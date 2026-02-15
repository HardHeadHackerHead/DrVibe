// Dr. Vibe - Hydration Reminder System

import { eventBus, Events } from '../../core/EventBus.js';
import { HydrationMessages } from './HydrationMessages.js';

export class HydrationReminder {
  constructor() {
    this.enabled = true;
    this.frequencyMinutes = 45;
    this.dailyCount = 0;
    this.lastResetDate = this.todayString();
    this.intervalId = null;
  }

  init() {
    this.setupEventListeners();
    this.checkDailyReset();
    if (this.enabled) {
      this.startInterval();
    }
  }

  setupEventListeners() {
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'hydrationEnabled') {
        this.enabled = value;
        if (value) {
          this.startInterval();
        } else {
          this.stopInterval();
        }
      }
      if (key === 'hydrationFrequency') {
        this.frequencyMinutes = value;
        if (this.enabled) {
          this.restartInterval();
        }
      }
    });

    eventBus.on(Events.SETTINGS_LOADED, () => {
      this.checkDailyReset();
    });
  }

  startInterval() {
    this.stopInterval();
    const ms = this.frequencyMinutes * 60 * 1000;
    this.intervalId = setInterval(() => this.remind(), ms);
    console.log(`Hydration reminder started: every ${this.frequencyMinutes} minutes`);
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

  async remind() {
    if (!this.enabled) return;

    const message = HydrationMessages.reminder();

    eventBus.emit(Events.HYDRATION_REMINDER, {
      title: message.title,
      body: message.body,
    });

    console.log('Hydration reminder sent');
  }

  logWater() {
    this.checkDailyReset();
    this.dailyCount++;

    eventBus.emit(Events.HYDRATION_LOGGED, {
      count: this.dailyCount,
      message: HydrationMessages.logged(),
    });

    console.log(`Water logged: ${this.dailyCount} today`);
  }

  checkDailyReset() {
    const today = this.todayString();
    if (this.lastResetDate !== today) {
      this.dailyCount = 0;
      this.lastResetDate = today;
      eventBus.emit(Events.HYDRATION_DAILY_RESET, { date: today });
      console.log('Hydration counter reset for new day');
    }
  }

  todayString() {
    return new Date().toISOString().slice(0, 10);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.startInterval();
    } else {
      this.stopInterval();
    }
  }

  setFrequency(minutes) {
    this.frequencyMinutes = minutes;
    if (this.enabled) {
      this.restartInterval();
    }
  }

  loadState(settings) {
    if (settings.hydrationEnabled !== undefined) this.enabled = settings.hydrationEnabled;
    if (settings.hydrationFrequency !== undefined) this.frequencyMinutes = settings.hydrationFrequency;
    if (settings.hydrationDailyCount !== undefined) this.dailyCount = settings.hydrationDailyCount;
    if (settings.hydrationLastReset !== undefined) this.lastResetDate = settings.hydrationLastReset;
    this.checkDailyReset();
  }

  getState() {
    return {
      enabled: this.enabled,
      frequencyMinutes: this.frequencyMinutes,
      dailyCount: this.dailyCount,
      lastResetDate: this.lastResetDate,
    };
  }

  destroy() {
    this.stopInterval();
  }
}
