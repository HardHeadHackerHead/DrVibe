// Dr. Vibe — Pause tracking (tray menu and Settings → Privacy).
//
// For 1 hour, until tomorrow or until resumed, Dr. Vibe stops looking:
// the window poll (ActivityMonitor), the folder watcher, git polling and
// the Claude Code log reader stop, and the Claude Code hook writes nothing
// (~/.dr-vibe/paused-until). The screen-share guard keeps running, because
// it protects privacy. The setting is `trackingPausedUntil`: epoch ms,
// 'manual' (until I resume) or null; a pause outlives a restart.

import { eventBus, Events } from '../../core/EventBus.js';

export const PAUSE_MODES = Object.freeze(['1h', 'tomorrow', 'manual']);

/** When a pause started at `now` ends: epoch ms, or 'manual'. */
export function pauseUntil(mode, now = Date.now()) {
  if (mode === 'manual') return 'manual';
  if (mode === 'tomorrow') {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0); // local midnight
    return d.getTime();
  }
  return now + 60 * 60 * 1000;
}

/** Whether `until` (the setting) means paused at `now`. */
export function isPaused(until, now = Date.now()) {
  return until === 'manual' || (typeof until === 'number' && now < until);
}

/** Short status line for the tray and Settings. */
export function pauseLabel(until, now = Date.now()) {
  if (!isPaused(until, now)) return 'Tracking is on';
  if (until === 'manual') return 'Tracking paused until you resume';
  const end = new Date(until);
  const sameDay = new Date(now).toDateString() === end.toDateString();
  const time = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Tracking paused until ${time}` : `Tracking paused until ${end.toLocaleDateString()} ${time}`;
}

export class TrackingPause {
  /**
   * @param {Object} deps
   * @param {{get: (k: string) => any, set: (k: string, v: any) => void}} deps.settings
   * @param {typeof eventBus} [deps.bus]
   * @param {() => number} [deps.now]
   * @param {(cmd: string, args?: any) => Promise<any>} [deps.invoke]  Tauri invoke
   */
  constructor({ settings, bus = eventBus, now = () => Date.now(), invoke = null }) {
    this._settings = settings;
    this._bus = bus;
    this._now = now;
    this._invoke = invoke;
    this._paused = false;
    this._timer = null;
  }

  get paused() { return this._paused; }
  get until() { return this._settings.get('trackingPausedUntil') ?? null; }

  init() {
    this._bus.on(Events.SETTINGS_CHANGED, ({ key }) => {
      if (key === 'trackingPausedUntil') this.apply();
    });
    this.apply();
  }

  /** Pause for `mode` ('1h' | 'tomorrow' | 'manual'). */
  pause(mode) {
    if (!PAUSE_MODES.includes(mode)) return;
    this._settings.set('trackingPausedUntil', pauseUntil(mode, this._now()));
    this.apply();
  }

  resume() {
    this._settings.set('trackingPausedUntil', null);
    this.apply();
  }

  /** Brings the trackers, the hook and the timer in line with the setting. */
  apply() {
    clearTimeout(this._timer);
    this._timer = null;
    const until = this.until;
    const paused = isPaused(until, this._now());
    if (!paused && until !== null) {
      // An expired pause: clear it so Settings shows "on" again.
      this._settings.set('trackingPausedUntil', null);
    }
    if (paused && typeof until === 'number') {
      // setTimeout is capped near 24.8 days; a pause never runs that long.
      this._timer = setTimeout(() => this.apply(), Math.min(until - this._now() + 50, 2 ** 31 - 1));
    }
    this._tellHook(paused ? until : null);
    if (paused === this._paused) return;
    this._paused = paused;
    this._bus.emit(paused ? Events.TRACKING_PAUSED : Events.TRACKING_RESUMED, paused ? { until } : {});
  }

  destroy() {
    clearTimeout(this._timer);
  }

  _tellHook(until) {
    if (!this._invoke) return;
    const untilSecs = until === null ? null : until === 'manual' ? 0 : Math.ceil(until / 1000);
    Promise.resolve(this._invoke('set_hook_paused', { untilSecs })).catch(() => {});
    Promise.resolve(this._invoke('set_tray_paused', { paused: until !== null })).catch(() => {});
  }
}
