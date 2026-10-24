// Tracked repos: a repo is tracked because Claude Code works in it (its
// root, never a parent folder; a worktree counts as its main repo), because
// it's in a folder the user added, or because it's open in the editor. Also
// the one-time move from the 2.0.x drive scan, GitTracker and the momentum
// watcher following the list, and the Settings helpers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrackedRepos, parentDir } from '../../src/features/activity/TrackedRepos.js';
import { migrateRepoScan } from '../../src/features/activity/repoMigration.js';
import { GitTracker } from '../../src/features/activity/GitTracker.js';
import { MomentumTracker } from '../../src/features/activity/MomentumTracker.js';
import { isIgnoredRepo, repoKey } from '../../src/features/activity/repoPaths.js';
import { Settings, DEFAULT_SETTINGS } from '../../src/features/settings/Settings.js';
import { visibleRepos, trackedSummary, repoTag, formatAgo } from '../../src/ui/foundRepos.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';
import { db } from '../../src/core/Database.js';

let sections;

function fakeSettings(values = {}) {
  const v = { trackClaudeRepos: true, projectFolders: [], ignoredRepos: [], ...values };
  return {
    values: v,
    get: (k) => v[k],
    set(k, value) {
      v[k] = value;
      eventBus.emit(Events.SETTINGS_CHANGED, { key: k, value });
    },
  };
}

// What repos.rs answers for these fake machines' paths
const REPOS = {
  'E:/work/app': { name: 'app', root: 'E:\\work\\app', worktree: 'E:\\work\\app' },
  'E:/work/app/src': { name: 'app', root: 'E:\\work\\app', worktree: 'E:\\work\\app' },
  'E:/work/app/src/deep': { name: 'app', root: 'E:\\work\\app', worktree: 'E:\\work\\app' },
  'E:/work/app-wt/fix': { name: 'app', root: 'E:\\work\\app', worktree: 'E:\\work\\app-wt\\fix' },
  'E:/work/app-wt/fix/src': { name: 'app', root: 'E:\\work\\app', worktree: 'E:\\work\\app-wt\\fix' },
  'E:/work/lib': { name: 'lib', root: 'E:\\work\\lib', worktree: 'E:\\work\\lib' },
  '/home/mara/code/api/src': { name: 'api', root: '/home/mara/code/api', worktree: '/home/mara/code/api' },
};

function fakeResolve() {
  return vi.spyOn(tauri, 'resolveRepo').mockImplementation(async (p) => REPOS[repoKey(p).replace(/^e:/, 'E:')] ?? null);
}

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  sections = { trackedRepos: { repos: [] } };
  vi.spyOn(db, 'getSection').mockImplementation((s) => sections[s] ?? null);
  vi.spyOn(db, 'setSection').mockImplementation((s, v) => { sections[s] = v === null ? null : JSON.parse(JSON.stringify(v)); });
  vi.spyOn(tauri, 'findFolderRepos').mockResolvedValue([]);
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

async function started(settings = fakeSettings()) {
  const repos = new TrackedRepos(settings);
  await repos.init();
  await flush();
  return repos;
}

