// Dr. Vibe - Posture Reminder System
// Gentle periodic reminders to check posture with countdown hold

import { eventBus, Events } from '../../core/EventBus.js';
import { PostureMessages } from './PostureMessages.js';

export class PostureReminder {
  constructor() {
    this.enabled = true;
    this.frequencyMinutes = 30;
    this.countdownSeconds = 15;
    this.intervalId = null;
    this.countdownId = null;
    this.remaining = 0;
    this.isCountingDown = false;
    this.isBreak = false;
  }

  init() {
    this.setupEventListeners();
    if (this.enabled) {
      this.startInterval();
    }
  }

  setupEventListeners() {
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'postureReminderEnabled') {
        this.enabled = value;
        if (value) {
          this.startInterval();
        } else {
          this.stopAll();
        }
      }
      if (key === 'postureFrequency') {
        this.frequencyMinutes = value;
        if (this.enabled) {
          this.restartInterval();
        }
      }
    });

    // Track break state to avoid interrupting during breaks
    eventBus.on(Events.TIMER_PROGRESS, ({ isBreak }) => {
      this.isBreak = isBreak;
    });
  }

  startInterval() {
    this.stopInterval();
    const ms = this.frequencyMinutes * 60 * 1000;
    this.intervalId = setInterval(() => this.remind(), ms);
    console.log(`Posture reminder started: every ${this.frequencyMinutes} minutes`);
  }

  stopInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  restartInterval() {
    this.stopInterval();
    this.startInterval();
  }

  stopCountdown() {
    if (this.countdownId) {
      clearInterval(this.countdownId);
      this.countdownId = null;
    }
    this.isCountingDown = false;
    this.remaining = 0;
  }

  stopAll() {
    this.stopInterval();
    this.stopCountdown();
  }

  async remind() {
    if (!this.enabled) return;
    if (this.isBreak) return;
    if (this.isCountingDown) return;

    const message = PostureMessages.reminder();
    const tip = PostureMessages.tip();

    eventBus.emit(Events.POSTURE_REMINDER, {
      title: message.title,
      body: message.body,
      tip,
    });

    this.startCountdown();
    console.log('Posture reminder sent');
  }

  startCountdown() {
    this.isCountingDown = true;
    this.remaining = this.countdownSeconds;

    eventBus.emit(Events.POSTURE_COUNTDOWN, { remaining: this.remaining });

    this.countdownId = setInterval(() => {
      this.remaining--;
      eventBus.emit(Events.POSTURE_COUNTDOWN, { remaining: this.remaining });

      if (this.remaining <= 0) {
        this.completeCountdown();
      }
    }, 1000);
  }

  completeCountdown() {
    this.stopCountdown();
    const message = PostureMessages.completion();

    eventBus.emit(Events.POSTURE_COMPLETE, { message });
    console.log('Posture countdown complete');
  }

  snooze() {
    this.stopCountdown();
    this.restartInterval();

    const message = PostureMessages.snooze();
    eventBus.emit(Events.POSTURE_SNOOZED, { message });
    console.log('Posture reminder snoozed');
  }

  loadState(settings) {
    if (settings.postureReminderEnabled !== undefined) this.enabled = settings.postureReminderEnabled;
    if (settings.postureFrequency !== undefined) this.frequencyMinutes = settings.postureFrequency;
  }

  destroy() {
    this.stopAll();
  }
}
