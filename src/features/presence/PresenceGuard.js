// Dr. Vibe — stay out of the way during screen shares and fullscreen apps.
//
// Rust (src-tauri/src/presence.rs) emits `presenting-changed` whenever a
// screen share (Zoom, Teams, Meet, Discord, OBS) or a fullscreen app starts
// or stops. While presenting, and if `hideWhenPresenting` is on (default),
// Dr. Vibe and his speech bubble hide, and toasts and visits wait: Notifier
// and the visitor controller ask `presenceGuard.holding` and queue until
// PRESENTING_ENDED.

import { eventBus, Events } from '../../core/EventBus.js';

export class PresenceGuard {
  /**
   * @param {Object} [deps]
   * @param {{ get: (key: string) => any }} [deps.settings]
   * @param {{ hide: () => Promise<void>|void, show: () => Promise<void>|void, isVisible: () => Promise<boolean>|boolean }} [deps.character]
   * @param {typeof eventBus} [deps.bus]
   */
  constructor({ settings = null, character = null, bus = eventBus } = {}) {
    this._settings = settings;
    this._character = character;
    this._bus = bus;
    this._state = { presenting: false, reason: null, app: null };
    this._weHid = false;
  }

  /** True while presenting and the player wants Dr. Vibe out of the way. */
  get holding() {
    return this._state.presenting && this._enabled();
  }

  get state() {
    return { ...this._state };
  }

  async init() {
    const listen = window.__TAURI__?.event?.listen;
    if (listen) {
      await listen('presenting-changed', (e) => { this.apply(e?.payload || {}); });
    }
    try {
      const now = await window.__TAURI__?.core?.invoke?.('get_presenting_state');
      if (now) await this.apply(now);
    } catch { /* not in Tauri */ }

    // Turning the setting off mid-share brings Dr. Vibe straight back.
    this._bus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key !== 'hideWhenPresenting' || !this._state.presenting) return;
      if (value === false) this._release();
      else this._engage();
    });
  }

  /** Apply a `PresentingState` from Rust: { presenting, reason, app }. */
  async apply(next) {
    const presenting = !!next.presenting;
    const was = this._state.presenting;
    this._state = { presenting, reason: next.reason || null, app: next.app || null };
    if (presenting === was) return;
    if (presenting) await this._engage();
    else await this._release();
  }

  _enabled() {
    return this._settings?.get?.('hideWhenPresenting') !== false;
  }

  async _engage() {
    if (!this._enabled()) return;
    if (this._character && !this._weHid) {
      const visible = await this._character.isVisible();
      if (visible) {
        await this._character.hide();
        this._weHid = true;
      }
    }
    this._bus.emit(Events.PRESENTING_STARTED, { reason: this._state.reason, app: this._state.app });
  }

  async _release() {
    // Only re-show if we were the ones who hid him (the tray "Hide" wins).
    if (this._character && this._weHid) {
      await this._character.show();
    }
    this._weHid = false;
    this._bus.emit(Events.PRESENTING_ENDED, {});
  }
}
