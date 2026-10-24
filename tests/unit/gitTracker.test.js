// GitTracker: commits always reach the event bus (achievements, VP); the
// notification setting only gates the speech bubble in app.js.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GitTracker } from '../../src/features/activity/GitTracker.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

const info = (hash, branch) => ({
  repo_name: 'demo', branch, uncommitted_count: 0,
  recent_commits: [{ hash, message: 'm', timestamp: new Date().toISOString() }],
});

describe('GitTracker', () => {
  it('emits commits and branch changes with notifications turned off', async () => {
    const settings = { get: (k) => (k.startsWith('git') && k.endsWith('NotificationsEnabled') ? false : undefined) };
    const tracker = new GitTracker(settings);
    const repo = { path: '/r', name: 'demo', tier: 'idle', lastCommitHash: null, currentBranch: null, uncommittedCount: 0, consecutiveFailures: 0, seeded: false };
    const commits = vi.fn();
    const branches = vi.fn();
    eventBus.on(Events.GIT_COMMIT_MADE, commits);
    eventBus.on(Events.GIT_BRANCH_CHANGED, branches);

    vi.spyOn(tauri, 'getGitInfo').mockResolvedValueOnce(info('a', 'main')).mockResolvedValueOnce(info('b', 'dev'));
    await tracker._pollRepo(repo, true);
    await tracker._pollRepo(repo);

    expect(commits).toHaveBeenCalledTimes(1);
    expect(branches).toHaveBeenCalledWith(expect.objectContaining({ from: 'main', to: 'dev' }));
  });
});
