// Dr. Vibe - Unified Database
// Single JSON file persistence layer with debounced saves and migration.

const DB_FILENAME = 'dr-vibe-data.json';
const DB_VERSION = 1;
const DEBOUNCE_MS = 2000;
const LOCALSTORAGE_KEY = 'dr-vibe-database';

// Old store filenames for migration
const OLD_STORES = {
  settings: 'settings.json',
  achievements: 'achievements.json',
  session: 'session.json',
  streak: 'streak.json',
  personalBest: 'personal-best.json',
  skills: 'skills.json',
  weeklySummary: 'weekly-summary.json',
  scanner: 'scanner.json',
};

// New sections with no old migration source — loaded from store if present.
// 'profile' is intentionally excluded: it's owned by Rust (auth-callback writes
// directly to the Tauri store, sync_profile reads from it). If JS loads it
// here, _flush would later overwrite Rust's fresh writes with stale in-memory
// data, silently logging the user out a few minutes after every sign-in.
export const NEW_SECTIONS = [
  'codingHourOfDay', 'setupWizard', 'companion', 'claudeCode',
  'privacy', 'economy', 'weeklyRecap', 'trackedRepos', 'serverStreak',
  // 2.0.x repo scan results: read once by repoMigration.js, then null
  'repoScan',
];

// Achievement IDs needed for migration (stored as top-level keys in old store)
const ACHIEVEMENT_IDS = [
  'hello_world', 'night_owl', 'early_bird', 'marathon',
  'dedicated', 'polyglot', 'century', 'persistent',
];

// All settings keys for flat-key migration
const SETTINGS_KEYS = [
  'workInterval', 'breakInterval', 'notificationsEnabled', 'position', 'codingApps',
  'breakMode', 'idleThresholdMinutes', 'longBreakInterval', 'longBreakMinutes',
  'breakHistory', 'boundaryAwarenessEnabled', 'hydrationEnabled', 'hydrationFrequency',
  'hydrationDailyCount', 'hydrationLastReset', 'learningResourcesEnabled',
  'encouragementEnabled', 'encouragementFrequency', 'eyeStrainEnabled',
  'postureReminderEnabled', 'postureFrequency', 'fatigueDetectionEnabled',
  'stuckDetectionEnabled', 'stuckThresholds', 'overworkPreventionEnabled',
  'focusModeDuration', 'focusModeEndTime', 'resumeSuggestionsEnabled', 'popupDuration',
];

// --- Lightweight Tauri Store wrapper using window.__TAURI__ globals ---
// The npm package @tauri-apps/plugin-store can't be imported in a non-bundled
// setup (live-server). Instead, we call the plugin IPC commands directly.

export class TauriStore {
  constructor(rid) {
    this.rid = rid;
  }

  static _invoke(...args) {
    return window.__TAURI__?.core?.invoke?.(...args);
  }

  static async load(path) {
    const rid = await TauriStore._invoke('plugin:store|load', { path });
    return new TauriStore(rid);
  }

  async get(key) {
    const result = await TauriStore._invoke('plugin:store|get', { rid: this.rid, key });
    if (!Array.isArray(result)) return undefined;
    const [value, exists] = result;
    return exists ? value : undefined;
  }

  async set(key, value) {
    await TauriStore._invoke('plugin:store|set', { rid: this.rid, key, value });
  }

  async save() {
    await TauriStore._invoke('plugin:store|save', { rid: this.rid });
  }
}

class Database {
  constructor() {
    this.store = null;
    this.data = {};
    this._dirty = false;
    this._saveTimer = null;
    this._initialized = false;
  }

  async init() {
    try {
      if (!window.__TAURI__?.core?.invoke) throw new Error('Tauri not available');
      this.store = await TauriStore.load(DB_FILENAME);

      const version = await this.store.get('_version');
      if (version === null || version === undefined) {
        await this._migrateFromOldStores();
      } else {
        await this._loadAll();
      }
      console.log('Database initialized (Tauri Store)');
    } catch (e) {
      console.log('Database: Tauri Store not available, using localStorage:', e.message || e);
      this._loadFromLocalStorage();
    }
    this._initialized = true;
  }

  // --- Section-level API ---

  getSection(section) {
    return this.data[section] ?? null;
  }

  setSection(section, value) {
    this.data[section] = value;
    this._scheduleSave();
  }

  // --- Key-level API ---

  get(section, key) {
    const sect = this.data[section];
    if (sect === null || sect === undefined) return null;
    return sect[key] ?? null;
  }

  set(section, key, value) {
    if (!this.data[section]) this.data[section] = {};
    this.data[section][key] = value;
    this._scheduleSave();
  }

  // --- Merge (partial update) ---

  merge(section, partial) {
    if (!this.data[section]) this.data[section] = {};
    Object.assign(this.data[section], partial);
    this._scheduleSave();
  }

