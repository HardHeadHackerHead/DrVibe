// Dr. Vibe - Achievement System
// Tracks progress toward achievements and handles unlocks.

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';
import { ACHIEVEMENTS, MASTERY_TRACKS } from './AchievementDefinitions.js';
import { economyClient } from '../economy/EconomyClient.js';
import { localDay } from '../../core/localDay.js';

const MARATHON_MS = 4 * 60 * 60 * 1000; // 4 hours
const PERSISTENT_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const DEEP_WORK_SECONDS = 2 * 60 * 60; // 2 hours
const MASTERY_PATH_SECONDS = 25 * 60 * 60; // 25 hours

const DEFAULT_COMMUNITY_ACTIONS = {
  accountConnected: false,
  gallerySubmitted: false,
  skinInstalled: false,
};

const MASTERY_LEVEL_NAMES = ['Rookie', 'Builder', 'Adept', 'Expert', 'Master'];

/**
 * A short, one-way tag for a repo name: Multi-repo counts distinct repos
 * without the names being stored (sync sends only the count).
 */
export function repoTag(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name).toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export class AchievementSystem {
  constructor() {
    // { [id]: { unlocked: bool, unlockedAt: number|null, progress: number } }
    this.state = {};
    // Runtime tracking (not persisted as achievement state, but session-level)
    this.sessionStartTime = Date.now();
    this.codingStartTime = null;
    this.lastCodingStopTime = null;
    this.seenApps = new Set();
    this.isCoding = false;

    // Git tracking - persisted across sessions
    this.lifetimeCommitCount = 0;
    this.seenRepos = new Set(); // short hashes of repo names (never the names), for Multi-repo
    this.totalBranchSwitches = 0;
    this.commitDays = []; // YYYY-MM-DD strings for commit-streak tracking

    // Git tracking - session-only (reset when coding starts)
    this.sessionCommitCount = 0;
    this._sessionReminderFired = false;
    this._lastReminderTime = null;

    // Community tracking - persisted across sessions
    this.communityActions = { ...DEFAULT_COMMUNITY_ACTIONS };
    this.gallerySubmissions = new Set(); // unique skin slugs submitted
    this.installedCommunitySkins = new Set(); // unique skin slugs installed

    // Mastery tracks - persisted across sessions
    this.masteryState = {};
  }

  async init() {
    this.initState();
    this.load();
    this.setupEventListeners();

    // "Welcome to Dr. Vibe" — fires on the very first launch. The unlock is
    // a no-op on subsequent runs (already-unlocked guard in checkAndUnlock).
    // Server-side this is permissive; the ACHIEVEMENT_UNLOCKED uniqueKey
    // dedupe prevents a re-claim if the local state is ever wiped.
    this.checkAndUnlock('welcome_dr_vibe', 1);

    // "Hello World" - first session ever
    this.checkAndUnlock('hello_world', 1);

    // Check time-based achievements on init
    this.checkTimeAchievements();

    // Sync account/gallery history if already available locally
    this.syncCommunityFromStoredData();
    this.syncCommunityCatalyst();
  }

  initState() {
    for (const id of Object.keys(ACHIEVEMENTS)) {
      this.state[id] = { unlocked: false, unlockedAt: null, progress: 0 };
    }
    for (const id of Object.keys(MASTERY_TRACKS)) {
      this.masteryState[id] = { progress: 0, level: 0, lastLeveledAt: null };
    }
  }

  // --- Persistence ---

  load() {
    const saved = db.getSection('achievements');
    if (saved) {
      // Load per-achievement state
      if (saved.state) {
        for (const [id, val] of Object.entries(saved.state)) {
          if (this.state[id]) {
            this.state[id] = val;
          }
        }
      }

      // Load runtime counters
      this.streakDays = saved.streakData?.days || [];
      this.seenApps = new Set(saved.seenApps || []);

      // Git counters
      this.lifetimeCommitCount = saved.lifetimeCommitCount || 0;
      // Older saves kept the names; only a hash of each is kept now.
      this.seenRepos = new Set(saved.seenRepoKeys || (saved.seenRepos || []).map(repoTag));
      this.totalBranchSwitches = saved.totalBranchSwitches || 0;
      this.commitDays = saved.commitDays || [];

      // Community counters
      this.gallerySubmissions = new Set(saved.gallerySubmissions || []);
      this.installedCommunitySkins = new Set(saved.installedCommunitySkins || []);
      this.communityActions = {
        ...DEFAULT_COMMUNITY_ACTIONS,
        ...(saved.communityActions || {}),
      };

      // Mastery tracks
      if (saved.masteryState) {
        for (const [id, val] of Object.entries(saved.masteryState)) {
          if (this.masteryState[id]) this.masteryState[id] = val;
        }
      }

      console.log('Achievements loaded from database');
    } else {
      this.streakDays = [];
      console.log('Achievements: no saved data, using defaults');
    }
  }

  save() {
    db.setSection('achievements', {
      state: this.state,
      streakData: { days: this.streakDays },
      seenApps: [...this.seenApps],
      lifetimeCommitCount: this.lifetimeCommitCount,
      seenRepoKeys: [...this.seenRepos],
      seenRepoCount: this.seenRepos.size,
      totalBranchSwitches: this.totalBranchSwitches,
      commitDays: this.commitDays,
      gallerySubmissions: [...this.gallerySubmissions],
      installedCommunitySkins: [...this.installedCommunitySkins],
      communityActions: this.communityActions,
      masteryState: this.masteryState,
    });
  }

  // --- Event Listeners ---

  setupEventListeners() {
    // Track work session completions
    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      this.incrementProgress('century');
      this.incrementProgress('pomodoro_pilot');
      this.incrementMastery('timer_mastery');
    });

    // Track break completions
    eventBus.on(Events.TIMER_BREAK_COMPLETE, () => {
      this.incrementProgress('break_balancer');
      this.incrementMastery('wellness_mastery');
    });

    // Track coding activity start
    eventBus.on(Events.ACTIVITY_CODING_START, ({ appName }) => {
      this.isCoding = true;
      this.sessionStartTime = Date.now();
      this.codingStartTime = Date.now();

      // Track app for "Polyglot"
      if (appName) {
        this.seenApps.add(appName.toLowerCase());
        this.setProgressIfHigher('polyglot', this.seenApps.size);
      }

      // Check time-based achievements
      this.checkTimeAchievements();

      // "Persistent" - returned after 30+ min idle
      if (this.lastCodingStopTime) {
        const idleTime = Date.now() - this.lastCodingStopTime;
        if (idleTime >= PERSISTENT_IDLE_MS) {
          this.checkAndUnlock('persistent', 1);
        }
      }

      // Record today for streak tracking
      this.recordCodingDay();

      // Reset per-session git counters
      this.sessionCommitCount = 0;
      this._sessionReminderFired = false;
      this._lastReminderTime = null;
    });

    // Track coding stop
    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      this.isCoding = false;
      this.lastCodingStopTime = Date.now();

      // "Self-Disciplined" - committed 3+ times without a single reminder
      if (!this._sessionReminderFired && this.sessionCommitCount >= 3) {
        this.checkAndUnlock('self_disciplined', 1);
      }
    });

    // Session-based Ready Now achievements
    eventBus.on(Events.SESSION_STATS_UPDATED, (stats = {}) => {
      const codingSeconds = stats.codingSeconds || 0;
      const totalFiles = (stats.filesCreated || 0) + (stats.filesModified || 0);

      if (codingSeconds >= DEEP_WORK_SECONDS) {
        this.checkAndUnlock('deep_work', 1);
      }
      this.setProgressIfHigher('file_sculptor', totalFiles);
    });

    // Momentum achievements
    eventBus.on(Events.MOMENTUM_LEVEL_CHANGED, ({ current }) => {
      if (current === 'fire') {
        this.checkAndUnlock('flow_state', 1);
        this.incrementProgress('inferno_loop');
      }
    });

    // Focus mode achievements
    eventBus.on(Events.FOCUS_MODE_ENDED, ({ completed } = {}) => {
      if (!completed) return;
      this.checkAndUnlock('focus_initiate', 1);
      this.incrementProgress('zen_master');
      this.incrementMastery('timer_mastery');
    });

    // Wellness achievements
    eventBus.on(Events.EYE_STRAIN_COMPLETE, () => {
      this.incrementProgress('eye_care_hero');
      this.incrementMastery('wellness_mastery');
    });
    eventBus.on(Events.POSTURE_COMPLETE, () => {
      this.incrementProgress('posture_guardian');
      this.incrementMastery('wellness_mastery');
    });
    eventBus.on(Events.BOUNDARY_REMINDER_SENT, () => {
      this.incrementProgress('boundary_sentinel');
      this.incrementMastery('wellness_mastery');
    });

    // Skills achievements
    eventBus.on(Events.SKILL_UPDATED, (stats = {}) => {
      this.setProgressIfHigher('skill_collector', Object.keys(stats).length);
    });
    eventBus.on(Events.SKILL_MILESTONE, ({ milestone, totalSeconds } = {}) => {
      this.incrementProgress('milestone_hunter');
      this.incrementMastery('skills_mastery');
      const seconds = Number(totalSeconds) || this.milestoneLabelToSeconds(milestone);
      if (seconds >= MASTERY_PATH_SECONDS) {
        this.checkAndUnlock('mastery_path', 1);
      }
    });

    // Personal best achievements
    eventBus.on(Events.PERSONAL_BEST_SET, () => {
      this.incrementProgress('record_breaker');
    });

    // Community achievements
    eventBus.on(Events.COMMUNITY_ACCOUNT_CONNECTED, () => {
      this.checkAndUnlock('community_connected', 1);
      this.markCommunityAction('accountConnected');
      this.incrementMastery('community_mastery');
    });

    eventBus.on(Events.COMMUNITY_GALLERY_SUBMITTED, ({ slug } = {}) => {
      const normalized = this.normalizeSlug(slug);
      if (normalized) {
        this.gallerySubmissions.add(normalized);
        this.setProgressIfHigher('gallery_regular', this.gallerySubmissions.size);
      } else {
        this.incrementProgress('gallery_regular');
      }
      this.checkAndUnlock('gallery_debut', 1);
      this.markCommunityAction('gallerySubmitted');
      this.incrementMastery('community_mastery');
    });

    eventBus.on(Events.COMMUNITY_SKIN_INSTALLED, ({ slug } = {}) => {
      const normalized = this.normalizeSlug(slug);
      if (normalized) {
        this.installedCommunitySkins.add(normalized);
        this.setProgressIfHigher('skin_collector', this.installedCommunitySkins.size);
      } else {
        this.incrementProgress('skin_collector');
      }
      this.markCommunityAction('skinInstalled');
      this.incrementMastery('community_mastery');
    });

    // Git commit achievements
    eventBus.on(Events.GIT_COMMIT_MADE, ({ project }) => {
      // First commit Dr. Vibe ever sees
      this.checkAndUnlock('first_push', 1);

      // Lifetime commit counter
      this.lifetimeCommitCount++;
      this.setProgressIfHigher('commit_machine', this.lifetimeCommitCount);
      this.setProgressIfHigher('version_veteran', this.lifetimeCommitCount);
      this.incrementMastery('git_mastery');

      // Per-session counter - "Rapid Fire"
      this.sessionCommitCount++;
      this.setProgressIfHigher('rapid_fire', this.sessionCommitCount);

      // Multi-repo
      if (project) {
        this.seenRepos.add(repoTag(project));
        this.setProgressIfHigher('multi_repo', this.seenRepos.size);
      }

      // Commit-streak tracking
      this.recordCommitDay();

      // "Quick Draw" - committed within 5 min of a reminder
      if (this._lastReminderTime && Date.now() - this._lastReminderTime <= 5 * 60 * 1000) {
        this.checkAndUnlock('quick_draw', 1);
        this._lastReminderTime = null;
      }

      this.save();
    });

    // Branch-switch achievements
    eventBus.on(Events.GIT_BRANCH_CHANGED, () => {
      this.totalBranchSwitches++;
      this.setProgressIfHigher('branch_explorer', this.totalBranchSwitches);
      this.save();
    });

    // Track reminders for "Quick Draw" and "Self-Disciplined"
    eventBus.on(Events.GIT_COMMIT_REMINDER, () => {
      this._sessionReminderFired = true;
      this._lastReminderTime = Date.now();
    });
  }

  // --- Achievement Checking ---

  checkTimeAchievements() {
    const hour = new Date().getHours();

    // "Night Owl" - after midnight (0-4)
    if (hour >= 0 && hour < 5) {
      this.checkAndUnlock('night_owl', 1);
    }

    // "Early Bird" - before 7am (5-6)
    if (hour >= 5 && hour < 7) {
      this.checkAndUnlock('early_bird', 1);
    }
  }

  checkMarathon() {
    if (!this.codingStartTime || !this.isCoding) return;

    const elapsed = Date.now() - this.sessionStartTime;
    if (elapsed >= MARATHON_MS) {
      this.checkAndUnlock('marathon', 1);
    }
  }

  recordCodingDay() {
    const today = localDay(); // YYYY-MM-DD
    if (!this.streakDays.includes(today)) {
      this.streakDays.push(today);
      // Keep only last 60 days of data for long streak checks
      if (this.streakDays.length > 60) {
        this.streakDays = this.streakDays.slice(-60);
      }
    }

    // Check streak achievements
    const streak = this.calculateStreak();
    this.setProgressIfHigher('streak_spark', streak);
    this.setProgressIfHigher('dedicated', streak);
    this.setProgressIfHigher('streak_legend', streak);

    this.save();
  }

  calculateStreak() {
    if (this.streakDays.length === 0) return 0;

    const sorted = [...this.streakDays].sort().reverse();
    const today = localDay();

    // If today isn't in the list, check if yesterday is (streak may still be active)
    if (sorted[0] !== today) {
      const yesterday = localDay(new Date(Date.now() - 86400000));
      if (sorted[0] !== yesterday) return 0;
    }

    let streak = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = new Date(sorted[i]);
      const prev = new Date(sorted[i + 1]);
      const diffDays = (current - prev) / 86400000;

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  recordCommitDay() {
    const today = localDay();
    if (!this.commitDays.includes(today)) {
      this.commitDays.push(today);
      if (this.commitDays.length > 60) {
        this.commitDays = this.commitDays.slice(-60);
      }
    }
    const streak = this.calculateCommitStreak();
    this.setProgressIfHigher('daily_pusher', streak);
    this.setProgressIfHigher('commit_consistent', streak);
  }

  calculateCommitStreak() {
    if (this.commitDays.length === 0) return 0;
    const sorted = [...this.commitDays].sort().reverse();
    const today = localDay();
    if (sorted[0] !== today) {
      const yesterday = localDay(new Date(Date.now() - 86400000));
      if (sorted[0] !== yesterday) return 0;
    }
    let streak = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const diffDays = (new Date(sorted[i]) - new Date(sorted[i + 1])) / 86400000;
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  normalizeSlug(slug) {
    const value = String(slug || '').trim().toLowerCase();
    return value || null;
  }

  milestoneLabelToSeconds(milestoneLabel) {
    const text = String(milestoneLabel || '').toLowerCase();
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*hour/);
    if (!match) return 0;
    return Math.round(parseFloat(match[1]) * 3600);
  }

  markCommunityAction(actionKey) {
    if (!(actionKey in this.communityActions)) return;

    if (!this.communityActions[actionKey]) {
      this.communityActions[actionKey] = true;
      this.syncCommunityCatalyst();
      this.save();
    }
  }

  syncCommunityCatalyst() {
    const progress = Object.values(this.communityActions).filter(Boolean).length;
    this.setProgressIfHigher('community_catalyst', progress);
  }

  async syncCommunityFromStoredData() {
    // Profile is owned by Rust (token in OS keyring, username in Tauri store).
    // Read via the get_profile command instead of db.getSection('profile') —
    // the JS Database no longer mirrors profile data.
    try {
      const invoke = window.__TAURI__?.core?.invoke;
      const profile = invoke ? await invoke('get_profile') : null;
      if (profile?.linked) {
        this.checkAndUnlock('community_connected', 1);
        this.markCommunityAction('accountConnected');
      }
    } catch { /* ignore — achievement just won't unlock this run */ }

    if (typeof localStorage === 'undefined') return;
    try {
      const list = JSON.parse(localStorage.getItem('gallery_submitted') || '[]');
      if (!Array.isArray(list) || list.length === 0) return;

      for (const item of list) {
        const normalized = this.normalizeSlug(item);
        if (normalized) this.gallerySubmissions.add(normalized);
      }

      if (this.gallerySubmissions.size > 0) {
        this.checkAndUnlock('gallery_debut', 1);
        this.setProgressIfHigher('gallery_regular', this.gallerySubmissions.size);
        this.markCommunityAction('gallerySubmitted');
      }
    } catch (e) {
      // ignore malformed localStorage data
    }
  }

  // --- Core Unlock Logic ---

  checkAndUnlock(id, newProgress) {
    const def = ACHIEVEMENTS[id];
    const entry = this.state[id];
    if (!def || !entry || entry.unlocked) return;

    entry.progress = Math.min(newProgress, def.maxProgress);

    eventBus.emit(Events.ACHIEVEMENT_PROGRESS, {
      id,
      progress: entry.progress,
      maxProgress: def.maxProgress,
    });

    if (entry.progress >= def.maxProgress) {
      entry.unlocked = true;
      entry.unlockedAt = Date.now();
      this.onUnlock(id, def);
    }

    this.save();
  }

  setProgressIfHigher(id, progress) {
    const entry = this.state[id];
    if (!entry || entry.unlocked) return;
    if (progress <= entry.progress) return;
    this.checkAndUnlock(id, progress);
  }

  incrementProgress(id, amount = 1) {
    const entry = this.state[id];
    if (!entry || entry.unlocked) return;
    this.checkAndUnlock(id, entry.progress + amount);
  }

  incrementMastery(id, amount = 1) {
    const track = MASTERY_TRACKS[id];
    const state = this.masteryState[id];
    if (!track || !state) return;

    const nextProgress = Math.max(0, (state.progress || 0) + amount);
    this.setMasteryProgress(id, nextProgress);
  }

  setMasteryProgress(id, progress) {
    const track = MASTERY_TRACKS[id];
    const state = this.masteryState[id];
    if (!track || !state) return;

    const next = Math.max(0, progress);
    if (next <= state.progress) return;

    state.progress = next;
    this.emitMasteryProgress(id, track, state);
    this.checkMasteryLevelUps(id, track, state);
    this.save();
  }

  emitMasteryProgress(id, track, state) {
    const maxLevel = track.levels.length;
    const currentLevel = Math.max(0, state.level || 0);
    const nextThreshold = currentLevel < maxLevel ? track.levels[currentLevel] : null;

    eventBus.emit(Events.MASTERY_PROGRESS, {
      id,
      title: track.title,
      icon: track.icon,
      category: track.category,
      unit: track.unit,
      progress: state.progress,
      level: currentLevel,
      maxLevel,
      nextThreshold,
    });
  }

  checkMasteryLevelUps(id, track, state) {
    const oldLevel = Math.max(0, state.level || 0);
    let newLevel = 0;

    for (const threshold of track.levels) {
      if (state.progress >= threshold) newLevel++;
    }

    if (newLevel <= oldLevel) return;

    for (let level = oldLevel + 1; level <= newLevel; level++) {
      const threshold = track.levels[level - 1];
      const levelName = MASTERY_LEVEL_NAMES[level - 1] || `Level ${level}`;
      const isMajor = (track.majorLevels || []).includes(level);

      eventBus.emit(Events.MASTERY_LEVEL_UP, {
        id,
        title: track.title,
        icon: track.icon,
        category: track.category,
        unit: track.unit,
        level,
        levelName,
        maxLevel: track.levels.length,
        threshold,
        progress: state.progress,
        isMajor,
      });

      // Report to server-authoritative economy. Server re-verifies and the
      // uniqueKey index blocks double-claims.
      try {
        economyClient?.reportActivity?.('MASTERY_LEVEL_UP', { trackId: id, level });
      } catch (e) {
        // EconomyClient may not be initialized yet during early boot — noop.
      }
    }

    state.level = newLevel;
    state.lastLeveledAt = Date.now();
  }

  async onUnlock(id, def) {
    console.log(`Achievement unlocked: ${def.title}`);

    eventBus.emit(Events.ACHIEVEMENT_UNLOCKED, {
      id,
      title: def.title,
      description: def.description,
      icon: def.icon,
    });

    // Report to server-authoritative economy. Server re-verifies and the
    // uniqueKey index blocks double-claims.
    try {
      economyClient?.reportActivity?.('ACHIEVEMENT_UNLOCKED', { achievementId: id });
    } catch (e) {
      // EconomyClient may not be initialized yet during early boot — noop.
    }
  }

  // Called from game loop to check time-dependent achievements
  update() {
    this.checkMarathon();
  }

  // --- Public API ---

  getAll() {
    return Object.keys(ACHIEVEMENTS).map(id => ({
      ...ACHIEVEMENTS[id],
      ...this.state[id],
    }));
  }

  getUnlocked() {
    return this.getAll().filter(a => a.unlocked);
  }

  getProgress(id) {
    return this.state[id] || null;
  }

  destroy() {
    this.save();
  }

  getMasteryTracks() {
    return Object.keys(MASTERY_TRACKS).map((id) => {
      const def = MASTERY_TRACKS[id];
      const state = this.masteryState[id] || { progress: 0, level: 0, lastLeveledAt: null };
      const maxLevel = def.levels.length;
      const level = Math.max(0, state.level || 0);
      const nextThreshold = level < maxLevel ? def.levels[level] : null;
      const currentThreshold = level > 0 ? def.levels[level - 1] : 0;
      const range = nextThreshold === null ? 1 : Math.max(1, nextThreshold - currentThreshold);
      const inLevelProgress = nextThreshold === null
        ? 1
        : Math.min(1, Math.max(0, (state.progress - currentThreshold) / range));

      return {
        ...def,
        trackType: 'mastery',
        progress: state.progress,
        level,
        maxLevel,
        levelName: MASTERY_LEVEL_NAMES[Math.max(0, Math.min(level - 1, MASTERY_LEVEL_NAMES.length - 1))] || 'Rookie',
        nextThreshold,
        currentThreshold,
        levelProgress: inLevelProgress,
        isMaxLevel: level >= maxLevel,
        lastLeveledAt: state.lastLeveledAt,
      };
    });
  }
}
