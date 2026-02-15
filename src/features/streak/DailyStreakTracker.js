// Dr. Vibe - Daily Coding Streak Tracker
// Tracks consecutive days of coding activity with a 36-hour grace period.
// Celebrates milestones, gently reminds about streaks, never guilt-trips.

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';

const GRACE_PERIOD_HOURS = 36;
const MILESTONES = [7, 14, 21, 30, 50, 100, 200, 365];
const REMINDER_HOUR = 21; // 9 PM - gentle evening reminder
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

const MILESTONE_MESSAGES = {
  7: { text: 'One week streak!', tip: 'A whole week of coding — consistency builds mastery.' },
  14: { text: 'Two week streak!', tip: 'Two weeks strong. You\'re building a real habit.' },
  21: { text: 'Three week streak!', tip: 'They say 21 days makes a habit. Look at you go!' },
  30: { text: 'One month streak!', tip: 'A full month of daily coding. That\'s dedication.' },
  50: { text: '50 day streak!', tip: 'Half a hundred days. Impressive commitment.' },
  100: { text: '100 day streak!', tip: 'Triple digits! You\'re in rare company.' },
  200: { text: '200 day streak!', tip: 'Two hundred days. Legendary persistence.' },
  365: { text: 'ONE YEAR STREAK!', tip: 'A full year of daily coding. Absolutely incredible.' },
};

const RECOVERY_MESSAGES = [
  'Welcome back! Every day is a fresh start.',
  'Good to see you again! Let\'s build a new streak.',
  'A break is healthy. Ready when you are!',
  'Fresh start, fresh energy. Let\'s go!',
];

export class DailyStreakTracker {
  constructor() {
    this.data = {
      current: 0,
      max: 0,
      lastCodingDate: null,    // ISO date string YYYY-MM-DD
      lastCodingTimestamp: null, // Unix ms - for grace period calculation
      startDate: null,          // When current streak began
      milestonesReached: [],
      previousStreak: 0,        // What streak was before it broke
    };
    this._unsubscribers = [];
    this._checkInterval = null;
    this._reminderSentToday = false;
    this._codingDetectedToday = false;
  }

  async init() {
    this._loadStore();
    this._recalculate();
    this._setupEventListeners();
    this._startPeriodicCheck();
    this._emitUpdate();
    console.log('DailyStreakTracker initialized', `streak: ${this.data.current}`);
  }

