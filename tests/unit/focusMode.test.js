import { describe, it, expect, afterEach, vi } from 'vitest';
import { FocusMode } from '../../src/features/focus/FocusMode.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

afterEach(() => {
  eventBus.clear();
  vi.useRealTimers();
});

describe('FocusMode', () => {
  it('reports how many minutes the session lasted', () => {
    vi.useFakeTimers();
    const settings = { focusModeDuration: 25, set: vi.fn() };
    const focus = new FocusMode(settings);
    const ended = vi.fn();
    eventBus.on(Events.FOCUS_MODE_ENDED, ended);
    focus.start(25);
    vi.advanceTimersByTime(12 * 60 * 1000);
    focus.end();
    expect(ended).toHaveBeenCalledWith({ completed: false, durationMinutes: 12 });
  });
});
