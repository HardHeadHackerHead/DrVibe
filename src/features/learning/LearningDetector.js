// Dr. Vibe - Learning Opportunity Detector
// Detects when the user might benefit from learning resources by tracking
// language/framework usage, file revisit patterns, and coding momentum.

import { eventBus, Events } from '../../core/EventBus.js';
import resourceDb from '../../config/learningResources.json' with { type: 'json' };

// How long before we consider a language/framework "new" again if not seen
const FAMILIARITY_RESET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Minimum time between suggestions for the same language/framework
const SUGGESTION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// File revisit tracking thresholds
const FILE_REVISIT_WINDOW_MS = 10 * 60 * 1000; // 10 minute window
const FILE_REVISIT_THRESHOLD = 5; // visits in the window to consider "struggling"

// Low momentum thresholds
const MOMENTUM_WINDOW_MS = 15 * 60 * 1000; // 15 minute tracking window
const LOW_MOMENTUM_CODING_RATIO = 0.3; // less than 30% active coding time

export class LearningDetector {
  constructor(settings) {
    this.settings = settings;
    this.enabled = false;

    // Track which languages/frameworks the user has seen before
    // { languageKey: { firstSeen, lastSeen, sessionCount } }
    this.languageHistory = new Map();

    // Track file revisits: { filePath: [timestamps] }
    this.fileVisits = new Map();

    // Track coding momentum
    this.codingStarts = [];  // timestamps of coding start events
    this.codingStops = [];   // timestamps of coding stop events
    this.lastCodingStart = null;

    // Cooldowns: { languageKey: lastSuggestionTimestamp }
    this.suggestionCooldowns = new Map();

    // Per-project dismissals: Set of "projectName:languageKey"
    this.dismissedForProject = new Set();

    this._currentProject = null;
    this._currentWindowTitle = '';

    this._loadPersistedState();
  }

