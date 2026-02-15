// Dr. Vibe - Stuck Detection
// Detects when a user is actively working but spinning their wheels —
// repetitive edits to the same file, sustained low momentum, no new files,
// and frequent doc/search switching. Supportive, never condescending.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';

// How often to evaluate stuck indicators (60 seconds)
const EVAL_INTERVAL_MS = 60 * 1000;

// Minimum session length before stuck detection kicks in (20 minutes)
const MIN_SESSION_MS = 20 * 60 * 1000;

// Cooldown between stuck suggestions (30 minutes)
const COOLDOWN_MS = 30 * 60 * 1000;

// Minimum indicators required before suggesting the user is stuck
const MIN_INDICATORS = 2;

// Default thresholds (can be adjusted by adaptive learning)
const DEFAULT_THRESHOLDS = {
  repetitiveEdits: 30,          // edits to same file before flagging
  sustainedLowMomentumMs: 30 * 60 * 1000,  // 30 minutes of cold/warming
  noNewFilesMs: 60 * 60 * 1000,            // 60 minutes without new files
  searchSwitchCount: 8,          // browser/doc switches in 10 minutes
  searchSwitchWindowMs: 10 * 60 * 1000,
};

// How long to keep file edit history (60 minutes)
const FILE_EDIT_WINDOW_MS = 60 * 60 * 1000;

// Known browser/docs app name fragments
const SEARCH_APPS = [
  'chrome', 'firefox', 'edge', 'safari', 'brave', 'opera', 'vivaldi',
  'arc', 'browser', 'explorer',
];

const STUCK_MESSAGES = [
  {
    title: 'Dr. Vibe',
    body: "Looks like you might be stuck on something. Maybe take a quick break and come back with fresh eyes?",
    tip: "A 5-minute walk can unlock new ideas.",
  },
  {
    title: 'Dr. Vibe',
    body: "You've been working hard on this one. Want to try a different file or approach for a bit?",
    tip: "Sometimes the answer is in a different part of the code.",
  },
  {
    title: 'Dr. Vibe',
    body: "Spending a lot of time in the same spot — that's normal! Maybe step back and think about the bigger picture?",
    tip: "Writing down the problem can help clarify it.",
  },
  {
    title: 'Dr. Vibe',
    body: "This seems like a tough one. No shame in taking a break or asking for help!",
    tip: "Rubber duck debugging: explain the problem out loud.",
  },
  {
    title: 'Dr. Vibe',
    body: "You've been at this a while — sometimes the best thing is to sleep on it.",
    tip: "Your brain keeps working on problems even when you rest.",
  },
];

export class StuckDetector {
  constructor(settings) {
    this.settings = settings;
    this.enabled = settings.stuckDetectionEnabled ?? true;
    this.evalInterval = null;
    this.lastSuggestionTime = 0;
    this.sessionStart = Date.now();
    this.dismissed = false;

    // Per-file edit tracking: Map<path, { count, timestamps[] }>
    this.fileEdits = new Map();

    // Unique files seen over time: Map<path, firstSeenTimestamp>
    this.uniqueFiles = new Map();
    this.lastNewFileTime = Date.now();

    // Momentum tracking for sustained low detection
    this.lowMomentumStart = null; // timestamp when momentum went cold/warming
    this.currentMomentumLevel = 'cold';

    // Search/docs switching tracking
    this.searchSwitches = []; // timestamps of switches to browser/docs

    // Coding activity tracking
    this.isCoding = false;
    this.codingStartTime = null;

    // Adaptive thresholds (loaded from settings)
    this.thresholds = { ...DEFAULT_THRESHOLDS };
    const saved = settings.stuckThresholds;
    if (saved) {
      Object.assign(this.thresholds, saved);
    }

    // Adaptive learning history
    this.stuckHistory = []; // { timestamp, indicators, dismissed: bool }

    this._unsubscribers = [];
  }

  init() {
    this._setupEventListeners();
    this._startEvaluation();
    console.log('StuckDetector initialized');
  }

