// Dr. Vibe - Notification System
// Centralizes all notification delivery through the in-app toast overlay window.

import { eventBus, Events } from '../../core/EventBus.js';
import { WEB_BASE as WEBSITE_BASE } from '../../core/config.js';

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
  economy:     'notifyVpEarned',
  trade:       'notifyTrades',
  community:   'notifyCommunity',
};

// Lookup table for reasonCode → human-readable label. Keys match the
// reasonCodes emitted by the website economy pipeline.
const REASON_LABELS = {
  activity_event:     'Activity',
  pomodoro_complete:  'Pomodoro',
  focus_session_end:  'Focus',
  git_commit:         'Commit',
  coding_session:     'Coding',
  wellness_check:     'Wellness',
  personal_best:      'Personal Best',
  achievement_unlock: 'Achievement',
  mastery_level_up:   'Mastery',
  quest_complete:     'Quest',
  streak_day:         'Streak',
  coding_session_start: 'Coding',
};

// Donations never buy VP; a donor's credit shows as a thank-you instead.
const DONATION_REASONS = new Set(['donation', 'donation_thanks', 'stripe_purchase']);

// Toasts that arrive during a screen share or fullscreen app wait here
// (newest kept) and play once it ends.
const MAX_HELD = 10;
const HELD_SPACING_MS = 1500;

export class Notifier {
  constructor(settings) {
    this.settings = settings;
    this.enabled = true;
    this.focusSuppressed = false;
    this._holdCheck = () => false;
    this._held = [];
  }

  init() {
    this.setupEventListeners();
    eventBus.on(Events.PRESENTING_ENDED, () => this._releaseHeld());
  }

  /** `check()` returns true while toasts must wait (PresenceGuard.holding). */
  holdWhile(check) {
    this._holdCheck = typeof check === 'function' ? check : () => false;
  }

  _releaseHeld() {
    const held = this._held;
    this._held = [];
    held.forEach((args, i) => setTimeout(() => this.send(...args), i * HELD_SPACING_MS));
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
      this.send(title, body, 'posture', 'posture');
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
      this.send(title, body, 'eyestrain', 'eyestrain');
    });

    // Achievement unlocked
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, ({ title, description, icon }) => {
      this.send(`Achievement: ${title}`, description, 'achievement');
    });

    // Celebration milestones (progress toasts — was inline in main window)
    eventBus.on(Events.CELEBRATION_TRIGGERED, ({ message, tip }) => {
      this.send(message, tip, 'achievement');
    });

    // Boundary awareness (work-life reminders)
    eventBus.on(Events.BOUNDARY_REMINDER_SENT, ({ type, message }) => {
      this.send('Dr. Vibe', message, 'boundary');
    });

    // Unified earn toast — fires for activity rewards, achievements, mastery
    // and quests. The toast is suppressed when amount === 0 (cap hit).
    // Client-side activity events are throttled by EconomyClient.
    eventBus.on(Events.ECONOMY_EARNED, ({ amount, reasonCode }) => {
      if (DONATION_REASONS.has(reasonCode)) {
        this.send('Thanks for supporting Dr. Vibe!', 'Your donation keeps the lab running. You rock.', 'community', null, `${WEBSITE_BASE}/donate`);
        return;
      }
      const amt = Number(amount || 0);
      if (amt <= 0) return; // suppress cap-hit toasts
      const pts = amt.toLocaleString();
      const label = REASON_LABELS[reasonCode] || 'Activity';
      this.send('Vibe Points', `+${pts} VP — ${label}`, 'economy', null, `${WEBSITE_BASE}/economy`);
    });

    // VP claim failed — achievement/mastery claim exhausted its retry budget
    // because the server couldn't verify the criteria. Rare, informational.
    eventBus.on(Events.ECONOMY_CLAIM_FAILED, ({ label }) => {
      this.send(
        'Vibe Points — sync failed',
        `${label} couldn't sync. It'll try again next launch.`,
        'economy',
      );
    });

    // Server notifications from the 60 s poll (follows, donations, comments…)
    eventBus.on(Events.NOTIFICATION_RECEIVED, ({ notification }) => {
      if (!notification) return;
      if (DONATION_REASONS.has(notification.type)) {
        this.send('Thanks for supporting Dr. Vibe!', notification.body || 'Your donation keeps the lab running.', 'community', null, notification.url);
        return;
      }
      const category = notification.type?.startsWith('trade_') ? 'trade' : 'community';
      this.send(notification.title, notification.body, category, null, notification.url);
    });

    // Trade proposed — another user wants to trade with us
    eventBus.on(Events.TRADE_PROPOSED, ({ tradeId, fromUser, companionName }) => {
      const url = tradeId ? `${WEBSITE_BASE}/trades/${tradeId}` : `${WEBSITE_BASE}/trades`;
      this.send('Trade Proposal!', `${fromUser} wants to trade for your ${companionName}!`, 'trade', null, url);
    });

    // Trade accepted — our trade proposal was accepted
    eventBus.on(Events.TRADE_ACCEPTED, ({ tradeId, companionName }) => {
      const url = tradeId ? `${WEBSITE_BASE}/trades/${tradeId}` : `${WEBSITE_BASE}/trades`;
      this.send('Trade Accepted!', `Your trade for ${companionName} was accepted!`, 'trade', null, url);
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
   * @param {string|null} snoozeAction - Optional snooze action identifier
   * @param {string|null} url - Optional URL to open in browser when "View" is clicked
   * @param {string|null} viewLabel - Optional text for that button (default "View")
   */
  send(title, body, category, snoozeAction, url, viewLabel) {
    if (!this.enabled || this.focusSuppressed) return;
    if (this._holdCheck()) {
      this._held.push([title, body, category, snoozeAction, url, viewLabel]);
      if (this._held.length > MAX_HELD) this._held.shift();
      return;
    }

    // Check per-category setting
    const settingKey = CATEGORY_SETTING_KEY[category];
    if (settingKey && this.settings && this.settings.get(settingKey) === false) return;

    const durationMs = (this.settings?.get('popupDuration') || 20) * 1000;

    this._emitToToast('toast-show', { title, body, category, durationMs, snoozeAction, url: url || null, viewLabel: viewLabel || null });
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
