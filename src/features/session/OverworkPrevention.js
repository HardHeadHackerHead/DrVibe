// Dr. Vibe - Overwork Prevention
// Tracks cumulative daily coding hours and suggests breaks at escalating thresholds.
// Supportive, never controlling — educates about burnout risks.

import { eventBus, Events } from '../../core/EventBus.js';

// Check every 60 seconds
const CHECK_INTERVAL_MS = 60 * 1000;

// Cooldown between repeat warnings at the same level (30 minutes)
const REPEAT_COOLDOWN_MS = 30 * 60 * 1000;

// Warning thresholds in seconds
const THRESHOLDS = [
  {
    hours: 4,
    seconds: 4 * 3600,
    level: 'gentle',
    characterState: 'concerned',
    messages: [
      {
        title: 'Dr. Vibe',
        body: "You've been coding a while! Great focus — just remember to stretch.",
      },
      {
        title: 'Dr. Vibe',
        body: "4 hours of coding! Your dedication is impressive. A short break helps creativity.",
      },
      {
        title: 'Dr. Vibe',
        body: "Solid session so far! Did you know short breaks improve problem-solving?",
      },
    ],
  },
  {
    hours: 6,
    seconds: 6 * 3600,
    level: 'moderate',
    characterState: 'tired',
    messages: [
      {
        title: 'Dr. Vibe',
        body: "Consider taking a longer break. 6 hours of focused work is a lot!",
      },
      {
        title: 'Dr. Vibe',
        body: "You've been at it for 6 hours. Research shows productivity drops after extended sessions.",
      },
      {
        title: 'Dr. Vibe',
        body: "6 hours in! Your brain consolidates learning during rest — a walk could help.",
      },
    ],
  },
  {
    hours: 8,
    seconds: 8 * 3600,
    level: 'strong',
    characterState: 'tired',
    messages: [
      {
        title: 'Dr. Vibe',
        body: "Please take care of yourself. 8+ hours is a marathon — rest is productive too.",
      },
      {
        title: 'Dr. Vibe',
        body: "You've been coding for over 8 hours. Burnout is real — tomorrow you'll be sharper after rest.",
      },
      {
        title: 'Dr. Vibe',
        body: "Marathon session! Your health matters more than any bug. Consider wrapping up for today.",
      },
    ],
  },
];

export class OverworkPrevention {
  constructor(settings, sessionTracker) {
    this.settings = settings;
    this.sessionTracker = sessionTracker;
    this.enabled = settings.overworkPreventionEnabled ?? true;
    this.checkInterval = null;
    this.lastWarningLevel = null; // track which threshold was last warned
    this.lastWarningTime = 0;
    this.dismissed = false; // user dismissed for the day
    this.previousDayCodingSeconds = 0; // coding time from earlier sessions today
    this._unsubscribers = [];
  }

  async init() {
    await this._loadPreviousDayCoding();
    this._setupEventListeners();
    this._startChecking();
    this._scheduleMidnightReset();
    console.log('OverworkPrevention initialized');
  }

  async _loadPreviousDayCoding() {
    try {
      const history = await this.sessionTracker.getSessionHistory();
      const today = new Date().toISOString().slice(0, 10);
      const todayEntry = history.find(h => h.date === today);
      this.previousDayCodingSeconds = todayEntry?.codingSeconds || 0;
    } catch {
      this.previousDayCodingSeconds = 0;
    }
  }

  _getDailyCodingSeconds() {
    return this.previousDayCodingSeconds + this.sessionTracker.getCodingSeconds();
  }

  _setupEventListeners() {
    this._unsubscribers.push(
      eventBus.on(Events.OVERWORK_DISMISSED, () => {
        this.dismissed = true;
        this.lastWarningTime = Date.now();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'overworkPreventionEnabled') {
          this.enabled = value;
        }
      })
    );
  }

  _startChecking() {
    this.checkInterval = setInterval(() => this._check(), CHECK_INTERVAL_MS);
  }

  _check() {
    if (!this.enabled) return;
    if (!this.settings.notificationsEnabled) return;
    if (this.dismissed) return;

    const dailySeconds = this._getDailyCodingSeconds();

    // Find the highest threshold crossed
    let activeThreshold = null;
    for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
      if (dailySeconds >= THRESHOLDS[i].seconds) {
        activeThreshold = THRESHOLDS[i];
        break;
      }
    }

    if (!activeThreshold) return;

    // Don't re-warn at the same level within cooldown
    if (
      this.lastWarningLevel === activeThreshold.level &&
      Date.now() - this.lastWarningTime < REPEAT_COOLDOWN_MS
    ) {
      return;
    }

    this._warn(activeThreshold, dailySeconds);
  }

  _warn(threshold, dailySeconds) {
    const message = threshold.messages[Math.floor(Math.random() * threshold.messages.length)];
    const hours = Math.floor(dailySeconds / 3600);
    const minutes = Math.floor((dailySeconds % 3600) / 60);

    this.lastWarningLevel = threshold.level;
    this.lastWarningTime = Date.now();

    eventBus.emit(Events.OVERWORK_WARNING, {
      message,
      level: threshold.level,
      characterState: threshold.characterState,
      dailyHours: hours,
      dailyMinutes: minutes,
      thresholdHours: threshold.hours,
    });

    console.log(`Overwork warning (${threshold.level}): ${hours}h ${minutes}m today`);
  }

  _scheduleMidnightReset() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight - now;

    setTimeout(() => {
      this._resetDaily();
      // Then schedule again every 24 hours
      setInterval(() => this._resetDaily(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  _resetDaily() {
    this.previousDayCodingSeconds = 0;
    this.lastWarningLevel = null;
    this.lastWarningTime = 0;
    this.dismissed = false;
    console.log('OverworkPrevention: daily reset');
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }
}
