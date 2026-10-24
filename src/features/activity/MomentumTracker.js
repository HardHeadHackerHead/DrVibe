// Dr. Vibe - Momentum Tracker
// Tracks coding momentum based on unique file activity.
// Produces a 0-100 score using a weighted, per-file freshness model.
//
// Each unique file gets exactly one slot in the active-file Map.
// Re-touching the same file refreshes its timestamp but does NOT add a
// new entry or inflate the count.  Files that haven't been touched for
// WINDOW_MS are automatically pruned — the bar cools off on its own.
//
// Three input sources:
//   1. Tauri file watcher  — watches the working trees of the tracked repos
//      (TrackedRepos: the repos Claude Code works in and the user's folders).
//   2. 'file-changed-synthetic' eventBus event — emitted by ClaudeCodeTracker
//      for every file Claude Code touches (reads, writes) regardless of
//      whether the Tauri watcher is running.
//   3. AntiGravity / Cursor activity (future: direct hook events)

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { repoKey } from './repoPaths.js';

// Scoring weights per event type (applied once per unique file slot)
const WEIGHTS = {
  create: 3,
  modify: 2,
  delete: 1,
  read: 1,
};

// Momentum levels with thresholds
const LEVELS = [
  { name: 'cold',    min: 0,  max: 20  },
  { name: 'warming', min: 21, max: 40  },
  { name: 'flowing', min: 41, max: 60  },
  { name: 'hot',     min: 61, max: 80  },
  { name: 'fire',    min: 81, max: 100 },
];

// How long a file stays "active" before it cools off (5 minutes)
const WINDOW_MS = 5 * 60 * 1000;

// How often to prune expired files and recalculate
const TICK_MS = 2000;

// Score needed for 100% momentum (tuned so steady editing hits it)
const MAX_SCORE = 60;

// Normalize paths so Windows backslash and forward-slash variants of
// the same file are treated as the same key, preventing double-counts
// when the Tauri watcher and ClaudeCode synthetic events both fire.
// Also collapses any double-backslash leakage from older hook versions.
function normalizePath(p) {
  if (!p) return p;
  return p.replace(/\\+/g, '/').replace(/\/+/g, '/').toLowerCase();
}

// Paths we never want feeding momentum even if Claude reads them. Anything
// inside a dotfile directory (.git, .next, .cache, .claude, .dr-vibe,
// .github, .quadflow, .vscode, .idea, ...) is config/build/tool state, not
// user work — one rule covers them all and stays future-proof. Plus a
// handful of well-known non-dotfile noise dirs.
const DOTFOLDER_RX = /\/\.[^/]+\//;
const PATH_BLOCKLIST = [
  '/appdata/',
  '/node_modules/',
  '/target/debug/',
  '/target/release/',
];

function isBlocklisted(normalizedPath) {
  if (!normalizedPath) return false;
  if (DOTFOLDER_RX.test(normalizedPath)) return true;
  for (const seg of PATH_BLOCKLIST) {
    if (normalizedPath.includes(seg)) return true;
  }
  return false;
}

// Concurrent-session multipliers: running multiple AI sessions at once
// boosts momentum to reward parallel vibe coding.
const SESSION_MULTIPLIERS = {
  1: 1.0,   // single session — normal
  2: 1.5,   // two sessions — 50% boost
  3: 2.0,   // three+ sessions — double
};

function getSessionMultiplier(count) {
  if (count <= 1) return 1.0;
  if (count === 2) return SESSION_MULTIPLIERS[2];
  return SESSION_MULTIPLIERS[3];
}

export class MomentumTracker {
  constructor(repos = []) {
    this._initialRepos = repos;

    // Map<normalizedPath, { timestamp, weight }>
    // One entry per unique file. Re-touching refreshes timestamp, never
    // inflates the count.
    this.activeFiles = new Map();

    this.momentum = 0;
    this.level = 'cold';
    this.tickInterval = null;
    this.unlistenFile = null;
    this.unsubRepos = null;
    this.unsubSynthetic = null;
    this.unsubSessions = null;
    this.watched = new Map();   // repoKey → working tree path
    this._watching = Promise.resolve();
    this._concurrentSessions = 0;
  }

  async init() {
    // --- Source 1: Tauri file watcher events ---
    if (tauri.isAvailable) {
      this.unlistenFile = await tauri.onFileChanged((event) => {
        this.onFileChange(event);
      });
    }

    // Watch the tracked repos now and whenever the list changes
    this.unsubRepos = eventBus.on(Events.REPOS_CHANGED, ({ repos }) => {
      this.watchRepos(repos);
    });
    await this.watchRepos(this._initialRepos);

    // --- Source 2: Synthetic events from ClaudeCodeTracker ---
    this.unsubSynthetic = eventBus.on('file-changed-synthetic', (event) => {
      this.onFileChange(event);
    });

    // --- Source 3: Non-file activity pulses (bash commands, etc.) ---
    // Routed on a dedicated channel so file-only consumers (SessionTracker,
    // SkillTracker) don't see synthetic non-path keys leak into their UIs.
    this.unsubPulse = eventBus.on('momentum-pulse', ({ key, weight, timestamp }) => {
      this.onActivityPulse(key, weight ?? 1, timestamp ?? Date.now());
    });

    // --- Concurrent session boost ---
    this.unsubSessions = eventBus.on(Events.CLAUDE_CODE_SESSIONS_CHANGED, ({ count }) => {
      this._concurrentSessions = count;
      this.recalculate(); // re-score immediately with new multiplier
    });

    // Start the tick loop for decay and pruning
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);