  _setupEventListeners() {
    // When coding activity is detected, record today
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        this._recordCodingActivity();
      })
    );

    // Also record on session save (catches accumulated coding time)
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, (stats) => {
        if (stats.codingSeconds > 0 && !this._codingDetectedToday) {
          this._recordCodingActivity();
        }
      })
    );
  }

  _recordCodingActivity() {
    const today = new Date().toISOString().slice(0, 10);

    if (this.data.lastCodingDate === today) {
      // Already recorded today, just update timestamp
      this.data.lastCodingTimestamp = Date.now();
      this._codingDetectedToday = true;
      return;
    }

    const previousStreak = this.data.current;
    this.data.lastCodingTimestamp = Date.now();
    this.data.lastCodingDate = today;
    this._codingDetectedToday = true;

    this._recalculate();

    // Check if this is a recovery after a break
    if (previousStreak === 0 && this.data.current === 1 && this.data.previousStreak > 0) {
      const msg = RECOVERY_MESSAGES[Math.floor(Math.random() * RECOVERY_MESSAGES.length)];
      eventBus.emit(Events.STREAK_RECOVERED, {
        text: msg,
        tip: `Previous streak: ${this.data.previousStreak} days`,
        previousStreak: this.data.previousStreak,
      });
    }

    // Check for milestones
    this._checkMilestones(previousStreak);

    this._save();
    this._emitUpdate();
  }

  _recalculate() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (!this.data.lastCodingDate) {
      this.data.current = 0;
      return;
    }

    // Check if streak is still alive using grace period
    if (this.data.lastCodingDate === today) {
      // Coded today - streak is active
      if (this.data.current === 0) {
        this.data.current = 1;
        this.data.startDate = today;
      }
    } else if (this.data.lastCodingTimestamp) {
      const hoursSinceLastCoding = (Date.now() - this.data.lastCodingTimestamp) / (1000 * 60 * 60);

      if (hoursSinceLastCoding > GRACE_PERIOD_HOURS) {
        // Streak broken
        if (this.data.current > 0) {
          this.data.previousStreak = this.data.current;
          this.data.current = 0;
          this.data.startDate = null;
        }
      }
      // Within grace period - streak still counts but hasn't incremented for today
    } else {
      // No timestamp data, fall back to date comparison
      const lastDate = new Date(this.data.lastCodingDate + 'T23:59:59');
      const hoursSince = (now - lastDate) / (1000 * 60 * 60);

      if (hoursSince > GRACE_PERIOD_HOURS) {
        if (this.data.current > 0) {
          this.data.previousStreak = this.data.current;
          this.data.current = 0;
          this.data.startDate = null;
        }
      }
    }

    // Update max
    if (this.data.current > this.data.max) {
      this.data.max = this.data.current;
    }
  }

  _checkMilestones(previousStreak) {
    for (const milestone of MILESTONES) {
      if (this.data.current >= milestone && previousStreak < milestone) {
        if (!this.data.milestonesReached.includes(milestone)) {
          this.data.milestonesReached.push(milestone);
        }

        const message = MILESTONE_MESSAGES[milestone];
        if (message) {
          eventBus.emit(Events.STREAK_MILESTONE, {
            milestone,
            streak: this.data.current,
            text: message.text,
            tip: message.tip,
          });
        }
      }
    }
  }

  _startPeriodicCheck() {
    this._checkInterval = setInterval(() => {
      this._periodicCheck();
    }, CHECK_INTERVAL_MS);
  }

  _periodicCheck() {
    const previousStreak = this.data.current;
    this._recalculate();

    // Streak just broke
    if (previousStreak > 0 && this.data.current === 0) {
      eventBus.emit(Events.STREAK_BROKEN, {
        previousStreak,
      });
      this._save();
      this._emitUpdate();
      return;
    }

    // Evening reminder check
    const hour = new Date().getHours();
    if (hour >= REMINDER_HOUR && !this._codingDetectedToday && !this._reminderSentToday) {
      if (this.data.current > 0) {
        this._reminderSentToday = true;
        eventBus.emit(Events.STREAK_REMINDER, {
          streak: this.data.current,
          text: `${this.data.current}-day streak still going!`,
          tip: 'Even a few minutes of coding keeps it alive.',
        });
      }
    }

    // Reset daily flags at midnight
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.lastCodingDate !== today) {
      this._codingDetectedToday = false;
      this._reminderSentToday = false;
    }
  }

  _emitUpdate() {
    const nextMilestone = MILESTONES.find(m => m > this.data.current) || null;
    const progressToNext = nextMilestone
      ? Math.round((this.data.current / nextMilestone) * 100)
      : 100;

    eventBus.emit(Events.STREAK_UPDATED, {
      current: this.data.current,
      max: this.data.max,
      startDate: this.data.startDate,
      lastCodingDate: this.data.lastCodingDate,
      nextMilestone,
      progressToNext,
      level: this._getStreakLevel(),
    });
  }

  _getStreakLevel() {
    const s = this.data.current;
    if (s === 0) return 'none';
    if (s < 3) return 'starting';
    if (s < 7) return 'warming';
    if (s < 30) return 'hot';
    if (s < 100) return 'fire';
    return 'legendary';
  }

  // --- Persistence ---

  _loadStore() {
    const saved = db.getSection('streak');
    if (saved) {
      this.data = { ...this.data, ...saved };
    }
  }

  _save() {
    db.setSection('streak', this.data);
  }

  // --- Public API ---

  getData() {
    return { ...this.data };
  }

  getLevel() {
    return this._getStreakLevel();
  }

  getNextMilestone() {
    return MILESTONES.find(m => m > this.data.current) || null;
  }

  destroy() {
    this._save();
    for (const unsub of this._unsubscribers) unsub();
    if (this._checkInterval) clearInterval(this._checkInterval);
  }
}
