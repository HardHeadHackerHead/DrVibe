// Dr. Vibe — 60-second poll for the equipped Dr. Vibe, notifications and visits.
//
// Replaces the Socket.io client: no long-lived connection, one cheap
// conditional GET a minute (If-None-Match / 304). Runs only while the app is
// linked to an account and pauses the moment it is unlinked.
//
// `GET /api/v1/desktop/poll` (API.md §3). Dispatches on the event bus:
//   COMPANION_EQUIPPED / COMPANION_UNEQUIPPED   when the equipped Dr. Vibe changes
//   COMPANION_FINISH_FROM_SERVER { id, finish } the same Dr. Vibe's finish (CompanionManager keeps changes)
//   ECONOMY_BALANCE_PUSH { newBalance }        the account's VP
//   LAB_ORIGINAL_CHOSEN { slug, chosenAt }     a Lab Original picked on the site (CompanionManager applies it once)
//   STREAK_FREEZE_FROM_SERVER { held, coveredDays }  streak freezes (DailyStreakTracker)
//   PRIVACY_FROM_SERVER { privacy }            settings as stored on the site
//   ACCOUNT_PROFILE_FROM_SERVER { username, displayName, avatarUrl }  the account as the site has it now
//   NOTIFICATION_RECEIVED { notification }     every desktop toast (then acked)
//   VISIT_RECEIVED { visit }                   another player's Dr. Vibe stopped by
//                                              (VisitorController acks played / missed)
//   POLL_STATUS { state }                      unlinked | connecting | live | offline | error | paused
//
// "Sync my stats" off (SyncSwitch) stops the poll too: status `paused`.

import { eventBus, Events } from './EventBus.js';
import { desktopApi } from './api/client.js';
import { accountState } from './AccountState.js';
import { syncSwitch } from './SyncSwitch.js';

export const POLL_INTERVAL_MS = 60_000;

export class PollClient {
  /**
   * @param {Object} [deps]
   * @param {typeof desktopApi} [deps.api]
   * @param {typeof eventBus} [deps.bus]
   * @param {{linked: boolean, markTokenRejected?: Function}} [deps.account]
   * @param {() => string|null} [deps.getEquippedId]  id currently on the desktop
   * @param {number} [deps.intervalMs]
   * @param {{enabled: boolean}} [deps.sync]  "Sync my stats"
   */
  constructor({ api = desktopApi, bus = eventBus, account = accountState, getEquippedId = () => null, intervalMs = POLL_INTERVAL_MS, sync = syncSwitch } = {}) {
    this._api = api;
    this._bus = bus;
    this._account = account;
    this._sync = sync;
    this._getEquippedId = getEquippedId;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._etag = null;
    this._inFlight = false;
    this._running = false;
    this._unsubs = [];
    this._seen = new Set(); // notification/visit ids already dispatched
    this._status = null;
  }

  get running() { return this._running; }
  get status() { return this._status; }

  start() {
    if (this._running) return;
    this._running = true;
    this._unsubs.push(
      this._bus.on(Events.ACCOUNT_LINKED, () => {
        this._etag = null;
        this._setStatus('connecting');
        this._schedule(0);
      }),
      this._bus.on(Events.ACCOUNT_UNLINKED, () => {
        this._pause();
        this._setStatus('unlinked');
      }),
      this._bus.on(Events.SYNC_ENABLED_CHANGED, ({ enabled } = {}) => {
        if (!this._account.linked) return;
        if (enabled) {
          this._setStatus('connecting');
          this._schedule(0);
        } else {
          this._pause();
          this._setStatus('paused');
        }
      }),
    );
    if (this._account.linked && !this._sync.enabled) {
      this._setStatus('paused');
    } else if (this._account.linked) {
      this._setStatus('connecting');
      this._schedule(0);
    } else {
      this._setStatus('unlinked');
    }
  }

  stop() {
    this._running = false;
    this._pause();
    for (const off of this._unsubs) { try { off?.(); } catch { /* ignore */ } }
    this._unsubs = [];
  }

