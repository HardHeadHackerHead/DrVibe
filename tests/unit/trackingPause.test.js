// Pause tracking: 1 hour, until tomorrow or until resumed; survives a restart.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TrackingPause, pauseUntil, isPaused, pauseLabel } from '../../src/features/privacy/TrackingPause.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

function fakeSettings(values = {}) {
  return {
    values: { trackingPausedUntil: null, ...values },
    get(k) { return this.values[k]; },
    set(k, v) {
      if (this.values[k] === v) return;
      this.values[k] = v;
      eventBus.emit(Events.SETTINGS_CHANGED, { key: k, value: v });
    },
  };
}

afterEach(() => {
  eventBus.clear();
  vi.useRealTimers();
});

describe('pause times', () => {
  it('1 hour, until local midnight, or until resumed', () => {
    const now = new Date(2026, 9, 27, 15, 30).getTime();
    expect(pauseUntil('1h', now)).toBe(now + 3_600_000);
    expect(pauseUntil('tomorrow', now)).toBe(new Date(2026, 9, 28, 0, 0).getTime());
    expect(pauseUntil('manual', now)).toBe('manual');
    expect(isPaused('manual', now)).toBe(true);
    expect(isPaused(now + 1, now)).toBe(true);
    expect(isPaused(now, now)).toBe(false);
    expect(isPaused(null, now)).toBe(false);
    expect(pauseLabel(null, now)).toBe('Tracking is on');
    expect(pauseLabel('manual', now)).toBe('Tracking paused until you resume');
  });
});

describe('TrackingPause', () => {
  it('pauses and resumes the trackers, the hook and the tray', () => {
    const settings = fakeSettings();
    const invoke = vi.fn(async () => {});
    const pause = new TrackingPause({ settings, invoke, now: () => 1_000 });
    const events = [];
    eventBus.on(Events.TRACKING_PAUSED, (p) => events.push(['paused', p.until]));
    eventBus.on(Events.TRACKING_RESUMED, () => events.push(['resumed']));
    pause.init();
    expect(events).toEqual([]);

    pause.pause('manual');
    expect(pause.paused).toBe(true);
    expect(settings.values.trackingPausedUntil).toBe('manual');
    expect(invoke).toHaveBeenCalledWith('set_hook_paused', { untilSecs: 0 });
    expect(invoke).toHaveBeenCalledWith('set_tray_paused', { paused: true });

    pause.resume();
    expect(pause.paused).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith('set_tray_paused', { paused: false });
    expect(invoke).toHaveBeenCalledWith('set_hook_paused', { untilSecs: null });
    expect(events).toEqual([['paused', 'manual'], ['resumed']]);
    pause.pause('nonsense');
    expect(pause.paused).toBe(false);
  });

  it('a timed pause ends by itself, and an expired one is cleared at start', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const settings = fakeSettings();
    const pause = new TrackingPause({ settings });
    pause.init();
    pause.pause('1h');
    expect(pause.paused).toBe(true);
    vi.advanceTimersByTime(3_600_000 + 100);
    expect(pause.paused).toBe(false);
    expect(settings.values.trackingPausedUntil).toBeNull();

    const restarted = new TrackingPause({ settings: fakeSettings({ trackingPausedUntil: 5 }) });
    restarted.init();
    expect(restarted.paused).toBe(false);
    expect(restarted.until).toBeNull();
  });

  it('a pause saved before a restart is still on', () => {
    const settings = fakeSettings({ trackingPausedUntil: 'manual' });
    const paused = vi.fn();
    eventBus.on(Events.TRACKING_PAUSED, paused);
    new TrackingPause({ settings }).init();
    expect(paused).toHaveBeenCalledTimes(1);
  });

  it('follows a change made in the Settings window', () => {
    const settings = fakeSettings();
    const pause = new TrackingPause({ settings, now: () => 0 });
    pause.init();
    settings.set('trackingPausedUntil', 'manual');
    expect(pause.paused).toBe(true);
  });
});
