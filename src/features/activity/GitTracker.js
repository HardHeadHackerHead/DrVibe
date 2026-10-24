// Dr. Vibe - Git Tracker (Multi-Repo Watchlist)
// Monitors ALL known git repos for commits, branch changes, and uncommitted work.
// Polls discovered repos on a two-tier schedule (active vs idle) and fires
// escalating commit reminders for any repo with stale uncommitted changes.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';

// How long to wait before re-sending a reminder at each urgency level.
const REMINDER_COOLDOWNS = {
  gentle:    20 * 60 * 1000, // re-remind every 20 min while still gentle
  urgent:    15 * 60 * 1000, // re-remind every 15 min while urgent
  emergency:  5 * 60 * 1000, // re-remind every 5 min while emergency
};

// Minimum time between any two reminder events (across all repos).
const GLOBAL_REMINDER_COOLDOWN_MS = 5 * 60 * 1000;

// Active tier tick interval (polls one or more active repos per tick).
const ACTIVE_TICK_MS = 15_000;

// Idle tier tick interval (polls one idle repo per tick).
const IDLE_TICK_MS = 60_000;

// Remove a repo from the watchlist after this many consecutive poll failures.
const MAX_CONSECUTIVE_FAILURES = 5;

// How many repos to seed in parallel during initial population.
const SEED_BATCH_SIZE = 3;

// ---- Per-repo state ----

// How long since the last user activity before a repo is considered stale.
// Reminders are suppressed for repos with no activity within this window.
const ACTIVITY_STALE_MS = 60 * 60 * 1000; // 1 hour

class RepoState {
  constructor(path, name) {
    this.path = path;
    this.name = name;
    this.tier = 'idle';               // 'active' | 'idle'

    // Git state
    this.lastCommitHash = null;
    this.currentBranch = null;
    this.uncommittedCount = 0;
    this.lastCommitTime = null;       // Date

    // Reminder state (per-repo)
    this.lastReminderTime = null;
    this.lastReminderUrgency = null;
    this.snoozedUntil = null;

    // Activity tracking — when the user last actually worked on this repo.
    // Updated when: project detected, uncommitted count increases, file changes.
    this.lastActivityTime = null;

    // Lifecycle
    this.lastPollTime = 0;
    this.consecutiveFailures = 0;
    this.seeded = false;              // Has the initial silent poll completed?
  }
}

// ---- Main tracker ----

export class GitTracker {
  constructor(settings) {
    this.settings = settings;
    this._watchlist = new Map();       // normalized path → RepoState
    this._currentProjectPath = null;   // The IDE's active project (for tier promotion)
    this._unsubscribers = [];

    // Polling timers
    this._activeTierTimer = null;
    this._idleTierTimer = null;
    this._activeIndex = 0;
    this._idleIndex = 0;

    // Global reminder cooldown
    this._lastGlobalReminderTime = null;

    // Track whether we've done the initial seed
    this._seededFromScanner = false;
  }

  // ---- Setting helpers ----

  _isEnabled() {
    return this.settings?.get('gitTrackingEnabled') !== false;
  }

  _pollIntervalMs() {
    const minutes = this.settings?.get('gitPollIntervalMinutes') || 1;
    return minutes * 60 * 1000;
  }

  _reminderEnabled() {
    return this.settings?.get('gitCommitRemindersEnabled') !== false;
  }

  _gentleThresholdMs() {
    const minutes = this.settings?.get('gitReminderThresholdMinutes') || 30;
    return minutes * 60 * 1000;
  }

  _urgentThresholdMs() {
    return this._gentleThresholdMs() * 2;
  }

  _emergencyThresholdMs() {
    return this._gentleThresholdMs() * 3;
  }

  _minChanges() {
    return this.settings?.get('gitReminderMinChanges') || 3;
  }

  // ---- Watchlist management ----

