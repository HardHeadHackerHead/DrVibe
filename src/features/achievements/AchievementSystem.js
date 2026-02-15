// Dr. Vibe - Achievement System
// Tracks progress toward achievements and handles unlocks

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';
import { ACHIEVEMENTS } from './AchievementDefinitions.js';

const MARATHON_MS = 4 * 60 * 60 * 1000; // 4 hours
const PERSISTENT_IDLE_MS = 30 * 60 * 1000; // 30 minutes

export class AchievementSystem {
  constructor() {
    // { [id]: { unlocked: bool, unlockedAt: number|null, progress: number } }
    this.state = {};
    // Runtime tracking (not persisted as achievement state, but session-level)
    this.sessionStartTime = Date.now();
    this.codingStartTime = null;
    this.lastCodingStopTime = null;
    this.seenApps = new Set();
    this.isCoding = false;
  }

  async init() {
    this.initState();
    this.load();
    this.setupEventListeners();

    // "Hello World" - first session ever
    this.checkAndUnlock('hello_world', 1);

    // Check time-based achievements on init
    this.checkTimeAchievements();
  }

  initState() {
    for (const id of Object.keys(ACHIEVEMENTS)) {
      this.state[id] = { unlocked: false, unlockedAt: null, progress: 0 };
    }
  }

  // --- Persistence ---

  load() {
    const saved = db.getSection('achievements');
    if (saved) {
      // Load per-achievement state
      if (saved.state) {
        for (const [id, val] of Object.entries(saved.state)) {
          if (this.state[id]) {
            this.state[id] = val;
          }
        }
      }
      // Load runtime counters
      this.streakDays = saved.streakData?.days || [];
      this.seenApps = new Set(saved.seenApps || []);
      console.log('Achievements loaded from database');
    } else {
      this.streakDays = [];
      console.log('Achievements: no saved data, using defaults');
    }
  }

  save() {
    db.setSection('achievements', {
      state: this.state,
      streakData: { days: this.streakDays },
      seenApps: [...this.seenApps],
    });
  }

  // --- Event Listeners ---

  setupEventListeners() {
    // Track work session completions for "Century"
    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      const current = this.state.century.progress;
      this.checkAndUnlock('century', current + 1);
    });

    // Track coding activity start
    eventBus.on(Events.ACTIVITY_CODING_START, ({ appName }) => {
      this.isCoding = true;
      this.codingStartTime = Date.now();

      // Track app for "Polyglot"
      if (appName) {
        this.seenApps.add(appName.toLowerCase());
        this.checkAndUnlock('polyglot', this.seenApps.size);
      }

      // Check time-based achievements
      this.checkTimeAchievements();

      // "Persistent" - returned after 30+ min idle
      if (this.lastCodingStopTime) {
        const idleTime = Date.now() - this.lastCodingStopTime;
        if (idleTime >= PERSISTENT_IDLE_MS) {
          this.checkAndUnlock('persistent', 1);
        }
      }

      // Record today for streak tracking
      this.recordCodingDay();
    });

    // Track coding stop
    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      this.isCoding = false;
      this.lastCodingStopTime = Date.now();
    });
  }

  // --- Achievement Checking ---

  checkTimeAchievements() {
    const hour = new Date().getHours();

    // "Night Owl" - after midnight (0-4)
    if (hour >= 0 && hour < 5) {
      this.checkAndUnlock('night_owl', 1);
    }

    // "Early Bird" - before 7am (5-6)
    if (hour >= 5 && hour < 7) {
      this.checkAndUnlock('early_bird', 1);
    }
  }

  checkMarathon() {
    if (!this.codingStartTime || !this.isCoding) return;

    const elapsed = Date.now() - this.sessionStartTime;
    if (elapsed >= MARATHON_MS) {
      this.checkAndUnlock('marathon', 1);
    }
  }

  recordCodingDay() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (!this.streakDays.includes(today)) {
      this.streakDays.push(today);
      // Keep only last 30 days of data
      if (this.streakDays.length > 30) {
        this.streakDays = this.streakDays.slice(-30);
      }
    }

    // Check streak
    const streak = this.calculateStreak();
    this.checkAndUnlock('dedicated', streak);

    this.save();
  }

  calculateStreak() {
    if (this.streakDays.length === 0) return 0;

    const sorted = [...this.streakDays].sort().reverse();
    const today = new Date().toISOString().slice(0, 10);

    // If today isn't in the list, check if yesterday is (streak may still be active)
    if (sorted[0] !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (sorted[0] !== yesterday) return 0;
    }

    let streak = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = new Date(sorted[i]);
      const prev = new Date(sorted[i + 1]);
      const diffDays = (current - prev) / 86400000;

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  // --- Core Unlock Logic ---

  checkAndUnlock(id, newProgress) {
    const def = ACHIEVEMENTS[id];
    const entry = this.state[id];
    if (!def || !entry || entry.unlocked) return;

    entry.progress = Math.min(newProgress, def.maxProgress);

    eventBus.emit(Events.ACHIEVEMENT_PROGRESS, {
      id,
      progress: entry.progress,
      maxProgress: def.maxProgress,
    });

    if (entry.progress >= def.maxProgress) {
      entry.unlocked = true;
      entry.unlockedAt = Date.now();
      this.onUnlock(id, def);
    }

    this.save();
  }

  async onUnlock(id, def) {
    console.log(`Achievement unlocked: ${def.title}`);

    eventBus.emit(Events.ACHIEVEMENT_UNLOCKED, {
      id,
      title: def.title,
      description: def.description,
      icon: def.icon,
    });
  }

  // Called from game loop to check time-dependent achievements
  update() {
    this.checkMarathon();
  }

  // --- Public API ---

  getAll() {
    return Object.keys(ACHIEVEMENTS).map(id => ({
      ...ACHIEVEMENTS[id],
      ...this.state[id],
    }));
  }

  getUnlocked() {
    return this.getAll().filter(a => a.unlocked);
  }

  getProgress(id) {
    return this.state[id] || null;
  }
}
