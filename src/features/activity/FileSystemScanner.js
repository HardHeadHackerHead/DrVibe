// Dr. Vibe - Repo Scanner
// Finds the git repos GitTracker watches. With "Find my repos automatically"
// on (autoDetectRepos), Rust walks the home folder, every fixed local drive
// and the user's project folders, and repos seen at runtime (Claude Code,
// editors) are remembered. Off, only the user's project folders are scanned.
// Results are cached; a rescan runs at most once a day, or on "Scan now".
// Paths never leave this computer.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';
import { repoKey, isIgnoredRepo, repoName } from './repoPaths.js';

const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SECTION = 'repoScan';
const MAX_REMEMBERED = 200;

export class FileSystemScanner {
  constructor(settings) {
    this.settings = settings;
    this.repos = [];          // [{ name, path, lastCommit, source: 'scan' | 'detected' }]
    this.remembered = [];     // [{ name, path }] repos seen at runtime, kept across scans
    this.lastScanTime = 0;
    this.lastScanStats = null; // { roots, dirsVisited, elapsedMs, truncated, timedOut }
    this.lastScanMode = null;  // autoDetect value of the last scan
    this.scanning = false;
    this._rescanQueued = false;
    this._prevIgnored = [];
    this._rescanTimer = null;
    this._unsubscribers = [];
  }

  async init() {
    this._loadFromStore();
    this._prevIgnored = [...this._ignored()];

    // A cache from the other mode (setting flipped while the app was closed) is stale.
    if (this._shouldRescan() || this.lastScanMode !== this._autoDetect()) {
      this.scan().catch(e => console.error('Initial repo scan failed:', e));
    } else {
      console.log(`RepoScanner: ${this.repos.length} cached repos (last scan ${this._formatAge()} ago)`);
      this._emitDiscovered(true);
    }

    this._unsubscribers.push(
      eventBus.on(Events.PROJECT_DETECTED, (project) => {
        this.rememberDetected(project).catch(() => {});
      }),
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => this._onSettingChanged(key, value)),
    );

