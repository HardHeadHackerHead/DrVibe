// ActivityReporter re-reports today's streak day on init: the streak counts
// once a day, usually before the reporter subscribes during startup.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ActivityReporter } from '../../src/features/economy/ActivityReporter.js';
import { economyClient } from '../../src/features/economy/EconomyClient.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

describe('ActivityReporter', () => {
  it("re-reports today's counted streak day with its idempotent id", () => {
    const report = vi.spyOn(economyClient, 'reportActivity').mockImplementation(() => {});
    new ActivityReporter().init({ streakToday: () => ({ streakLength: 4, day: '2026-10-23' }) });
    expect(report).toHaveBeenCalledWith('STREAK_DAY', { streakLength: 4, day: '2026-10-23' }, 'streak-day-2026-10-23');
  });

  it('reports nothing when today is not counted yet, then reports the live event', () => {
    const report = vi.spyOn(economyClient, 'reportActivity').mockImplementation(() => {});
    new ActivityReporter().init({ streakToday: () => null });
    expect(report).not.toHaveBeenCalled();
    eventBus.emit(Events.STREAK_DAY_COUNTED, { streakLength: 1, day: '2026-10-23' });
    expect(report).toHaveBeenCalledWith('STREAK_DAY', { streakLength: 1, day: '2026-10-23' }, 'streak-day-2026-10-23');
  });
});
