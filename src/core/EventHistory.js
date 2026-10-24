// Dr. Vibe - Event History
// Maintains a session-scoped log of everything Dr. Vibe has said or triggered.
// Consumed by the dashboard Events tab via _sendDashboardData().

import { eventBus, Events } from './EventBus.js';

const MAX_ENTRIES = 300;

class EventHistory {
  constructor() {
    this._entries = [];
    this._stateTimeline = [];
  }

  init() {
    this._subscribe();
  }

  getStateTimeline() {
    if (this._stateTimeline.length === 0) return [];
    const result = this._stateTimeline.slice();
    result[result.length - 1] = { ...result[result.length - 1], endTime: Date.now() };
    return result;
  }

  _add(category, icon, message, detail = '') {
    const last = this._entries[0];
    if (last && last.category === category && last.message === message) {
      last.count = (last.count || 1) + 1;
      last.timestamp = Date.now();
      return;
    }
    this._entries.unshift({
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      category,
      icon,
      message,
      detail,
      count: 1,
    });
    if (this._entries.length > MAX_ENTRIES) {
      this._entries.length = MAX_ENTRIES;
    }
  }

  getHistory() {
    return this._entries.slice();
  }

  _subscribe() {
    // ---- Character state timeline ----

    eventBus.on(Events.CHARACTER_STATE_CHANGED, ({ current }) => {
      const now = Date.now();
      if (this._stateTimeline.length > 0) {
        this._stateTimeline[this._stateTimeline.length - 1].endTime = now;
      }
      this._stateTimeline.push({ state: current, startTime: now, endTime: null });
      if (this._stateTimeline.length > 500) this._stateTimeline.shift();
    });

    // ---- Speech events (what Dr. Vibe actually said) ----

    eventBus.on(Events.TIMER_SPEECH, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.HYDRATION_REMINDER, ({ title, body }) => {
      this._add('speech', '💬', title || 'Time for water!', body || 'Stay hydrated — your brain needs it.');
    });

    eventBus.on(Events.BREAK_ACTIVITY_SUGGESTED, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.ENCOURAGEMENT_TRIGGERED, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.STUCK_DETECTED, ({ message }) => {
      this._add('speech', '💬', message?.body || 'You seem stuck.', message?.tip || '');
    });

    eventBus.on(Events.RESUME_SUGGESTION_TRIGGERED, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.STREAK_MILESTONE, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.STREAK_REMINDER, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.STREAK_RECOVERED, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.CLAUDE_CODE_HOTSPOT, ({ text }) => {
      this._add('speech', '💬', text, 'Hotspot file detected');
    });

    eventBus.on(Events.CLAUDE_CODE_PATTERN, ({ text, pattern }) => {
      const tips = {
        research: 'Claude is reading more than writing.',
        rampage: 'Claude is making lots of changes at once!',
        surgical: 'Precise, targeted edit detected.',
      };
      this._add('speech', '💬', text, tips[pattern] || 'Coding pattern detected');
    });

    eventBus.on(Events.AI_PAIR_MILESTONE, ({ text, tip }) => {
      this._add('speech', '💬', text, tip || '');
    });

    eventBus.on(Events.AI_PAIR_STARTED, () => {
      this._add('speech', '💬', 'Pair programming session started!', "You and Claude are both active — let's go!");
    });

    eventBus.on(Events.CLAUDE_CODE_SUMMARY, ({ text }) => {
      this._add('speech', '💬', text, 'Session wrap-up');
    });

    eventBus.on(Events.CLAUDE_CODE_FIX_CYCLE, ({ text }) => {
      this._add('speech', '💬', text, 'Fix-test cycle detected');
    });

    eventBus.on(Events.CLAUDE_CODE_BUG_FIXED, ({ text }) => {
      this._add('speech', '💬', text, 'Bug squashed!');
    });

    eventBus.on(Events.CLAUDE_CODE_FILE_CREATED, ({ text }) => {
      this._add('speech', '💬', text, 'New file created');
    });

    eventBus.on(Events.CLAUDE_CODE_INSIGHT, ({ text, pattern }) => {
      const tips = {
        deep_dive: 'Claude is thoroughly investigating this area.',
        cross_cutting: 'Changes spanning multiple directories.',
      };
      this._add('speech', '💬', text, tips[pattern] || 'Code insight');
    });

    eventBus.on(Events.CLAUDE_CODE_SESSION_START, ({ projectName }) => {
      this._add('speech', '💬', 'Claude just joined the session!',
        projectName ? `Working on: ${projectName}` : 'A new Claude Code session started.');
    });

    // ---- Activity events ----

    eventBus.on(Events.ACTIVITY_CODING_START, ({ appName }) => {
      this._add('activity', '💻', 'Started coding', appName || '');
    });

    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      this._add('activity', '💻', 'Stopped coding');
    });

    eventBus.on(Events.ACTIVITY_IDLE, ({ idleTimeMs }) => {
      const mins = idleTimeMs ? Math.round(idleTimeMs / 60000) : 5;
      this._add('activity', '💤', `Idle for ${mins}+ minute${mins !== 1 ? 's' : ''}`);
    });

    eventBus.on(Events.PROJECT_CHANGED, ({ current, previous }) => {
      const detail = previous ? `Previously: ${previous.name}` : '';
      this._add('activity', '📁', `Switched to ${current.name}`, detail);
    });

    eventBus.on(Events.PROJECT_LOST, ({ project }) => {
      this._add('activity', '📁', `Left project: ${project?.name || 'unknown'}`);
    });

    // ---- Wellness events ----

    eventBus.on(Events.HYDRATION_LOGGED, ({ count }) => {
      this._add('wellness', '💧', `Water logged — ${count} glass${count !== 1 ? 'es' : ''} today`);
    });

    eventBus.on(Events.EYE_STRAIN_COMPLETE, () => {
      this._add('wellness', '👀', 'Eye break complete — 20-20-20 done!');
    });

    eventBus.on(Events.EYE_STRAIN_SNOOZED, () => {
      this._add('wellness', '👀', 'Eye strain reminder snoozed');
    });

    eventBus.on(Events.POSTURE_COMPLETE, () => {
      this._add('wellness', '🧘', 'Posture check complete');
    });

    eventBus.on(Events.POSTURE_SNOOZED, () => {
      this._add('wellness', '🧘', 'Posture reminder snoozed');
    });

    eventBus.on(Events.FATIGUE_DETECTED, () => {
      this._add('wellness', '😴', 'Fatigue detected — consider a break');
    });

    eventBus.on(Events.FATIGUE_DISMISSED, () => {
      this._add('wellness', '😴', 'Fatigue warning dismissed');
    });

    eventBus.on(Events.OVERWORK_WARNING, ({ level }) => {
      this._add('wellness', '⚠️', `Overwork warning (level ${level || 1})`, 'Time to wrap up soon');
    });

    eventBus.on(Events.BOUNDARY_REMINDER_SENT, () => {
      this._add('wellness', '🏠', "Work-life boundary reminder sent — it's okay to stop");
    });

    // ---- Achievement events ----

    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, ({ title, description }) => {
      this._add('achievement', '🏆', `Achievement unlocked: ${title || 'New achievement'}`, description || '');
    });

    eventBus.on(Events.STREAK_BROKEN, ({ previous }) => {
      const days = previous || 0;
      this._add('achievement', '💔', `Coding streak broken (was ${days} day${days !== 1 ? 's' : ''})`, 'Start a new streak today!');
    });

    eventBus.on(Events.PERSONAL_BEST_SET, ({ label, formatted }) => {
      this._add('achievement', '🏆', `New personal best: ${label || 'record'}`, formatted?.new || '');
    });

    eventBus.on(Events.SKILL_MILESTONE, ({ language, milestone }) => {
      this._add('achievement', '⭐', `${milestone} in ${language}`, `Skill milestone reached`);
    });

    // ---- Timer events ----

    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      this._add('timer', '⏱️', 'Work session complete — time for a break!');
    });

    eventBus.on(Events.TIMER_BREAK_START, () => {
      this._add('timer', '☕', 'Break started');
    });

    eventBus.on(Events.TIMER_BREAK_COMPLETE, () => {
      this._add('timer', '⏱️', 'Break over — back to work!');
    });

    // ---- Focus mode events ----

    eventBus.on(Events.FOCUS_MODE_STARTED, ({ duration }) => {
      const mins = duration ? Math.round(duration / 60000) : '?';
      this._add('focus', '🎯', `Focus mode started (${mins} min)`, 'Reactions suppressed');
    });

    eventBus.on(Events.FOCUS_MODE_ENDED, () => {
      this._add('focus', '🎯', 'Focus mode ended');
    });

    // ---- Claude Code / AI session events ----

    eventBus.on(Events.CLAUDE_CODE_SESSION_END, ({ filesWritten, filesRead }) => {
      const detail = `${filesWritten ?? 0} written, ${filesRead ?? 0} read`;
      this._add('claude', '🤖', 'Claude Code session ended', detail);
    });

    eventBus.on(Events.AI_PAIR_ENDED, () => {
      this._add('claude', '🤖', 'AI pair programming session ended');
    });
  }
}

export const eventHistory = new EventHistory();