  _normalizePath(p) {
    // Normalize slashes for consistent Map keys (Windows forward-slash compat)
    return p.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  _addToWatchlist(path, name) {
    if (!path) return;
    const key = this._normalizePath(path);
    if (this._watchlist.has(key)) return;

    this._watchlist.set(key, new RepoState(key, name));
    console.log(`GitTracker: added "${name}" to watchlist (${this._watchlist.size} repos)`);
  }

  _promoteToActive(path) {
    const key = this._normalizePath(path);
    const repo = this._watchlist.get(key);
    if (repo && repo.tier !== 'active') {
      repo.tier = 'active';
    }
  }

  /**
   * Populate the watchlist from an array of discovered projects.
   * Called from app.js after init, and also from the PROJECTS_DISCOVERED event.
   */
  populateFromProjects(projects) {
    if (!projects) return;
    for (const project of projects) {
      if (project.markers_found?.includes('.git')) {
        this._addToWatchlist(project.path, project.name);
      }
    }
    if (!this._seededFromScanner && this._watchlist.size > 0) {
      this._seededFromScanner = true;
      this._seedAllRepos();
      this._ensureIdleTierRunning();
    }
  }

  // ---- Urgency helpers ----

  _getUrgency(msElapsed) {
    if (msElapsed >= this._emergencyThresholdMs()) return 'emergency';
    if (msElapsed >= this._urgentThresholdMs())    return 'urgent';
    if (msElapsed >= this._gentleThresholdMs())    return 'gentle';
    return null;
  }

  // ---- Multi-repo reminder system ----

  _checkReminders() {
    if (!this._reminderEnabled()) return;

    // Global cooldown: avoid rapid-fire reminders across repos
    if (this._lastGlobalReminderTime &&
        Date.now() - this._lastGlobalReminderTime < GLOBAL_REMINDER_COOLDOWN_MS) {
      return;
    }

    const minChanges = this._minChanges();
    const now = Date.now();
    let worstRepo = null;
    let worstElapsed = 0;

    for (const repo of this._watchlist.values()) {
      if (!repo.uncommittedCount || repo.uncommittedCount < minChanges) continue;
      if (!repo.lastCommitTime) continue;
      if (repo.snoozedUntil && now < repo.snoozedUntil) continue;

      // Only remind for repos the user has actively worked on recently.
      // Stale repos with old uncommitted changes are left alone.
      if (!repo.lastActivityTime || now - repo.lastActivityTime > ACTIVITY_STALE_MS) continue;

      const elapsed = now - repo.lastCommitTime.getTime();
      const urgency = this._getUrgency(elapsed);
      if (!urgency) continue;

      // Per-repo cooldown
      if (repo.lastReminderTime) {
        const sinceLast = now - repo.lastReminderTime;
        if (sinceLast < REMINDER_COOLDOWNS[urgency]) continue;
      }

      if (elapsed > worstElapsed) {
        worstElapsed = elapsed;
        worstRepo = repo;
      }
    }

    if (!worstRepo) return;

    const urgency = this._getUrgency(worstElapsed);
    const minutesSince = Math.floor(worstElapsed / 60000);

    worstRepo.lastReminderTime = Date.now();
    worstRepo.lastReminderUrgency = urgency;
    this._lastGlobalReminderTime = Date.now();

    eventBus.emit(Events.GIT_COMMIT_REMINDER, {
      urgency,
      minutesSince,
      changedFiles: worstRepo.uncommittedCount,
      project: worstRepo.name,
      repoPath: worstRepo.path,
    });
  }

  /**
   * Snooze reminders. If repoPath is given, only that repo is snoozed.
   * Otherwise snooze all repos (global snooze).
   */
  snoozeReminders(minutes = 30, repoPath = null) {
    const until = Date.now() + minutes * 60 * 1000;

    if (repoPath) {
      const key = this._normalizePath(repoPath);
      const repo = this._watchlist.get(key);
      if (repo) {
        repo.snoozedUntil = until;
        console.log(`GitTracker: "${repo.name}" snoozed for ${minutes} min`);
      }
    } else {
      for (const repo of this._watchlist.values()) {
        repo.snoozedUntil = until;
      }
      console.log(`GitTracker: all repos snoozed for ${minutes} min`);
    }
  }

  // ---- Per-repo polling ----

  async _pollRepo(repo, silent = false) {
    let info;
    try {
      info = await tauri.getGitInfo(repo.path);
    } catch {
      info = null;
    }

    if (!info) {
      repo.consecutiveFailures++;
      if (repo.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`GitTracker: removing "${repo.name}" after ${MAX_CONSECUTIVE_FAILURES} failures`);
        this._watchlist.delete(repo.path);
      }
      return;
    }

    repo.consecutiveFailures = 0;
    repo.lastPollTime = Date.now();

    // Update uncommitted count — detect new work being done
    const prevUncommitted = repo.uncommittedCount;
    repo.uncommittedCount = info.uncommitted_count ?? (info.has_uncommitted_changes ? 1 : 0);
    if (repo.uncommittedCount > prevUncommitted && repo.seeded) {
      repo.lastActivityTime = Date.now();
    }

    // Update last commit time
    if (info.recent_commits[0]?.timestamp) {
      const commitDate = new Date(info.recent_commits[0].timestamp);
      if (!isNaN(commitDate.getTime())) {
        repo.lastCommitTime = commitDate;
      }
    }

    const latestHash = info.recent_commits[0]?.hash;

    // Detect events only after the initial seed poll
    if (!silent && repo.seeded) {
      // New commit detected
      if (repo.lastCommitHash && latestHash && latestHash !== repo.lastCommitHash) {
        // Always emitted: achievements, VP and reactions count commits. The
        // notification setting only gates the speech bubble (app.js).
        eventBus.emit(Events.GIT_COMMIT_MADE, {
          commit: info.recent_commits[0],
          project: info.repo_name,
          branch: info.branch,
          repoPath: repo.path,
        });
        // Reset reminder state for this repo
        repo.lastReminderTime = null;
        repo.lastReminderUrgency = null;
        repo.snoozedUntil = null;
      }

      // Branch change detected
      if (repo.currentBranch && info.branch !== repo.currentBranch) {
        eventBus.emit(Events.GIT_BRANCH_CHANGED, {
          from: repo.currentBranch,
          to: info.branch,
          project: info.repo_name,
          repoPath: repo.path,
        });
      }
    }

    // Store state
    if (latestHash) repo.lastCommitHash = latestHash;
    repo.currentBranch = info.branch;
    repo.seeded = true;

    // Tier promotion: idle → active only when new work is being done
    // (uncommitted count increased), not for old stale changes.
    if (repo.tier === 'idle' && repo.uncommittedCount > prevUncommitted && repo.seeded) {
      repo.tier = 'active';
    }

    // Tier demotion: active → idle when clean and not the current project,
    // or when the repo has had no recent activity.
    const currentKey = this._currentProjectPath ? this._normalizePath(this._currentProjectPath) : null;
    const isStale = repo.lastActivityTime && Date.now() - repo.lastActivityTime > ACTIVITY_STALE_MS;
    if (repo.tier === 'active' && repo.path !== currentKey &&
        (repo.uncommittedCount === 0 || isStale)) {
      repo.tier = 'idle';
    }

    // Emit full status for dashboard / listeners
    eventBus.emit(Events.GIT_STATUS_UPDATED, {
      ...info,
      watchedRepo: repo.path,
    });
  }

