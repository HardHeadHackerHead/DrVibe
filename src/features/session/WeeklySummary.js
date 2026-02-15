// Dr. Vibe - Weekly Summary & Reflection
// Aggregates the past week's session data into an encouraging report card.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';

const ENCOURAGING_MESSAGES = [
  { threshold: 0, messages: [
    "Every expert was once a beginner. This week is a fresh start!",
    "Rest is part of the process. Ready when you are!",
    "Sometimes the best code is the code you think about before writing.",
  ]},
  { threshold: 1, messages: [
    "You showed up! That's what matters most.",
    "One step at a time. You're building something great.",
    "Consistency starts with a single day. You did it!",
  ]},
  { threshold: 60, messages: [
    "Nice work this week! You're building momentum.",
    "Steady progress! Every minute of practice counts.",
    "You're putting in the time. The results will follow.",
  ]},
  { threshold: 300, messages: [
    "Solid week! You're in a great rhythm.",
    "Impressive dedication! Your skills are growing.",
    "Look at you go! That's some serious focus.",
  ]},
  { threshold: 600, messages: [
    "What a productive week! You should be proud.",
    "You're on fire! Your commitment is inspiring.",
    "Champion-level work this week. Keep it up!",
  ]},
];

export class WeeklySummary {
  constructor(sessionTracker) {
    this.tracker = sessionTracker;
    this.goals = null;
    this._summary = null;
  }

  async init() {
    this._loadStore();
    await this._buildSummary();
    await this._checkAutoTrigger();
    console.log('WeeklySummary initialized');
  }

  _loadStore() {
    this.goals = db.get('weeklySummary', 'goals') || null;
  }

  async _checkAutoTrigger() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon
    const hour = now.getHours();

    // Trigger on Sunday evening (18+) or Monday morning (<12)
    const shouldTrigger = (day === 0 && hour >= 18) || (day === 1 && hour < 12);
    if (!shouldTrigger) return;

    // Only auto-trigger once per week
    const weekKey = this._getWeekKey();
    const lastTrigger = db.get('weeklySummary', 'lastAutoTrigger') || null;
    if (lastTrigger === weekKey) return;

    db.set('weeklySummary', 'lastAutoTrigger', weekKey);

