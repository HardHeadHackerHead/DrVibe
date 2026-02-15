// Dr. Vibe - Break Scheduler
// Coordinates multiple break triggers: time-based (Pomodoro), idle detection,
// and window switching. Gentle suggestions, never forceful.

import { eventBus, Events } from '../../core/EventBus.js';
import { BreakMessages } from './BreakMessages.js';

export class BreakScheduler {
  constructor(settings, timer) {
    this.settings = settings;
    this.timer = timer;

    // Track work cycles for long-break scheduling
    this.completedCycles = 0;

    // Cooldown: don't spam suggestions
    this.lastSuggestionTime = 0;
    this.suggestionCooldownMs = 3 * 60 * 1000; // 3 min cooldown between suggestions

    // Track whether the user is currently on break
    this.onBreak = false;

    // Focus mode suppression
    this.focusSuppressed = false;

    // Maximum history entries to keep
    this.maxHistoryEntries = 100;
  }

  init() {
    this.setupEventListeners();
    console.log(`BreakScheduler initialized (mode: ${this.settings.breakMode})`);
  }

  setupEventListeners() {
    // Time-based: Pomodoro work complete
    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      this.completedCycles++;
      this.onTimerWorkComplete();
    });

    eventBus.on(Events.TIMER_BREAK_COMPLETE, () => {
      this.onBreak = false;
      this.suggestReturnToWork();
    });

    // Activity-based: idle detection
    eventBus.on(Events.ACTIVITY_IDLE, ({ idleTimeMs }) => {
      if (this.settings.breakMode === 'smart') {
        this.onIdleDetected(idleTimeMs);
      }
    });

    // Activity-based: window switch away from coding
    eventBus.on(Events.ACTIVITY_WINDOW_SWITCH, ({ fromApp, toApp }) => {
      if (this.settings.breakMode === 'smart') {
        this.onWindowSwitch(fromApp, toApp);
      }
    });

    // Settings changes
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'breakMode') {
        console.log(`Break mode changed to: ${value}`);
      }
    });

    // Focus mode — suppress break suggestions
    eventBus.on(Events.FOCUS_MODE_STARTED, () => {
      this.focusSuppressed = true;
    });

    eventBus.on(Events.FOCUS_MODE_ENDED, () => {
      this.focusSuppressed = false;
    });

    // Break acceptance/dismissal tracking
    eventBus.on(Events.BREAK_ACCEPTED, (data) => {
      this.recordBreakResponse('accepted', data.trigger);
    });

    eventBus.on(Events.BREAK_DISMISSED, (data) => {
      this.recordBreakResponse('dismissed', data.trigger);
    });
  }

  onTimerWorkComplete() {
    // Both pomodoro and smart modes use timer-based breaks
    if (this.settings.breakMode === 'manual') return;

    const isLongBreak = this.completedCycles % this.settings.longBreakInterval === 0;
    const breakType = isLongBreak ? 'long' : 'short';

    // In Pomodoro mode, the timer auto-starts break — just send the notification
    const message = isLongBreak ? BreakMessages.long() : BreakMessages.short();

    this.suggestBreak(breakType, 'timer', message);

    // If long break, adjust the timer's break duration for this cycle
    if (isLongBreak) {
      const originalBreak = this.settings.breakInterval;
      this.timer.setIntervals(this.settings.workInterval, this.settings.longBreakMinutes);
      // Restore after the break completes
      eventBus.once(Events.TIMER_BREAK_COMPLETE, () => {
        this.timer.setIntervals(this.settings.workInterval, originalBreak);
      });
    }
  }

  onIdleDetected(idleTimeMs) {
    if (this.onBreak) return;
    if (!this.canSuggest()) return;

    const message = BreakMessages.idle();
    this.suggestBreak('micro', 'idle', message);
  }

  onWindowSwitch(fromApp, toApp) {
    if (this.onBreak) return;
    if (!this.canSuggest()) return;

    // Only suggest if the timer is past 50% of the work period
    // (don't suggest breaks right after the user just started)
    const state = this.timer.getState();
    if (state.progress < 50) return;

    const message = BreakMessages.windowSwitch();
    this.suggestBreak('micro', 'windowSwitch', message);
  }

  suggestBreak(breakType, trigger, message) {
    if (this.focusSuppressed) return;
    this.onBreak = true;
    this.lastSuggestionTime = Date.now();

    eventBus.emit(Events.BREAK_SUGGESTED, {
      breakType,
      trigger,
      message,
      completedCycles: this.completedCycles,
    });

    console.log(`Break suggested: ${breakType} (trigger: ${trigger})`);
  }

  suggestReturnToWork() {
    const message = BreakMessages.returnToWork();
    // Use notification event directly — the Notifier picks it up
    eventBus.emit(Events.NOTIFICATION_SENT, {
      type: 'returnToWork',
      title: message.title,
      body: message.body,
    });
  }

  canSuggest() {
    return Date.now() - this.lastSuggestionTime > this.suggestionCooldownMs;
  }

  recordBreakResponse(response, trigger) {
    const entry = {
      response,
      trigger,
      timestamp: Date.now(),
    };

    this.settings.breakHistory.push(entry);

    // Trim history
    if (this.settings.breakHistory.length > this.maxHistoryEntries) {
      this.settings.breakHistory = this.settings.breakHistory.slice(-this.maxHistoryEntries);
    }

    this.settings.save();
  }

  // Get acceptance rate for adaptive suggestions
  getAcceptanceRate() {
    const history = this.settings.breakHistory;
    if (history.length === 0) return 0.5;

    const recent = history.slice(-20);
    const accepted = recent.filter(e => e.response === 'accepted').length;
    return accepted / recent.length;
  }

  getState() {
    return {
      completedCycles: this.completedCycles,
      onBreak: this.onBreak,
      breakMode: this.settings.breakMode,
      acceptanceRate: this.getAcceptanceRate(),
    };
  }
}
