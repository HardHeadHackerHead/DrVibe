// StreakDisplay: the server's builder streak is shown when fresh, the local
// DailyStreakTracker otherwise, and milestones are cheered once for the
// number on screen.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DailyStreakTracker } from '../../src/features/streak/DailyStreakTracker.js';
import { StreakDisplay, chooseStreak, SERVER_STREAK_MAX_AGE_MS } from '../../src/features/streak/StreakDisplay.js';
import { parseBuilderStreak, parseMeStreak } from '../../src/core/api/contract.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z').getTime();
let sections;

const server = (current, extra = {}) => ({
  current, longest: Math.max(current, extra.longest ?? 0),
  sources: { drvibeDays: current, githubDays: extra.githubDays ?? 0 },
  includesGithub: (extra.githubDays ?? 0) > 0,
  source: extra.source ?? 'server',
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sections = {};
  vi.spyOn(db, 'getSection').mockImplementation((s) => (s in sections ? JSON.parse(JSON.stringify(sections[s])) : null));
  vi.spyOn(db, 'setSection').mockImplementation((s, v) => { sections[s] = JSON.parse(JSON.stringify(v)); });
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('chooseStreak', () => {
  const local = { current: 3, max: 9 };

  it('prefers a fresh server streak while linked', () => {
    const shown = chooseStreak(local, { streak: server(12, { longest: 40, githubDays: 4 }), fetchedAt: NOW - DAY }, { linked: true, now: NOW });
    expect(shown).toEqual({ current: 12, longest: 40, includesGithub: true, source: 'server' });
  });

  it('falls back to the local streak when absent, stale, unlinked or echoed from the desktop', () => {
    const localShown = { current: 3, longest: 9, includesGithub: false, source: 'local' };
    expect(chooseStreak(local, null, { linked: true, now: NOW })).toEqual(localShown);
    expect(chooseStreak(local, { streak: null, fetchedAt: NOW }, { linked: true, now: NOW })).toEqual(localShown);
    const stale = { streak: server(12), fetchedAt: NOW - SERVER_STREAK_MAX_AGE_MS - 1 };
    expect(chooseStreak(local, stale, { linked: true, now: NOW })).toEqual(localShown);
    expect(chooseStreak(local, { streak: server(12), fetchedAt: NOW }, { linked: false, now: NOW })).toEqual(localShown);
    expect(chooseStreak(local, { streak: server(3, { source: 'desktop' }), fetchedAt: NOW }, { linked: true, now: NOW })).toEqual(localShown);
  });

  it('a value fetched exactly 48 h ago still counts', () => {
    const cache = { streak: server(12), fetchedAt: NOW - SERVER_STREAK_MAX_AGE_MS };
    expect(chooseStreak(local, cache, { linked: true, now: NOW }).source).toBe('server');
  });
});

describe('parseBuilderStreak / parseMeStreak', () => {
  it('reads the protocol shape and rejects junk', () => {
    expect(parseBuilderStreak(server(5, { githubDays: 2 }))).toEqual(server(5, { githubDays: 2 }));
    expect(parseBuilderStreak(undefined)).toBeNull();
    expect(parseBuilderStreak({ current: 'x' })).toBeNull();
    expect(parseBuilderStreak({ current: 2, source: 'other' }).source).toBe('desktop');
  });

  it('GET /me/streak carries the GitHub link state', () => {
    expect(parseMeStreak({ streak: server(2), github: { linked: false, status: 'none' } }))
      .toEqual({ streak: server(2), githubLinked: false });
    expect(parseMeStreak({})).toEqual({ streak: null, githubLinked: null });
  });
});

describe('StreakDisplay', () => {
  let linked;

  async function setup({ fetchStreak = null } = {}) {
    const tracker = new DailyStreakTracker();
    await tracker.init();
    const display = new StreakDisplay({ tracker, isLinked: () => linked, fetchStreak });
    display.init();
    return { tracker, display };
  }

  function milestones() {
    const seen = [];
    eventBus.on(Events.STREAK_MILESTONE, (m) => seen.push(m.milestone));
    return seen;
  }

  function codeToday() {
    eventBus.emit(Events.ACTIVITY_CODING_START, { appName: 'Code' });
  }

  beforeEach(() => { linked = true; });

  it('shows the server streak after a sync and the local one once it goes stale', async () => {
    const { tracker, display } = await setup();
    codeToday();
    display.applySync(server(20, { githubDays: 8 }));
    expect(display.get()).toMatchObject({ current: 20, includesGithub: true, source: 'server' });

    vi.setSystemTime(NOW + SERVER_STREAK_MAX_AGE_MS + 1);
    expect(display.get()).toMatchObject({ current: tracker.getData().current, source: 'local' });
  });

  it('a sync without `streak` (older server) keeps the local streak', async () => {
    const { display } = await setup();
    codeToday();
    display.applySync(undefined);
    expect(display.get()).toMatchObject({ current: 1, source: 'local' });
  });

  it('unlinking drops the server value', async () => {
    const { display } = await setup();
    display.applySync(server(20));
    linked = false;
    eventBus.emit(Events.ACCOUNT_UNLINKED, {});
    linked = true;
    expect(display.get().source).toBe('local');
  });

  it('cheers a milestone the server streak passes once, and the local tracker stays quiet', async () => {
    sections.streak = { current: 6, max: 6, lastCodingDate: '2026-09-30', lastCodingTimestamp: NOW - DAY, startDate: '2026-09-25', milestonesReached: [] };
    const { tracker, display } = await setup();
    display.applySync(server(6));
    const seen = milestones();

    codeToday(); // local 6 -> 7 while the server's number is on screen
    expect(tracker.getData().current).toBe(7);
    expect(tracker.getData().milestonesReached).toContain(7); // still reported in the sync payload
    expect(seen).toEqual([]);

    display.applySync(server(7));
    display.applySync(server(7));
    expect(seen).toEqual([7]);
  });

  it('a big first jump cheers only the highest milestone', async () => {
    const { display } = await setup();
    const seen = milestones();
    display.applySync(server(120, { githubDays: 100 }));
    expect(seen).toEqual([100]);
  });

  it('switching source does not cheer the same milestone again', async () => {
    sections.streak = { current: 6, max: 6, lastCodingDate: '2026-09-30', lastCodingTimestamp: NOW - DAY, startDate: '2026-09-25', milestonesReached: [] };
    const { tracker, display } = await setup();
    const seen = milestones();
    codeToday(); // no server value yet: the local tracker cheers 7
    expect(seen).toEqual([7]);

    display.applySync(server(20)); // shown 7 -> 20: 14 is new
    expect(seen).toEqual([7, 14]);

    vi.setSystemTime(NOW + SERVER_STREAK_MAX_AGE_MS + 1); // stale: the local 7 is shown again
    expect(display.get()).toMatchObject({ current: tracker.getData().current, source: 'local' });
    display.applySync(server(21)); // shown 7 -> 21: 14 was just cheered, 21 is new
    expect(seen).toEqual([7, 14, 21]);
  });

  it('a milestone can be cheered again after a streak that broke had time to regrow', async () => {
    const { display } = await setup();
    const seen = milestones();
    display.applySync(server(7));
    display.applySync(server(0));
    vi.setSystemTime(NOW + 8 * DAY);
    display.applySync(server(7));
    expect(seen).toEqual([7, 7]);
  });

  it('the evening reminder names the shown streak', async () => {
    sections.streak = { current: 4, max: 4, lastCodingDate: '2026-09-30', lastCodingTimestamp: NOW - 12 * 60 * 60 * 1000, startDate: '2026-09-27', milestonesReached: [] };
    vi.setSystemTime(new Date(2026, 9, 1, 21, 30));
    const { tracker, display } = await setup();
    display.applySync(server(15));
    const reminders = [];
    eventBus.on(Events.STREAK_REMINDER, (r) => reminders.push(r.streak));
    tracker._periodicCheck();
    expect(reminders).toEqual([15]);
  });

  it('GET /me/streak fills the cache and offers the GitHub hint once until dismissed', async () => {
    const fetchStreak = vi.fn(async () => ({ ok: true, data: { streak: server(3), github: { linked: false } } }));
    const { display } = await setup({ fetchStreak });
    await display.refresh();
    expect(display.get()).toMatchObject({ current: 3, source: 'server', githubHint: true });

    display.dismissGithubHint();
    expect(display.get().githubHint).toBe(false);
    expect(sections.serverStreak.hintDismissed).toBe(true);

    linked = false;
    await display.refresh();
    expect(fetchStreak).toHaveBeenCalledTimes(1);
  });

  it('no hint while GitHub is linked or the state is unknown', async () => {
    const { display } = await setup({ fetchStreak: async () => ({ ok: true, data: { streak: server(3), github: { linked: true } } }) });
    expect(display.get().githubHint).toBe(false);
    await display.refresh();
    expect(display.get().githubHint).toBe(false);
  });
});
