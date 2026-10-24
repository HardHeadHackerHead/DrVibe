// Dr. Vibe — Companion Manager
// Handles companion equip/unequip events, sprite caching with LRU eviction,
// living stat tracking, tray menu updates, and sync payload contributions.
// Replaces the inline COMPANION_EQUIPPED handler that was in app.js.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';
import { desktopApi } from '../../core/api/client.js';

const DEFAULT_SKIN = 'dr-vibe-default';

export class CompanionManager {
  constructor() {
    this._equippedId   = null;
    this._companions   = [];    // [{ id, name, slug }]
    this._livingStats  = {};    // { [id]: { hoursAccompanied, sessionsCount, lastActiveAt } }
    this._sessionStart = null;
    this._settings     = null;  // injected via init()
    this._originalSkin = null;  // last non-companion skin the user picked
    this._labOriginalChosenAt = null; // last site "Wear" applied (poll labOriginal.chosenAt)
  }

  async init(settings) {
    this._settings = settings;

    // Restore persisted companion state
    const state = db.getSection('companion') || {};
    this._equippedId  = state.equippedId  || null;
    this._companions  = state.companions  || [];
    this._livingStats = state.livingStats || {};
    this._originalSkin = state.originalSkin || null;
    this._labOriginalChosenAt = state.labOriginalChosenAt || null;
    this._rememberOriginalSkin(settings?.get?.('selectedSkin'));

    if (this._equippedId) this._sessionStart = Date.now();

    // Equip changes from the 60 s poll (PollClient)
    eventBus.on(Events.COMPANION_EQUIPPED,   (data) => this._onEquipped(data));
    eventBus.on(Events.COMPANION_UNEQUIPPED, ()     => this._onUnequipped());
    eventBus.on(Events.LAB_ORIGINAL_CHOSEN,  (data) => this._onLabOriginalChosen(data));

    // Reconcile _equippedId whenever the active skin changes (Settings Panel
    // pick, programmatic, etc.). When _onEquipped/_equipFromCache are the
    // source they set _equippedId before this fires, so it no-ops; when the
    // user picks a community skin from the Settings grid this clears it.
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key !== 'selectedSkin') return;
      if (this._rememberOriginalSkin(value)) this._saveState();
      this.syncEquippedToSlug(value);
    });

    // Linking mid-session: fetch the collection now, not at the next start.
    eventBus.on(Events.ACCOUNT_LINKED, () => { this._fetchCompanions().catch(() => {}); });
    eventBus.on(Events.ACCOUNT_UNLINKED, () => this._onAccountUnlinked());

    // Tray equip click forwarded from Rust via window.emit
    if (tauri.isAvailable) {
      const listen = window.__TAURI__?.event?.listen;
      if (listen) {
        await listen('companion-tray-equip', (ev) => this._equipFromCache(ev.payload));
      }
    }

    // Populate tray with any cached companions (no network needed)
    this._updateTray();

    // Fetch live companion list (non-blocking, updates tray when resolved)
    this._fetchCompanions().catch(() => {});
  }

  // ── Equip event handlers ──────────────────────────────────────────────────

  async _onEquipped({ id, slug, name, pngUrl, animUrl, animJson }) {
    if (!slug || !pngUrl) return;
    try {
      const finalSlug = await tauri.invoke('cache_companion_skin', {
        id:       id || slug,
        slug,
        name:     name || slug,
        pngUrl,
        animUrl:  animUrl || null,
        animJson: animJson || null,
      });

      // Flush stats for the previously equipped companion before switching
      if (this._equippedId) this._flushLivingStats();

      this._equippedId  = id || slug;
      this._sessionStart = Date.now();

      // Upsert in local companion list
      const existing = this._companions.find(c => c.id === this._equippedId);
      if (existing) {
        existing.name = name || slug;
        existing.slug = finalSlug;
        existing.cached = true;
      } else {
        this._companions.push({ id: this._equippedId, name: name || slug, slug: finalSlug, editionSlug: slug, spriteSheetUrl: pngUrl, animJson: animJson || null, cached: true });
      }

      // Initialise living stats for this companion if not seen before
      if (!this._livingStats[this._equippedId]) {
        this._livingStats[this._equippedId] = { hoursAccompanied: 0, sessionsCount: 0, lastActiveAt: null };
      }
      this._livingStats[this._equippedId].sessionsCount++;
      this._livingStats[this._equippedId].lastActiveAt = new Date().toISOString();

      this._saveState();

      // Switch skin → triggers SpriteAnimator.loadSkin via SETTINGS_CHANGED event
      this._settings.set('selectedSkin', finalSlug);

      this._updateTray();
      console.log('[companion] Equipped:', finalSlug);
    } catch (e) {
      console.error('[companion] Failed to equip companion skin:', e);
    }
  }

  _onUnequipped() {
    this._flushLivingStats();
    this._equippedId  = null;
    this._sessionStart = null;
    this._saveState();

    // Revert to the Lab Original (or own skin) the user had picked
    const skin = this._originalSkin || DEFAULT_SKIN;
    this._settings.set('selectedSkin', skin);

    this._updateTray();
    console.log(`[companion] Unequipped — reverted to ${skin}`);
  }

  /**
   * A Lab Original picked on the website ("Wear"), from the poll. Applied
   * once per `chosenAt`, like a pick in the Settings grid: the companion is
   * dropped locally (the server already cleared it, so no PUT), and the
   * original becomes the skin to return to on unequip. A later pick on the
   * desktop wins until the player chooses again on the site.
   */
  _onLabOriginalChosen({ slug, chosenAt } = {}) {
    if (!slug || !chosenAt) return;
    if (chosenAt === this._labOriginalChosenAt) {
      // Already applied; the poll's null `equipped` still means no companion.
      if (this._equippedId) this._onUnequipped();
      return;
    }
    const skin = `dr-vibe-${slug}`;
    this._flushLivingStats();
    this._equippedId = null;
    this._sessionStart = null;
    this._labOriginalChosenAt = chosenAt;
    this._originalSkin = skin;
    this._saveState();
    this._settings.set('selectedSkin', skin);
    this._updateTray();
    console.log(`[companion] Wearing ${skin}, chosen on the site`);
  }

  /** Account unlinked: the collection belongs to the account, so forget it. */
  _onAccountUnlinked() {
    this._flushLivingStats();
    this._equippedId   = null;
    this._sessionStart = null;
    this._companions   = [];
    this._saveState();
    this._updateTray();
  }

  /** Remember `slug` as the skin to return to on unequip unless it's a companion. Returns true if it changed. */
  _rememberOriginalSkin(slug) {
    if (typeof slug !== 'string' || !slug) return false;
    if (slug.startsWith('companion-') || this._companions.some(c => c.slug === slug)) return false;
    if (slug === this._originalSkin) return false;
    this._originalSkin = slug;
    return true;
  }

  // ── Skin-driven reconciliation ────────────────────────────────────────────

  /**
   * Reconcile _equippedId with the active sprite slug.
   * Called from Settings Panel after the user picks a skin card; the Panel
   * already handles `selectedSkin`, so this method only manages our own view
   * of which (if any) companion is active.
   *  - slug matches an owned companion's slug → mark that companion equipped
   *  - otherwise (community / built-in skin)  → clear _equippedId
   * The next _syncProfile() will then write the right value (or null) to
   * UserProfile.equippedCompanionId on the website.
   */
  syncEquippedToSlug(slug) {
    const companion = (typeof slug === 'string' && slug)
      ? this._companions.find(c => c.slug === slug)
      : null;
    const newId = companion ? companion.id : null;
    if (newId === this._equippedId) return;

    this._flushLivingStats();
    this._equippedId   = newId;
    this._sessionStart = newId ? Date.now() : null;

    if (newId) {
      if (!this._livingStats[newId]) {
        this._livingStats[newId] = { hoursAccompanied: 0, sessionsCount: 0, lastActiveAt: null };
      }
      this._livingStats[newId].sessionsCount++;
      this._livingStats[newId].lastActiveAt = new Date().toISOString();
    }

    this._saveState();
    this._updateTray();
    console.log(
      '[companion]',
      newId ? `Equipped via skin pick: ${companion.slug} (${newId})`
            : 'Cleared equip — non-companion skin active'
    );

    // Best-effort server sync so the inventory page reflects the change instantly
    // instead of waiting up to 15 minutes for the next _syncProfile().
    if (newId) {
      this._syncEquipToServer(newId).catch(() => {});
    } else {
      this._syncUnequipToServer().catch(() => {});
    }
  }

  // ── Tray equip (local, from cached sprite) ────────────────────────────────

  async _equipFromCache({ id }) {
    if (!id || id === this._equippedId) return;
    const companion = this._companions.find(c => c.id === id);
    if (!companion) return;

    // Download the sheet first if this Dr. Vibe has never been worn here.
    if (companion.spriteSheetUrl && !companion.cached) {
      try {
        companion.slug = await tauri.invoke('cache_companion_skin', {
          id,
          slug: companion.editionSlug || companion.slug.replace(/^companion-/, ''),
          name: companion.name,
          pngUrl: companion.spriteSheetUrl,
          animUrl: null,
          animJson: companion.animJson || null,
        });
        companion.cached = true;
      } catch (e) {
        console.warn('[companion] could not download that Dr. Vibe:', e);
        return;
      }
    }

    this._flushLivingStats();
    this._equippedId  = id;
    this._sessionStart = Date.now();

    if (!this._livingStats[id]) {
      this._livingStats[id] = { hoursAccompanied: 0, sessionsCount: 0, lastActiveAt: null };
    }
    this._livingStats[id].sessionsCount++;
    this._livingStats[id].lastActiveAt = new Date().toISOString();

    this._saveState();
    this._settings.set('selectedSkin', companion.slug);
    this._updateTray();

    // Best-effort server sync so website profile reflects the change
    this._syncEquipToServer(id).catch(() => {});
  }

  // ── Server interactions ───────────────────────────────────────────────────

  // PUT /desktop/equipped (signed); the poll then reports the same choice.
  async _syncEquipToServer(companionId) {
    const r = await desktopApi.setEquipped(companionId);
    if (!r.ok && !r.unlinked) throw new Error(`HTTP ${r.status} ${r.error || ''}`);
  }

  async _syncUnequipToServer() {
    const r = await desktopApi.setEquipped(null);
    if (!r.ok && !r.unlinked) throw new Error(`HTTP ${r.status} ${r.error || ''}`);
  }

  async _fetchCompanions() {
    // GET /desktop/collection → { equippedId, companions: CollectionEntry[] }
    const r = await desktopApi.collection();
    if (r.unlinked) return;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const { equippedId } = r.data || {};
    const companions = (r.data?.companions || []).map((c) => ({
      id: c.companionId,
      slug: c.editionSlug,
      name: c.name,
      spriteSheetUrl: c.spriteSheetUrl || null,
      animJson: c.animJson || null,
    }));

    // Server-truth reconciliation: a successful 200 response is authoritative.
    // Build a fresh local list from the server payload, preserving any cached
    // slug that already has the `companion-` prefix (means the sprite has been
    // downloaded and `loadSkin` needs that exact name). Companions the server
    // no longer returns are dropped — fixes the "stale tray entries from old
    // dev sessions" bug where the previous additive merge left orphans forever.
    const reconciled = companions.map(c => {
      const prefixedSlug = `companion-${c.slug}`;
      const existing = this._companions.find(x => x.id === c.id);
      const slug = existing?.slug?.startsWith('companion-') ? existing.slug : prefixedSlug;
      return {
        id: c.id,
        name: c.name || existing?.name,
        slug,
        editionSlug: c.slug,
        spriteSheetUrl: c.spriteSheetUrl,
        animJson: c.animJson,
        cached: !!existing?.cached,
      };
    });

    // Drop livingStats for companions the server no longer reports — keeps
    // the on-disk store from accumulating orphaned hour-counters.
    const validIds = new Set(reconciled.map(c => c.id));
    for (const id of Object.keys(this._livingStats)) {
      if (!validIds.has(id)) delete this._livingStats[id];
    }

    this._companions = reconciled;

    // Reconcile equipped ID if server disagrees with local state
    const prevEquippedId = this._equippedId;
    if (equippedId !== undefined && equippedId !== prevEquippedId) {
      this._equippedId = equippedId || null;
      this._saveState();

      // If the server says a companion is equipped that we haven't cached yet,
      // download and apply it now (handles the case where the user equipped via
      // the website while Dr. Vibe was offline).
      if (equippedId) {
        const companion = companions.find(c => c.id === equippedId);
        if (companion?.spriteSheetUrl) {
          try {
            const finalSlug = await tauri.invoke('cache_companion_skin', {
              id:       companion.id,
              slug:     companion.slug,
              name:     companion.name,
              pngUrl:   companion.spriteSheetUrl,
              animUrl:  null,
              animJson: companion.animJson,
            });
            // Update local cache with confirmed slug and apply the skin
            const local = this._companions.find(x => x.id === equippedId);
            if (local) local.slug = finalSlug;
            this._settings.set('selectedSkin', finalSlug);
          } catch (e) {
            console.warn('[companion] Could not cache companion skin from server:', e);
          }
        }
      }
    }

    this._saveState();
    this._updateTray();
  }

  // ── Living stats ──────────────────────────────────────────────────────────

  /** Accumulate hours for the currently equipped companion then reset the clock. */
  _flushLivingStats() {
    if (!this._equippedId || !this._sessionStart) return;
    const hours = (Date.now() - this._sessionStart) / 3_600_000;
    const stats = (this._livingStats[this._equippedId] ??= { hoursAccompanied: 0, sessionsCount: 0, lastActiveAt: null });
    stats.hoursAccompanied += hours;
    stats.lastActiveAt = new Date().toISOString();
    this._sessionStart = Date.now(); // reset so future flushes don't double-count
  }

  /** Called by _syncProfile to include companion data in the sync payload. */
  getEquippedStats() {
    this._flushLivingStats();
    if (!this._equippedId) return null;
    const stats = this._livingStats[this._equippedId] || {};
    return {
      companionId:      this._equippedId,
      hoursAccompanied: stats.hoursAccompanied || 0,
      sessionsCount:    stats.sessionsCount    || 0,
      lastActiveAt:     stats.lastActiveAt     || null,
    };
  }

  getEquippedId() { return this._equippedId; }

  // ── Persistence ───────────────────────────────────────────────────────────

  _saveState() {
    db.setSection('companion', {
      equippedId:  this._equippedId,
      companions:  this._companions,
      livingStats: this._livingStats,
      originalSkin: this._originalSkin,
      labOriginalChosenAt: this._labOriginalChosenAt,
    });
  }

  // ── Tray ──────────────────────────────────────────────────────────────────

  async _updateTray() {
    if (!tauri.invoke) return;
    try {
      await tauri.invoke('update_companions_tray', {
        companions: this._companions.map(c => ({ id: c.id, name: c.name })),
        equippedId: this._equippedId,
      });
    } catch { /* non-critical */ }
  }
}

export const companionManager = new CompanionManager();