  // ---- Two-tier polling engine ----

  _reposByTier(tier) {
    return [...this._watchlist.values()].filter(r => r.tier === tier);
  }

  _tickActiveTier() {
    const activeRepos = this._reposByTier('active');
    if (activeRepos.length === 0) return;

    // Calculate how many repos to poll this tick so each active repo
    // is polled approximately once per _pollIntervalMs.
    const targetMs = this._pollIntervalMs();
    const reposPerTick = Math.max(1, Math.ceil(activeRepos.length * ACTIVE_TICK_MS / targetMs));

    for (let i = 0; i < reposPerTick && i < activeRepos.length; i++) {
      const repo = activeRepos[this._activeIndex % activeRepos.length];
      this._activeIndex++;
      this._pollRepo(repo).then(() => this._checkReminders());
    }
  }

  _tickIdleTier() {
    const idleRepos = this._reposByTier('idle');
    if (idleRepos.length === 0) return;

    const repo = idleRepos[this._idleIndex % idleRepos.length];
    this._idleIndex++;
    this._pollRepo(repo);
  }

  _startActiveTier() {
    this._stopActiveTier();
    if (!this._isEnabled()) return;
    this._activeIndex = 0;
    this._activeTierTimer = setInterval(() => this._tickActiveTier(), ACTIVE_TICK_MS);
    // Immediate first tick
    this._tickActiveTier();
  }