describe('TrackedRepos from Claude Code', () => {
  it('tracks the repo root a session starts in, never its parent folder', async () => {
    const resolve = fakeResolve();
    const settings = fakeSettings();
    const repos = await started(settings);
    const changed = vi.fn();
    eventBus.on(Events.REPOS_CHANGED, changed);

    eventBus.emit(Events.CLAUDE_CODE_SESSION_START, { cwd: 'E:\\work\\app\\src' });
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());

    expect(resolve).toHaveBeenCalledWith('E:\\work\\app\\src');
    expect(repos.getRepos()).toEqual([
      expect.objectContaining({ name: 'app', path: 'E:\\work\\app', worktrees: ['E:\\work\\app'], source: 'claude' }),
    ]);
    expect(sections.trackedRepos.repos[0]).toMatchObject({ name: 'app', path: 'E:\\work\\app' });
    // No folder is added on the user's behalf
    expect(settings.values.projectFolders).toEqual([]);
  });

  it('tracks the repo of a file Claude edits, even outside the session folder', async () => {
    fakeResolve();
    const repos = await started();
    eventBus.emit(Events.CLAUDE_CODE_FILE_CHANGED, { path: '/home/mara/code/api/src/server.ts', cwd: 'E:\\work\\app' });
    await vi.waitFor(() => expect(repos.getRepos()).toHaveLength(1));
    expect(repos.getRepos()[0]).toMatchObject({ name: 'api', path: '/home/mara/code/api' });
  });

  it('never tracks what Claude only reads', async () => {
    const resolve = fakeResolve();
    await started();
    eventBus.emit(Events.CLAUDE_CODE_FILE_READ, { path: 'E:\\work\\lib\\README.md' });
    await flush();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('counts a worktree as its main repo, keeping each working tree', async () => {
    fakeResolve();
    const repos = await started();
    await repos.noteClaudePath('E:\\work\\app');
    await repos.noteClaudePath('E:\\work\\app-wt\\fix\\src');
    expect(repos.getRepos()).toHaveLength(1);
    expect(repos.getRepos()[0]).toMatchObject({
      name: 'app', path: 'E:\\work\\app', worktrees: ['E:\\work\\app', 'E:\\work\\app-wt\\fix'],
    });
    expect(repoTag(repos.getRepos()[0])).toBe('Claude Code · 2 worktrees');
  });

  it('asks git once per folder', async () => {
    const resolve = fakeResolve();
    const repos = await started();
    for (let i = 0; i < 5; i++) await repos.noteClaudePath('E:\\work\\app\\src\\deep');
    await repos.noteClaudePath('e:/work/app/src/deep/');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('skips temp and system places (Rust says null), ignored repos, and everything when off', async () => {
    const resolve = fakeResolve();
    const repos = await started(fakeSettings({ ignoredRepos: ['E:\\work\\lib'] }));
    expect(await repos.noteClaudePath('C:\\Users\\mara\\AppData\\Local\\Temp\\drvibe-proj-1-git')).toBeNull();
    expect(await repos.noteClaudePath('E:\\work\\lib')).toBeNull();
    expect(repos.getRepos()).toEqual([]);

    const off = await started(fakeSettings({ trackClaudeRepos: false }));
    resolve.mockClear();
    expect(await off.noteClaudePath('E:\\work\\app')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('asks again when Rust could not be asked', async () => {
    const resolve = vi.spyOn(tauri, 'resolveRepo').mockResolvedValueOnce(undefined)
      .mockResolvedValue(REPOS['E:/work/lib']);
    const repos = await started();
    expect(await repos.noteClaudePath('E:\\work\\lib')).toBeNull();
    expect(await repos.noteClaudePath('E:\\work\\lib')).toMatchObject({ name: 'lib' });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('hides remembered repos while the setting is off and brings them back', async () => {
    sections.trackedRepos = { repos: [{ name: 'app', path: 'E:\\work\\app', worktrees: ['E:\\work\\app'], lastSeen: 1 }] };
    fakeResolve();
    const settings = fakeSettings();
    const repos = await started(settings);
    settings.set('trackClaudeRepos', false);
    expect(repos.getRepos()).toEqual([]);
    settings.set('trackClaudeRepos', true);
    expect(repos.getRepos()).toHaveLength(1);
  });

  it('rechecks remembered repos: gone ones drop, worktrees move under their main repo', async () => {
    sections.trackedRepos = {
      repos: [
        { name: 'fix', path: 'E:\\work\\app-wt\\fix', worktrees: ['E:\\work\\app-wt\\fix'], lastSeen: 5 },
        { name: 'gone', path: 'E:\\work\\gone', worktrees: ['E:\\work\\gone'], lastSeen: 4 },
        { name: 'lib', path: 'E:\\work\\lib', worktrees: ['E:\\work\\lib'], lastSeen: 3 },
      ],
    };
    fakeResolve();
    const repos = await started();
    await vi.waitFor(() => expect(sections.trackedRepos.repos).toHaveLength(2));
    expect(repos.getRepos().map(r => [r.name, r.path, r.worktrees])).toEqual([
      ['app', 'E:\\work\\app', ['E:\\work\\app-wt\\fix']],
      ['lib', 'E:\\work\\lib', ['E:\\work\\lib']],
    ]);
  });
});

describe('TrackedRepos from folders and the editor', () => {
  it('tracks the repos in the user folders and follows changes to them', async () => {
    fakeResolve();
    const find = tauri.findFolderRepos.mockImplementation(async (folder) => (
      folder === 'E:\\work' ? [REPOS['E:/work/app'], REPOS['E:/work/app-wt/fix'], REPOS['E:/work/lib']] : []
    ));
    const settings = fakeSettings({ projectFolders: ['E:\\work'], trackClaudeRepos: false });
    const repos = await started(settings);
    await vi.waitFor(() => expect(repos.getRepos()).toHaveLength(2));
    expect(find).toHaveBeenCalledWith('E:\\work');
    expect(repos.getRepos()[0]).toMatchObject({ name: 'app', source: 'folder', worktrees: ['E:\\work\\app', 'E:\\work\\app-wt\\fix'] });

    settings.set('projectFolders', []);
    await vi.waitFor(() => expect(repos.getRepos()).toEqual([]));
  });

  it('merges a repo Claude worked in with the same repo from a folder', async () => {
    fakeResolve();
    tauri.findFolderRepos.mockResolvedValue([REPOS['E:/work/app']]);
    const repos = await started(fakeSettings({ projectFolders: ['E:\\work'] }));
    await repos.noteClaudePath('E:\\work\\app-wt\\fix');
    await vi.waitFor(() => expect(repos.getRepos()[0]?.worktrees).toHaveLength(2));
    expect(repos.getRepos()).toHaveLength(1);
    expect(repos.getRepos()[0].source).toBe('claude');
  });

  it('tracks the project open in an editor for this run only', async () => {
    fakeResolve();
    const repos = await started();
    eventBus.emit(Events.PROJECT_DETECTED, { name: 'lib', path: 'E:\\work\\lib', source: 'window_title' });
    await vi.waitFor(() => expect(repos.getRepos()).toHaveLength(1));
    expect(repos.getRepos()[0]).toMatchObject({ name: 'lib', source: 'editor' });
    expect(sections.trackedRepos.repos).toEqual([]);
  });
});

describe('migration from the 2.0.x drive scan', () => {
  // A copy of a real 2.0.1 install, names changed: auto-added parent folders
  // (temp and app data among them) and 300 scanned repos, test fixtures and
  // worktrees included.
  function realisticInstall() {
    const fixtures = [];
    for (let i = 0; i < 195; i++) {
      const kind = ['drvibe-proj', 'drvibe-reposcan', 'drvibe-watch', 'drvibe-test-rotate'][i % 4];
      fixtures.push({ name: `${kind}-${4000 + i}-git`, path: `C:\\Users\\mara\\AppData\\Local\\Temp\\${kind}-${4000 + i}-git`, lastCommit: null, source: 'scan' });
    }
    const worktrees = Array.from({ length: 45 }, (_, i) => ({ name: `slot${i}`, path: `E:/game-wt/slot${i}`, lastCommit: 1790000000, source: 'scan' }));
    const real = Array.from({ length: 58 }, (_, i) => ({ name: `proj${i}`, path: `E:\\proj${i}`, lastCommit: 1790000000, source: 'scan' }));
    const detected = [
      { name: 'site', path: 'C:\\Users\\mara\\Desktop\\Lab\\site', lastCommit: 1791000000, source: 'detected' },
      { name: 'cache', path: 'C:\\Users\\mara\\AppData\\Local\\Temp\\qfr', lastCommit: null, source: 'detected' },
    ];
    return {
      settings: {
        projectFolders: [
          'C:\\Users\\mara\\Desktop\\Lab\\quads',
          'C:\\Users\\mara\\Desktop\\Lab',
          'C:\\Users\\mara\\AppData\\Local\\QuadFlow-preview',
          'C:\\Users\\mara\\Desktop',
          'C:\\Users\\mara\\AppData\\Local\\Temp',
          'C:\\Users\\mara\\Desktop\\Lab\\QuadCode\\.claude\\worktrees',
          'C:\\Users\\mara\\AppData\\Local',
          'C:\\Users\\mara',
          'E:\\hq\\packages',
          'C:\\Users\\mara\\Desktop',
        ],
        autoDetectRepos: true,
        ignoredRepos: [],
      },
      repoScan: {
        autoDetect: true,
        lastScan: 1792876100083,
        remembered: [{ name: 'tool', path: 'E:\\tools\\tool' }],
        repos: [...fixtures, ...worktrees, ...real, ...detected],
        stats: { dirsVisited: 31291, elapsedMs: 3204, roots: 14, timedOut: false, truncated: true },
      },
      achievements: { seenRepos: ['qwickcert', 'site', 'hq'] },
    };
  }

  // Stand-in for repos.rs untracked_places on this machine (its own tests
  // cover the rules): temp, app data and the home folder or above.
  const untrackedPlaces = async (paths) => paths.map(p => /\\appdata(\\|$)/i.test(p) || /^c:\\users\\mara$/i.test(p));

  function install(blob) {
    sections = JSON.parse(JSON.stringify(blob));
    return fakeSettings({ ...sections.settings });
  }

  it('drops scanned repos and temp/app-data folders, keeps real folders and remembered repos', async () => {
    const settings = install(realisticInstall());
    const section = await migrateRepoScan({ settings, db, untrackedPlaces });

    expect(settings.values.projectFolders).toEqual([
      'C:\\Users\\mara\\Desktop\\Lab\\quads',
      'C:\\Users\\mara\\Desktop\\Lab',
      'C:\\Users\\mara\\Desktop',
      'C:\\Users\\mara\\Desktop\\Lab\\QuadCode\\.claude\\worktrees',
      'E:\\hq\\packages',
    ]);
    expect(section.repos.map(r => r.path)).toEqual(['E:\\tools\\tool', 'C:\\Users\\mara\\Desktop\\Lab\\site']);
    expect(section.repos[0]).toEqual({ name: 'tool', path: 'E:\\tools\\tool', worktrees: ['E:\\tools\\tool'], lastSeen: 0 });
    expect(sections.trackedRepos).toEqual(section);
    expect(sections.repoScan).toBeNull();
    expect(settings.values.trackClaudeRepos).toBe(true);
    // Achievements are untouched
    expect(sections.achievements.seenRepos).toEqual(['qwickcert', 'site', 'hq']);
  });

  it('runs once: a second launch finds the new section and leaves folders alone', async () => {
    const settings = install(realisticInstall());
    const check = vi.spyOn(tauri, 'untrackedPlaces').mockImplementation(untrackedPlaces);
    vi.spyOn(tauri, 'resolveRepo').mockResolvedValue(undefined);
    delete sections.trackedRepos;

    const first = new TrackedRepos(settings);
    await first.init();
    expect(check).toHaveBeenCalledTimes(1);
    expect(first.claudeRepos.map(r => r.name)).toEqual(['tool', 'site']);
    first.destroy();

    settings.values.projectFolders.push('C:\\Users\\mara\\AppData\\Roaming\\x');
    const second = new TrackedRepos(settings);
    await second.init();
    expect(check).toHaveBeenCalledTimes(1);
    expect(settings.values.projectFolders).toContain('C:\\Users\\mara\\AppData\\Roaming\\x');
    second.destroy();
  });

  it('waits for the next launch when Rust cannot be asked', async () => {
    const blob = realisticInstall();
    const settings = install(blob);
    const section = await migrateRepoScan({ settings, db, untrackedPlaces: async () => null });
    expect(section).toBeNull();
    expect(sections.trackedRepos).toBeUndefined();
    expect(sections.repoScan.repos).toHaveLength(300);
    expect(settings.values.projectFolders).toEqual(blob.settings.projectFolders);
  });

  it('keeps "folders only" for people who had switched the scan off', async () => {
    const blob = realisticInstall();
    blob.settings.autoDetectRepos = false;
    const settings = install(blob);
    await migrateRepoScan({ settings, db, untrackedPlaces });
    expect(settings.values.trackClaudeRepos).toBe(false);
  });

  it('writes an empty section on a fresh install', async () => {
    sections = {};
    const settings = fakeSettings();
    const check = vi.fn();
    expect(await migrateRepoScan({ settings, db, untrackedPlaces: check })).toEqual({ repos: [] });
    expect(check).not.toHaveBeenCalled();
    expect(sections.trackedRepos).toEqual({ repos: [] });
  });
});

describe('GitTracker follows the tracked repos', () => {
  function tracker(settings = fakeSettings()) {
    const t = new GitTracker(settings);
    vi.spyOn(t, '_seedAllRepos').mockImplementation(() => {});
    vi.spyOn(t, '_ensureIdleTierRunning').mockImplementation(() => {});
    vi.spyOn(t, '_pollRepo').mockResolvedValue();
    t.init();
    return t;
  }

  it('watches each working tree under the repo name and drops what leaves the list', () => {
    const t = tracker();
    eventBus.emit(Events.REPOS_CHANGED, { repos: [
      { name: 'app', path: 'E:\\work\\app', worktrees: ['E:\\work\\app', 'E:\\work\\app-wt\\fix'] },
      { name: 'lib', path: 'E:\\work\\lib', worktrees: ['E:\\work\\lib'] },
    ] });
    expect(t.getWatchlist().map(r => [r.name, r.path])).toEqual([
      ['app', 'E:/work/app'], ['app', 'E:/work/app-wt/fix'], ['lib', 'E:/work/lib'],
    ]);
    eventBus.emit(Events.REPOS_CHANGED, { repos: [{ name: 'lib', path: 'E:\\work\\lib', worktrees: ['E:\\work\\lib'] }] });
    expect(t.getWatchlist().map(r => r.name)).toEqual(['lib']);
    t.destroy();
  });

  it('never tracks ignored repos and drops them when ignored later', () => {
    const settings = fakeSettings({ ignoredRepos: ['/b'] });
    const t = tracker(settings);
    t.populateFromRepos([{ name: 'a', path: '/a', worktrees: ['/a'] }, { name: 'b', path: '/b', worktrees: ['/b-wt'] }]);
    expect(t.getWatchlist().map(r => r.name)).toEqual(['a']);
    settings.set('ignoredRepos', ['/b', '/a']);
    expect(t.getWatchlist()).toEqual([]);
    t.destroy();
  });

  it('promotes the working tree a project is in, and adds nothing on its own', () => {
    const t = tracker();
    t.populateFromRepos([{ name: 'app', path: '/w/app', worktrees: ['/w/app', '/w/app/.claude/worktrees/x'] }]);
    eventBus.emit(Events.PROJECT_DETECTED, { name: 'x', path: '/w/app/.claude/worktrees/x/src' });
    eventBus.emit(Events.PROJECT_DETECTED, { name: 'tmp', path: 'C:\\Users\\mara\\AppData\\Local\\Temp\\x' });
    expect(t.getWatchlist().map(r => [r.path, r.tier])).toEqual([
      ['/w/app', 'idle'], ['/w/app/.claude/worktrees/x', 'active'],
    ]);
    t.destroy();
  });
});

describe('MomentumTracker watches the tracked repos', () => {
  it('watches every working tree and restarts the watcher when one is dropped', async () => {
    const start = vi.spyOn(tauri, 'startWatching').mockResolvedValue('ok');
    const stop = vi.spyOn(tauri, 'stopWatching').mockResolvedValue('ok');
    const available = tauri.isAvailable;
    tauri.isAvailable = true;
    try {
      const m = new MomentumTracker();
      await m.watchRepos([{ path: 'E:\\a', worktrees: ['E:\\a', 'E:\\a-wt\\x'] }, { path: '/b', worktrees: [] }]);
      expect(start.mock.calls.map(c => c[0])).toEqual(['E:\\a', 'E:\\a-wt\\x', '/b']);
      await m.watchRepos([{ path: 'E:\\a', worktrees: ['E:\\a', 'E:\\a-wt\\x'] }, { path: '/b', worktrees: ['/b'] }, { path: '/c', worktrees: ['/c'] }]);
      expect(stop).not.toHaveBeenCalled();
      expect(start).toHaveBeenCalledTimes(4);
      await m.watchRepos([{ path: '/c', worktrees: ['/c'] }]);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(m.getState().watchedPaths).toEqual(['/c']);
    } finally {
      tauri.isAvailable = available;
    }
  });
});

describe('helpers', () => {
  it('parentDir takes the folder of a file on either OS', () => {
    expect(parentDir('E:\\work\\app\\src\\main.rs')).toBe('E:\\work\\app\\src');
    expect(parentDir('/home/mara/code/api/x.ts')).toBe('/home/mara/code/api');
  });

  it('compares Windows paths loosely and matches insides only', () => {
    expect(repoKey('E:\\Work\\Repo\\')).toBe('e:/work/repo');
    expect(repoKey('/Home/Repo/')).toBe('/Home/Repo');
    expect(isIgnoredRepo('e:/work/repo/src', ['E:\\Work\\Repo'])).toBe(true);
    expect(isIgnoredRepo('E:\\Work\\Repo2', ['E:\\Work\\Repo'])).toBe(false);
  });

  it('lists repos most recently seen first and summarises them', () => {
    const repos = [
      { name: 'old', path: '/old', lastSeen: 100 },
      { name: 'folder', path: '/folder' },
      { name: 'new', path: '/new', lastSeen: 200 },
      { name: 'hidden', path: '/hidden', lastSeen: 300 },
    ];
    expect(visibleRepos(repos, ['/hidden']).map(r => r.name)).toEqual(['new', 'old', 'folder']);
    expect(trackedSummary(null, 0)).toBe('Loading…');
    expect(trackedSummary({ repos: [] }, 0)).toBe('No repos tracked yet');
    expect(trackedSummary({ repos: [] }, 1)).toBe('1 repo tracked');
    expect(repoTag({ source: 'folder', worktrees: ['/a'] })).toBe('your folder');
    const now = Date.UTC(2026, 9, 24);
    expect(formatAgo(now - 3 * 86400e3, now)).toBe('3d ago');
  });

  it('Settings: Claude repos are tracked by default and the choice survives a reload', async () => {
    let saved = null;
    db.getSection.mockImplementation(() => saved);
    db.setSection.mockImplementation((_s, v) => { saved = JSON.parse(JSON.stringify(v)); });

    expect(DEFAULT_SETTINGS.trackClaudeRepos).toBe(true);
    expect('autoDetectRepos' in DEFAULT_SETTINGS).toBe(false);
    const first = new Settings();
    await first.init();
    first.set('trackClaudeRepos', false);
    first.set('ignoredRepos', ['E:\\work\\old']);

    const second = new Settings();
    await second.init();
    expect(second.get('trackClaudeRepos')).toBe(false);
    expect(second.get('ignoredRepos')).toEqual(['E:\\work\\old']);
    second.reset();
    expect(second.get('trackClaudeRepos')).toBe(true);
  });
});