  /**
   * "Delete all local data": forget everything in memory and in the
   * localStorage mirror, and never write again in this run (Rust clears the
   * store file, then the app restarts into first-run setup).
   */
  wipe() {
    this._wiped = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._dirty = false;
    this.data = {};
    try { localStorage.removeItem(LOCALSTORAGE_KEY); } catch { /* unavailable */ }
  }

  // --- Save control ---

  _scheduleSave() {
    if (this._wiped) return;
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flush();
    }, DEBOUNCE_MS);
  }

  async saveNow() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    await this._flush();
  }

  async _flush() {
    if (!this._dirty || this._wiped) return;
    this._dirty = false;

    try {
      if (this.store) {
        for (const [key, value] of Object.entries(this.data)) {
          // Defense-in-depth: never let JS persist 'profile'. Rust owns it
          // (see auth-callback handlers in main.rs). If something accidentally
          // sets this.data.profile, we still must not write it back to the
          // store — Rust's fresh write would be silently clobbered.
          if (key === 'profile') continue;
          await this.store.set(key, value);
        }
        await this.store.set('_version', DB_VERSION);
        await this.store.save();
      }
    } catch (e) {
      console.error('Database: store save failed:', e);
    }
    // Always mirror to localStorage so popup windows can read the data
    // (popup windows may not have access to the Tauri Store plugin)
    this._saveToLocalStorage();
  }

  // --- Load all sections from store ---

  async _loadAll() {
    const sections = [...Object.keys(OLD_STORES), ...NEW_SECTIONS];
    for (const section of sections) {
      const value = await this.store.get(section);
      if (value !== null && value !== undefined) {
        this.data[section] = value;
      }
    }

    // Backfill any sections still missing from unified localStorage.
    // This covers data that was only ever saved to localStorage (session,
    // skills, codingHourOfDay) before the Tauri store was connected.
    let backfilled = false;
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) {
        const unified = JSON.parse(saved);
        for (const [key, value] of Object.entries(unified)) {
          if (key === '_version') continue;
          if (!(key in this.data) && value != null) {
            this.data[key] = value;
            backfilled = true;
          }
        }
        if (backfilled) {
          console.log('Database: backfilled missing sections from localStorage');
          this._dirty = true;
          await this._flush();
        }
      }
    } catch (e) {
      console.log('Database: localStorage backfill failed:', e);
    }
  }

  // --- Migration from old per-file stores ---

  async _migrateFromOldStores() {
    console.log('Database: Migrating from per-file stores...');
    let migrated = false;

    // 1. Settings (flat keys)
    try {
      const old = await TauriStore.load(OLD_STORES.settings);
      const settings = {};
      for (const key of SETTINGS_KEYS) {
        const val = await old.get(key);
        if (val !== null && val !== undefined) {
          settings[key] = val;
          migrated = true;
        }
      }
      if (Object.keys(settings).length > 0) {
        this.data.settings = settings;
      }
    } catch (e) {
      console.log('Migration: settings.json not found, skipping');
    }

    // 2. Achievements (per-ID keys + metadata)
    try {
      const old = await TauriStore.load(OLD_STORES.achievements);
      const state = {};
      for (const id of ACHIEVEMENT_IDS) {
        const val = await old.get(id);
        if (val) {
          state[id] = val;
          migrated = true;
        }
      }
      const streakData = await old.get('_streakData');
      const seenApps = await old.get('_seenApps');
      this.data.achievements = {
        state,
        streakData: streakData || { days: [] },
        seenApps: seenApps || [],
      };
    } catch (e) {
      console.log('Migration: achievements.json not found, skipping');
    }

    // 3. Session (key-map)
    try {
      const old = await TauriStore.load(OLD_STORES.session);
      const history = await old.get('history');
      const recentFiles = await old.get('recentFiles');
      if (history || recentFiles) {
        this.data.session = {
          history: history || [],
          recentFiles: recentFiles || [],
        };
        migrated = true;
      }
    } catch (e) {
      console.log('Migration: session.json not found, skipping');
    }

    // 4. Streak (single key 'data')
    try {
      const old = await TauriStore.load(OLD_STORES.streak);
      const data = await old.get('data');
      if (data) {
        this.data.streak = data;
        migrated = true;
      }
    } catch (e) {
      console.log('Migration: streak.json not found, skipping');
    }

    // 5. Personal Best (key-map)
    try {
      const old = await TauriStore.load(OLD_STORES.personalBest);
      const bests = await old.get('bests');
      const history = await old.get('history');
      if (bests || history) {
        this.data.personalBest = {
          bests: bests || {},
          history: history || [],
        };
        migrated = true;
      }
    } catch (e) {
      console.log('Migration: personal-best.json not found, skipping');
    }

    // 6. Skills (single key 'skills')
    try {
      const old = await TauriStore.load(OLD_STORES.skills);
      const skills = await old.get('skills');
      if (skills) {
        this.data.skills = skills;
        migrated = true;
      }
    } catch (e) {
      console.log('Migration: skills.json not found, skipping');
    }

    // 7. Weekly Summary (key-map)
    try {
      const old = await TauriStore.load(OLD_STORES.weeklySummary);
      const goals = await old.get('goals');
      const lastAutoTrigger = await old.get('lastAutoTrigger');
      if (goals !== null || lastAutoTrigger !== null) {
        this.data.weeklySummary = {
          goals: goals || null,
          lastAutoTrigger: lastAutoTrigger || null,
        };
        migrated = true;
      }
    } catch (e) {
      console.log('Migration: weekly-summary.json not found, skipping');
    }

    // 8. Scanner (key-map)
    try {
      const old = await TauriStore.load(OLD_STORES.scanner);
      const projects = await old.get('discoveredProjects');
      const lastScan = await old.get('lastProjectScan');
      if (projects || lastScan) {
        this.data.scanner = {
          discoveredProjects: projects || [],
          lastProjectScan: lastScan || 0,
        };
        migrated = true;
      }
    } catch (e) {
      console.log('Migration: scanner.json not found, skipping');
    }

    // Also try migrating from localStorage (old per-feature keys)
    if (!migrated) {
      this._migrateFromLocalStorage();
    }

    // Fill in any sections still missing from the unified localStorage key.
    // The Database previously ran on localStorage-only (the npm import of
    // @tauri-apps/plugin-store silently failed), so session history, skills,
    // and codingHourOfDay may only exist under the unified key.
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) {
        const unified = JSON.parse(saved);
        for (const [key, value] of Object.entries(unified)) {
          if (!(key in this.data) && value != null) {
            this.data[key] = value;
          }
        }
      }
    } catch (e) {
      console.log('Migration: unified localStorage read failed:', e);
    }

    // Save the consolidated data
    this._dirty = true;
    await this._flush();
    console.log('Database: Migration complete');
  }

  // --- localStorage fallback ---

  _loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) {
        this.data = JSON.parse(saved);
        return;
      }
    } catch (e) {
      console.log('Database: Failed to load from localStorage:', e);
    }

    // Try migrating from old per-feature localStorage keys
    this._migrateFromLocalStorage();
  }

  _migrateFromLocalStorage() {
    const oldKeys = {
      settings: 'dr-vibe-settings',
      achievements: 'dr-vibe-achievements',
      session: { history: 'dr-vibe-session-history', recentFiles: 'dr-vibe-recent-files' },
      streak: 'dr-vibe-streak',
      personalBest: 'dr-vibe-personal-best',
      skills: 'dr-vibe-skills',
      weeklySummary: { goals: 'dr-vibe-weekly-goals', lastAutoTrigger: 'dr-vibe-weekly-last-trigger' },
      scanner: 'dr-vibe-scanner',
    };

    try {
      // Settings
      const settings = localStorage.getItem(oldKeys.settings);
      if (settings) this.data.settings = JSON.parse(settings);

      // Achievements (localStorage format already has { state, streakDays, seenApps })
      const achievements = localStorage.getItem(oldKeys.achievements);
      if (achievements) {
        const parsed = JSON.parse(achievements);
        this.data.achievements = {
          state: parsed.state || {},
          streakData: { days: parsed.streakDays || [] },
          seenApps: parsed.seenApps || [],
        };
      }

      // Session
      const history = localStorage.getItem(oldKeys.session.history);
      const recentFiles = localStorage.getItem(oldKeys.session.recentFiles);
      if (history || recentFiles) {
        this.data.session = {
          history: history ? JSON.parse(history) : [],
          recentFiles: recentFiles ? JSON.parse(recentFiles) : [],
        };
      }

      // Streak
      const streak = localStorage.getItem(oldKeys.streak);
      if (streak) this.data.streak = JSON.parse(streak);

      // Personal Best
      const pb = localStorage.getItem(oldKeys.personalBest);
      if (pb) this.data.personalBest = JSON.parse(pb);

      // Skills
      const skills = localStorage.getItem(oldKeys.skills);
      if (skills) this.data.skills = JSON.parse(skills);

      // Weekly Summary
      const goals = localStorage.getItem(oldKeys.weeklySummary.goals);
      const lastTrigger = localStorage.getItem(oldKeys.weeklySummary.lastAutoTrigger);
      if (goals || lastTrigger) {
        this.data.weeklySummary = {
          goals: goals ? JSON.parse(goals) : null,
          lastAutoTrigger: lastTrigger || null,
        };
      }

      // Scanner
      const scanner = localStorage.getItem(oldKeys.scanner);
      if (scanner) this.data.scanner = JSON.parse(scanner);
    } catch (e) {
      console.log('Database: localStorage migration failed:', e);
    }
  }

  _saveToLocalStorage() {
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.error('Database: Failed to save to localStorage:', e);
    }
  }
}

export const db = new Database();
