// Dr. Vibe - Weekend/Evening Boundary Awareness
// Gentle reminders about work-life balance when coding late nights or weekends

import { eventBus, Events } from '../../core/EventBus.js';

const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds
const COOLDOWN_MS = 60 * 60 * 1000;  // Max one reminder per hour

const EVENING_MESSAGES = [
  "It's getting late... Remember, bugs are easier to squash when you're rested!",
  "Night owl mode detected! Don't forget to wind down soon.",
  "Burning the midnight oil? Your code will thank you for a good night's sleep.",
  "Late night coding session! Just a gentle nudge to take care of yourself.",
];

const WEEKEND_MESSAGES = [
  "Weekend coding! Remember to rest and recharge too.",
  "It's the weekend! Balance is key — enjoy some time away from the screen.",
  "Coding on the weekend? Don't forget to do something fun offline too!",
  "Weekend warrior! A rested mind writes better code.",
];

export class BoundaryAwareness {
  constructor(settings) {
    this.settings = settings;
    this.enabled = settings.boundaryAwarenessEnabled;
    this.checkInterval = null;
    this.lastReminderTime = 0;
    this.isCoding = false;
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    eventBus.on(Events.ACTIVITY_CODING_START, () => {
      this.isCoding = true;
    });

    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      this.isCoding = false;
    });

    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'boundaryAwarenessEnabled') {
        this.enabled = value;
      }
    });
  }

  start() {
    this.checkInterval = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  check() {
    if (!this.enabled || !this.settings.notificationsEnabled) return;
    if (!this.isCoding) return;
    if (Date.now() - this.lastReminderTime < COOLDOWN_MS) return;

    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = day === 0 || day === 6;
    const isEvening = hour >= 22 || hour < 5; // 10pm to 5am

    if (isEvening) {
      this.sendReminder('evening');
    } else if (isWeekend) {
      this.sendReminder('weekend');
    }
  }

  async sendReminder(type) {
    const messages = type === 'evening' ? EVENING_MESSAGES : WEEKEND_MESSAGES;
    const message = messages[Math.floor(Math.random() * messages.length)];

    this.lastReminderTime = Date.now();

    eventBus.emit(Events.BOUNDARY_REMINDER_SENT, { type, message });
  }
}
