// Dr. Vibe - Eye Strain Prevention (20-20-20 Rule)
// Every 20 minutes, look 20 feet away for 20 seconds

import { eventBus, Events } from '../../core/EventBus.js';
import { EyeStrainMessages } from './EyeStrainMessages.js';

export class EyeStrainReminder {
  constructor() {
    this.enabled = true;
    this.frequencyMinutes = 20;
    this.countdownSeconds = 20;
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
      if (key === 'eyeStrainEnabled') {
        this.enabled = value;
        if (value) {
          this.startInterval();
        } else {
          this.stopAll();
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
    console.log(`Eye strain reminder started: every ${this.frequencyMinutes} minutes`);
  }

  stopInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
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

    const message = EyeStrainMessages.reminder();

    eventBus.emit(Events.EYE_STRAIN_REMINDER, {
      title: message.title,
      body: message.body,
    });

    this.startCountdown();
    console.log('Eye strain reminder sent');
  }

  startCountdown() {
    this.isCountingDown = true;
    this.remaining = this.countdownSeconds;

    eventBus.emit(Events.EYE_STRAIN_COUNTDOWN, { remaining: this.remaining });

    this.countdownId = setInterval(() => {
      this.remaining--;
      eventBus.emit(Events.EYE_STRAIN_COUNTDOWN, { remaining: this.remaining });

      if (this.remaining <= 0) {
        this.completeCountdown();
      }
    }, 1000);
  }

  completeCountdown() {
    this.stopCountdown();
    const message = EyeStrainMessages.completion();

    eventBus.emit(Events.EYE_STRAIN_COMPLETE, { message });
    console.log('Eye strain countdown complete');
  }

  snooze() {
    this.stopCountdown();
    // Restart the interval (resets the 20-minute timer)
    this.startInterval();

    const message = EyeStrainMessages.snooze();
    eventBus.emit(Events.EYE_STRAIN_SNOOZED, { message });
    console.log('Eye strain reminder snoozed');
  }

  loadState(settings) {
    if (settings.eyeStrainEnabled !== undefined) this.enabled = settings.eyeStrainEnabled;
  }

  destroy() {
    this.stopAll();
  }
}
