// Achievement unlocks and mastery level-ups (AchievementSystem), driven by
// the same events the trackers emit in the app.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AchievementSystem } from '../../src/features/achievements/AchievementSystem.js';
import { ACHIEVEMENTS, MASTERY_TRACKS } from '../../src/features/achievements/AchievementDefinitions.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';
import { economyClient } from '../../src/features/economy/EconomyClient.js';

let stored;
let unlocked;
let levelUps;

async function boot() {
  const sys = new AchievementSystem();
  await sys.init();
  return sys;
}

const commit = (project = 'dr-vibe') =>
  eventBus.emit(Events.GIT_COMMIT_MADE, { commit: { hash: 'abc12345', message: 'wip' }, project, branch: 'main' });

beforeEach(() => {
  stored = null;
  unlocked = [];
  levelUps = [];
  vi.spyOn(db, 'getSection').mockImplementation((section) => (section === 'achievements' ? stored : null));
  vi.spyOn(db, 'setSection').mockImplementation((section, value) => {
    if (section === 'achievements') stored = JSON.parse(JSON.stringify(value));
  });
  vi.spyOn(economyClient, 'reportActivity').mockImplementation(() => {});
  eventBus.on(Events.ACHIEVEMENT_UNLOCKED, (a) => unlocked.push(a.id));
  eventBus.on(Events.MASTERY_LEVEL_UP, (m) => levelUps.push(m));
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

describe('achievement unlocks', () => {
  it('first launch unlocks Welcome and Hello World exactly once', async () => {
    await boot();
    expect(unlocked).toEqual(expect.arrayContaining(['welcome_dr_vibe', 'hello_world']));
    const first = unlocked.length;

    eventBus.clear();
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, (a) => unlocked.push(a.id));
    await boot(); // second launch: state restored from the saved section
    expect(unlocked.length).toBe(first);
  });

  it('every unlock is reported once to the economy queue', async () => {
    await boot();
    const reported = economyClient.reportActivity.mock.calls
      .filter(([type]) => type === 'ACHIEVEMENT_UNLOCKED')
      .map(([, meta]) => meta.achievementId);
    expect(reported.sort()).toEqual([...unlocked].sort());
  });

  it('the first commit unlocks First Push and counts toward the commit goals', async () => {
    const sys = await boot();
    commit();
    expect(unlocked).toContain('first_push');
    expect(sys.getProgress('commit_machine').progress).toBe(1);
    expect(sys.getProgress('rapid_fire').progress).toBe(1);
  });

  it('Rapid Fire unlocks at its threshold within one session', async () => {
    await boot();
    for (let i = 0; i < ACHIEVEMENTS.rapid_fire.maxProgress; i++) commit();
    expect(unlocked.filter((id) => id === 'rapid_fire')).toHaveLength(1);
  });

  it('Multi-repo counts distinct projects only', async () => {
    const sys = await boot();
    commit('a'); commit('a'); commit('b');
    expect(sys.getProgress('multi_repo').progress).toBe(2);
  });

  it('Quick Draw needs a commit within 5 minutes of a reminder', async () => {
    vi.useFakeTimers();
    try {
      await boot();
      eventBus.emit(Events.GIT_COMMIT_REMINDER, { urgency: 'gentle' });
      vi.advanceTimersByTime(6 * 60 * 1000);
      commit();
      expect(unlocked).not.toContain('quick_draw');
      eventBus.emit(Events.GIT_COMMIT_REMINDER, { urgency: 'gentle' });
      vi.advanceTimersByTime(60 * 1000);
      commit();
      expect(unlocked).toContain('quick_draw');
    } finally {
      vi.useRealTimers();
    }
  });

  it('progress and unlocks survive a restart', async () => {
    await boot();
    commit('a');
    commit('b');
    const again = await boot();
    expect(again.getProgress('first_push').unlocked).toBe(true);
    expect(again.lifetimeCommitCount).toBe(2);
    expect(again.seenRepos.size).toBe(2);
  });
});

describe('mastery tracks', () => {
  it('git mastery levels up at each threshold, with major levels flagged', async () => {
    await boot();
    const levels = MASTERY_TRACKS.git_mastery.levels;
    for (let i = 0; i < levels[2]; i++) commit();
    const git = levelUps.filter((m) => m.id === 'git_mastery');
    expect(git.map((m) => m.level)).toEqual([1, 2, 3]);
    expect(git.map((m) => m.levelName)).toEqual(['Rookie', 'Builder', 'Adept']);
    expect(git[2].isMajor).toBe(MASTERY_TRACKS.git_mastery.majorLevels.includes(3));
    const reported = economyClient.reportActivity.mock.calls.filter(([t, m]) => t === 'MASTERY_LEVEL_UP' && m.trackId === 'git_mastery');
    expect(reported).toHaveLength(3);
  });
});
