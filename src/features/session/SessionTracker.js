// Dr. Vibe - Session Progress Tracker
// Aggregates session data: coding time, file changes, streak, timeline.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';

export class SessionTracker {
  constructor() {
    this.sessionStart = Date.now();
    this.codingSeconds = 0;
    this.codingStartedAt = null;
    this.filesCreated = new Set();
    this.filesModified = new Set();
    this.recentFiles = []; // Ordered by recency, most recent first, capped at 5
    this.timeline = []; // { type: 'coding'|'idle', time: timestamp }
    this.currentProject = null;
    this.streak = 0;
    this._unsubscribers = [];
    this._fileChangeUnlisten = null;
    this._updateInterval = null;
  }

  async init() {
    this._loadStore();
    await this._setupEventListeners();
    this._startPeriodicUpdate();
    console.log('SessionTracker initialized');
  }

  async _setupEventListeners() {
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        this.codingStartedAt = Date.now();
        this._addTimelineEvent('coding');
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
        if (this.codingStartedAt !== null) {
          this.codingSeconds += Math.floor((Date.now() - this.codingStartedAt) / 1000);
          this.codingStartedAt = null;
        }
        this._addTimelineEvent('idle');
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.PROJECT_DETECTED, (project) => {
        this._onProjectDetected(project);
      })
    );

    // tauri.onFileChanged returns a Promise<UnlistenFn>, so we need to await it
    this._fileChangeUnlisten = await tauri.onFileChanged((event) => {
      this._onFileChanged(event);
    });

    // Also listen for synthetic file-change events from Claude Code integration
    this._unsubscribers.push(
      eventBus.on('file-changed-synthetic', (event) => {
        this._onFileChanged(event);
      })
    );
  }

  _onProjectDetected(project) {
    if (this.currentProject?.path === project.path) return;
    this.currentProject = project;

    if (project.path) {
      tauri.startWatching(project.path);
      console.log(`SessionTracker: watching ${project.path}`);
    }
  }

  _onFileChanged(event) {
    if (event.event_type === 'create') {
      this.filesCreated.add(event.path);
    } else if (event.event_type === 'modify') {
      if (!this.filesCreated.has(event.path)) {
        this.filesModified.add(event.path);
      }
    }

    // Track recent files in recency order (most recent first, capped at 5)
    if (event.event_type === 'create' || event.event_type === 'modify') {
      const idx = this.recentFiles.indexOf(event.path);
      if (idx !== -1) this.recentFiles.splice(idx, 1);
      this.recentFiles.unshift(event.path);
      if (this.recentFiles.length > 5) this.recentFiles.length = 5;
    }

    eventBus.emit(Events.SESSION_STATS_UPDATED, this.getStats());
  }

  _addTimelineEvent(type) {
    this.timeline.push({ type, time: Date.now() });
  }

  getCodingSeconds() {
    let total = this.codingSeconds;
    if (this.codingStartedAt !== null) {
      total += Math.floor((Date.now() - this.codingStartedAt) / 1000);
    }
    return total;
  }

  getStats() {
    return {
      sessionStart: this.sessionStart,
      codingSeconds: this.getCodingSeconds(),
      filesCreated: this.filesCreated.size,
      filesModified: this.filesModified.size,
      recentFiles: [...this.recentFiles],
      streak: this.streak,
      timeline: this.timeline,
      projectName: this.currentProject?.name || null,
    };
  }

  // --- Persistence ---

  _loadStore() {
    const saved = db.getSection('session');
    if (saved) {
      const history = saved.history || [];
      this.streak = this._computeStreak(history);
      if (Array.isArray(saved.recentFiles)) {
        this.recentFiles = saved.recentFiles;
      }
    }
  }

  _computeStreak(history) {
    if (!history || history.length === 0) return 0;

    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    const today = new Date().toISOString().slice(0, 10);
    let streak = 0;
    let checkDate = new Date();

    // If no entry for today, start checking from yesterday
    if (sorted[0].date !== today) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toISOString().slice(0, 10);
      const found = sorted.find(h => h.date === dateStr);
      if (found && found.codingSeconds > 0) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  _getSessionHistory() {
    const saved = db.getSection('session');
    return saved?.history || [];
  }

  async saveSession() {
    const today = new Date().toISOString().slice(0, 10);
    const codingSecs = this.getCodingSeconds();
    if (codingSecs === 0) return;

    let history = this._getSessionHistory();
    const existing = history.find(h => h.date === today);

    // Calculate this session's duration for longest-session tracking
    const sessionDuration = Math.floor((Date.now() - this.sessionStart) / 1000);

    if (existing) {
      existing.codingSeconds += codingSecs;
      existing.filesCreated = (existing.filesCreated || 0) + this.filesCreated.size;
      existing.filesModified = (existing.filesModified || 0) + this.filesModified.size;
      existing.longestSessionSeconds = Math.max(
        existing.longestSessionSeconds || 0,
        sessionDuration
      );
      // Merge projects
      const existingProjects = existing.projects || [];
      if (this.currentProject?.name && !existingProjects.includes(this.currentProject.name)) {
        existingProjects.push(this.currentProject.name);
      }
      existing.projects = existingProjects;
    } else {
      const projects = [];
      if (this.currentProject?.name) projects.push(this.currentProject.name);
      history.push({
        date: today,
        codingSeconds: codingSecs,
        filesCreated: this.filesCreated.size,
        filesModified: this.filesModified.size,
        longestSessionSeconds: sessionDuration,
        projects,
      });
    }

    // Keep last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    history = history.filter(h => h.date >= cutoffStr);

    db.setSection('session', { history, recentFiles: this.recentFiles });
    await db.saveNow();

    this.streak = this._computeStreak(history);
  }

  async getSessionHistory() {
    return this._getSessionHistory();
  }

  _startPeriodicUpdate() {
    // Emit updated stats every 30 seconds and auto-save every 5 minutes
    let saveCounter = 0;
    this._updateInterval = setInterval(() => {
      eventBus.emit(Events.SESSION_STATS_UPDATED, this.getStats());
      saveCounter++;
      if (saveCounter >= 10) {
        saveCounter = 0;
        this.saveSession();
      }
    }, 30000);
  }

  destroy() {
    this.saveSession();
    for (const unsub of this._unsubscribers) unsub();
    if (this._fileChangeUnlisten) this._fileChangeUnlisten();
    if (this._updateInterval) clearInterval(this._updateInterval);
  }
}