  /** Poll now (also used after waking from sleep). */
  async pollNow() {
    if (!this._running || this._inFlight || !this._account.linked) return;
    if (!this._sync.enabled) return this._setStatus('paused');
    this._inFlight = true;
    let nextMs = this._intervalMs;
    try {
      const r = await this._api.poll(this._etag);
      if (r.unlinked) {
        this._setStatus('unlinked');
        return this._pause();
      }
      if (r.status === 401) {
        this._setStatus('error');
        this._account.markTokenRejected?.();
        // A revoked token is gone for good (Rust forgot it); other 401s
        // (clock skew) are retried on the normal schedule.
        if (r.error === 'invalid_device_token') return this._pause();
      }
      if (r.status === 429 && r.retryAfterSeconds) nextMs = r.retryAfterSeconds * 1000;
      if (r.status === 0 || r.status >= 500) this._setStatus('offline');
      if (r.notModified) {
        this._setStatus('live');
        return;
      }
      if (r.ok && r.poll) {
        this._setStatus('live');
        if (r.etag) this._etag = r.etag;
        this._dispatch(r.poll);
      }
    } catch (e) {
      console.warn('[poll] failed:', e);
    } finally {
      this._inFlight = false;
      if (this._running && this._account.linked && this._sync.enabled) this._schedule(nextMs);
    }
  }

  /** @param {import('./api/contract.js').PollResult} poll */
  _dispatch(poll) {
    if (poll.equipped === null) {
      // A Lab Original chosen on the site replaces the companion in one
      // switch; CompanionManager ignores a chosenAt it already applied.
      if (poll.labOriginal) this._bus.emit(Events.LAB_ORIGINAL_CHOSEN, { ...poll.labOriginal });
      else if (this._getEquippedId()) this._bus.emit(Events.COMPANION_UNEQUIPPED, {});
    } else if (poll.equipped && poll.equipped.id !== this._getEquippedId()) {
      this._bus.emit(Events.COMPANION_EQUIPPED, { ...poll.equipped });
    } else if (poll.equipped) {
      // Same Dr. Vibe; its finish may be new (a season's crowned grant), or
      // the Lab may have replaced its art (new versioned sheet URL).
      this._bus.emit(Events.COMPANION_FINISH_FROM_SERVER, { id: poll.equipped.id, finish: poll.equipped.finish });
      this._bus.emit(Events.COMPANION_ART_FROM_SERVER, { ...poll.equipped });
    }

    if (poll.account) this._bus.emit(Events.ECONOMY_BALANCE_PUSH, { newBalance: poll.account.vibePoints });
    if (poll.account?.username) {
      const { username, displayName, avatarUrl } = poll.account;
      this._bus.emit(Events.ACCOUNT_PROFILE_FROM_SERVER, { username, displayName, avatarUrl });
    }
    if (poll.streakFreeze) this._bus.emit(Events.STREAK_FREEZE_FROM_SERVER, { ...poll.streakFreeze });
    if (poll.privacy) this._bus.emit(Events.PRIVACY_FROM_SERVER, { privacy: poll.privacy });

    const shown = [];
    for (const n of poll.notifications) {
      shown.push(n.id);
      if (this._markSeen(`n:${n.id}`)) continue;
      this._bus.emit(Events.NOTIFICATION_RECEIVED, { notification: n });
    }
    // Toasts leave the poll once acked (held ones are queued locally).
    if (shown.length) {
      Promise.resolve(this._api.ack?.({ notificationIds: shown })).catch(() => {});
    }

    for (const v of poll.visits) {
      if (this._markSeen(`v:${v.id}`)) continue;
      this._bus.emit(Events.VISIT_RECEIVED, { visit: v });
    }
  }

  /** Returns true if already seen. Keeps the set bounded. */
  _markSeen(key) {
    if (this._seen.has(key)) return true;
    this._seen.add(key);
    if (this._seen.size > 500) this._seen = new Set([...this._seen].slice(-250));
    return false;
  }

  _setStatus(state) {
    if (state === this._status) return;
    this._status = state;
    this._bus.emit(Events.POLL_STATUS, { state });
  }

  _schedule(ms) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.pollNow(); }, Math.max(0, ms));
  }

  _pause() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._etag = null;
  }
}
