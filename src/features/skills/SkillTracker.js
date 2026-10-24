// Dr. Vibe - Skill Development Tracker
// Tracks cumulative coding time per language/technology from file extensions.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';

// Map file extensions to language names
const EXTENSION_MAP = {
  // JavaScript / TypeScript
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
  // Python
  '.py': 'Python', '.pyw': 'Python', '.pyi': 'Python',
  // Rust
  '.rs': 'Rust',
  // Go
  '.go': 'Go',
  // C / C++
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cxx': 'C++', '.cc': 'C++', '.hpp': 'C++', '.hxx': 'C++',
  // C#
  '.cs': 'C#',
  // Java
  '.java': 'Java',
  // Kotlin
  '.kt': 'Kotlin', '.kts': 'Kotlin',
  // Swift
  '.swift': 'Swift',
  // Ruby
  '.rb': 'Ruby', '.erb': 'Ruby',
  // PHP
  '.php': 'PHP',
  // Lua
  '.lua': 'Lua',
  // Shell
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.fish': 'Shell',
  '.ps1': 'PowerShell', '.psm1': 'PowerShell',
  // Web
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS',
  // Data / Config
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.xml': 'XML',
  // SQL
  '.sql': 'SQL',
  // Dart
  '.dart': 'Dart',
  // Elixir / Erlang
  '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang',
  // Haskell
  '.hs': 'Haskell',
  // Scala
  '.scala': 'Scala',
  // Zig
  '.zig': 'Zig',
  // Vue / Svelte
  '.vue': 'Vue', '.svelte': 'Svelte',
  // Markdown / Docs
  '.md': 'Markdown', '.mdx': 'Markdown',
};

// Language display colors
const LANGUAGE_COLORS = {
  JavaScript: '#f7df1e',
  TypeScript: '#3178c6',
  Python: '#3776ab',
  Rust: '#dea584',
  Go: '#00add8',
  C: '#a8b9cc',
  'C++': '#00599c',
  'C#': '#239120',
  Java: '#ed8b00',
  Kotlin: '#7f52ff',
  Swift: '#fa7343',
  Ruby: '#cc342d',
  PHP: '#777bb4',
  Lua: '#2c2d72',
  Shell: '#89e051',
  PowerShell: '#012456',
  HTML: '#e34f26',
  CSS: '#1572b6',
  JSON: '#a0a0a0',
  YAML: '#cb171e',
  TOML: '#9c4221',
  XML: '#f26522',
  SQL: '#e38c00',
  Dart: '#0175c2',
  Elixir: '#6e4a7e',
  Erlang: '#a90533',
  Haskell: '#5e5086',
  Scala: '#dc322f',
  Zig: '#f7a41d',
  Vue: '#42b883',
  Svelte: '#ff3e00',
  Markdown: '#808080',
};

// Milestone thresholds in seconds
const MILESTONES = [
  { seconds: 3600, label: '1 hour' },
  { seconds: 18000, label: '5 hours' },
  { seconds: 36000, label: '10 hours' },
  { seconds: 90000, label: '25 hours' },
  { seconds: 180000, label: '50 hours' },
  { seconds: 360000, label: '100 hours' },
  { seconds: 900000, label: '250 hours' },
  { seconds: 1800000, label: '500 hours' },
];

export { LANGUAGE_COLORS, MILESTONES };

export class SkillTracker {
  constructor() {
    // Persisted cumulative data: { [language]: { totalSeconds, lastMilestoneIndex } }
    this.skills = {};
    // Session-only tracking: { [language]: { sessionSeconds, codingStartedAt } }
    this.sessionSkills = {};
    // Files active in this session per language
    this.activeFiles = new Set();
    this._unsubscribers = [];
    this._saveInterval = null;
    this._isCoding = false;
  }

  async init() {
    this._loadStore();
    this._setupEventListeners();
    this._startPeriodicSave();
    console.log('SkillTracker initialized');
  }

