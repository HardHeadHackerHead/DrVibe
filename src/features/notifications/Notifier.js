// Dr. Vibe - Notification System
// Centralizes all notification delivery through the in-app toast overlay window.

import { eventBus, Events } from '../../core/EventBus.js';

// Maps notification categories to their settings key
const CATEGORY_SETTING_KEY = {
  break:       'notifyBreaks',
  hydration:   'notifyHydration',
  posture:     'notifyPosture',
  eyestrain:   'notifyEyeStrain',
  fatigue:     'notifyFatigue',
  stuck:       'notifyStuck',
  overwork:    'notifyOverwork',
  achievement: 'notifyAchievements',
  boundary:    'notifyBoundary',
  work:        'notifyBreaks',
};

export class Notifier {
  constructor(settings) {
    this.settings = settings;
    this.enabled = true;
    this.focusSuppressed = false;
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Break suggestions from BreakScheduler
    eventBus.on(Events.BREAK_SUGGESTED, ({ breakType, trigger, message }) => {
      this.send(message.title, message.body, 'break');
      eventBus.emit(Events.NOTIFICATION_SENT, { type: breakType || 'break', title: message.title });
    });

    // Fatigue detected
    eventBus.on(Events.FATIGUE_DETECTED, ({ message }) => {
      this.send(message.title, message.body, 'fatigue');
    });

    // Stuck detected
    eventBus.on(Events.STUCK_DETECTED, ({ message }) => {
      this.send(message.title, message.body, 'stuck');
    });

    // Posture reminder
    eventBus.on(Events.POSTURE_REMINDER, ({ title, body }) => {
      this.send(title, body, 'posture');
    });

    // Overwork warning
    eventBus.on(Events.OVERWORK_WARNING, ({ message }) => {
      this.send(message.title, message.body, 'overwork');
    });

    // Hydration reminder
    eventBus.on(Events.HYDRATION_REMINDER, ({ title, body }) => {
      this.send(title, body, 'hydration');
    });

    // Eye strain reminder
    eventBus.on(Events.EYE_STRAIN_REMINDER, ({ title, body }) => {
      this.send(title, body, 'eyestrain');
    });

    // Achievement unlocked
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, ({ title, description, icon }) => {
      this.send(`Achievement: ${title}`, description, 'achievement');
    });

    // Boundary awareness (work-life reminders)
    eventBus.on(Events.BOUNDARY_REMINDER_SENT, ({ type, message }) => {
      this.send('Dr. Vibe', message, 'boundary');
    });

    // Settings changes
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'notificationsEnabled') {
        this.enabled = value;
      }
      if (key === 'notificationPosition') {
        this._emitToToast('toast-reposition', { position: value });
      }
    });

    // Focus mode suppression
    eventBus.on(Events.FOCUS_MODE_STARTED, () => {
      this.focusSuppressed = true;
    });

    eventBus.on(Events.FOCUS_MODE_ENDED, () => {
      this.focusSuppressed = false;
    });
  }

  /**
   * Send a notification to the toast overlay window.
   * @param {string} title - Notification title
   * @param {string} body - Notification body text
   * @param {string} category - Category key (break, hydration, posture, etc.)
   */
  send(title, body, category) {
    if (!this.enabled || this.focusSuppressed) return;

    // Check per-category setting
    const settingKey = CATEGORY_SETTING_KEY[category];
    if (settingKey && this.settings && this.settings.get(settingKey) === false) return;

    const durationMs = (this.settings?.get('popupDuration') || 20) * 1000;

    this._emitToToast('toast-show', { title, body, category, durationMs });
  }

  /**
   * Send a return-to-work notification.
   */
  sendWorkNotification(title, body) {
    const t = title || 'Back to Work!';
    const b = body || "Dr. Vibe says: Break's over! Let's get back to coding!";
    this.send(t, b, 'work');
    eventBus.emit(Events.NOTIFICATION_SENT, { type: 'work', title: t });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  _emitToToast(event, payload) {
    try {
      const { emitTo } = window.__TAURI__?.event || {};
      if (emitTo) {
        emitTo('toast', event, payload);
      }
    } catch (e) {
      console.error('Notifier: failed to emit to toast window', e);
    }
  }
}
