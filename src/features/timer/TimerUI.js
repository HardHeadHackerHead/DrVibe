// Dr. Vibe - Timer UI Component
// Communicates timer milestones through speech bubbles instead of a persistent display

import { eventBus, Events } from '../../core/EventBus.js';

const MESSAGES = {
  halfway: [
    { text: 'Halfway there!', tip: "You're in the zone — keep going." },
    { text: 'Half the session done!', tip: 'Solid progress so far.' },
  ],
  fiveMin: [
    { text: '5 minutes until break!', tip: 'Good time to start wrapping up.' },
    { text: 'Almost break time!', tip: '5 more minutes of focus.' },
    { text: "Break's coming up soon!", tip: 'Finish your current thought.' },
  ],
  twoMin: [
    { text: '2 minutes left!', tip: 'Wrap up what you\'re working on.' },
    { text: 'Hey, running out of time!', tip: 'Break time in 2 minutes.' },
  ],
  oneMin: [
    { text: 'One minute to go!', tip: 'Time to find a stopping point.' },
    { text: 'Last minute!', tip: 'Save your work, break incoming.' },
  ],
  workComplete: [
    { text: 'Break time!', tip: 'You earned it — step away for a bit.' },
    { text: "Time's up — take a break!", tip: 'Rest makes you sharper.' },
  ],
  breakAlmostOver: [
    { text: "Break's almost over!", tip: 'Get ready to jump back in.' },
    { text: 'One minute left on break!', tip: 'Time to refocus.' },
  ],
  breakComplete: [
    { text: "Break's over — let's go!", tip: 'Refreshed and ready.' },
    { text: 'Welcome back!', tip: 'New session, new energy.' },
  ],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class TimerUI {
  constructor() {
    // Active coding time tracking (still used by SessionPanel)
    this.codingSecondsTotal = 0;
    this.codingStartedAt = null;

    // Milestone tracking
    this.shownMilestones = new Set();
    this.isBreak = false;

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Detect milestones on each tick
    eventBus.on(Events.TIMER_TICK, ({ minutes, seconds, isBreak }) => {
      this.isBreak = isBreak;

      // Only fire on exact second boundaries (seconds === 0) for minute milestones
      if (!isBreak) {
        this.checkWorkMilestones(minutes, seconds);
      } else {
        this.checkBreakMilestones(minutes, seconds);
      }
    });

    // Work period complete
    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      this.emitSpeech('workComplete');
      this.shownMilestones.clear();
    });

    // Break complete
    eventBus.on(Events.TIMER_BREAK_COMPLETE, () => {
      this.emitSpeech('breakComplete');
      this.shownMilestones.clear();
      this.isBreak = false;
    });

    // Break started — reset milestones for break period
    eventBus.on(Events.TIMER_BREAK_START, () => {
      this.shownMilestones.clear();
      this.isBreak = true;
    });

    // Track active coding time
    eventBus.on(Events.ACTIVITY_CODING_START, () => {
      this.codingStartedAt = Date.now();
    });

    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      if (this.codingStartedAt !== null) {
        this.codingSecondsTotal += Math.floor((Date.now() - this.codingStartedAt) / 1000);
        this.codingStartedAt = null;
      }
    });
  }

  checkWorkMilestones(minutes, seconds) {
    if (seconds !== 0) return;

    if (minutes === 5 && !this.shownMilestones.has('fiveMin')) {
      this.shownMilestones.add('fiveMin');
      this.emitSpeech('fiveMin');
    } else if (minutes === 2 && !this.shownMilestones.has('twoMin')) {
      this.shownMilestones.add('twoMin');
      this.emitSpeech('twoMin');
    } else if (minutes === 1 && !this.shownMilestones.has('oneMin')) {
      this.shownMilestones.add('oneMin');
      this.emitSpeech('oneMin');
    }
  }

  checkBreakMilestones(minutes, seconds) {
    if (seconds !== 0) return;

    if (minutes === 1 && !this.shownMilestones.has('breakAlmostOver')) {
      this.shownMilestones.add('breakAlmostOver');
      this.emitSpeech('breakAlmostOver');
    }
  }

  emitSpeech(key) {
    const msg = pickRandom(MESSAGES[key]);
    if (msg) {
      eventBus.emit(Events.TIMER_SPEECH, { text: msg.text, tip: msg.tip });
    }
  }

  resetSession() {
    this.codingSecondsTotal = 0;
    this.codingStartedAt = null;
  }
}
