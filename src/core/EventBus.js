// Dr. Vibe - Event Bus for decoupled communication between modules

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  // Subscribe to an event
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  // Subscribe to an event once
  once(event, callback) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback(...args);
    };
    return this.on(event, wrapper);
  }

  // Unsubscribe from an event
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  // Emit an event
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error in event handler for '${event}':`, e);
        }
      });
    }
  }

  // Remove all listeners for an event (or all events if no event specified)
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// Singleton instance
export const eventBus = new EventBus();

// Event name constants for type safety and discoverability
export const Events = {
  // App lifecycle
  APP_READY: 'app:ready',
  APP_FOCUS: 'app:focus',
  APP_BLUR: 'app:blur',

  // Timer events
  TIMER_TICK: 'timer:tick',
  TIMER_PROGRESS: 'timer:progress',
  TIMER_WORK_COMPLETE: 'timer:workComplete',
  TIMER_BREAK_COMPLETE: 'timer:breakComplete',
  TIMER_BREAK_START: 'timer:breakStart',
  TIMER_SPEECH: 'timer:speech',
  TIMER_PAUSED: 'timer:paused',
  TIMER_RESUMED: 'timer:resumed',

  // Activity events
  ACTIVITY_CHANGED: 'activity:changed',
  ACTIVITY_CODING_START: 'activity:codingStart',
  ACTIVITY_CODING_STOP: 'activity:codingStop',
  ACTIVITY_IDLE: 'activity:idle',

  // Character events
  CHARACTER_STATE_CHANGED: 'character:stateChanged',
  CHARACTER_ANIMATION_START: 'character:animationStart',
  CHARACTER_ANIMATION_COMPLETE: 'character:animationComplete',

  // Project events
  PROJECT_CHANGED: 'project:changed',
  PROJECT_DETECTED: 'project:detected',
  PROJECT_LOST: 'project:lost',

  // Filesystem scanner events
  SCANNER_STARTED: 'scanner:started',
  SCANNER_COMPLETE: 'scanner:complete',
  SCANNER_ERROR: 'scanner:error',
  PROJECTS_DISCOVERED: 'scanner:projectsDiscovered',

  // Momentum events
  MOMENTUM_CHANGED: 'momentum:changed',
  MOMENTUM_LEVEL_CHANGED: 'momentum:levelChanged',

  // Settings events
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_LOADED: 'settings:loaded',

  // UI events
  SETTINGS_PANEL_TOGGLE: 'ui:settingsPanelToggle',
  SETTINGS_PANEL_OPENED: 'ui:settingsPanelOpened',
  SETTINGS_PANEL_CLOSED: 'ui:settingsPanelClosed',
  CONTEXT_MENU_SHOW: 'ui:contextMenuShow',
  CONTEXT_MENU_OPENED: 'ui:contextMenuOpened',
  CONTEXT_MENU_CLOSED: 'ui:contextMenuClosed',
  WINDOW_DRAG_START: 'ui:windowDragStart',
  WINDOW_DRAG_END: 'ui:windowDragEnd',

  // Break system events
  BREAK_SUGGESTED: 'break:suggested',
  BREAK_ACCEPTED: 'break:accepted',
  BREAK_DISMISSED: 'break:dismissed',
  BREAK_ACTIVITY_SUGGESTED: 'break:activitySuggested',
  ACTIVITY_WINDOW_SWITCH: 'activity:windowSwitch',
  ACTIVITY_WINDOW_CHANGED: 'activity:windowChanged',

  // Hydration events
  HYDRATION_REMINDER: 'hydration:reminder',
  HYDRATION_LOGGED: 'hydration:logged',
  HYDRATION_DAILY_RESET: 'hydration:dailyReset',

  // Notification events
  NOTIFICATION_SENT: 'notification:sent',

  // About panel
  ABOUT_PANEL_TOGGLE: 'ui:aboutPanelToggle',
  ABOUT_PANEL_OPENED: 'ui:aboutPanelOpened',
  ABOUT_PANEL_CLOSED: 'ui:aboutPanelClosed',

  // Achievement events
  ACHIEVEMENT_UNLOCKED: 'achievement:unlocked',
  ACHIEVEMENT_PROGRESS: 'achievement:progress',
  ACHIEVEMENT_PANEL_TOGGLE: 'ui:achievementPanelToggle',
  ACHIEVEMENT_PANEL_OPENED: 'ui:achievementPanelOpened',
  ACHIEVEMENT_PANEL_CLOSED: 'ui:achievementPanelClosed',

  // Eye strain events
  EYE_STRAIN_REMINDER: 'eyestrain:reminder',
  EYE_STRAIN_COUNTDOWN: 'eyestrain:countdown',
  EYE_STRAIN_COMPLETE: 'eyestrain:complete',
  EYE_STRAIN_SNOOZED: 'eyestrain:snoozed',

  // Posture reminder events
  POSTURE_REMINDER: 'posture:reminder',
  POSTURE_COUNTDOWN: 'posture:countdown',
  POSTURE_COMPLETE: 'posture:complete',
  POSTURE_SNOOZED: 'posture:snoozed',

  // Boundary awareness events
  BOUNDARY_REMINDER_SENT: 'boundary:reminderSent',

  // Session progress
  SESSION_PANEL_TOGGLE: 'ui:sessionPanelToggle',
  SESSION_PANEL_OPENED: 'ui:sessionPanelOpened',
  SESSION_PANEL_CLOSED: 'ui:sessionPanelClosed',
  SESSION_STATS_UPDATED: 'session:statsUpdated',

  // Learning resources
  LEARNING_RESOURCE_SUGGESTED: 'learning:resourceSuggested',
  LEARNING_RESOURCE_DISMISSED: 'learning:resourceDismissed',

  // Weekly summary
  WEEKLY_SUMMARY_AVAILABLE: 'weekly:summaryAvailable',
  WEEKLY_SUMMARY_PANEL_TOGGLE: 'ui:weeklySummaryPanelToggle',
  WEEKLY_SUMMARY_PANEL_OPENED: 'ui:weeklySummaryPanelOpened',
  WEEKLY_SUMMARY_PANEL_CLOSED: 'ui:weeklySummaryPanelClosed',

  // Encouragement events
  ENCOURAGEMENT_TRIGGERED: 'encouragement:triggered',

  // Skill development
  SKILL_UPDATED: 'skill:updated',
  SKILL_MILESTONE: 'skill:milestone',
  SKILL_PANEL_TOGGLE: 'ui:skillPanelToggle',
  SKILL_PANEL_OPENED: 'ui:skillPanelOpened',
  SKILL_PANEL_CLOSED: 'ui:skillPanelClosed',

  // Fatigue detection
  FATIGUE_DETECTED: 'fatigue:detected',
  FATIGUE_DISMISSED: 'fatigue:dismissed',

  // Stuck detection
  STUCK_DETECTED: 'stuck:detected',
  STUCK_DISMISSED: 'stuck:dismissed',

  // Overwork prevention
  OVERWORK_WARNING: 'overwork:warning',
  OVERWORK_DISMISSED: 'overwork:dismissed',

  // Today's Wins summary
  TODAY_WINS_TOGGLE: 'ui:todayWinsToggle',
  TODAY_WINS_SHOW: 'ui:todayWinsShow',
  TODAY_WINS_OPENED: 'ui:todayWinsOpened',
  TODAY_WINS_CLOSED: 'ui:todayWinsClosed',

  // App quit flow
  APP_QUIT_REQUESTED: 'app:quitRequested',
  APP_QUIT_CONFIRMED: 'app:quitConfirmed',

  // Personal best events
  PERSONAL_BEST_SET: 'personalBest:set',
  PERSONAL_BEST_APPROACHING: 'personalBest:approaching',
  PERSONAL_BEST_PANEL_TOGGLE: 'ui:personalBestPanelToggle',
  PERSONAL_BEST_PANEL_OPENED: 'ui:personalBestPanelOpened',
  PERSONAL_BEST_PANEL_CLOSED: 'ui:personalBestPanelClosed',

  // Focus mode
  FOCUS_MODE_STARTED: 'focusMode:started',
  FOCUS_MODE_ENDED: 'focusMode:ended',
  FOCUS_MODE_TICK: 'focusMode:tick',
  FOCUS_MODE_WARNING: 'focusMode:warning',

  // Resume suggestions
  RESUME_SUGGESTION_TRIGGERED: 'resume:suggestionTriggered',
  RESUME_DISMISSED: 'resume:dismissed',

  // Celebration events
  CELEBRATION_TRIGGERED: 'celebration:triggered',

  // Session context (active files)
  SESSION_FILES_UPDATED: 'sessionContext:filesUpdated',
  SESSION_CONTEXT_TOGGLE: 'ui:sessionContextToggle',

  // Walking events
  WALKING_STARTED: 'walking:started',
  WALKING_STOPPED: 'walking:stopped',

  // Claude Code integration events
  CLAUDE_CODE_SESSION_START: 'claudeCode:sessionStart',
  CLAUDE_CODE_SESSION_END: 'claudeCode:sessionEnd',
  CLAUDE_CODE_FILE_CHANGED: 'claudeCode:fileChanged',
  CLAUDE_CODE_FILE_READ: 'claudeCode:fileRead',
  CLAUDE_CODE_COMMAND_RUN: 'claudeCode:commandRun',
  CLAUDE_CODE_ACTIVE: 'claudeCode:active',
  CLAUDE_CODE_IDLE: 'claudeCode:idle',
  CLAUDE_CODE_HOTSPOT: 'claudeCode:hotspot',
  CLAUDE_CODE_PATTERN: 'claudeCode:pattern',
  CLAUDE_CODE_FILE_CREATED: 'claudeCode:fileCreated',
  CLAUDE_CODE_FIX_CYCLE: 'claudeCode:fixCycle',
  CLAUDE_CODE_BUG_FIXED: 'claudeCode:bugFixed',
  CLAUDE_CODE_INSIGHT: 'claudeCode:insight',
  CLAUDE_CODE_SUMMARY: 'claudeCode:summary',
  AI_PAIR_MILESTONE: 'aiPair:milestone',
  AI_PAIR_STARTED: 'aiPair:started',
  AI_PAIR_ENDED: 'aiPair:ended',

  // Snitch security integration
  SNITCH_SCAN_SUGGESTED: 'snitch:scanSuggested',
  SNITCH_SCAN_STARTED:   'snitch:scanStarted',
  SNITCH_SCAN_COMPLETE:  'snitch:scanComplete',

  // Streak tracker events
  STREAK_UPDATED: 'streak:updated',
  STREAK_MILESTONE: 'streak:milestone',
  STREAK_REMINDER: 'streak:reminder',
  STREAK_BROKEN: 'streak:broken',
  STREAK_RECOVERED: 'streak:recovered',
};
