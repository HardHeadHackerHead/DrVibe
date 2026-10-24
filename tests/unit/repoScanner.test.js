// "Find my repos automatically": what the scanner asks Rust for in each mode,
// remembered runtime repos, the ignore list, GitTracker gating, the Claude
// Code folder auto-add, and the settings round-trip.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileSystemScanner } from '../../src/features/activity/FileSystemScanner.js';
import { GitTracker } from '../../src/features/activity/GitTracker.js';
import { claudeFolderToAutoAdd, isIgnoredRepo, repoKey } from '../../src/features/activity/repoPaths.js';
import { Settings, DEFAULT_SETTINGS } from '../../src/features/settings/Settings.js';
import { visibleRepos, scanSummary, formatAgo } from '../../src/ui/foundRepos.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';
import { db } from '../../src/core/Database.js';

let sections;

function fakeSettings(values = {}) {
  const v = { autoDetectRepos: true, projectFolders: [], ignoredRepos: [], ...values };
  return {
    values: v,
    get: (k) => v[k],
    set(k, value) {
      v[k] = value;
      eventBus.emit(Events.SETTINGS_CHANGED, { key: k, value });
    },
  };
}

const scanResult = (repos) => ({
  repos, roots: 4, dirsVisited: 100, elapsedMs: 12, truncated: false, timedOut: false,
});