    console.log('MomentumTracker initialized');
  }

  destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.unlistenFile) {
      Promise.resolve(this.unlistenFile).then(fn => {
        if (typeof fn === 'function') fn();
      });
      this.unlistenFile = null;
    }
    if (this.unsubRepos) {
      this.unsubRepos();
      this.unsubRepos = null;
    }
    if (this.unsubSynthetic) {
      this.unsubSynthetic();
      this.unsubSynthetic = null;
    }
    if (this.unsubPulse) {
      this.unsubPulse();
      this.unsubPulse = null;
    }
    if (this.unsubSessions) {
      this.unsubSessions();
      this.unsubSessions = null;
    }
    tauri.stopWatching();
  }

  /**
   * Watches every working tree of `repos` ({ path, worktrees }). The watcher
   * can't drop a single folder, so it restarts when one leaves the list.
   */
  watchRepos(repos) {
    this._watching = this._watching.then(() => this._syncWatched(repos || []));
    return this._watching;
  }

  async _syncWatched(repos) {
    if (!tauri.isAvailable) return;
    const paths = repos.flatMap(r => (r.worktrees?.length ? r.worktrees : [r.path])).filter(Boolean);
    const keys = new Set(paths.map(repoKey));
    if ([...this.watched.keys()].some(k => !keys.has(k))) {
      await tauri.stopWatching();
      this.watched.clear();
    }
    for (const path of paths) {
      const key = repoKey(path);
      if (this.watched.has(key)) continue;
      if (await tauri.startWatching(path)) {
        this.watched.set(key, path);
        console.log(`MomentumTracker watching: ${path}`);
      }
    }
  }

  // Non-file activity (bash commands, etc). Stored under a synthetic key
  // that's never shown in any file UI because it doesn't go through the
  // file-event channel.
  onActivityPulse(key, weight, ts) {
    const existing = this.activeFiles.get(key);
    if (existing) {
      existing.timestamp = ts;
      existing.weight = Math.max(existing.weight, weight);
    } else {
      this.activeFiles.set(key, { timestamp: ts, weight });
    }
    this.recalculate();
  }

  onFileChange(event) {
    const { event_type, path, timestamp } = event;
    const weight = WEIGHTS[event_type] ?? 1;
    const ts = timestamp || Date.now();
    const key = normalizePath(path);
    if (isBlocklisted(key)) {
      // Silently drop Claude Code's own session-log reads, AppData noise, etc.
      return;
    }

    // Upsert: re-touching a file refreshes its timestamp so it stays
    // active, but does NOT add a new entry. The count only grows when
    // a genuinely new file is touched. Weight keeps the highest seen
    // (create > modify > read).
    const existing = this.activeFiles.get(key);
    if (existing) {
      existing.timestamp = ts;
      existing.weight = Math.max(existing.weight, weight);
    } else {
      this.activeFiles.set(key, { timestamp: ts, weight });
    }

    // Immediately recalculate on new event for responsiveness
    this.recalculate();
  }

  tick() {
    this.pruneOldFiles();
    this.recalculate();
  }

  pruneOldFiles() {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [path, info] of this.activeFiles) {
      if (info.timestamp < cutoff) {
        this.activeFiles.delete(path);
      }
    }
  }

  recalculate() {
    const now = Date.now();
    let totalScore = 0;

    for (const [, info] of this.activeFiles) {
      const age = now - info.timestamp;
      const freshness = Math.max(0, 1 - age / WINDOW_MS);
      totalScore += info.weight * freshness;
    }

    // Bonus for touching multiple unique files (breadth of work)
    const fileBonus = Math.min(this.activeFiles.size * 0.5, 5);
    totalScore += fileBonus;

    // Concurrent session boost — running multiple AI sessions at once
    // amplifies momentum to reward parallel vibe coding
    const multiplier = getSessionMultiplier(this._concurrentSessions);
    totalScore *= multiplier;

    const newMomentum = Math.min(100, Math.round((totalScore / MAX_SCORE) * 100));

    if (newMomentum === this.momentum) return;

    this.momentum = newMomentum;
    const newLevel = this.getLevel(newMomentum);

    const levelChanged = newLevel !== this.level;
    const previousLevel = this.level;
    this.level = newLevel;

    eventBus.emit(Events.MOMENTUM_CHANGED, {
      momentum: this.momentum,
      level: this.level,
      filesActive: this.activeFiles.size,
      recentEvents: this.activeFiles.size,
      concurrentSessions: this._concurrentSessions,
      sessionMultiplier: getSessionMultiplier(this._concurrentSessions),
    });

    if (levelChanged) {
      eventBus.emit(Events.MOMENTUM_LEVEL_CHANGED, {
        previous: previousLevel,
        current: this.level,
        momentum: this.momentum,
      });
    }
  }

  getLevel(value) {
    for (const level of LEVELS) {
      if (value >= level.min && value <= level.max) {
        return level.name;
      }
    }
    return 'cold';
  }

  getState() {
    return {
      momentum: this.momentum,
      level: this.level,
      filesActive: this.activeFiles.size,
      recentEvents: this.activeFiles.size,
      watchedPaths: [...this.watched.values()],
      concurrentSessions: this._concurrentSessions,
      sessionMultiplier: getSessionMultiplier(this._concurrentSessions),
    };
  }
}
