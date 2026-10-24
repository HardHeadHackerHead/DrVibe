// Dr. Vibe - AI Pair Programming Streak Tracker
// Detects when the user is coding AND Claude Code is active simultaneously.
// Tracks continuous pair duration and celebrates milestones.

import { eventBus, Events } from '../../core/EventBus.js';

// Milestones in seconds
const PAIR_MILESTONES = [
  { seconds: 900,  label: '15 minutes', text: '15 minutes of pair programming!', tip: 'You and Claude are warming up.' },
  { seconds: 1800, label: '30 minutes', text: '30 minutes of pair programming!', tip: 'You two are in sync.' },
  { seconds: 3600, label: '1 hour',     text: '1 hour of pair programming!',     tip: 'Dynamic duo status achieved.' },
  { seconds: 7200, label: '2 hours',    text: '2 hours of pair programming!',    tip: 'Unstoppable pair. Seriously.' },
  { seconds: 14400, label: '4 hours',   text: '4 hours of pair programming!',   tip: 'You and Claude should get matching jackets.' },
];

const TOLERANCE_MS = 120000; // 2 min gap before breaking the streak

export class AIPairTracker {
  constructor() {
    this._userCoding = false;
    this._claudeActive = false;
    this._pairStartedAt = null;    // When both became active
    this._pairSeconds = 0;         // Accumulated pair time
    this._lastBothActive = 0;      // Last time both were active
    this._lastMilestoneIndex = -1;
    this._checkInterval = null;
    this._unsubscribers = [];
  }

  init() {
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        this._userCoding = true;
        this._checkPairState();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
        this._userCoding = false;
        this._checkPairState();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.CLAUDE_CODE_ACTIVE, () => {
        this._claudeActive = true;
        this._checkPairState();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.CLAUDE_CODE_IDLE, () => {
        this._claudeActive = false;
        this._checkPairState();
      })
    );

    // Check for milestones every 30 seconds
    this._checkInterval = setInterval(() => this._checkMilestones(), 30000);

    console.log('AIPairTracker initialized');
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
    if (this._checkInterval) clearInterval(this._checkInterval);
  }

  _checkPairState() {
    const bothActive = this._userCoding && this._claudeActive;
    const now = Date.now();

    if (bothActive) {
      this._lastBothActive = now;

      if (!this._pairStartedAt) {
        // Starting a new pair session
        this._pairStartedAt = now;
        this._pairSeconds = 0;
        this._lastMilestoneIndex = -1;

        eventBus.emit(Events.AI_PAIR_STARTED, {
          startedAt: now,
        });
      }
    } else {
      // One side went inactive — check tolerance
      if (this._pairStartedAt && now - this._lastBothActive > TOLERANCE_MS) {
        // Pair session broken
        this._flushPairTime();

        eventBus.emit(Events.AI_PAIR_ENDED, {
          duration: this._pairSeconds,
          startedAt: this._pairStartedAt,
        });

        this._pairStartedAt = null;
        this._pairSeconds = 0;
        this._lastMilestoneIndex = -1;
      }
    }
  }

  _flushPairTime() {
    if (this._pairStartedAt && this._lastBothActive > 0) {
      this._pairSeconds = Math.floor((this._lastBothActive - this._pairStartedAt) / 1000);
    }
  }

  _checkMilestones() {
    if (!this._pairStartedAt) return;

    this._flushPairTime();

    // Also add ongoing time if both are still active
    let currentSeconds = this._pairSeconds;
    if (this._userCoding && this._claudeActive) {
      currentSeconds = Math.floor((Date.now() - this._pairStartedAt) / 1000);
    }

    for (let i = this._lastMilestoneIndex + 1; i < PAIR_MILESTONES.length; i++) {
      if (currentSeconds >= PAIR_MILESTONES[i].seconds) {
        this._lastMilestoneIndex = i;
        const milestone = PAIR_MILESTONES[i];

        eventBus.emit(Events.AI_PAIR_MILESTONE, {
          seconds: currentSeconds,
          label: milestone.label,
          text: milestone.text,
          tip: milestone.tip,
        });
      } else {
        break;
      }
    }
  }

  // --- Public API ---

  isPairing() {
    return this._pairStartedAt !== null;
  }

  getPairDuration() {
    if (!this._pairStartedAt) return 0;
    if (this._userCoding && this._claudeActive) {
      return Math.floor((Date.now() - this._pairStartedAt) / 1000);
    }
    return this._pairSeconds;
  }

  getState() {
    return {
      isPairing: this.isPairing(),
      duration: this.getPairDuration(),
      userCoding: this._userCoding,
      claudeActive: this._claudeActive,
    };
  }
}
