// Dr. Vibe — privacy settings: stored locally, sent only when changed.
//
// The website and the desktop share one privacy model (PLAN "One privacy
// model"). The desktop must never overwrite a choice made on the web, so it
// sends the settings only after the player changes one here, and only once:
// the change is marked pending, sent through desktopApi.updatePrivacy, and
// cleared on success. A change made while unlinked or offline stays pending
// and goes out on the next ACCOUNT_LINKED (or app start while linked).
//
// The settings window does not talk to the server itself: it emits
// `privacy-changed` to the main window, which owns this module.

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';
import { desktopApi } from '../../core/api/client.js';
import { accountState } from '../../core/AccountState.js';
import { PRIVACY_DEFAULTS, SEND_SWITCHES, buildPrivacyBody } from '../../core/api/contract.js';
import { syncSwitch } from '../../core/SyncSwitch.js';

const SECTION = 'privacy';

export class PrivacySync {
  /**
   * @param {Object} [deps]
   * @param {typeof desktopApi} [deps.api]
   * @param {{linked: boolean, markTokenRejected?: Function}} [deps.account]
   * @param {{load: () => any, save: (v: any) => void}} [deps.store]
   * @param {{enabled: boolean}} [deps.sync]  "Sync my stats"
   */
  constructor({
    api = desktopApi,
    account = accountState,
    store = { load: () => db.getSection(SECTION), save: (v) => db.setSection(SECTION, v) },
    sync = syncSwitch,
    now = () => Date.now(),
  } = {}) {
    this._now = now;
    this._api = api;
    this._account = account;
    this._sync = sync;
    this._store = store;
    this._sending = null;
  }

  init() {
    eventBus.on(Events.ACCOUNT_LINKED, () => { this.flush(); });
    eventBus.on(Events.SYNC_ENABLED_CHANGED, ({ enabled } = {}) => { if (enabled) this.flush(); });
    eventBus.on(Events.PRIVACY_FROM_SERVER, ({ privacy } = {}) => { this.applyServer(privacy); });
    const listen = window.__TAURI__?.event?.listen;
    if (listen) {
      listen('privacy-changed', (e) => {
        const { force, ...patch } = e?.payload || {};
        this.update(patch, { force: force === true });
      });
    }
    this.flush();
  }

  /** Current settings (defaults filled in). */
  get() {
    return buildPrivacyBody({ ...PRIVACY_DEFAULTS, ...(this._state().settings || {}) });
  }

  get pending() {
    return !!this._state().pending;
  }

  /**
   * Apply a local change. Only real changes are marked for sending, unless
   * `force` (the setup wizard): then the whole body goes out as an explicit
   * choice even where it equals the defaults.
   */
  update(patch, { force = false } = {}) {
    const before = this.get();
    const after = buildPrivacyBody({ ...before, ...patch });
    if (!force && JSON.stringify(before) === JSON.stringify(after)) return Promise.resolve(false);
    this._store.save({ settings: after, pending: true, localChangedAt: this._now() });
    return this.flush();
  }

  /**
   * Adopt the settings stored on the site (from the poll), e.g. a change
   * made on the web. A local change still waiting to be sent wins.
   */
  applyServer(server) {
    if (!server || this.pending) return false;
    // Fields the server left out (see parsePrivacy) keep their local value.
    const local = this.get();
    const state = this._state();
    const incoming = { ...server };
    // The send switches stop data on this computer: a server value replaces
    // a local choice only when it is newer than that choice (and than the
    // server's answer to it), i.e. a change made on the website since.
    const serverMs = Date.parse(server.updatedAt ?? '') || 0;
    const localMs = Math.max(state.localChangedAt || 0, Date.parse(state.ackedAt ?? '') || 0);
    if (localMs && serverMs <= localMs) {
      for (const key of SEND_SWITCHES) delete incoming[key];
    }
    const next = buildPrivacyBody({ ...local, ...incoming });
    if (JSON.stringify(next) === JSON.stringify(local) && state.serverUpdatedAt === server.updatedAt) return false;
    this._store.save({ ...state, settings: next, pending: false, serverUpdatedAt: server.updatedAt ?? null });
    return true;
  }

  /** Send a pending change if linked. Resolves true when the server accepted it. */
  flush() {
    if (this._sending) return this._sending;
    if (!this.pending || !this._account.linked || !this._sync.enabled) return Promise.resolve(false);
    const sent = this.get();
    this._sending = (async () => {
      try {
        const r = await this._api.updatePrivacy(sent);
        if (r.status === 401) this._account.markTokenRejected?.();
        if (!r.ok) return false;
        const stored = r.data?.updatedAt ?? null;
        // Only clear pending if nothing changed while the request was in flight.
        if (JSON.stringify(this.get()) === JSON.stringify(sent)) {
          this._store.save({ ...this._state(), settings: sent, pending: false, serverUpdatedAt: stored, ackedAt: stored });
        }
        return true;
      } finally {
        this._sending = null;
      }
    })();
    return this._sending;
  }

  _state() {
    const s = this._store.load();
    return s && typeof s === 'object' ? s : {};
  }
}

export const privacySync = new PrivacySync();