    this._scheduleRescan();
  }

  destroy() {
    if (this._rescanTimer) {
      clearTimeout(this._rescanTimer);
      this._rescanTimer = null;
    }
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  async scan() {
    if (this.scanning) {
      this._rescanQueued = true;
      return this.repos;
    }
    this.scanning = true;
    const autoDetect = this._autoDetect();
    console.log(`RepoScanner: scanning (${autoDetect ? 'all drives' : 'project folders only'})...`);
    eventBus.emit(Events.SCANNER_STARTED, {});

    try {
      const result = await tauri.scanGitRepos({
        scanDrives: autoDetect,
        folders: this._folders(),
        knownRepos: autoDetect ? this.remembered.map(r => r.path) : [],
        ignored: this._ignored(),
      });
      if (!result) throw new Error('Repo scan unavailable');

      const rememberedKeys = new Set(this.remembered.map(r => repoKey(r.path)));
      this.repos = result.repos.map(r => ({
        name: r.name,
        path: r.path,
        lastCommit: r.lastCommit ?? null,
        source: rememberedKeys.has(repoKey(r.path)) ? 'detected' : 'scan',
      }));
      // Remembered repos that are gone (deleted, drive unplugged) are dropped.
      if (autoDetect) {
        const found = new Set(this.repos.map(r => repoKey(r.path)));
        this.remembered = this.remembered.filter(r => found.has(repoKey(r.path)));
      }
      this.lastScanTime = Date.now();
      this.lastScanMode = autoDetect;
      this.lastScanStats = {
        roots: result.roots,
        dirsVisited: result.dirsVisited,
        elapsedMs: result.elapsedMs,
        truncated: result.truncated,
        timedOut: result.timedOut,
      };
      this._saveToStore();
      this.scanning = false; // before the events, so status snapshots read "done"

      console.log(`RepoScanner: found ${this.repos.length} repos in ${result.elapsedMs}ms` +
        `${result.truncated ? ' (cap reached)' : ''}${result.timedOut ? ' (time limit reached)' : ''}`);
      eventBus.emit(Events.SCANNER_COMPLETE, { count: this.repos.length, elapsed: result.elapsedMs });
      this._emitDiscovered(false);
    } catch (e) {
      console.error('RepoScanner: scan failed:', e);
      this.scanning = false;
      eventBus.emit(Events.SCANNER_ERROR, { error: e.message || String(e) });
    } finally {
      this.scanning = false;
    }

    if (this._rescanQueued) {
      this._rescanQueued = false;
      return this.scan();
    }
    return this.repos;
  }

  /**
   * Remember a repo the user is working in (Claude Code cwd, editor project),
   * so it's tracked even outside the scanned areas. Only with auto-detect on.
   */
  async rememberDetected(project) {
    if (!project?.path || !this._autoDetect()) return false;
    if (isIgnoredRepo(project.path, this._ignored())) return false;
    if (this._knows(project.path)) return false;

    const info = await tauri.getGitInfo(project.path);
    const root = info?.git_root;
    if (!root || this._knows(root) || isIgnoredRepo(root, this._ignored())) return false;

    const entry = { name: info.repo_name || repoName(root), path: root };
    this.remembered = [entry, ...this.remembered].slice(0, MAX_REMEMBERED);
    this.repos.push({ ...entry, lastCommit: null, source: 'detected' });
    this._saveToStore();
    console.log(`RepoScanner: remembered detected repo "${entry.name}"`);
    this._emitDiscovered(false);
    return true;
  }

  /** Repos to track: everything found, minus ignored ones. */
  getRepos() {
    const ignored = this._ignored();
    return this.repos.filter(r => !isIgnoredRepo(r.path, ignored));
  }

  /** Snapshot for Settings → Tracking. */
  getStatus() {
    return {
      autoDetect: this._autoDetect(),
      scanning: this.scanning,
      lastScanTime: this.lastScanTime,
      stats: this.lastScanStats,
      repos: this.getRepos(),
    };
  }

  isScanning() {
    return this.scanning;
  }

  getLastScanTime() {
    return this.lastScanTime;
  }

  // --- Private ---

  _autoDetect() {
    return this.settings?.get('autoDetectRepos') !== false;
  }

  _folders() {
    const folders = this.settings?.get('projectFolders');
    return Array.isArray(folders) ? folders : [];
  }

  _ignored() {
    const ignored = this.settings?.get('ignoredRepos');
    return Array.isArray(ignored) ? ignored : [];
  }

  _knows(path) {
    const key = repoKey(path);
    return this.repos.some(r => repoKey(r.path) === key) ||
      this.remembered.some(r => repoKey(r.path) === key);
  }

  _onSettingChanged(key, value) {
    if (key === 'autoDetectRepos' || key === 'projectFolders') {
      this.scan().catch(e => console.error('Repo rescan failed:', e));
    } else if (key === 'ignoredRepos') {
      // Un-ignored repos were left out of the last scan, so look again;
      // newly ignored ones only need filtering.
      const nowIgnored = Array.isArray(value) ? value : [];
      const unIgnored = this._prevIgnored.some(p => !nowIgnored.includes(p));
      this._prevIgnored = [...nowIgnored];
      if (unIgnored) {
        this.scan().catch(e => console.error('Repo rescan failed:', e));
      } else {
        this._emitDiscovered(false);
      }
    }
  }

  _emitDiscovered(fromCache) {
    eventBus.emit(Events.PROJECTS_DISCOVERED, { repos: this.getRepos(), fromCache });
  }

  _shouldRescan() {
    if (this.lastScanTime === 0) return true; // Never scanned
    return (Date.now() - this.lastScanTime) >= RESCAN_INTERVAL_MS;
  }

  _scheduleRescan() {
    if (this._rescanTimer) clearTimeout(this._rescanTimer);

    const msUntilRescan = this.lastScanTime === 0
      ? RESCAN_INTERVAL_MS
      : Math.max(0, RESCAN_INTERVAL_MS - (Date.now() - this.lastScanTime));

    this._rescanTimer = setTimeout(() => {
      this.scan().catch(e => console.error('Scheduled rescan failed:', e));
      this._scheduleRescan(); // Schedule next one
    }, msUntilRescan + 1000); // +1s buffer
  }

  _formatAge() {
    if (this.lastScanTime === 0) return 'never';
    const hours = Math.round((Date.now() - this.lastScanTime) / (1000 * 60 * 60));
    if (hours < 1) return 'less than 1 hour';
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  _loadFromStore() {
    const saved = db.getSection(SECTION);
    if (!saved) return;
    if (Array.isArray(saved.repos)) this.repos = saved.repos;
    if (Array.isArray(saved.remembered)) this.remembered = saved.remembered;
    if (typeof saved.lastScan === 'number') this.lastScanTime = saved.lastScan;
    if (typeof saved.autoDetect === 'boolean') this.lastScanMode = saved.autoDetect;
    if (saved.stats) this.lastScanStats = saved.stats;
  }

  _saveToStore() {
    db.setSection(SECTION, {
      repos: this.repos,
      remembered: this.remembered,
      lastScan: this.lastScanTime,
      autoDetect: this.lastScanMode,
      stats: this.lastScanStats,
    });
  }
}
