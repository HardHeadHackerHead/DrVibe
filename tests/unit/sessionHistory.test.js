import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {};
vi.mock('../../src/core/Database.js', () => ({
  db: {
    getSection: (k) => store[k],
    setSection: (k, v) => { store[k] = v; },
    saveNow: async () => {},
  },
}));

const { SessionTracker, repairHistory } = await import('../../src/features/session/SessionTracker.js');
const { localDay } = await import('../../src/core/localDay.js');

describe('session history', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

  it('adds only what is new on each save', async () => {
    const t = new SessionTracker();
    t.codingSeconds = 600;
    t.filesModified.add('a.js');
    await t.saveSession();
    await t.saveSession();
    t.codingSeconds = 900;
    t.filesModified.add('b.js');
    await t.saveSession();
    const day = store.session.history.find((h) => h.date === localDay());
    expect(day.codingSeconds).toBe(900);
    expect(day.filesModified).toBe(2);
  });

  it('keeps time from an earlier session the same day', async () => {
    store.session = { history: [{ date: localDay(), codingSeconds: 1000, filesCreated: 1, filesModified: 1 }] };
    const t = new SessionTracker();
    t.codingSeconds = 300;
    await t.saveSession();
    await t.saveSession();
    expect(store.session.history[0].codingSeconds).toBe(1300);
  });

  it('repairs impossible days and leaves real ones alone', () => {
    const history = [{ date: '2026-10-22', codingSeconds: 7200 }, { date: '2026-10-23', codingSeconds: 821349 }];
    expect(repairHistory(history)).toBe(true);
    expect(history[0].codingSeconds).toBe(7200);
    expect(history[1].codingSeconds).toBeLessThanOrEqual(24 * 3600);
    expect(history[1].codingSeconds).toBeGreaterThan(3600 * 5);
    expect(repairHistory(history)).toBe(false);
  });
});
