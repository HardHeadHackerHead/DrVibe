// Dr. Vibe - Encouragement System
// Celebrates small coding wins with warm, non-patronizing messages.
// Rate-limited, opt-out-able, and driven by session milestones.

import { eventBus, Events } from '../../core/EventBus.js';

// Milestone definitions: each has a check function and a pool of messages.
// check(stats, ctx) returns true when the milestone is reached.
// ctx tracks per-session / per-day state so milestones fire at most once each.
const MILESTONES = [
  {
    id: 'first_file_today',
    check: (stats, ctx) => stats.filesCreated >= 1 && !ctx.firstFileFired,
    messages: [
      { text: 'Great start!', tip: 'Your first new file of the session.' },
      { text: 'And so it begins!', tip: 'First file created — nice.' },
      { text: 'Off to a good start!', tip: 'New file detected.' },
    ],
    onFire: (_stats, ctx) => { ctx.firstFileFired = true; },
  },
  {
    id: 'one_hour_coding',
    check: (stats, ctx) => stats.codingSeconds >= 3600 && !ctx.oneHourFired,
    messages: [
      { text: "You're doing great!", tip: 'One hour of solid coding.' },
      { text: 'Solid hour of work!', tip: 'Keep the momentum going.' },
      { text: 'One hour down!', tip: "You're making real progress." },
    ],
    onFire: (_stats, ctx) => { ctx.oneHourFired = true; },
  },
  {
    id: 'many_files',
    check: (stats, ctx) => {
      const total = stats.filesCreated + stats.filesModified;
      return total >= 10 && !ctx.manyFilesFired;
    },
    messages: [
      { text: 'Look at all this progress!', tip: "You've touched a lot of files." },
      { text: 'Productive session!', tip: 'Multiple files created and modified.' },
      { text: 'Building something big!', tip: 'Lots of file activity this session.' },
    ],
    onFire: (_stats, ctx) => { ctx.manyFilesFired = true; },
  },
  {
    id: 'long_session',
    check: (stats, ctx) => {
      const sessionHours = (Date.now() - stats.sessionStart) / (1000 * 60 * 60);
      return sessionHours >= 4 && !ctx.longSessionFired;
    },
    messages: [
      { text: 'Impressive dedication!', tip: 'Four hours in — remember to stretch.' },
      { text: 'Marathon session!', tip: "You've been at it for hours. Nice work." },
      { text: 'Deep work mode!', tip: 'Four-hour session and counting.' },
    ],
    onFire: (_stats, ctx) => { ctx.longSessionFired = true; },
  },
];

export class EncouragementSystem {
  constructor(settings) {
    this.settings = settings;
    this.enabled = settings.encouragementEnabled;
    this.frequencyMs = settings.encouragementFrequency * 60 * 1000;
    this.lastEncouragementTime = 0;
    this._unsubscribers = [];

    // Per-session context for milestone tracking
    this._ctx = {
      firstFileFired: false,
      oneHourFired: false,
      manyFilesFired: false,
      longSessionFired: false,
    };
  }

  init() {
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, (stats) => {
        this._evaluate(stats);
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'encouragementEnabled') {
          this.enabled = value;
        }
        if (key === 'encouragementFrequency') {
          this.frequencyMs = value * 60 * 1000;
        }
      })
    );

    console.log('EncouragementSystem initialized');
  }

  _evaluate(stats) {
    if (!this.enabled) return;

    const now = Date.now();
    if (now - this.lastEncouragementTime < this.frequencyMs) return;

    for (const milestone of MILESTONES) {
      if (milestone.check(stats, this._ctx)) {
        this._trigger(milestone, stats);
        break; // one encouragement at a time
      }
    }
  }

  _trigger(milestone, stats) {
    const pool = milestone.messages;
    const pick = pool[Math.floor(Math.random() * pool.length)];

    milestone.onFire(stats, this._ctx);
    this.lastEncouragementTime = Date.now();

    eventBus.emit(Events.ENCOURAGEMENT_TRIGGERED, {
      id: milestone.id,
      text: pick.text,
      tip: pick.tip,
    });
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
