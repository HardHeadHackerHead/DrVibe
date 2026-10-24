// Dr. Vibe - Session Progress Tracker
// Aggregates session data: coding time, file changes, streak, timeline.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';
import { IS_DEV } from '../../core/config.js';
import { localDay } from '../../core/localDay.js';

// Normalize path separators and casing so Tauri watcher events and
// ClaudeCode synthetic events for the same file share one Set key.
function normalizePath(p) {
  if (!p) return p;
  // Strip Windows extended-path prefix (\\?\) that notify may emit
  p = p.replace(/^\\\\\?\\/, '');
  return p.replace(/\\/g, '/').toLowerCase();
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Before 2.0.1, every auto-save added the whole session again, so a long day
 * could record hundreds of hours. A day can't hold more than 24 h of coding;
 * days past that (or with file counts inflated the same way) are clamped.
 * Returns true if anything changed.
 */
export function repairHistory(history) {
  let changed = false;
  for (const day of history) {
    if (typeof day.codingSeconds === 'number' && day.codingSeconds > DAY_SECONDS) {
      // The inflation grows roughly with the square of the real time, so the
      // real figure is far below the cap; the square root of the recorded
      // total times one save interval (300 s) estimates it.
      day.codingSeconds = Math.min(DAY_SECONDS, Math.round(Math.sqrt(day.codingSeconds * 2 * 300)));
      changed = true;
    }
  }
  return changed;
}

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
    this._codingHourOfDay = new Array(24).fill(0); // Cumulative lifetime seconds per hour-of-day
    // What saveSession() has already added to today's history entry, so each
    // save adds only the new part (it runs every few minutes).
    this._saved = { codingSeconds: 0, filesCreated: 0, filesModified: 0 };
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
    // Coding time is driven by AI tool activity (Claude Code, etc.),
    // not by which app has window focus. When any AI session is actively
    // producing events, the clock ticks. No free points for leaving an
    // IDE open — only real vibe coding counts.
    this._unsubscribers.push(
      eventBus.on(Events.CLAUDE_CODE_ACTIVE, () => {
        if (this.codingStartedAt === null) {
          this.codingStartedAt = Date.now();
          this._addTimelineEvent('coding');
        }
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.CLAUDE_CODE_IDLE, () => {
        if (this.codingStartedAt !== null) {
          const started = this.codingStartedAt;
          const now = Date.now();
          this.codingSeconds += Math.floor((now - started) / 1000);
          this._accumulateCodingHours(started, now);
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
    // Normalize so Tauri watcher events (backslash) and ClaudeCode
    // synthetic events (forward slash) for the same file share one key.
    const path = normalizePath(event.path);

    if (event.event_type === 'delete') return;

    // Skip non-file synthetic keys (e.g. `cmd:<session>:<ts>` from older
    // momentum-pulse code paths). These aren't real files and shouldn't
    // show up in recentFiles or filesCreated/Modified counts.
    if (!path || path.startsWith('cmd:')) return;

    // Only trust "create" from sources that can reliably distinguish new
    // files from modifications. The Tauri file watcher (notify) reports
    // atomic saves (delete+create) and rename-based writes as "create" on
    // Windows, making every save look like a new file. Only the Claude
    // Code tracker knows the actual intent (Write to new file vs. Edit).
    const isCreate = event.event_type === 'create' && event.source === 'claude_code';

    if (isCreate) {
      this.filesCreated.add(path);
    } else {
      if (!this.filesCreated.has(path)) {
        this.filesModified.add(path);
      }
    }

    // Track recent files in recency order (most recent first, capped at 5)
    const idx = this.recentFiles.indexOf(path);
    if (idx !== -1) this.recentFiles.splice(idx, 1);
    this.recentFiles.unshift(path);
    if (this.recentFiles.length > 5) this.recentFiles.length = 5;

    eventBus.emit(Events.SESSION_STATS_UPDATED, this.getStats());
  }

  _addTimelineEvent(type) {
    this.timeline.push({ type, time: Date.now() });
  }

  // Distribute a coding interval across the 24 hour-of-day buckets
  _accumulateCodingHours(startMs, endMs) {
    let cur = startMs;
    while (cur < endMs) {
      const hour = new Date(cur).getHours();
      const nextHourStart = new Date(cur);
      nextHourStart.setHours(hour + 1, 0, 0, 0);
      const chunkEnd = Math.min(nextHourStart.getTime(), endMs);
      this._codingHourOfDay[hour] += Math.floor((chunkEnd - cur) / 1000);
      cur = chunkEnd;
    }
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

  getCodingHourOfDay() {
    const buckets = [...this._codingHourOfDay];
    if (this.codingStartedAt !== null) {
      let cur = this.codingStartedAt;
      const now = Date.now();
      while (cur < now) {
        const hour = new Date(cur).getHours();
        const nextHourStart = new Date(cur);
        nextHourStart.setHours(hour + 1, 0, 0, 0);
        const chunkEnd = Math.min(nextHourStart.getTime(), now);
        buckets[hour] += Math.floor((chunkEnd - cur) / 1000);
        cur = chunkEnd;
      }
    }
    return buckets;
  }

  // --- Persistence ---

  _loadStore() {
    const saved = db.getSection('session');
    if (saved) {
      const history = saved.history || [];
      if (repairHistory(history)) db.setSection('session', { ...saved, history });
      this.streak = this._computeStreak(history);
      if (Array.isArray(saved.recentFiles)) {
        this.recentFiles = saved.recentFiles;
      }
    }

    const savedHours = db.getSection('codingHourOfDay');
    if (Array.isArray(savedHours) && savedHours.length === 24) {
      this._codingHourOfDay = savedHours;
    }
  }

  _computeStreak(history) {
    if (!history || history.length === 0) return 0;

    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    const today = localDay();
    let streak = 0;
    let checkDate = new Date();

    // If no entry for today, start checking from yesterday
    if (sorted[0].date !== today) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const dateStr = localDay(checkDate);
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
    const today = localDay();
    const total = this.getCodingSeconds();
    if (total === 0) return;
    // Only what this session added since the last save.
    const codingSecs = Math.max(0, total - this._saved.codingSeconds);
    const createdNew = Math.max(0, this.filesCreated.size - this._saved.filesCreated);
    const modifiedNew = Math.max(0, this.filesModified.size - this._saved.filesModified);
    this._saved = { codingSeconds: total, filesCreated: this.filesCreated.size, filesModified: this.filesModified.size };

    let history = this._getSessionHistory();
    const existing = history.find(h => h.date === today);

    // Calculate this session's duration for longest-session tracking
    const sessionDuration = Math.floor((Date.now() - this.sessionStart) / 1000);

    if (existing) {
      existing.codingSeconds = Math.min(DAY_SECONDS, existing.codingSeconds + codingSecs);
      existing.filesCreated = (existing.filesCreated || 0) + createdNew;
      existing.filesModified = (existing.filesModified || 0) + modifiedNew;
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
        codingSeconds: Math.min(DAY_SECONDS, codingSecs),
        filesCreated: createdNew,
        filesModified: modifiedNew,
        longestSessionSeconds: sessionDuration,
        projects,
      });
    }

    // Keep last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = localDay(cutoff);
    history = history.filter(h => h.date >= cutoffStr);

    db.setSection('session', { history, recentFiles: this.recentFiles });
    db.setSection('codingHourOfDay', this._codingHourOfDay);
    await db.saveNow();

    this.streak = this._computeStreak(history);
  }

  async getSessionHistory() {
    return this._getSessionHistory();
  }

  _startPeriodicUpdate() {
    // Emit updated stats every 30 seconds.
    // Auto-save: every tick (30s) in dev to survive hot-reloads, every 5 min in prod.
    const saveTicks = IS_DEV ? 1 : 10;
    let saveCounter = 0;
    this._updateInterval = setInterval(() => {
      eventBus.emit(Events.SESSION_STATS_UPDATED, this.getStats());
      saveCounter++;
      if (saveCounter >= saveTicks) {
        saveCounter = 0;
        this.saveSession();
      }
    }, 30000);
  }

  async destroy() {
    await this.saveSession();
    for (const unsub of this._unsubscribers) unsub();
    if (this._fileChangeUnlisten) this._fileChangeUnlisten();
    if (this._updateInterval) clearInterval(this._updateInterval);
  }
}
