// Dr. Vibe - Momentum Tracker
// Tracks coding momentum based on file change activity.
// Produces a 0-100 score using a weighted moving average.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';

// Scoring weights per event type
const WEIGHTS = {
  create: 3,
  modify: 2,
  delete: 1,
};

// Momentum levels with thresholds
const LEVELS = [
  { name: 'cold', min: 0, max: 20 },
  { name: 'warming', min: 21, max: 40 },
  { name: 'flowing', min: 41, max: 60 },
  { name: 'hot', min: 61, max: 80 },
  { name: 'fire', min: 81, max: 100 },
];

// How long events stay relevant (5 minutes)
const WINDOW_MS = 5 * 60 * 1000;

// How often to recalculate momentum
const TICK_MS = 2000;

// Score needed for 100% momentum (tuned so steady editing hits it)
const MAX_SCORE = 60;

// Debounce: ignore duplicate events on the same path within this window
const DEBOUNCE_MS = 500;

// Hard cap on stored events to prevent unbounded growth
const MAX_EVENTS = 500;

export class MomentumTracker {
  constructor() {
    this.events = [];         // { type, path, timestamp, weight }
    this.filesActive = new Set();
    this.momentum = 0;        // 0-100
    this.level = 'cold';
    this.tickInterval = null;
    this.unlistenFile = null;
    this.unsubProject = null;
    this.watchedPath = null;
    this.lastEventKey = null;  // "type:path" for debounce
    this.lastEventTime = 0;
  }

  async init() {
    // Listen for project detection to start watching
    this.unsubProject = eventBus.on(Events.PROJECT_DETECTED, (project) => {
      if (project.path) {
        this.watchProject(project.path);
      }
    });

    // Start the tick loop for smooth decay
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);

    // Listen for file changes from Tauri
    if (tauri.isAvailable) {
      this.unlistenFile = await tauri.onFileChanged((event) => {
        this.onFileChange(event);
      });
    }

    console.log('MomentumTracker initialized');
  }

  destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.unlistenFile) {
      // Tauri listen returns a promise that resolves to an unlisten fn
      Promise.resolve(this.unlistenFile).then(fn => {
        if (typeof fn === 'function') fn();
      });
      this.unlistenFile = null;
    }
    if (this.unsubProject) {
      this.unsubProject();
      this.unsubProject = null;
    }
    tauri.stopWatching();
  }

  async watchProject(path) {
    if (this.watchedPath === path) return;

    const result = await tauri.startWatching(path);
    if (result) {
      this.watchedPath = path;
      console.log(`MomentumTracker watching: ${path}`);
    }
  }

  onFileChange(event) {
    const { event_type, path, timestamp } = event;
    const weight = WEIGHTS[event_type] || 1;

    // Debounce: skip if same file+type within DEBOUNCE_MS
    const key = `${event_type}:${path}`;
    if (key === this.lastEventKey && (timestamp - this.lastEventTime) < DEBOUNCE_MS) {
      return;
    }
    this.lastEventKey = key;
    this.lastEventTime = timestamp;

    this.events.push({ type: event_type, path, timestamp, weight });
    // Cap events array to prevent unbounded memory growth
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    this.filesActive.add(path);

    // Immediately recalculate on new event for responsiveness
    this.recalculate();
  }

  tick() {
    this.pruneOldEvents();
    this.recalculate();
  }

  pruneOldEvents() {
    const cutoff = Date.now() - WINDOW_MS;
    this.events = this.events.filter(e => e.timestamp > cutoff);

    // Rebuild active files from remaining events
    this.filesActive = new Set(this.events.map(e => e.path));
  }

  recalculate() {
    const now = Date.now();
    let totalScore = 0;

    for (const event of this.events) {
      // Time-decay: events lose relevance as they age
      const age = now - event.timestamp;
      const freshness = Math.max(0, 1 - age / WINDOW_MS);
      totalScore += event.weight * freshness;
    }

    // Bonus for touching multiple files (breadth of work)
    const fileBonus = Math.min(this.filesActive.size * 0.5, 5);
    totalScore += fileBonus;

    // Normalize to 0-100
    const newMomentum = Math.min(100, Math.round((totalScore / MAX_SCORE) * 100));

    if (newMomentum === this.momentum) return;

    this.momentum = newMomentum;
    const newLevel = this.getLevel(newMomentum);

    const levelChanged = newLevel !== this.level;
    const previousLevel = this.level;
    this.level = newLevel;

    eventBus.emit(Events.MOMENTUM_CHANGED, {
      momentum: this.momentum,
      level: this.level,
      filesActive: this.filesActive.size,
      recentEvents: this.events.length,
    });

    if (levelChanged) {
      eventBus.emit(Events.MOMENTUM_LEVEL_CHANGED, {
        previous: previousLevel,
        current: this.level,
        momentum: this.momentum,
      });
    }
  }

  getLevel(value) {
    for (const level of LEVELS) {
      if (value >= level.min && value <= level.max) {
        return level.name;
      }
    }
    return 'cold';
  }

  getState() {
    return {
      momentum: this.momentum,
      level: this.level,
      filesActive: this.filesActive.size,
      recentEvents: this.events.length,
      watchedPath: this.watchedPath,
    };
  }
}