  _stopActiveTier() {
    if (this._activeTierTimer) {
      clearInterval(this._activeTierTimer);
      this._activeTierTimer = null;
    }
  }

  _ensureIdleTierRunning() {
    if (this._idleTierTimer) return;
    if (!this._isEnabled()) return;
    this._idleIndex = 0;
    this._idleTierTimer = setInterval(() => this._tickIdleTier(), IDLE_TICK_MS);
  }

  _stopAllPolling() {
    this._stopActiveTier();
    if (this._idleTierTimer) {
      clearInterval(this._idleTierTimer);
      this._idleTierTimer = null;
    }
  }

  // ---- Seeding ----

  async _seedAllRepos() {
    const unseeded = [...this._watchlist.values()].filter(r => !r.seeded);
    if (unseeded.length === 0) return;

    console.log(`GitTracker: seeding ${unseeded.length} repos...`);

    for (let i = 0; i < unseeded.length; i += SEED_BATCH_SIZE) {
      const batch = unseeded.slice(i, i + SEED_BATCH_SIZE);
      await Promise.all(batch.map(repo => this._pollRepo(repo, true)));
    }

    console.log(`GitTracker: seeding complete, ${this._watchlist.size} repos tracked`);
  }

  // ---- Lifecycle ----

  init() {
    // Populate watchlist when FileSystemScanner reports discovered projects
    this._unsubscribers.push(
      eventBus.on(Events.PROJECTS_DISCOVERED, ({ projects }) => {
        this.populateFromProjects(projects);
      })
    );

    // Add repos dynamically from project detection (Claude Code sessions, IDE, etc.)
    this._unsubscribers.push(
      eventBus.on(Events.PROJECT_DETECTED, (project) => {
        if (project.path) {
          this._currentProjectPath = project.path;
          this._addToWatchlist(project.path, project.name);
          this._promoteToActive(project.path);

          // Mark as recently active — the user is working on this now
          const key = this._normalizePath(project.path);
          const repo = this._watchlist.get(key);
          if (repo) {
            repo.lastActivityTime = Date.now();
            if (!repo.seeded) this._pollRepo(repo, true);
          }
        }
      })
    );

    // Start/stop active-tier polling with coding activity
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        if (this._isEnabled()) this._startActiveTier();
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
        this._stopActiveTier();
      })
    );

    // React to settings changes
    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'gitTrackingEnabled') {
          if (value) {
            this._ensureIdleTierRunning();
          } else {
            this._stopAllPolling();
          }
        }
        if (key === 'gitPollIntervalMinutes' && this._activeTierTimer) {
          this._startActiveTier();
        }
      })
    );

    console.log('GitTracker initialized (multi-repo watchlist)');
  }

  destroy() {
    this._stopAllPolling();
    for (const unsub of this._unsubscribers) unsub();
  }

  // ---- Public API ----

  getWatchlist() {
    return [...this._watchlist.values()].map(r => ({
      name: r.name,
      path: r.path,
      tier: r.tier,
      uncommittedCount: r.uncommittedCount,
      lastCommitTime: r.lastCommitTime,
    }));
  }

  getRepoState(path) {
    const key = this._normalizePath(path);
    return this._watchlist.get(key) || null;
  }
}