  _setupEventListeners() {
    // Track coding start/stop for time attribution
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        this._isCoding = true;
        this._startCodingForActiveLanguages();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
        this._isCoding = false;
        this._stopCodingForAllLanguages();
      })
    );

    // Track file changes to detect languages
    // tauri.onFileChanged returns a Promise<UnlistenFn>, resolve it before storing
    const fileChangePromise = tauri.onFileChanged((event) => {
      this._onFileChanged(event);
    });
    if (fileChangePromise) {
      fileChangePromise.then(unsub => {
        if (unsub) this._unsubscribers.push(unsub);
      });
    }

    // Also listen for synthetic file-change events from Claude Code integration
    this._unsubscribers.push(
      eventBus.on('file-changed-synthetic', (event) => {
        this._onFileChanged(event);
      })
    );
  }

  _onFileChanged(event) {
    if (!event.path) return;

    const language = this._detectLanguage(event.path);
    if (!language) return;

    this.activeFiles.add(event.path);

    // Ensure language entry exists
    if (!this.skills[language]) {
      this.skills[language] = { totalSeconds: 0, lastMilestoneIndex: -1 };
    }
    if (!this.sessionSkills[language]) {
      this.sessionSkills[language] = { sessionSeconds: 0, codingStartedAt: null };
    }

    // If currently coding, start tracking this language
    if (this._isCoding && !this.sessionSkills[language].codingStartedAt) {
      this.sessionSkills[language].codingStartedAt = Date.now();
    }

    eventBus.emit(Events.SKILL_UPDATED, this.getStats());
  }

  _detectLanguage(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    const lastDot = normalized.lastIndexOf('.');
    if (lastDot === -1) return null;

    const ext = normalized.slice(lastDot).toLowerCase();
    return EXTENSION_MAP[ext] || null;
  }

  _startCodingForActiveLanguages() {
    const now = Date.now();
    for (const lang of Object.keys(this.sessionSkills)) {
      if (!this.sessionSkills[lang].codingStartedAt) {
        this.sessionSkills[lang].codingStartedAt = now;
      }
    }
  }

  _stopCodingForAllLanguages() {
    const now = Date.now();
    for (const lang of Object.keys(this.sessionSkills)) {
      const session = this.sessionSkills[lang];
      if (session.codingStartedAt) {
        const elapsed = Math.floor((now - session.codingStartedAt) / 1000);
        session.sessionSeconds += elapsed;
        session.codingStartedAt = null;

        // Add to cumulative
        if (this.skills[lang]) {
          this.skills[lang].totalSeconds += elapsed;
          this._checkMilestones(lang);
        }
      }
    }
    eventBus.emit(Events.SKILL_UPDATED, this.getStats());
  }

  _checkMilestones(language) {
    const skill = this.skills[language];
    if (!skill) return;

    for (let i = skill.lastMilestoneIndex + 1; i < MILESTONES.length; i++) {
      if (skill.totalSeconds >= MILESTONES[i].seconds) {
        skill.lastMilestoneIndex = i;
        eventBus.emit(Events.SKILL_MILESTONE, {
          language,
          milestone: MILESTONES[i].label,
          totalSeconds: skill.totalSeconds,
        });
      } else {
        break;
      }
    }
  }

  getStats() {
    const now = Date.now();
    const stats = {};

    for (const [lang, skill] of Object.entries(this.skills)) {
      let currentTotal = skill.totalSeconds;
      let sessionTotal = 0;

      // Include in-progress coding time
      const session = this.sessionSkills[lang];
      if (session) {
        sessionTotal = session.sessionSeconds;
        if (session.codingStartedAt) {
          const inProgress = Math.floor((now - session.codingStartedAt) / 1000);
          currentTotal += inProgress;
          sessionTotal += inProgress;
        }
      }

      stats[lang] = {
        totalSeconds: currentTotal,
        sessionSeconds: sessionTotal,
        color: LANGUAGE_COLORS[lang] || '#a0a0a0',
        nextMilestone: this._getNextMilestone(currentTotal),
        lastMilestoneIndex: skill.lastMilestoneIndex,
      };
    }

    return stats;
  }

  _getNextMilestone(totalSeconds) {
    for (const milestone of MILESTONES) {
      if (totalSeconds < milestone.seconds) {
        return { seconds: milestone.seconds, label: milestone.label };
      }
    }
    return null;
  }

  getLanguageCount() {
    return Object.keys(this.skills).length;
  }

  // --- Persistence ---

  _loadStore() {
    const saved = db.getSection('skills');
    if (saved) {
      this.skills = saved;
    }
  }

  _saveStore() {
    // Flush any in-progress coding time to cumulative before saving
    this._flushInProgressTime();
    db.setSection('skills', this.skills);
  }

  _flushInProgressTime() {
    const now = Date.now();
    for (const lang of Object.keys(this.sessionSkills)) {
      const session = this.sessionSkills[lang];
      if (session.codingStartedAt) {
        const elapsed = Math.floor((now - session.codingStartedAt) / 1000);
        session.sessionSeconds += elapsed;
        session.codingStartedAt = now; // Reset start, don't stop tracking

        if (this.skills[lang]) {
          this.skills[lang].totalSeconds += elapsed;
          this._checkMilestones(lang);
        }
      }
    }
  }

  _startPeriodicSave() {
    // Save every 2 minutes
    this._saveInterval = setInterval(() => {
      this._saveStore();
    }, 120000);
  }

  destroy() {
    this._saveStore();
    for (const unsub of this._unsubscribers) unsub();
    if (this._saveInterval) clearInterval(this._saveInterval);
  }
}
