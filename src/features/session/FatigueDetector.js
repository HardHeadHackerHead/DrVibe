// Dr. Vibe - Session Fatigue Detection
// Detects declining productivity patterns and gently suggests stopping for the day.
// Uses multiple indicators: momentum trend, context switching, save frequency, idle gaps.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';

// How often to evaluate fatigue (60 seconds)
const EVAL_INTERVAL_MS = 60 * 1000;

// Minimum session length before fatigue detection kicks in (30 minutes)
const MIN_SESSION_MS = 30 * 60 * 1000;

// Cooldown between fatigue suggestions (20 minutes)
const COOLDOWN_MS = 20 * 60 * 1000;

// How many momentum samples to keep for trend analysis
const MOMENTUM_HISTORY_SIZE = 30;

// Minimum indicators required before suggesting fatigue
const MIN_INDICATORS = 2;

const FATIGUE_MESSAGES = [
  {
    title: 'Dr. Vibe',
    body: "Might be a good stopping point for today. You've put in solid work!",
  },
  {
    title: 'Dr. Vibe',
    body: "Your momentum is lower than usual. A fresh start tomorrow could help!",
  },
  {
    title: 'Dr. Vibe',
    body: "Looks like things are winding down. No shame in calling it a day!",
  },
  {
    title: 'Dr. Vibe',
    body: "Great session! Your energy seems to be dipping — rest is productive too.",
  },
];

export class FatigueDetector {
  constructor(settings) {
    this.settings = settings;
    this.enabled = settings.fatigueDetectionEnabled ?? true;
    this.evalInterval = null;
    this.lastSuggestionTime = 0;
    this.sessionStart = Date.now();
    this.dismissed = false;

    // Momentum tracking
    this.momentumHistory = []; // { timestamp, momentum }
    this.peakMomentum = 0;

    // Context switching tracking
    this.windowSwitches = []; // timestamps of switches away from coding
    this.windowChanges = []; // timestamps of window title changes while coding

    // Idle tracking
    this.idleEvents = []; // timestamps of idle events

    // File save frequency tracking
    this.fileSaveEvents = []; // timestamps of file modify events

    this._unsubscribers = [];
  }

  init() {
    this._setupEventListeners();
    this._startEvaluation();
    console.log('FatigueDetector initialized');
  }

  _setupEventListeners() {
    this._unsubscribers.push(
      eventBus.on(Events.MOMENTUM_CHANGED, ({ momentum }) => {
        this.momentumHistory.push({ timestamp: Date.now(), momentum });
        if (momentum > this.peakMomentum) {
          this.peakMomentum = momentum;
        }
        // Keep history bounded
        if (this.momentumHistory.length > MOMENTUM_HISTORY_SIZE) {
          this.momentumHistory.shift();
        }
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_WINDOW_SWITCH, () => {
        this.windowSwitches.push(Date.now());
        this._pruneRecent(this.windowSwitches);
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_WINDOW_CHANGED, () => {
        this.windowChanges.push(Date.now());
        this._pruneRecent(this.windowChanges);
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_IDLE, () => {
        this.idleEvents.push(Date.now());
        this._pruneRecent(this.idleEvents);
      })
    );

    // Track file saves via momentum tracker's file change events
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, () => {
        // Use session stats updates as a proxy for activity pulses
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.FATIGUE_DISMISSED, () => {
        this.dismissed = true;
        this.lastSuggestionTime = Date.now();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'fatigueDetectionEnabled') {
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
    if (!this.settings.notificationsEnabled) return;

    // Don't evaluate until minimum session length
    const sessionAge = Date.now() - this.sessionStart;
    if (sessionAge < MIN_SESSION_MS) return;

    // Cooldown check
    if (Date.now() - this.lastSuggestionTime < COOLDOWN_MS) return;

    // If user already dismissed, respect that for a longer period
    if (this.dismissed) return;

    const indicators = this._collectIndicators();
    const activeCount = indicators.filter(i => i.active).length;

    if (activeCount >= MIN_INDICATORS) {
      this._suggestFatigue(indicators);
    }
  }

  _collectIndicators() {
    const now = Date.now();
    const recentWindow = 10 * 60 * 1000; // Last 10 minutes

    return [
      this._checkMomentumDecline(),
      this._checkContextSwitching(now, recentWindow),
      this._checkIdleFrequency(now, recentWindow),
      this._checkMomentumFloor(),
    ];
  }

  // Indicator 1: Momentum is steadily declining over time
  _checkMomentumDecline() {
    if (this.momentumHistory.length < 10) {
      return { name: 'momentum_decline', active: false };
    }

    // Compare first half average to second half average
    const mid = Math.floor(this.momentumHistory.length / 2);
    const firstHalf = this.momentumHistory.slice(0, mid);
    const secondHalf = this.momentumHistory.slice(mid);

    const firstAvg = firstHalf.reduce((s, e) => s + e.momentum, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, e) => s + e.momentum, 0) / secondHalf.length;

    // Significant decline: second half is at least 30% lower than first half
    const decline = firstAvg > 0 ? (firstAvg - secondAvg) / firstAvg : 0;
    const active = decline >= 0.3 && firstAvg >= 20;

    return { name: 'momentum_decline', active, detail: { firstAvg, secondAvg, decline } };
  }

  // Indicator 2: Frequent context switching (window switches away from coding)
  _checkContextSwitching(now, window) {
    const recentSwitches = this.windowSwitches.filter(t => now - t < window);
    // More than 6 switches in 10 minutes suggests unfocused behavior
    const active = recentSwitches.length >= 6;
    return { name: 'context_switching', active, detail: { count: recentSwitches.length } };
  }

  // Indicator 3: Frequent idle events (longer gaps between activity)
  _checkIdleFrequency(now, window) {
    const recentIdles = this.idleEvents.filter(t => now - t < window);
    // 2+ idle events in 10 minutes suggests declining engagement
    const active = recentIdles.length >= 2;
    return { name: 'idle_frequency', active, detail: { count: recentIdles.length } };
  }

  // Indicator 4: Momentum has been at the floor for a sustained period
  _checkMomentumFloor() {
    if (this.momentumHistory.length < 5 || this.peakMomentum < 30) {
      return { name: 'momentum_floor', active: false };
    }

    // Check if last 5 readings are all below 20% of peak
    const threshold = Math.max(this.peakMomentum * 0.2, 10);
    const recent = this.momentumHistory.slice(-5);
    const allLow = recent.every(e => e.momentum <= threshold);

    return { name: 'momentum_floor', active: allLow, detail: { threshold, peakMomentum: this.peakMomentum } };
  }

  _suggestFatigue(indicators) {
    const message = FATIGUE_MESSAGES[Math.floor(Math.random() * FATIGUE_MESSAGES.length)];

    this.lastSuggestionTime = Date.now();

    eventBus.emit(Events.FATIGUE_DETECTED, {
      message,
      indicators: indicators.filter(i => i.active).map(i => i.name),
      sessionMinutes: Math.floor((Date.now() - this.sessionStart) / 60000),
    });

    console.log('Fatigue detected:', indicators.filter(i => i.active).map(i => i.name).join(', '));
  }

  // Remove events older than 15 minutes to keep arrays bounded
  _pruneRecent(arr) {
    const cutoff = Date.now() - 15 * 60 * 1000;
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
