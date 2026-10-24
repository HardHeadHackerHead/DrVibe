// Dr. Vibe - Celebration System
// Coordinates visual celebrations for tangible progress milestones.
// Rate-limited (max 1 per 15 min), suppressed during focus mode, ties into
// the existing encouragement toggle.

import { eventBus, Events } from '../../core/EventBus.js';

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between celebrations

// Milestone definitions — each fires at most once per session.
// check(stats, ctx) returns true when milestone condition is met.
const MILESTONES = [
  {
    id: 'first_file_today',
    check: (stats, ctx) => stats.filesCreated >= 1 && !ctx.firstFileFired,
    message: 'First file of the session!',
    tip: 'Every project starts with a single file.',
    onFire: (_s, ctx) => { ctx.firstFileFired = true; },
  },
  {
    id: 'five_files_session',
    check: (stats, ctx) => {
      const total = stats.filesCreated + stats.filesModified;
      return total >= 5 && !ctx.fiveFilesFired;
    },
    message: 'Five files and counting!',
    tip: "You're building something real.",
    onFire: (_s, ctx) => { ctx.fiveFilesFired = true; },
  },
  {
    id: 'one_hour_coding',
    check: (stats, ctx) => stats.codingSeconds >= 3600 && !ctx.oneHourFired,
    message: 'One hour of focused coding!',
    tip: 'Solid dedication pays off.',
    onFire: (_s, ctx) => { ctx.oneHourFired = true; },
  },
  {
    id: 'ten_files_milestone',
    check: (stats, ctx) => {
      const total = stats.filesCreated + stats.filesModified;
      return total >= 10 && !ctx.tenFilesFired;
    },
    message: 'Ten files touched!',
    tip: 'This project is really taking shape.',
    onFire: (_s, ctx) => { ctx.tenFilesFired = true; },
  },
  {
    id: 'fifty_files_milestone',
    check: (stats, ctx) => {
      const total = stats.filesCreated + stats.filesModified;
      return total >= 50 && !ctx.fiftyFilesFired;
    },
    message: 'Fifty files!',
    tip: "That's a serious amount of work.",
    onFire: (_s, ctx) => { ctx.fiftyFilesFired = true; },
  },
];

export class CelebrationSystem {
  constructor(settings) {
    this.settings = settings;
    this.lastCelebrationTime = 0;
    this.suppressed = false;
    this._unsubscribers = [];

    // Per-session context — milestones fire once each
    this._ctx = {
      firstFileFired: false,
      fiveFilesFired: false,
      oneHourFired: false,
      tenFilesFired: false,
      fiftyFilesFired: false,
    };
  }

  init() {
    // Evaluate milestones on session stat updates
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, (stats) => {
        this._evaluate(stats);
      })
    );

    // Celebrate personal bests (separate from milestone milestones)
    this._unsubscribers.push(
      eventBus.on(Events.PERSONAL_BEST_SET, ({ label, formatted }) => {
        this._triggerCelebration({
          id: 'personal_best',
          message: 'New Personal Best!',
          tip: `${label}: ${formatted.new}`,
        });
      })
    );

    // Suppress during focus mode
    this._unsubscribers.push(
      eventBus.on(Events.FOCUS_MODE_STARTED, () => {
        this.suppressed = true;
      })
    );
    this._unsubscribers.push(
      eventBus.on(Events.FOCUS_MODE_ENDED, () => {
        this.suppressed = false;
      })
    );

    // Respect encouragement toggle
    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'encouragementEnabled') {
          // If disabled, we just skip triggering — no state to update
        }
      })
    );

    console.log('CelebrationSystem initialized');
  }

  _evaluate(stats) {
    if (!this.settings.encouragementEnabled) return;
    if (this.suppressed) return;
    if (!this._cooldownReady()) return;

    for (const milestone of MILESTONES) {
      if (milestone.check(stats, this._ctx)) {
        milestone.onFire(stats, this._ctx);
        this._triggerCelebration(milestone);
        break; // one celebration at a time
      }
    }
  }

  _cooldownReady() {
    return Date.now() - this.lastCelebrationTime >= COOLDOWN_MS;
  }

  _triggerCelebration({ id, message, tip }) {
    if (!this.settings.encouragementEnabled) return;
    if (this.suppressed) return;
    if (!this._cooldownReady()) return;

    this.lastCelebrationTime = Date.now();

    eventBus.emit(Events.CELEBRATION_TRIGGERED, {
      id,
      message,
      tip,
    });
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
