// Dr. Vibe — "Sync my stats" (Settings → Privacy, and the Join step of setup).
//
// Linked accounts sync by default (joining is the opt-in). Off keeps the
// account linked but holds back everything that shares stats or presence:
// profile sync, activity events (they wait in the queue), the poll, the
// weekly recap and privacy updates. Rust holds the same calls back
// (api.rs `set_sync_enabled`), so a module that forgets to check still
// sends nothing.

import { eventBus, Events } from './EventBus.js';

export class SyncSwitch {
  constructor({ bus = eventBus, invoke = () => window.__TAURI__?.core?.invoke } = {}) {
    this._bus = bus;
    this._invoke = invoke;
    this._enabled = true;
  }

  get enabled() { return this._enabled; }

  /** Set from `settings.syncEnabled` (missing = on). Tells Rust and the modules that wait on it. */
  set(enabled) {
    const next = enabled !== false;
    try { this._invoke()?.('set_sync_enabled', { enabled: next })?.catch?.(() => {}); } catch { /* no Tauri */ }
    if (next === this._enabled) return;
    this._enabled = next;
    this._bus.emit(Events.SYNC_ENABLED_CHANGED, { enabled: next });
  }
}

export const syncSwitch = new SyncSwitch();