    // Delay slightly so the app finishes loading
    setTimeout(() => {
      eventBus.emit(Events.WEEKLY_SUMMARY_AVAILABLE, this._summary);
    }, 3000);
  }

  _getWeekKey() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${weekNum}`;
  }

  async _buildSummary() {
    const history = await this.tracker.getSessionHistory();
    const now = new Date();

    // Get the last 7 days
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      weekDays.push(d.toISOString().slice(0, 10));
    }

    const weekData = weekDays.map(date => {
      const entry = history.find(h => h.date === date);
      return entry || { date, codingSeconds: 0, filesCreated: 0, filesModified: 0, longestSessionSeconds: 0, projects: [] };
    });

    // Aggregate stats
    const totalSeconds = weekData.reduce((sum, d) => sum + (d.codingSeconds || 0), 0);
    const totalFilesCreated = weekData.reduce((sum, d) => sum + (d.filesCreated || 0), 0);
    const totalFilesModified = weekData.reduce((sum, d) => sum + (d.filesModified || 0), 0);
    const longestSession = Math.max(...weekData.map(d => d.longestSessionSeconds || 0));
    const activeDays = weekData.filter(d => (d.codingSeconds || 0) > 0).length;
    const allProjects = [...new Set(weekData.flatMap(d => d.projects || []))];

    // Streak from tracker
    const streak = this.tracker.streak;

    // Pick encouraging message
    const totalMinutes = Math.floor(totalSeconds / 60);
    let messagePool = ENCOURAGING_MESSAGES[0].messages;
    for (const tier of ENCOURAGING_MESSAGES) {
      if (totalMinutes >= tier.threshold) {
        messagePool = tier.messages;
      }
    }
    const encouragement = messagePool[Math.floor(Math.random() * messagePool.length)];

    // Goal comparison
    let goalStatus = null;
    if (this.goals) {
      goalStatus = {
        codingHoursGoal: this.goals.codingHours || null,
        codingHoursActual: totalSeconds / 3600,
        activeDaysGoal: this.goals.activeDays || null,
        activeDaysActual: activeDays,
      };
    }

    this._summary = {
      weekLabel: this._formatWeekLabel(weekDays),
      totalSeconds,
      totalHours: totalSeconds / 3600,
      totalFilesCreated,
      totalFilesModified,
      longestSessionSeconds: longestSession,
      activeDays,
      projects: allProjects,
      streak,
      encouragement,
      goalStatus,
      dailyBreakdown: weekData.reverse(), // chronological order
    };

    return this._summary;
  }

  _formatWeekLabel(weekDays) {
    const last = weekDays[weekDays.length - 1];
    const first = weekDays[0];
    const opts = { month: 'short', day: 'numeric' };
    const startStr = new Date(last + 'T12:00:00').toLocaleDateString(undefined, opts);
    const endStr = new Date(first + 'T12:00:00').toLocaleDateString(undefined, opts);
    return `${startStr} - ${endStr}`;
  }

  async getSummary() {
    if (!this._summary) {
      await this._buildSummary();
    }
    return this._summary;
  }

  async refreshSummary() {
    return this._buildSummary();
  }

  async setGoals(goals) {
    this.goals = goals;
    db.set('weeklySummary', 'goals', goals);
    // Rebuild summary with goal comparison
    await this._buildSummary();
  }

  async clearGoals() {
    this.goals = null;
    db.set('weeklySummary', 'goals', null);
    await this._buildSummary();
  }

  exportAsMarkdown() {
    const s = this._summary;
    if (!s) return '';

    const hours = Math.floor(s.totalSeconds / 3600);
    const minutes = Math.floor((s.totalSeconds % 3600) / 60);
    const longestH = Math.floor(s.longestSessionSeconds / 3600);
    const longestM = Math.floor((s.longestSessionSeconds % 3600) / 60);

    let md = `# Weekly Summary - ${s.weekLabel}\n\n`;
    md += `> ${s.encouragement}\n\n`;
    md += `## Stats\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Coding Time | ${hours}h ${minutes}m |\n`;
    md += `| Active Days | ${s.activeDays} / 7 |\n`;
    md += `| Files Created | ${s.totalFilesCreated} |\n`;
    md += `| Files Modified | ${s.totalFilesModified} |\n`;
    md += `| Longest Session | ${longestH}h ${longestM}m |\n`;
    md += `| Current Streak | ${s.streak} days |\n`;

    if (s.projects.length > 0) {
      md += `| Projects | ${s.projects.join(', ')} |\n`;
    }

    if (s.goalStatus) {
      md += `\n## Goals\n\n`;
      if (s.goalStatus.codingHoursGoal != null) {
        const actual = s.goalStatus.codingHoursActual.toFixed(1);
        const met = s.goalStatus.codingHoursActual >= s.goalStatus.codingHoursGoal;
        md += `- Coding Hours: ${actual} / ${s.goalStatus.codingHoursGoal}h ${met ? '(met!)' : ''}\n`;
      }
      if (s.goalStatus.activeDaysGoal != null) {
        const met = s.goalStatus.activeDaysActual >= s.goalStatus.activeDaysGoal;
        md += `- Active Days: ${s.goalStatus.activeDaysActual} / ${s.goalStatus.activeDaysGoal} ${met ? '(met!)' : ''}\n`;
      }
    }

    md += `\n## Daily Breakdown\n\n`;
    md += `| Day | Coding Time | Files |\n`;
    md += `|-----|-------------|-------|\n`;
    for (const day of s.dailyBreakdown) {
      const dH = Math.floor((day.codingSeconds || 0) / 3600);
      const dM = Math.floor(((day.codingSeconds || 0) % 3600) / 60);
      const files = (day.filesCreated || 0) + (day.filesModified || 0);
      const dayName = new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
      md += `| ${dayName} | ${dH}h ${dM}m | ${files} |\n`;
    }

    md += `\n---\n*Generated by Dr. Vibe*\n`;
    return md;
  }

  destroy() {
    // No subscriptions to clean up
  }
}
