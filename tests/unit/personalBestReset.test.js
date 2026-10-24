import { describe, expect, it, vi } from 'vitest';

const store = {};
vi.mock('../../src/core/Database.js', () => ({
  db: { getSection: (k) => store[k] ?? null, setSection: (k, v) => { store[k] = v; }, saveNow: async () => {} },
}));
const { PersonalBestTracker } = await import('../../src/features/personalBest/PersonalBestTracker.js');

describe('personal best reset', () => {
  it('drops the old Most Files record once and keeps the others', () => {
    store.personalBest = {
      bests: { mostFiles: { value: 30000, date: '2026-10-23' }, longestSession: { value: 5000, date: '2026-10-22' } },
      history: [{ date: '2026-10-23', metric: 'mostFiles', value: 30000 }, { date: '2026-10-22', metric: 'longestSession', value: 5000 }],
    };
    const t = new PersonalBestTracker();
    t._loadStore();
    expect(t.bests.mostFiles.value).toBe(0);
    expect(t.bests.longestSession.value).toBe(5000);
    expect(t.history.map((h) => h.metric)).toEqual(['longestSession']);
    expect(store.personalBest.filesCountEdits).toBe(true);
    // A real record set afterwards survives the next start.
    t.bests.mostFiles = { value: 12, date: '2026-10-24' };
    t._save();
    const again = new PersonalBestTracker();
    again._loadStore();
    expect(again.bests.mostFiles.value).toBe(12);
  });
});
