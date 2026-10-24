// DailyStreakTracker: consecutive coding days, the 36-hour grace period,
// milestones and recovery.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DailyStreakTracker } from '../../src/features/streak/DailyStreakTracker.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';

const DAY = 24 * 60 * 60 * 1000;
let saved;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  saved = null;
  vi.spyOn(db, 'getSection').mockImplementation(() => saved);
  vi.spyOn(db, 'setSection').mockImplementation((_s, v) => { saved = JSON.parse(JSON.stringify(v)); });
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function tracker() {
  const t = new DailyStreakTracker();
  await t.init();
  return t;
}

function codeToday() {
  eventBus.emit(Events.ACTIVITY_CODING_START, { appName: 'Code' });
}

describe('DailyStreakTracker', () => {
  it('starts a streak on the first coding day and counts it once per day', async () => {
    const t = await tracker();
    codeToday();
    codeToday();
    expect(t.getData().current).toBe(1);
  });

  it('grows by one on each consecutive day', async () => {
    let t = await tracker();
    codeToday();
    for (let day = 1; day <= 6; day++) {
      t.destroy();
      eventBus.clear();
      vi.setSystemTime(new Date(Date.now() + DAY));
      t = await tracker();
      codeToday();
    }
    expect(t.getData().current).toBe(7);
    expect(t.getData().max).toBe(7);
  });

  it('celebrates the 7-day milestone', async () => {
    const milestones = [];
    let t = await tracker();
    codeToday();
    for (let day = 1; day <= 6; day++) {
      t.destroy();
      eventBus.clear();
      eventBus.on(Events.STREAK_MILESTONE, (m) => milestones.push(m.milestone));
      vi.setSystemTime(new Date(Date.now() + DAY));
      t = await tracker();
      codeToday();
    }
    expect(milestones).toEqual([7]);
  });

  it('breaks after the grace period and restarts at 1, keeping history', async () => {
    let t = await tracker();
    codeToday();
    t.destroy();
    eventBus.clear();
    vi.setSystemTime(new Date(Date.now() + DAY));
    t = await tracker();
    codeToday();
    expect(t.getData().current).toBe(2);

    t.destroy();
    eventBus.clear();
    vi.setSystemTime(new Date(Date.now() + 3 * DAY));
    t = await tracker();
    expect(t.getData().current).toBe(0);
    codeToday();
    const d = t.getData();
    expect(d.current).toBe(1);
    expect(d.max).toBe(2);
    expect(d.streakHistory.at(-1).length).toBe(2);
  });
});

describe('streak freezes', () => {
  // Coded on Mon 2026-10-05 in the evening, then reopened on a later day.
  async function codedMonday() {
    vi.setSystemTime(new Date(2026, 9, 5, 20));
    const t = await tracker();
    codeToday();
    return t;
  }
  async function laterDay(t, date, freeze) {
    t.destroy();
    eventBus.clear();
    vi.setSystemTime(date);
    const next = await tracker();
    if (freeze) eventBus.emit(Events.STREAK_FREEZE_FROM_SERVER, freeze);
    return next;
  }

  it('no freezes: a missed day still breaks the streak', async () => {
    let t = await codedMonday();
    t = await laterDay(t, new Date(2026, 9, 7, 20));
    codeToday();
    expect(t.getData().current).toBe(1);
  });

  it('a day the server covered keeps the streak, and the next coding day grows it by one', async () => {
    let t = await codedMonday();
    t = await laterDay(t, new Date(2026, 9, 7, 20), { held: 0, coveredDays: ['2026-10-06'] });
    t._periodicCheck();
    expect(t.getData().current).toBe(1);
    const counted = [];
    eventBus.on(Events.STREAK_DAY_COUNTED, (d) => counted.push(d));
    codeToday();
    expect(t.getData().current).toBe(2);
    expect(counted).toEqual([{ streakLength: 2, day: '2026-10-07' }]);
  });

  it('a held freeze covers a missed day the server has not spent yet', async () => {
    let t = await codedMonday();
    t = await laterDay(t, new Date(2026, 9, 7, 20), { held: 1, coveredDays: [] });
    codeToday();
    expect(t.getData().current).toBe(2);
  });

  it('two missed days with one freeze break the streak', async () => {
    let t = await codedMonday();
    t = await laterDay(t, new Date(2026, 9, 8, 20), { held: 1, coveredDays: [] });
    codeToday();
    expect(t.getData().current).toBe(1);
  });

  it('two missed days with two freezes, or one spent and one held, keep it', async () => {
    let t = await codedMonday();
    t = await laterDay(t, new Date(2026, 9, 8, 20), { held: 2, coveredDays: [] });
    codeToday();
    expect(t.getData().current).toBe(2);

    t.destroy();
    eventBus.clear();
    saved = null;
    t = await codedMonday();
    t = await laterDay(t, new Date(2026, 9, 8, 20), { held: 1, coveredDays: ['2026-10-06'] });
    codeToday();
    expect(t.getData().current).toBe(2);
  });

  it('remembers the freezes across restarts', async () => {
    let t = await codedMonday();
    eventBus.emit(Events.STREAK_FREEZE_FROM_SERVER, { held: 1, coveredDays: [] });
    t = await laterDay(t, new Date(2026, 9, 7, 20));
    expect(t.getFreeze().held).toBe(1);
    codeToday();
    expect(t.getData().current).toBe(2);
  });
});

describe('daysBetween', () => {
  it('lists calendar days, also across DST changes', async () => {
    const { daysBetween } = await import('../../src/features/streak/DailyStreakTracker.js');
    expect(daysBetween('2026-10-05', '2026-10-06')).toEqual([]);
    expect(daysBetween('2026-10-05', '2026-10-08')).toEqual(['2026-10-06', '2026-10-07']);
    const tz = process.env.TZ;
    try {
      for (const zone of ['America/New_York', 'Europe/Berlin']) {
        process.env.TZ = zone;
        // EU clocks go back on 2026-10-25, US on 2026-11-01; forward in March.
        expect(daysBetween('2026-10-24', '2026-10-27')).toEqual(['2026-10-25', '2026-10-26']);
        expect(daysBetween('2026-10-31', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02']);
        expect(daysBetween('2026-03-07', '2026-03-10')).toEqual(['2026-03-08', '2026-03-09']);
        expect(daysBetween('2026-03-28', '2026-03-31')).toEqual(['2026-03-29', '2026-03-30']);
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});
