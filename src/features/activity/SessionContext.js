// Dr. Vibe - Session Context Tracker
// Tracks which files the user is actively working on by listening
// to file change events. Maintains a recency-sorted list of active
// files (modified within the last 15 minutes) and emits updates.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';

// How long a file stays "active" (15 minutes)
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

// How often to prune stale files
const PRUNE_INTERVAL_MS = 30 * 1000;

// Max files to track in the display
const MAX_DISPLAY_FILES = 5;

// Paths to ignore (build artifacts, node_modules, etc.)
const IGNORE_PATTERNS = [
  /node_modules/i,
  /\.git[/\\]/,
  /[/\\]\.DS_Store$/,
  /[/\\]thumbs\.db$/i,
  /[/\\]target[/\\]/,      // Rust build
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
  /[/\\]\.next[/\\]/,
  /[/\\]__pycache__[/\\]/,
  /\.pyc$/,
  /\.o$/,
  /\.obj$/,
  /\.exe$/,
  /\.dll$/,
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
];

export class SessionContext {
  constructor() {
    this.activeFiles = new Map(); // path -> { path, filename, relativePath, lastModified, eventType }
    this.projectPath = null;
    this.pruneInterval = null;
    this.unlistenFile = null;
    this.unsubProject = null;
    this.unsubProjectLost = null;
  }

  async init() {
    // Track current project for relative path calculation
    this.unsubProject = eventBus.on(Events.PROJECT_DETECTED, (project) => {
      this.projectPath = project.path;
    });

    this.unsubProjectLost = eventBus.on(Events.PROJECT_LOST, () => {
      this.projectPath = null;
    });

    // Listen for file changes from Tauri
    if (tauri.isAvailable) {
      this.unlistenFile = await tauri.onFileChanged((event) => {
        this.onFileChange(event);
      });
    }

    // Prune stale files periodically
    this.pruneInterval = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);

    console.log('SessionContext initialized');
  }

  destroy() {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    if (this.unlistenFile) {
      Promise.resolve(this.unlistenFile).then(fn => {
        if (typeof fn === 'function') fn();
      });
      this.unlistenFile = null;
    }
    if (this.unsubProject) {
      this.unsubProject();
      this.unsubProject = null;
    }
    if (this.unsubProjectLost) {
      this.unsubProjectLost();
      this.unsubProjectLost = null;
    }
  }

  onFileChange(event) {
    const { event_type, path, timestamp } = event;

    // Skip ignored paths
    if (this.shouldIgnore(path)) return;

    const filename = this.extractFilename(path);
    const relativePath = this.getRelativePath(path);

    this.activeFiles.set(path, {
      path,
      filename,
      relativePath,
      lastModified: timestamp || Date.now(),
      eventType: event_type,
    });

    this.emitUpdate();
  }

  shouldIgnore(path) {
    return IGNORE_PATTERNS.some(pattern => pattern.test(path));
  }

  extractFilename(path) {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  getRelativePath(path) {
    if (!this.projectPath) return path;

    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedProject = this.projectPath.replace(/\\/g, '/');

    if (normalizedPath.startsWith(normalizedProject)) {
      const rel = normalizedPath.slice(normalizedProject.length);
      return rel.startsWith('/') ? rel.slice(1) : rel;
    }
    return path;
  }

  prune() {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    let changed = false;

    for (const [path, file] of this.activeFiles) {
      if (file.lastModified < cutoff) {
        this.activeFiles.delete(path);
        changed = true;
      }
    }

    if (changed) {
      this.emitUpdate();
    }
  }

  getActiveFiles() {
    // Return sorted by most recent first, limited to MAX_DISPLAY_FILES
    return Array.from(this.activeFiles.values())
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, MAX_DISPLAY_FILES);
  }

  getFileCount() {
    return this.activeFiles.size;
  }

  emitUpdate() {
    eventBus.emit(Events.SESSION_FILES_UPDATED, {
      files: this.getActiveFiles(),
      totalCount: this.activeFiles.size,
    });
  }
}