beforeEach(() => {
  sections = {};
  vi.spyOn(db, 'getSection').mockImplementation((s) => sections[s] ?? null);
  vi.spyOn(db, 'setSection').mockImplementation((s, v) => { sections[s] = JSON.parse(JSON.stringify(v)); });
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

describe('FileSystemScanner', () => {
  it('scans the home folder and every drive when on', async () => {
    const settings = fakeSettings({ projectFolders: ['/work'], ignoredRepos: ['/work/old'] });
    const scan = vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([
      { name: 'app', path: '/work/app', lastCommit: 1700000000 },
    ]));
    const discovered = vi.fn();
    eventBus.on(Events.PROJECTS_DISCOVERED, discovered);

    const scanner = new FileSystemScanner(settings);
    await scanner.scan();

    expect(scan).toHaveBeenCalledWith({
      scanDrives: true, folders: ['/work'], knownRepos: [], ignored: ['/work/old'],
    });
    expect(discovered).toHaveBeenCalledWith({
      repos: [{ name: 'app', path: '/work/app', lastCommit: 1700000000, source: 'scan' }],
      fromCache: false,
    });
    expect(sections.repoScan.repos).toHaveLength(1);
    expect(sections.repoScan.autoDetect).toBe(true);
    expect(scanner.getStatus()).toMatchObject({ autoDetect: true, scanning: false, stats: { roots: 4 } });
  });

  it('scans only the user folders when off, without remembered repos', async () => {
    sections.repoScan = { remembered: [{ name: 'far', path: 'E:/far' }], repos: [], lastScan: 0 };
    const settings = fakeSettings({ autoDetectRepos: false, projectFolders: ['/work'] });
    const scan = vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([]));
    const scanner = new FileSystemScanner(settings);
    scanner._loadFromStore();
    await scanner.scan();

    expect(scan).toHaveBeenCalledWith({ scanDrives: false, folders: ['/work'], knownRepos: [], ignored: [] });
    // Kept for when the setting comes back on
    expect(scanner.remembered).toHaveLength(1);
  });

  it('uses the cache for a day, and rescans when the mode changed', async () => {
    const scan = vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([]));
    sections.repoScan = { repos: [{ name: 'a', path: '/a' }], lastScan: Date.now() - 1000, autoDetect: true };

    const cached = new FileSystemScanner(fakeSettings());
    await cached.init();
    expect(scan).not.toHaveBeenCalled();
    expect(cached.getRepos()).toHaveLength(1);
    cached.destroy();

    const flipped = new FileSystemScanner(fakeSettings({ autoDetectRepos: false }));
    await flipped.init();
    expect(scan).toHaveBeenCalledTimes(1);
    flipped.destroy();
  });

  it('remembers a detected repo, persists it and passes it to the next scan', async () => {
    const settings = fakeSettings();
    vi.spyOn(tauri, 'getGitInfo').mockResolvedValue({ git_root: 'E:/games/mod', repo_name: 'mod' });
    const scan = vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([
      { name: 'mod', path: 'E:/games/mod', lastCommit: null },
    ]));
    const scanner = new FileSystemScanner(settings);

    expect(await scanner.rememberDetected({ name: 'src', path: 'E:/games/mod/src' })).toBe(true);
    expect(sections.repoScan.remembered).toEqual([{ name: 'mod', path: 'E:/games/mod' }]);
    expect(scanner.getRepos()[0]).toMatchObject({ path: 'E:/games/mod', source: 'detected' });
    // Already known: no second git call
    expect(await scanner.rememberDetected({ name: 'mod', path: 'E:/games/mod' })).toBe(false);

    await scanner.scan();
    expect(scan.mock.calls[0][0].knownRepos).toEqual(['E:/games/mod']);
    expect(scanner.getRepos()[0].source).toBe('detected');

    // A later reload still has it
    const reloaded = new FileSystemScanner(settings);
    reloaded._loadFromStore();
    expect(reloaded.remembered).toEqual([{ name: 'mod', path: 'E:/games/mod' }]);
  });

  it('drops remembered repos the scan no longer finds', async () => {
    const scanner = new FileSystemScanner(fakeSettings());
    scanner.remembered = [{ name: 'gone', path: '/gone' }];
    vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([]));
    await scanner.scan();
    expect(scanner.remembered).toEqual([]);
  });

  it('does not remember anything when off or when ignored', async () => {
    const git = vi.spyOn(tauri, 'getGitInfo').mockResolvedValue({ git_root: '/r', repo_name: 'r' });
    const off = new FileSystemScanner(fakeSettings({ autoDetectRepos: false }));
    expect(await off.rememberDetected({ path: '/r' })).toBe(false);
    const ignoring = new FileSystemScanner(fakeSettings({ ignoredRepos: ['/r'] }));
    expect(await ignoring.rememberDetected({ path: '/r/src' })).toBe(false);
    expect(git).not.toHaveBeenCalled();
  });

  it('filters newly ignored repos at once and rescans when one is un-ignored', async () => {
    const settings = fakeSettings();
    sections.repoScan = {
      repos: [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }],
      lastScan: Date.now(), autoDetect: true,
    };
    const scan = vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([
      { name: 'a', path: '/a' }, { name: 'b', path: '/b' },
    ]));
    const scanner = new FileSystemScanner(settings);
    await scanner.init();
    const discovered = vi.fn();
    eventBus.on(Events.PROJECTS_DISCOVERED, discovered);

    settings.set('ignoredRepos', ['/b']);
    expect(scan).not.toHaveBeenCalled();
    expect(discovered.mock.calls.at(-1)[0].repos.map(r => r.name)).toEqual(['a']);

    settings.set('ignoredRepos', []);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    scanner.destroy();
  });

  it('rescans when the setting is switched', async () => {
    const settings = fakeSettings();
    sections.repoScan = { repos: [], lastScan: Date.now(), autoDetect: true };
    const scan = vi.spyOn(tauri, 'scanGitRepos').mockResolvedValue(scanResult([]));
    const scanner = new FileSystemScanner(settings);
    await scanner.init();
    settings.set('autoDetectRepos', false);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    expect(scan.mock.calls[0][0].scanDrives).toBe(false);
    scanner.destroy();
  });

  it('queues one more scan when asked while scanning', async () => {
    let release;
    const scan = vi.spyOn(tauri, 'scanGitRepos')
      .mockImplementationOnce(() => new Promise(r => { release = () => r(scanResult([])); }))
      .mockResolvedValue(scanResult([]));
    const scanner = new FileSystemScanner(fakeSettings());
    const first = scanner.scan();
    scanner.scan();
    scanner.scan();
    release();
    await first;
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

describe('GitTracker with the repo list', () => {
  it('never tracks ignored repos and drops them when ignored later', () => {
    const settings = fakeSettings({ ignoredRepos: ['/b'] });
    const tracker = new GitTracker(settings);
    vi.spyOn(tracker, '_seedAllRepos').mockImplementation(() => {});
    vi.spyOn(tracker, '_ensureIdleTierRunning').mockImplementation(() => {});
    tracker.init();

    tracker.populateFromRepos([{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }]);
    expect(tracker.getWatchlist().map(r => r.name)).toEqual(['a']);

    eventBus.emit(Events.PROJECT_DETECTED, { name: 'b', path: '/b/src' });
    expect(tracker.getWatchlist().map(r => r.name)).toEqual(['a']);

    settings.set('ignoredRepos', ['/b', '/a']);
    expect(tracker.getWatchlist()).toEqual([]);
    tracker.destroy();
  });

  it('with the setting off, tracks only repos inside the user folders', () => {
    const settings = fakeSettings({ autoDetectRepos: false, projectFolders: ['C:\\work'] });
    const tracker = new GitTracker(settings);
    vi.spyOn(tracker, '_pollRepo').mockResolvedValue();
    tracker.init();

    eventBus.emit(Events.PROJECT_DETECTED, { name: 'elsewhere', path: 'E:\\games\\mod' });
    eventBus.emit(Events.PROJECT_DETECTED, { name: 'app', path: 'c:/Work/app' });
    expect(tracker.getWatchlist().map(r => r.name)).toEqual(['app']);
    tracker.destroy();
  });

  it('syncs to the latest list but keeps repos detected at runtime', () => {
    const tracker = new GitTracker(fakeSettings());
    vi.spyOn(tracker, '_seedAllRepos').mockImplementation(() => {});
    vi.spyOn(tracker, '_ensureIdleTierRunning').mockImplementation(() => {});
    vi.spyOn(tracker, '_pollRepo').mockResolvedValue();
    tracker.init();

    tracker.populateFromRepos([{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }]);
    eventBus.emit(Events.PROJECT_DETECTED, { name: 'c', path: '/c' });
    tracker.populateFromRepos([{ name: 'a', path: '/a' }]);
    expect(tracker.getWatchlist().map(r => r.name).sort()).toEqual(['a', 'c']);
    tracker.destroy();
  });
});

describe('claudeFolderToAutoAdd', () => {
  const opts = { autoDetect: true, projectFolders: [], ignored: [] };

  it('adds the parent folder only with the setting on', () => {
    expect(claudeFolderToAutoAdd('E:\\work\\games\\mod', opts)).toEqual({ folder: 'E:\\work\\games' });
    expect(claudeFolderToAutoAdd('E:\\work\\games\\mod', { ...opts, autoDetect: false }))
      .toEqual({ skip: 'auto-detect-off' });
  });

  it('keeps the old guards', () => {
    expect(claudeFolderToAutoAdd('C:\\Users\\me', opts).skip).toBe('too-shallow');
    expect(claudeFolderToAutoAdd('/home/me/x', opts).skip).toBe('too-shallow');
    expect(claudeFolderToAutoAdd('/home/me/code/x/', opts).folder).toBe('/home/me/code');
    expect(claudeFolderToAutoAdd('/home/me/code/x', { ...opts, projectFolders: ['/home/me/code'] }).skip).toBe('already-added');
    expect(claudeFolderToAutoAdd('E:\\\\work\\\\a\\\\b', opts)).toEqual({ folder: 'E:\\work\\a' });
  });

  it('skips sessions inside ignored repos', () => {
    expect(claudeFolderToAutoAdd('/home/me/x/src', { ...opts, ignored: ['/home/me/x'] }).skip).toBe('ignored');
  });
});

describe('repo paths', () => {
  it('compare Windows paths loosely and match insides only', () => {
    expect(repoKey('E:\\Work\\Repo\\')).toBe('e:/work/repo');
    expect(repoKey('/Home/Repo/')).toBe('/Home/Repo');
    expect(isIgnoredRepo('e:/work/repo/src', ['E:\\Work\\Repo'])).toBe(true);
    expect(isIgnoredRepo('E:\\Work\\Repo2', ['E:\\Work\\Repo'])).toBe(false);
  });
});

describe('found repos list', () => {
  const now = Date.UTC(2026, 9, 24);

  it('hides ignored repos and puts the latest commits first', () => {
    const repos = [
      { name: 'old', path: '/old', lastCommit: 100 },
      { name: 'none', path: '/none', lastCommit: null },
      { name: 'new', path: '/new', lastCommit: 200 },
      { name: 'hidden', path: '/hidden', lastCommit: 300 },
    ];
    expect(visibleRepos(repos, ['/hidden']).map(r => r.name)).toEqual(['new', 'old', 'none']);
  });

  it('summarises count, last scan and limits', () => {
    expect(scanSummary(null, 0)).toBe('Not scanned yet');
    expect(scanSummary({ scanning: true }, 3)).toBe('Scanning…');
    expect(scanSummary({ lastScanTime: now - 2 * 3600e3, stats: {} }, 12, now)).toBe('12 repos found · last scan 2h ago');
    expect(scanSummary({ lastScanTime: now, stats: { truncated: true } }, 300, now)).toContain('repo limit');
    expect(scanSummary({ lastScanTime: now, stats: { timedOut: true } }, 1, now)).toContain('1 repo found');
    expect(formatAgo(now - 3 * 86400e3, now)).toBe('3d ago');
    expect(formatAgo(0, now)).toBe('');
  });
});

describe('Settings round-trip', () => {
  it('defaults to on with nothing ignored, and keeps changes across a reload', async () => {
    let saved = null;
    db.getSection.mockImplementation(() => saved);
    db.setSection.mockImplementation((_s, v) => { saved = JSON.parse(JSON.stringify(v)); });

    expect(DEFAULT_SETTINGS.autoDetectRepos).toBe(true);
    const first = new Settings();
    await first.init();
    expect(first.get('autoDetectRepos')).toBe(true);
    expect(first.get('ignoredRepos')).toEqual([]);

    first.set('autoDetectRepos', false);
    first.set('ignoredRepos', ['E:\\work\\old']);
    expect(saved.autoDetectRepos).toBe(false);

    const second = new Settings();
    await second.init();
    expect(second.get('autoDetectRepos')).toBe(false);
    expect(second.get('ignoredRepos')).toEqual(['E:\\work\\old']);

    second.reset();
    expect(second.get('autoDetectRepos')).toBe(true);
    expect(second.get('ignoredRepos')).toEqual([]);
  });
});
