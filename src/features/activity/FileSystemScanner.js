// Dr. Vibe - Smart File System Scanner
// Automatically discovers coding projects on the user's machine.
// Scans on first launch and rescans daily. Persists results via unified database.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';

const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_DEPTH = 5;
const MAX_PROJECTS = 200; // Cap to prevent unbounded storage growth

// Platform-aware default search paths
function getDefaultSearchPaths() {
  const isWindows = navigator.userAgent.includes('Windows');

  if (isWindows) {
    const user = '~';
    return [
      `${user}\\code`,
      `${user}\\projects`,
      `${user}\\dev`,
      `${user}\\repos`,
      `${user}\\workspace`,
      `${user}\\source`,
      `${user}\\src`,
      `${user}\\Documents`,
      `${user}\\Desktop`,
    ];
  }

  // macOS / Linux
  return [
    '~/code',
    '~/projects',
    '~/dev',
    '~/repos',
    '~/workspace',
    '~/src',
    '~/Documents',
    '~/Desktop',
  ];
}

export class FileSystemScanner {
  constructor() {
    this.projects = [];      // Array of { name, path, project_type, markers_found, discoveredAt }
    this.lastScanTime = 0;
    this.scanning = false;
    this._rescanTimer = null;
  }

  async init() {
    this._loadFromStore();

    const needsScan = this._shouldRescan();
    if (needsScan) {
      // Run scan asynchronously so it doesn't block app startup
      this.scan().catch(e => console.error('Initial project scan failed:', e));
    } else {
      console.log(`FileSystemScanner: ${this.projects.length} cached projects (last scan ${this._formatAge()} ago)`);
      if (this.projects.length > 0) {
        eventBus.emit(Events.PROJECTS_DISCOVERED, { projects: this.projects, fromCache: true });
      }
    }

    this._scheduleRescan();
  }

  destroy() {
    if (this._rescanTimer) {
      clearTimeout(this._rescanTimer);
      this._rescanTimer = null;
    }
  }

  async scan() {
    if (this.scanning) return this.projects;
    this.scanning = true;

    const startTime = Date.now();
    console.log('FileSystemScanner: Starting project scan...');
    eventBus.emit(Events.SCANNER_STARTED, {});

    try {
      const searchPaths = getDefaultSearchPaths();
      const results = await tauri.scanDirectoriesForProjects(searchPaths, MAX_DEPTH);

      const now = Date.now();
      this.projects = results.map(p => ({
        name: p.name,
        path: p.path,
        project_type: p.project_type,
        markers_found: p.markers_found,
        discoveredAt: now,
      }));
      // Cap project list to prevent unbounded storage/memory growth
      if (this.projects.length > MAX_PROJECTS) {
        this.projects = this.projects.slice(0, MAX_PROJECTS);
      }
      this.lastScanTime = now;

      const elapsed = now - startTime;
      console.log(`FileSystemScanner: Found ${this.projects.length} projects in ${elapsed}ms`);

      this._saveToStore();

      eventBus.emit(Events.SCANNER_COMPLETE, {
        count: this.projects.length,
        elapsed,
      });
      eventBus.emit(Events.PROJECTS_DISCOVERED, {
        projects: this.projects,
        fromCache: false,
      });
    } catch (e) {
      console.error('FileSystemScanner: Scan failed:', e);
      eventBus.emit(Events.SCANNER_ERROR, { error: e.message || String(e) });
    } finally {
      this.scanning = false;
    }

    return this.projects;
  }

  getProjects() {
    return this.projects;
  }

  getProjectByPath(path) {
    return this.projects.find(p => p.path === path) || null;
  }

  getProjectsByType(type) {
    return this.projects.filter(p => p.project_type === type);
  }

  isScanning() {
    return this.scanning;
  }

  getLastScanTime() {
    return this.lastScanTime;
  }

  // --- Private ---

  _shouldRescan() {
    if (this.lastScanTime === 0) return true; // Never scanned
    return (Date.now() - this.lastScanTime) >= RESCAN_INTERVAL_MS;
  }

  _scheduleRescan() {
    if (this._rescanTimer) clearTimeout(this._rescanTimer);

    const msUntilRescan = this.lastScanTime === 0
      ? 0
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
    const saved = db.getSection('scanner');
    if (saved) {
      if (Array.isArray(saved.discoveredProjects)) this.projects = saved.discoveredProjects;
      if (typeof saved.lastProjectScan === 'number') this.lastScanTime = saved.lastProjectScan;
    }
  }

  _saveToStore() {
    db.setSection('scanner', {
      discoveredProjects: this.projects,
      lastProjectScan: this.lastScanTime,
    });
  }
}
