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
import { PRIVACY_DEFAULTS, buildPrivacyBody } from '../../core/api/contract.js';

const SECTION = 'privacy';

export class PrivacySync {
  /**
   * @param {Object} [deps]
   * @param {typeof desktopApi} [deps.api]
   * @param {{linked: boolean, markTokenRejected?: Function}} [deps.account]
   * @param {{load: () => any, save: (v: any) => void}} [deps.store]
   */
  constructor({
    api = desktopApi,
    account = accountState,
    store = { load: () => db.getSection(SECTION), save: (v) => db.setSection(SECTION, v) },
  } = {}) {
    this._api = api;
    this._account = account;
    this._store = store;
    this._sending = null;
  }

  init() {
    eventBus.on(Events.ACCOUNT_LINKED, () => { this.flush(); });
    eventBus.on(Events.PRIVACY_FROM_SERVER, ({ privacy } = {}) => { this.applyServer(privacy); });
    const listen = window.__TAURI__?.event?.listen;
    if (listen) {
      listen('privacy-changed', (e) => { this.update(e?.payload || {}); });
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

  /** Apply a local change. Only real changes are marked for sending. */
  update(patch) {
    const before = this.get();
    const after = buildPrivacyBody({ ...before, ...patch });
    if (JSON.stringify(before) === JSON.stringify(after)) return Promise.resolve(false);
    this._store.save({ settings: after, pending: true });
    return this.flush();
  }

  /**
   * Adopt the settings stored on the site (from the poll), e.g. a change
   * made on the web. A local change still waiting to be sent wins.
   */
  applyServer(server) {
    if (!server || this.pending) return false;
    const next = buildPrivacyBody(server);
    const state = this._state();
    if (JSON.stringify(next) === JSON.stringify(this.get()) && state.serverUpdatedAt === server.updatedAt) return false;
    this._store.save({ settings: next, pending: false, serverUpdatedAt: server.updatedAt ?? null });
    return true;
  }

  /** Send a pending change if linked. Resolves true when the server accepted it. */
  flush() {
    if (this._sending) return this._sending;
    if (!this.pending || !this._account.linked) return Promise.resolve(false);
    const sent = this.get();
    this._sending = (async () => {
      try {
        const r = await this._api.updatePrivacy(sent);
        if (r.status === 401) this._account.markTokenRejected?.();
        if (!r.ok) return false;
        const stored = r.data?.updatedAt ?? null;
        // Only clear pending if nothing changed while the request was in flight.
        if (JSON.stringify(this.get()) === JSON.stringify(sent)) {
          this._store.save({ settings: sent, pending: false, serverUpdatedAt: stored });
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