  init() {
    // Listen for settings changes
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'learningResourcesEnabled') {
        this.enabled = value;
      }
    });

    this.enabled = this.settings.get('learningResourcesEnabled') || false;

    // Track project changes
    eventBus.on(Events.PROJECT_DETECTED, (project) => {
      this._currentProject = project;
      this._checkNewProject(project);
    });

    eventBus.on(Events.PROJECT_CHANGED, ({ current }) => {
      this._currentProject = current;
    });

    // Track activity for file revisits and momentum
    eventBus.on(Events.ACTIVITY_CHANGED, ({ isCoding, appName, windowTitle }) => {
      if (!this.enabled) return;
      this._currentWindowTitle = windowTitle || '';
      if (isCoding && windowTitle) {
        this._trackFileVisit(windowTitle);
        this._detectLanguageFromWindow(windowTitle, appName);
      }
    });

    eventBus.on(Events.ACTIVITY_CODING_START, () => {
      if (!this.enabled) return;
      const now = Date.now();
      this.codingStarts.push(now);
      this.lastCodingStart = now;
      this._pruneTimestamps();
    });

    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      if (!this.enabled) return;
      this.codingStops.push(Date.now());
      this.lastCodingStart = null;
      this._pruneTimestamps();
      this._checkMomentum();
    });

    console.log('LearningDetector initialized');
  }

  dismissForProject(projectName, languageKey) {
    this.dismissedForProject.add(`${projectName}:${languageKey}`);
    this._persistState();
  }

  isDismissedForProject(projectName, languageKey) {
    return this.dismissedForProject.has(`${projectName}:${languageKey}`);
  }

  _checkNewProject(project) {
    if (!this.enabled || !project?.name) return;

    // Detect language/framework from window title context
    // The actual detection happens in _detectLanguageFromWindow
    // which fires on each ACTIVITY_CHANGED
  }

  _detectLanguageFromWindow(windowTitle, appName) {
    if (!windowTitle) return;

    const detectedLangs = this._identifyLanguages(windowTitle);

    for (const langKey of detectedLangs) {
      const history = this.languageHistory.get(langKey);
      const now = Date.now();

      if (!history || (now - history.lastSeen > FAMILIARITY_RESET_MS)) {
        // New language or hasn't been seen in a while
        this._recordLanguageSeen(langKey, !history);

        if (this._canSuggest(langKey)) {
          const category = history ? 'lowMomentum' : 'newLanguage';
          this._emitSuggestion(langKey, category);
        }
      } else {
        // Update last seen
        history.lastSeen = now;
        history.sessionCount++;
      }
    }
  }

  _identifyLanguages(windowTitle) {
    const detected = [];
    const lowerTitle = windowTitle.toLowerCase();

    // Check file extensions in window title
    const extMatch = windowTitle.match(/\.(\w+)(?:\s|$|\s[—–-])/);
    if (extMatch) {
      const ext = '.' + extMatch[1].toLowerCase();

      for (const [key, lang] of Object.entries(resourceDb.languages)) {
        if (lang.indicators.some(ind => ind === ext)) {
          detected.push(key);
        }
      }
    }

    // Check for framework indicators in the title
    for (const [key, fw] of Object.entries(resourceDb.frameworks)) {
      if (fw.indicators.some(ind => lowerTitle.includes(ind.toLowerCase()))) {
        detected.push(`fw:${key}`);
      }
    }

    return detected;
  }

  _trackFileVisit(windowTitle) {
    // Extract filename from window title
    const fileMatch = windowTitle.match(/^(?:●\s*)?([^\s—–-]+\.\w+)/);
    if (!fileMatch) return;

    const fileName = fileMatch[1];
    const now = Date.now();

    if (!this.fileVisits.has(fileName)) {
      this.fileVisits.set(fileName, []);
    }

    const visits = this.fileVisits.get(fileName);
    visits.push(now);

    // Prune old visits outside the window
    const cutoff = now - FILE_REVISIT_WINDOW_MS;
    while (visits.length > 0 && visits[0] < cutoff) {
      visits.shift();
    }

    // Check if struggling
    if (visits.length >= FILE_REVISIT_THRESHOLD) {
      this._onStrugglingDetected(fileName);
      // Reset to avoid repeated triggers
      visits.length = 0;
    }
  }

  _onStrugglingDetected(fileName) {
    // Find a relevant language for this file
    const ext = fileName.match(/\.(\w+)$/);
    if (!ext) return;

    const dotExt = '.' + ext[1].toLowerCase();
    for (const [key, lang] of Object.entries(resourceDb.languages)) {
      if (lang.indicators.some(ind => ind === dotExt)) {
        if (this._canSuggest(key)) {
          this._emitSuggestion(key, 'struggling');
        }
        return;
      }
    }
  }

  _checkMomentum() {
    if (this.codingStarts.length < 3) return; // Need enough data

    const now = Date.now();
    const windowStart = now - MOMENTUM_WINDOW_MS;

    // Calculate total coding time in the window
    let totalCodingMs = 0;
    for (let i = 0; i < this.codingStarts.length; i++) {
      const start = Math.max(this.codingStarts[i], windowStart);
      const stop = this.codingStops[i]
        ? Math.min(this.codingStops[i], now)
        : now;
      if (stop > start) {
        totalCodingMs += stop - start;
      }
    }

    const ratio = totalCodingMs / MOMENTUM_WINDOW_MS;

    if (ratio < LOW_MOMENTUM_CODING_RATIO) {
      // Low momentum — suggest resources for current language
      const detectedLangs = this._identifyLanguages(this._currentWindowTitle);
      for (const langKey of detectedLangs) {
        if (this._canSuggest(langKey)) {
          this._emitSuggestion(langKey, 'lowMomentum');
          break; // Only suggest for one language at a time
        }
      }
    }
  }

  _canSuggest(langKey) {
    if (!this.enabled) return false;

    // Check per-project dismissal
    const projectName = this._currentProject?.name;
    if (projectName && this.isDismissedForProject(projectName, langKey)) {
      return false;
    }

    // Check cooldown
    const lastSuggestion = this.suggestionCooldowns.get(langKey);
    if (lastSuggestion && (Date.now() - lastSuggestion) < SUGGESTION_COOLDOWN_MS) {
      return false;
    }

    return true;
  }

  _emitSuggestion(langKey, reason) {
    const isFramework = langKey.startsWith('fw:');
    const cleanKey = isFramework ? langKey.slice(3) : langKey;
    const db = isFramework ? resourceDb.frameworks : resourceDb.languages;
    const entry = db[cleanKey];

    if (!entry) return;

    // Pick the right suggestion template
    const templateKey = isFramework ? 'newFramework' : reason;
    const template = resourceDb.suggestionTemplates[templateKey] || resourceDb.suggestionTemplates.newLanguage;
    const message = template.replace('{label}', entry.label);

    this.suggestionCooldowns.set(langKey, Date.now());

    eventBus.emit(Events.LEARNING_RESOURCE_SUGGESTED, {
      languageKey: langKey,
      label: entry.label,
      reason,
      message,
      resources: entry.resources,
      projectName: this._currentProject?.name || null,
    });

    console.log(`Learning resource suggested: ${entry.label} (${reason})`);
  }

  _recordLanguageSeen(langKey, isNew) {
    this.languageHistory.set(langKey, {
      firstSeen: isNew ? Date.now() : (this.languageHistory.get(langKey)?.firstSeen || Date.now()),
      lastSeen: Date.now(),
      sessionCount: 1,
    });
  }

  _pruneTimestamps() {
    const cutoff = Date.now() - MOMENTUM_WINDOW_MS;
    while (this.codingStarts.length > 0 && this.codingStarts[0] < cutoff) {
      this.codingStarts.shift();
      this.codingStops.shift();
    }
  }

  _persistState() {
    try {
      const data = {
        dismissed: Array.from(this.dismissedForProject),
        languageHistory: Object.fromEntries(this.languageHistory),
      };
      localStorage.setItem('dr-vibe-learning', JSON.stringify(data));
    } catch (e) {
      // Silently fail — not critical
    }
  }

  _loadPersistedState() {
    try {
      const raw = localStorage.getItem('dr-vibe-learning');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.dismissed) {
          this.dismissedForProject = new Set(data.dismissed);
        }
        if (data.languageHistory) {
          for (const [key, val] of Object.entries(data.languageHistory)) {
            this.languageHistory.set(key, val);
          }
        }
      }
    } catch (e) {
      // Silently fail — start fresh
    }
  }
}
