// Dr. Vibe - Project Detector
// Automatically detects which project the user is working on by parsing
// IDE window titles and falling back to filesystem scanning.
// Includes debounced project switching to prevent flickering.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';

const DEBOUNCE_MS = 5000; // 5 second minimum before committing a project switch

// IDE window title patterns.
// Each entry: { pattern: RegExp, extract: (match) => { name, path } }
const IDE_PATTERNS = [
  // VS Code / Cursor / Windsurf: "filename — ProjectName" or "ProjectName - Visual Studio Code"
  {
    apps: ['code', 'cursor', 'windsurf'],
    pattern: /^(?:●\s*)?(?:.+?\s+[—–-]\s+)?(.+?)\s+-\s+(?:Visual Studio Code|Cursor|Windsurf)/i,
    extract: (match) => ({ name: match[1].trim(), path: null }),
  },
  // VS Code with path: "filename — ~/code/project - Visual Studio Code"
  {
    apps: ['code', 'cursor', 'windsurf'],
    pattern: /^(?:●\s*)?(?:.+?\s+[—–-]\s+)?((?:[A-Z]:\\|~\/|\/)[^\s].*?)\s+-\s+(?:Visual Studio Code|Cursor|Windsurf)/i,
    extract: (match) => {
      const fullPath = match[1].trim();
      const name = fullPath.split(/[/\\]/).filter(Boolean).pop();
      return { name, path: fullPath };
    },
  },
  // IntelliJ family: "project_name – [path] – IntelliJ IDEA"
  {
    apps: ['intellij', 'webstorm', 'pycharm', 'goland', 'rider', 'clion', 'datagrip', 'rustrover', 'phpstorm'],
    pattern: /^(.+?)\s+[–—-]\s+(?:\[(.+?)\]\s+[–—-]\s+)?(?:IntelliJ IDEA|WebStorm|PyCharm|GoLand|Rider|CLion|DataGrip|RustRover|PhpStorm)/i,
    extract: (match) => ({
      name: match[1].trim(),
      path: match[2] ? match[2].trim() : null,
    }),
  },
  // Sublime Text: "filename - project_name - Sublime Text"
  {
    apps: ['sublime'],
    pattern: /^(?:.+?\s+-\s+)?(.+?)\s+-\s+Sublime Text/i,
    extract: (match) => ({ name: match[1].trim(), path: null }),
  },
  // Zed: "filename — project_name — Zed"
  {
    apps: ['zed'],
    pattern: /^(?:.+?\s+[—–-]\s+)?(.+?)\s+[—–-]\s+Zed/i,
    extract: (match) => ({ name: match[1].trim(), path: null }),
  },
  // Generic fallback for unknown IDEs
  {
    apps: null,
    pattern: /^(?:●\s*)?(?:.+?\s+[—–-]\s+)?(.+?)\s+[—–-]\s+\S+$/,
    extract: (match) => ({ name: match[1].trim(), path: null }),
  },
];

// Map project markers to display-friendly types and colors
const PROJECT_TYPE_INFO = {
  rust:        { label: 'Rust',      color: '#dea584' },
  node:        { label: 'Node',      color: '#68a063' },
  python:      { label: 'Python',    color: '#3776ab' },
  go:          { label: 'Go',        color: '#00add8' },
  java:        { label: 'Java',      color: '#f89820' },
  dotnet:      { label: '.NET',      color: '#512bd4' },
  ruby:        { label: 'Ruby',      color: '#cc342d' },
  php:         { label: 'PHP',       color: '#777bb4' },
  flutter:     { label: 'Flutter',   color: '#02569b' },
  datascience: { label: 'Data Sci',  color: '#f37626' },
  web:         { label: 'Web',       color: '#e34c26' },
  git:         { label: 'Git',       color: '#f05032' },
  cmake:       { label: 'C/C++',     color: '#00599c' },
  make:        { label: 'C/C++',     color: '#00599c' },
};

export class ProjectDetector {
  constructor() {
    this.currentProject = null;   // { name, path, source, projectType, typeInfo, detectedAt }
    this.projectCache = new Map(); // path/name -> project info
    this.fallbackScanDone = false;

    // Debounce state
    this._pendingProject = null;  // Project waiting to be committed
    this._debounceTimer = null;

    this._unsubActivity = null;
    this._unsubWindowChanged = null;
  }

  init() {
    // Listen for coding start/stop transitions
    this._unsubActivity = eventBus.on(Events.ACTIVITY_CHANGED, (data) => {
      this._onActivityChanged(data);
    });

    // Listen for window changes while still coding (project switches)
    this._unsubWindowChanged = eventBus.on(Events.ACTIVITY_WINDOW_CHANGED, (data) => {
      this._onWindowChanged(data);
    });

    console.log('ProjectDetector initialized (5s debounce)');
  }