  _setupEventListeners() {
    // Track file changes from momentum tracker's underlying events
    if (tauri.isAvailable) {
      const setupFileListener = async () => {
        const unlisten = await tauri.onFileChanged((event) => {
          this._onFileChange(event);
        });
        if (unlisten) {
          this._unsubscribers.push(() => {
            Promise.resolve(unlisten).then(fn => {
              if (typeof fn === 'function') fn();
            });
          });
        }
      };
      setupFileListener();
    }

    // Track momentum level for sustained-low detection
    this._unsubscribers.push(
      eventBus.on(Events.MOMENTUM_LEVEL_CHANGED, ({ current, previous }) => {
        this.currentMomentumLevel = current;
        const isLow = current === 'cold' || current === 'warming';
        const wasLow = previous === 'cold' || previous === 'warming';

        if (isLow && !wasLow) {
          // Momentum just dropped — start tracking
          this.lowMomentumStart = Date.now();
        } else if (!isLow && wasLow) {
          // Momentum recovered — reset
          this.lowMomentumStart = null;
        }
      })
    );

    // Track momentum changes to maintain current level
    this._unsubscribers.push(
      eventBus.on(Events.MOMENTUM_CHANGED, ({ level }) => {
        this.currentMomentumLevel = level;
      })
    );

    // Track window switches to detect search/docs behavior
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_WINDOW_SWITCH, ({ toApp }) => {
        if (this._isSearchApp(toApp)) {
          this.searchSwitches.push(Date.now());
          this._pruneRecent(this.searchSwitches, this.thresholds.searchSwitchWindowMs);
        }
      })
    );

    // Track coding state
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        this.isCoding = true;
        if (!this.codingStartTime) {
          this.codingStartTime = Date.now();
        }
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
        this.isCoding = false;
      })
    );

    // Handle dismissal
    this._unsubscribers.push(
      eventBus.on(Events.STUCK_DISMISSED, () => {
        this.dismissed = true;
        this.lastSuggestionTime = Date.now();

        // Record dismissal for adaptive learning
        if (this.stuckHistory.length > 0) {
          this.stuckHistory[this.stuckHistory.length - 1].dismissed = true;
        }
        this._adaptThresholds();
      })
    );

    // Settings changes
    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'stuckDetectionEnabled') {
          this.enabled = value;
        }
      })
    );
  }

  _startEvaluation() {
    this.evalInterval = setInterval(() => this._evaluate(), EVAL_INTERVAL_MS);
  }

  _evaluate() {
    if (!this.enabled) return;

    // Don't evaluate until minimum session length
    const sessionAge = Date.now() - this.sessionStart;
    if (sessionAge < MIN_SESSION_MS) return;

    // Cooldown check
    if (Date.now() - this.lastSuggestionTime < COOLDOWN_MS) return;

    // If user already dismissed, respect that until cooldown expires
    if (this.dismissed) {
      this.dismissed = false; // Reset for next evaluation after cooldown
      return;
    }

    const indicators = this._collectIndicators();
    const activeCount = indicators.filter(i => i.active).length;

    if (activeCount >= MIN_INDICATORS) {
      this._suggestStuck(indicators);
    }
  }

  _collectIndicators() {
    return [
      this._checkRepetitiveEdits(),
      this._checkSustainedLowMomentum(),
      this._checkNoNewFiles(),
      this._checkSearchSwitching(),
    ];
  }

  // Indicator 1: Same file modified repeatedly (30+ edits in tracking window)
  _checkRepetitiveEdits() {
    const now = Date.now();
    let maxEdits = 0;
    let maxFile = '';

    for (const [path, data] of this.fileEdits) {
      // Prune old timestamps
      data.timestamps = data.timestamps.filter(t => now - t < FILE_EDIT_WINDOW_MS);
      data.count = data.timestamps.length;

      if (data.count > maxEdits) {
        maxEdits = data.count;
        maxFile = path;
      }
    }

    const active = maxEdits >= this.thresholds.repetitiveEdits;
    return {
      name: 'repetitive_edits',
      active,
      detail: { maxEdits, file: maxFile, threshold: this.thresholds.repetitiveEdits },
    };
  }

  // Indicator 2: Very low momentum for extended time (30+ min cold/warming)
  _checkSustainedLowMomentum() {
    const isLow = this.currentMomentumLevel === 'cold' || this.currentMomentumLevel === 'warming';

    if (!isLow || !this.lowMomentumStart) {
      return { name: 'sustained_low_momentum', active: false };
    }

    const duration = Date.now() - this.lowMomentumStart;
    const active = duration >= this.thresholds.sustainedLowMomentumMs;

    return {
      name: 'sustained_low_momentum',
      active,
      detail: { durationMs: duration, threshold: this.thresholds.sustainedLowMomentumMs },
    };
  }

  // Indicator 3: No new files in long session (60+ min of activity)
  _checkNoNewFiles() {
    // Only meaningful if user has been coding
    if (!this.codingStartTime) {
      return { name: 'no_new_files', active: false };
    }

    const codingDuration = Date.now() - this.codingStartTime;
    if (codingDuration < this.thresholds.noNewFilesMs) {
      return { name: 'no_new_files', active: false };
    }

    const timeSinceNewFile = Date.now() - this.lastNewFileTime;
    const active = timeSinceNewFile >= this.thresholds.noNewFilesMs;

    return {
      name: 'no_new_files',
      active,
      detail: { timeSinceNewFileMs: timeSinceNewFile, threshold: this.thresholds.noNewFilesMs },
    };
  }

  // Indicator 4: Frequent switching to browser/docs (8+ in 10 minutes)
  _checkSearchSwitching() {
    const now = Date.now();
    this._pruneRecent(this.searchSwitches, this.thresholds.searchSwitchWindowMs);
    const recentCount = this.searchSwitches.filter(
      t => now - t < this.thresholds.searchSwitchWindowMs
    ).length;

    const active = recentCount >= this.thresholds.searchSwitchCount;
    return {
      name: 'search_switching',
      active,
      detail: { count: recentCount, threshold: this.thresholds.searchSwitchCount },
    };
  }

  _onFileChange(event) {
    const { event_type, path, timestamp } = event;
    if (event_type !== 'modify' && event_type !== 'create') return;

    // Track per-file edit counts
    if (event_type === 'modify') {
      if (!this.fileEdits.has(path)) {
        this.fileEdits.set(path, { count: 0, timestamps: [] });
      }
      const data = this.fileEdits.get(path);
      data.timestamps.push(timestamp || Date.now());
      data.count = data.timestamps.length;
    }

    // Track unique files for "no new files" indicator
    if (!this.uniqueFiles.has(path)) {
      this.uniqueFiles.set(path, timestamp || Date.now());
      this.lastNewFileTime = Date.now();
    }
  }

  _isSearchApp(appName) {
    if (!appName) return false;
    const lower = appName.toLowerCase();
    return SEARCH_APPS.some(name => lower.includes(name));
  }

  _suggestStuck(indicators) {
    const message = STUCK_MESSAGES[Math.floor(Math.random() * STUCK_MESSAGES.length)];
    const activeIndicators = indicators.filter(i => i.active).map(i => i.name);

    this.lastSuggestionTime = Date.now();

    // Record for adaptive learning
    this.stuckHistory.push({
      timestamp: Date.now(),
      indicators: activeIndicators,
      dismissed: false, // Will be set to true if user dismisses
    });

    // Keep history bounded
    if (this.stuckHistory.length > 50) {
      this.stuckHistory = this.stuckHistory.slice(-30);
    }

    eventBus.emit(Events.STUCK_DETECTED, {
      message,
      indicators: activeIndicators,
      sessionMinutes: Math.floor((Date.now() - this.sessionStart) / 60000),
    });

    console.log('Stuck detected:', activeIndicators.join(', '));
  }

  // Adaptive threshold adjustment based on history
  _adaptThresholds() {
    // Need at least 5 data points before adjusting
    if (this.stuckHistory.length < 5) return;

    const dismissed = this.stuckHistory.filter(h => h.dismissed);
    const accepted = this.stuckHistory.filter(h => !h.dismissed);

    // If more than 70% are dismissed, thresholds are too sensitive — increase them
    const dismissRate = dismissed.length / this.stuckHistory.length;

    if (dismissRate > 0.7) {
      this.thresholds.repetitiveEdits = Math.min(60, this.thresholds.repetitiveEdits + 5);
      this.thresholds.sustainedLowMomentumMs = Math.min(
        60 * 60 * 1000,
        this.thresholds.sustainedLowMomentumMs + 5 * 60 * 1000
      );
      this.thresholds.searchSwitchCount = Math.min(15, this.thresholds.searchSwitchCount + 2);
      console.log('StuckDetector: Increased thresholds (high dismiss rate)');
    } else if (dismissRate < 0.3 && accepted.length >= 3) {
      // User accepts most suggestions — thresholds are appropriate or could be slightly lower
      this.thresholds.repetitiveEdits = Math.max(15, this.thresholds.repetitiveEdits - 2);
      this.thresholds.sustainedLowMomentumMs = Math.max(
        15 * 60 * 1000,
        this.thresholds.sustainedLowMomentumMs - 5 * 60 * 1000
      );
      this.thresholds.searchSwitchCount = Math.max(4, this.thresholds.searchSwitchCount - 1);
      console.log('StuckDetector: Decreased thresholds (low dismiss rate)');
    }

    // Persist adapted thresholds
    this.settings.set('stuckThresholds', { ...this.thresholds });
  }

  _pruneRecent(arr, windowMs) {
    const cutoff = Date.now() - windowMs;
    while (arr.length > 0 && arr[0] < cutoff) {
      arr.shift();
    }
  }

  destroy() {
    if (this.evalInterval) {
      clearInterval(this.evalInterval);
      this.evalInterval = null;
    }
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }
}