  destroy() {
    if (this._unsubActivity) {
      this._unsubActivity();
      this._unsubActivity = null;
    }
    if (this._unsubWindowChanged) {
      this._unsubWindowChanged();
      this._unsubWindowChanged = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  _onActivityChanged({ isCoding, appName, windowTitle }) {
    if (!isCoding || !windowTitle) {
      // User stopped coding — clear pending and emit project lost after debounce
      this._clearPending();
      if (this.currentProject) {
        this._debounceTimer = setTimeout(() => {
          if (this.currentProject) {
            eventBus.emit(Events.PROJECT_LOST, { project: this.currentProject });
          }
        }, DEBOUNCE_MS);
      }
      return;
    }

    this._detectFromWindow(windowTitle, appName);
  }

  _onWindowChanged({ appName, windowTitle }) {
    if (!windowTitle) return;
    this._detectFromWindow(windowTitle, appName);
  }

  _detectFromWindow(windowTitle, appName) {
    const detected = this._parseWindowTitle(windowTitle, appName);
    if (detected) {
      this._scheduleProjectSwitch(detected.name, detected.path, 'window_title');
    } else {
      this._tryFallbackScan(windowTitle);
    }
  }

  _parseWindowTitle(title, appName) {
    if (!title || title.length === 0) return null;

    const lowerApp = (appName || '').toLowerCase();

    for (const pattern of IDE_PATTERNS) {
      if (pattern.apps !== null) {
        const appMatches = pattern.apps.some(a => lowerApp.includes(a));
        if (!appMatches) continue;
      }

      const match = title.match(pattern.pattern);
      if (match) {
        const result = pattern.extract(match);
        if (result && result.name && result.name.length > 0) {
          if (this._isValidProjectName(result.name)) {
            return result;
          }
        }
      }
    }

    return null;
  }

  _isValidProjectName(name) {
    if (name.length > 100) return false;
    if (name.length < 2) return false;
    if (/^\.\w+$/.test(name)) return false;
    const rejects = ['welcome', 'getting started', 'release notes', 'settings', 'untitled'];
    if (rejects.includes(name.toLowerCase())) return false;
    return true;
  }

  _scheduleProjectSwitch(name, path, source) {
    const key = path || name;

    // Same as current project — cancel any pending switch and stay
    if (this.currentProject && (this.currentProject.path || this.currentProject.name) === key) {
      this._clearPending();
      return;
    }

    // Same as already pending — let the timer continue
    if (this._pendingProject && (this._pendingProject.path || this._pendingProject.name) === key) {
      return;
    }

    // New candidate — start debounce
    this._clearPending();
    this._pendingProject = { name, path, source };

    // If there's no current project, commit immediately (first detection)
    if (!this.currentProject) {
      this._commitProjectSwitch();
      return;
    }

    this._debounceTimer = setTimeout(() => {
      this._commitProjectSwitch();
    }, DEBOUNCE_MS);
  }

  async _commitProjectSwitch() {
    if (!this._pendingProject) return;

    const { name, path, source } = this._pendingProject;
    this._pendingProject = null;

    const prev = this.currentProject;
    const key = path || name;

    // Enrich with project type from filesystem scan
    let projectType = null;
    let typeInfo = null;
    if (path) {
      const markers = await tauri.scanProjectMarkers(path);
      if (markers && markers.project_type) {
        projectType = markers.project_type;
        typeInfo = PROJECT_TYPE_INFO[projectType] || null;
      }
    }

    // Check cache for type info if not resolved from path
    if (!typeInfo && this.projectCache.has(key)) {
      const cached = this.projectCache.get(key);
      projectType = cached.projectType;
      typeInfo = cached.typeInfo;
    }

    const project = {
      name,
      path,
      source,
      projectType,
      typeInfo,
      detectedAt: Date.now(),
    };

    this.projectCache.set(key, project);
    this.currentProject = project;

    console.log(`Project switched: ${name}${projectType ? ' (' + projectType + ')' : ''} via ${source}`);

    eventBus.emit(Events.PROJECT_DETECTED, project);
    eventBus.emit(Events.PROJECT_CHANGED, {
      current: project,
      previous: prev,
    });
  }

  _clearPending() {
    this._pendingProject = null;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  async _tryFallbackScan(windowTitle) {
    const pathMatch = windowTitle.match(/((?:[A-Z]:\\|~\/|\/(?:home|Users)\/)[^\s|—–-]+)/i);
    if (!pathMatch) return;

    const dirPath = pathMatch[1].trim();
    const markers = await tauri.scanProjectMarkers(dirPath);
    if (markers && markers.project_name) {
      this._scheduleProjectSwitch(markers.project_name, dirPath, 'filesystem_scan');
    }
  }

  async scanCommonDirectories() {
    if (this.fallbackScanDone) return;
    this.fallbackScanDone = true;

    const homePaths = [
      '~/code', '~/projects', '~/dev', '~/repos', '~/workspace',
      '~/Documents/code', '~/Documents/projects',
      '~/Desktop',
    ];

    const repos = await tauri.getRecentGitRepos(homePaths);
    for (const repo of repos) {
      this.projectCache.set(repo.path, {
        name: repo.name,
        path: repo.path,
        source: 'git_scan',
        projectType: null,
        typeInfo: null,
        detectedAt: Date.now(),
      });
    }

    if (repos.length > 0) {
      console.log(`Discovered ${repos.length} project(s) from common directories`);
    }
  }

  getCurrentProject() {
    return this.currentProject;
  }

  getKnownProjects() {
    return Array.from(this.projectCache.values());
  }
}
