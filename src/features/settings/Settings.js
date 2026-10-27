// Dr. Vibe - Settings Management

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';

export const DEFAULT_SETTINGS = {
  workInterval: 25,
  breakInterval: 5,
  notificationsEnabled: true,
  position: { x: 100, y: 100 },
  codingApps: [
    'Code',
    'Visual Studio',
    'Cursor',
    'Anti-Gravity',
    'Zed',
    'Sublime Text',
    'IntelliJ',
    'WebStorm',
    'PyCharm',
    'GoLand',
    'Rider',
    'CLion',
    'DataGrip',
    'RustRover',
    'vim',
    'nvim',
    'neovim',
    'Emacs',
    'Windows Terminal',
    'Terminal',
    'iTerm',
    'Alacritty',
    'Kitty',
    'Warp',
    'Hyper',
    'PowerShell',
    'cmd',
    'Claude',
  ],
  // Break system settings
  breakMode: 'pomodoro',           // 'pomodoro' | 'smart' | 'manual'
  idleThresholdMinutes: 5,         // minutes of inactivity before idle break suggestion
  longBreakInterval: 4,            // work cycles before a long break
  longBreakMinutes: 15,            // long break duration
  breakHistory: [],                // recent break acceptance/dismissal records
  // Boundary awareness settings
  boundaryAwarenessEnabled: true,  // gentle work-life balance reminders
  // Hydration reminder settings
  hydrationEnabled: true,
  hydrationFrequency: 45,          // minutes between reminders
  hydrationDailyCount: 0,
  hydrationLastReset: '',          // YYYY-MM-DD string
  // Learning resources settings
  learningResourcesEnabled: false, // opt-in: suggest learning resources based on detected language/framework
  // Encouragement settings
  encouragementEnabled: true,      // celebrate small wins with warm messages
  encouragementFrequency: 60,      // minimum minutes between encouragements
  // Eye strain prevention settings (20-20-20 rule)
  eyeStrainEnabled: true,
  // Posture reminder settings
  postureReminderEnabled: true,
  postureFrequency: 30,              // minutes between reminders
  // Fatigue detection settings
  fatigueDetectionEnabled: true,   // detect declining productivity and suggest stopping
  // Stuck detection settings
  stuckDetectionEnabled: true,     // detect when user is spinning their wheels on a problem
  stuckThresholds: null,           // adaptive thresholds (null = use defaults)
  // Overwork prevention settings
  overworkPreventionEnabled: true,  // track daily hours and warn about excessive coding
  // Focus mode settings
  focusModeDuration: 25,           // minutes (default: 25, max: 120)
  focusModeEndTime: null,          // timestamp when focus should end (for resume on restart)
  // Resume suggestions settings
  resumeSuggestionsEnabled: true,  // suggest where to continue after idle
  // Notification position on screen
  notificationPosition: 'bottom-right', // 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center'
  // Per-category notification toggles
  notifyBreaks: true,
  notifyHydration: true,
  notifyPosture: true,
  notifyEyeStrain: true,
  notifyFatigue: true,
  notifyStuck: true,
  notifyOverwork: true,
  notifyAchievements: true,
  notifyBoundary: true,
  notifyVpEarned: true,   // "+X VP" toasts when you earn Vibe Points
  notifyTrades: true,     // trade proposed / accepted notifications
  notifyCommunity: true,
  shareWeeklyRecap: true, // send last week's numbers for the recap card and feed post (linked only; the first card waits for a look)
  syncEnabled: true,      // "Sync my stats": off keeps the account linked but sends nothing (SyncSwitch)
  trackingPausedUntil: null, // Pause tracking: epoch ms, 'manual' (until I resume) or null (TrackingPause)
  aiGeneratorConsentAt: null, // when the "your description goes to Anthropic/OpenAI" notice was accepted (ms)
  communityInviteDismissed: false, // wizard "don't ask again" or already joined
  communityInviteShown: false,     // the one-time join toast after the first achievement
  hideWhenPresenting: true, // hide Dr. Vibe, hold visits and toasts during screen shares / fullscreen apps  // server notifications from the poll (follows, donations, visits while away)
  // Pop-up display duration (seconds)
  popupDuration: 8,               // how long toasts/pop-ups stay visible (seconds)
  // Click-through ghost mode
  clickThroughGhostEnabled: true, // fade character transparent on hover so clicks pass through
  // Mouse nudge (hover-to-bounce)
  mouseNudgeEnabled: false,        // Dr. Vibe hops away when the cursor approaches him
  mouseNudgeSpeed:   7,            // 1–10, controls flee speed and acceleration
  // Walking behavior
  walkingEnabled: true,            // enable/disable walking behavior
  walkingLockedToScreen: true,     // prevent Dr. Vibe from walking off the current monitor
  walkingBoundLeftPercent: 0,      // left boundary as % from left screen edge (0 = edge)
  walkingBoundRightPercent: 0,     // right boundary as % from right screen edge (0 = edge)
  // Character skin
  selectedSkin: 'dr-vibe-default', // name of the sprite sheet in assets/sprites/skins/
  selectedSkinTone: 'medium-light',    // skin tone preset key (e.g. 'default', 'dark', 'green')
  aiAgent: 'claude',                // CLI agent used for character generation ('claude' | 'codex')
  characterScale: 100,             // display size percentage (75 = small, 100 = normal, 125 = large, 150 = xl)
  // Sound settings
  soundReactionsEnabled: false,   // opt-in: character makes sounds on state changes
  soundTalkEnabled: false,        // opt-in: chattering noises when speech bubble appears
  soundVolume: 50,                // 0-100 volume level
  soundTalkVoice: 'mumble',       // voice style preset for talk sounds
  // Claude Code integration: hooks in ~/.claude/settings.json (Settings → Tracking).
  // Off until chosen in setup or Settings; installed only after setup.
  claudeCodeHooksEnabled: false,
  // Git tracking settings
  gitTrackingEnabled: true,           // master toggle for git integration
  gitCommitNotificationsEnabled: true, // show speech bubble on new commits
  gitBranchNotificationsEnabled: true, // show speech bubble on branch changes
  gitPollIntervalMinutes: 1,          // how often to poll for git changes (minutes)
  gitCommitRemindersEnabled: true,    // nudge to commit when changes sit too long
  gitReminderThresholdMinutes: 30,    // minutes before first gentle reminder
  gitReminderMinChanges: 3,           // minimum changed files before reminding
  projectFolders: [],              // folders whose repos are tracked (the folder's own, or one level down)
  trackClaudeRepos: false,         // also track the repos Claude Code starts sessions in (needs the hooks)
  ignoredRepos: [],                // repo paths never tracked
  // Activity overlay visibility
  momentumMeterEnabled: true,         // show/hide the heat bar
  momentumMeterPosition: 'bottom',    // 'top' | 'bottom' — where the heat bar appears relative to Dr. Vibe
  autoStartEnabled: false,            // launch Dr. Vibe automatically when the computer starts
  // Admin mode — gates access to creator tools (generator, uploader, sprite editor)
  adminMode: false,
  // Dev server override — admin-only. Lets an admin redirect the app to a
  // different Dr. Vibe web server without recompiling. Values:
  //   'auto'       — use automatic IS_DEV detection (default)
  //   'production' — force drvibe.io
  //   'localhost'  — force http://localhost:8080 (a local Dr. Vibe server)
  //   'custom:<url>' — use the provided URL verbatim
  // Read once at startup by both JS (src/core/config.js) and Rust
  // (main.rs web_base_url()). Changing it requires an app restart.
  devServerOverride: 'auto',
};

/** Compare names ignoring case and spaces ("Windows Terminal" = WindowsTerminal). */
function squash(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * The coding apps list with one entry per app: the old "WindowsTerminal"
 * entry (any spacing or case) becomes "Windows Terminal", and duplicates
 * go. Every other entry, custom ones included, is kept in order.
 */
export function normalizeCodingApps(list) {
  const out = [];
  for (const app of Array.isArray(list) ? list : []) {
    const name = squash(app) === 'windowsterminal' ? 'Windows Terminal' : app;
    if (!out.some((a) => squash(a) === squash(name))) out.push(name);
  }
  return out;
}

// Executable names of coding apps listed under another name.
const CODING_APP_EXES = {
  'visual studio': ['devenv'],
  'intellij': ['idea'],
  'sublime text': ['sublime_text'],
  'windows terminal': ['wt'],
  'iterm': ['iterm2'],
  'powershell': ['pwsh'],
  'emacs': ['runemacs'],
  'vim': ['gvim'],
};

// Default coding apps already offered to this profile. load() backfills only
// defaults missing from this list, so an app the user removed stays removed.
DEFAULT_SETTINGS.codingAppsOffered = [...DEFAULT_SETTINGS.codingApps];

export class Settings {
  constructor() {
    this.workInterval = DEFAULT_SETTINGS.workInterval;
    this.breakInterval = DEFAULT_SETTINGS.breakInterval;
    this.notificationsEnabled = DEFAULT_SETTINGS.notificationsEnabled;
    this.position = { ...DEFAULT_SETTINGS.position };
    this.codingApps = [...DEFAULT_SETTINGS.codingApps];
    this.breakMode = DEFAULT_SETTINGS.breakMode;
    this.idleThresholdMinutes = DEFAULT_SETTINGS.idleThresholdMinutes;
    this.longBreakInterval = DEFAULT_SETTINGS.longBreakInterval;
    this.longBreakMinutes = DEFAULT_SETTINGS.longBreakMinutes;
    this.breakHistory = [...DEFAULT_SETTINGS.breakHistory];
    this.boundaryAwarenessEnabled = DEFAULT_SETTINGS.boundaryAwarenessEnabled;
    this.hydrationEnabled = DEFAULT_SETTINGS.hydrationEnabled;
    this.hydrationFrequency = DEFAULT_SETTINGS.hydrationFrequency;
    this.hydrationDailyCount = DEFAULT_SETTINGS.hydrationDailyCount;
    this.hydrationLastReset = DEFAULT_SETTINGS.hydrationLastReset;
    this.learningResourcesEnabled = DEFAULT_SETTINGS.learningResourcesEnabled;
    this.encouragementEnabled = DEFAULT_SETTINGS.encouragementEnabled;
    this.encouragementFrequency = DEFAULT_SETTINGS.encouragementFrequency;
    this.eyeStrainEnabled = DEFAULT_SETTINGS.eyeStrainEnabled;
    this.postureReminderEnabled = DEFAULT_SETTINGS.postureReminderEnabled;
    this.postureFrequency = DEFAULT_SETTINGS.postureFrequency;
    this.fatigueDetectionEnabled = DEFAULT_SETTINGS.fatigueDetectionEnabled;
    this.stuckDetectionEnabled = DEFAULT_SETTINGS.stuckDetectionEnabled;
    this.stuckThresholds = DEFAULT_SETTINGS.stuckThresholds;
    this.overworkPreventionEnabled = DEFAULT_SETTINGS.overworkPreventionEnabled;
    this.focusModeDuration = DEFAULT_SETTINGS.focusModeDuration;
    this.focusModeEndTime = DEFAULT_SETTINGS.focusModeEndTime;
    this.resumeSuggestionsEnabled = DEFAULT_SETTINGS.resumeSuggestionsEnabled;
    this.notificationPosition = DEFAULT_SETTINGS.notificationPosition;
    this.notifyBreaks = DEFAULT_SETTINGS.notifyBreaks;
    this.notifyHydration = DEFAULT_SETTINGS.notifyHydration;
    this.notifyPosture = DEFAULT_SETTINGS.notifyPosture;
    this.notifyEyeStrain = DEFAULT_SETTINGS.notifyEyeStrain;
    this.notifyFatigue = DEFAULT_SETTINGS.notifyFatigue;
    this.notifyStuck = DEFAULT_SETTINGS.notifyStuck;
    this.notifyOverwork = DEFAULT_SETTINGS.notifyOverwork;
    this.notifyAchievements = DEFAULT_SETTINGS.notifyAchievements;
    this.notifyBoundary = DEFAULT_SETTINGS.notifyBoundary;
    this.popupDuration = DEFAULT_SETTINGS.popupDuration;
    this.clickThroughGhostEnabled = DEFAULT_SETTINGS.clickThroughGhostEnabled;
    this.mouseNudgeEnabled = DEFAULT_SETTINGS.mouseNudgeEnabled;
    this.mouseNudgeSpeed   = DEFAULT_SETTINGS.mouseNudgeSpeed;
    this.walkingEnabled = DEFAULT_SETTINGS.walkingEnabled;
    this.walkingLockedToScreen = DEFAULT_SETTINGS.walkingLockedToScreen;
    this.walkingBoundLeftPercent = DEFAULT_SETTINGS.walkingBoundLeftPercent;
    this.walkingBoundRightPercent = DEFAULT_SETTINGS.walkingBoundRightPercent;
    this.selectedSkin = DEFAULT_SETTINGS.selectedSkin;
    this.selectedSkinTone = DEFAULT_SETTINGS.selectedSkinTone;
    this.aiAgent = DEFAULT_SETTINGS.aiAgent;
    this.characterScale = DEFAULT_SETTINGS.characterScale;
    this.soundReactionsEnabled = DEFAULT_SETTINGS.soundReactionsEnabled;
    this.soundTalkEnabled = DEFAULT_SETTINGS.soundTalkEnabled;
    this.soundVolume = DEFAULT_SETTINGS.soundVolume;
    this.soundTalkVoice = DEFAULT_SETTINGS.soundTalkVoice;
    this.gitTrackingEnabled = DEFAULT_SETTINGS.gitTrackingEnabled;
    this.gitCommitNotificationsEnabled = DEFAULT_SETTINGS.gitCommitNotificationsEnabled;
    this.gitBranchNotificationsEnabled = DEFAULT_SETTINGS.gitBranchNotificationsEnabled;
    this.gitPollIntervalMinutes = DEFAULT_SETTINGS.gitPollIntervalMinutes;
    this.gitCommitRemindersEnabled = DEFAULT_SETTINGS.gitCommitRemindersEnabled;
    this.gitReminderThresholdMinutes = DEFAULT_SETTINGS.gitReminderThresholdMinutes;
    this.gitReminderMinChanges = DEFAULT_SETTINGS.gitReminderMinChanges;
    this.projectFolders = [...DEFAULT_SETTINGS.projectFolders];
    this.momentumMeterEnabled = DEFAULT_SETTINGS.momentumMeterEnabled;
    this.momentumMeterPosition = DEFAULT_SETTINGS.momentumMeterPosition;
    this.autoStartEnabled = DEFAULT_SETTINGS.autoStartEnabled;
    this.adminMode = DEFAULT_SETTINGS.adminMode;
    this.devServerOverride = DEFAULT_SETTINGS.devServerOverride;
    // Any DEFAULT_SETTINGS key not assigned above (newer settings such as
    // notifyTrades or hideWhenPresenting) still becomes a real setting —
    // set() ignores keys that are not properties.
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(key in this)) this[key] = Array.isArray(value) ? [...value] : value;
    }
  }

  async init() {
    await this.load();
  }

  async load() {
    const saved = db.getSection('settings');
    if (saved) {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (saved[key] !== null && saved[key] !== undefined) {
          this[key] = Settings.clamp(key, saved[key]);
        }
      }
      // One entry per app (an old WindowsTerminal entry becomes Windows Terminal).
      const merged = normalizeCodingApps(this.codingApps);
      const renamed = JSON.stringify(merged) !== JSON.stringify(this.codingApps);
      this.codingApps = merged;
      // Backfill default coding apps added since this profile last saw the
      // list (e.g. Claude). Profiles from before the list was tracked get
      // every missing default once.
      const offered = Array.isArray(saved.codingAppsOffered) ? saved.codingAppsOffered : [];
      let backfilled = false;
      for (const app of DEFAULT_SETTINGS.codingApps) {
        if (!offered.includes(app) && !this.codingApps.includes(app)) {
          this.codingApps.push(app);
          backfilled = true;
        }
      }
      const allOffered = DEFAULT_SETTINGS.codingApps.every(app => offered.includes(app));
      this.codingAppsOffered = [...new Set([...offered, ...DEFAULT_SETTINGS.codingApps])];
      if (backfilled || !allOffered || renamed) this.save();
      console.log('Settings loaded from database');
    } else {
      console.log('Settings: no saved data, using defaults');
    }

    eventBus.emit(Events.SETTINGS_LOADED, this.getAll());
  }

  save() {
    db.setSection('settings', this.getAll());
  }

  set(key, value) {
    if (!(key in this)) return;
    const next = Settings.clamp(key, value);
    // Unchanged values are a no-op: no save, no SETTINGS_CHANGED (which would
    // restart reminders, re-sync, reload the skin...).
    if (JSON.stringify(next) === JSON.stringify(this[key])) return;
    this[key] = next;
    this.save();
    eventBus.emit(Events.SETTINGS_CHANGED, { key, value: this[key] });
  }

  static clamp(key, value) {
    const rules = {
      workInterval:            { min: 1, max: 120 },
      breakInterval:           { min: 1, max: 60 },
      idleThresholdMinutes:    { min: 1, max: 60 },
      longBreakInterval:       { min: 2, max: 10 },
      longBreakMinutes:        { min: 5, max: 60 },
      focusModeDuration:       { min: 5, max: 120 },
      encouragementFrequency:  { min: 10, max: 240 },
      postureFrequency:        { min: 5, max: 120 },
      hydrationFrequency:      { min: 10, max: 180 },
      popupDuration:           { min: 3, max: 60 },
      walkingBoundLeftPercent:  { min: 0, max: 45 },
      walkingBoundRightPercent: { min: 0, max: 45 },
      characterScale: { min: 75, max: 150 },
      soundVolume: { min: 0, max: 100 },
      gitPollIntervalMinutes: { min: 1, max: 60 },
    };
    const rule = rules[key];
    if (rule && typeof value === 'number') {
      return Math.max(rule.min, Math.min(rule.max, Math.round(value)));
    }
    return value;
  }

  get(key) {
    return this[key];
  }

  getAll() {
    return {
      workInterval: this.workInterval,
      breakInterval: this.breakInterval,
      notificationsEnabled: this.notificationsEnabled,
      position: this.position,
      codingApps: this.codingApps,
      breakMode: this.breakMode,
      idleThresholdMinutes: this.idleThresholdMinutes,
      longBreakInterval: this.longBreakInterval,
      longBreakMinutes: this.longBreakMinutes,
      breakHistory: this.breakHistory,
      boundaryAwarenessEnabled: this.boundaryAwarenessEnabled,
      hydrationEnabled: this.hydrationEnabled,
      hydrationFrequency: this.hydrationFrequency,
      hydrationDailyCount: this.hydrationDailyCount,
      hydrationLastReset: this.hydrationLastReset,
      learningResourcesEnabled: this.learningResourcesEnabled,
      encouragementEnabled: this.encouragementEnabled,
      encouragementFrequency: this.encouragementFrequency,
      eyeStrainEnabled: this.eyeStrainEnabled,
      postureReminderEnabled: this.postureReminderEnabled,
      postureFrequency: this.postureFrequency,
      fatigueDetectionEnabled: this.fatigueDetectionEnabled,
      stuckDetectionEnabled: this.stuckDetectionEnabled,
      stuckThresholds: this.stuckThresholds,
      overworkPreventionEnabled: this.overworkPreventionEnabled,
      focusModeDuration: this.focusModeDuration,
      focusModeEndTime: this.focusModeEndTime,
      resumeSuggestionsEnabled: this.resumeSuggestionsEnabled,
      notificationPosition: this.notificationPosition,
      notifyBreaks: this.notifyBreaks,
      notifyHydration: this.notifyHydration,
      notifyPosture: this.notifyPosture,
      notifyEyeStrain: this.notifyEyeStrain,
      notifyFatigue: this.notifyFatigue,
      notifyStuck: this.notifyStuck,
      notifyOverwork: this.notifyOverwork,
      notifyAchievements: this.notifyAchievements,
      notifyBoundary: this.notifyBoundary,
      popupDuration: this.popupDuration,
      clickThroughGhostEnabled: this.clickThroughGhostEnabled,
      mouseNudgeEnabled: this.mouseNudgeEnabled,
      mouseNudgeSpeed:   this.mouseNudgeSpeed,
      walkingEnabled: this.walkingEnabled,
      walkingLockedToScreen: this.walkingLockedToScreen,
      walkingBoundLeftPercent: this.walkingBoundLeftPercent,
      walkingBoundRightPercent: this.walkingBoundRightPercent,
      selectedSkin: this.selectedSkin,
      selectedSkinTone: this.selectedSkinTone,
      aiAgent: this.aiAgent,
      characterScale: this.characterScale,
      soundReactionsEnabled: this.soundReactionsEnabled,
      soundTalkEnabled: this.soundTalkEnabled,
      soundVolume: this.soundVolume,
      soundTalkVoice: this.soundTalkVoice,
      gitTrackingEnabled: this.gitTrackingEnabled,
      gitCommitNotificationsEnabled: this.gitCommitNotificationsEnabled,
      gitBranchNotificationsEnabled: this.gitBranchNotificationsEnabled,
      gitPollIntervalMinutes: this.gitPollIntervalMinutes,
      gitCommitRemindersEnabled: this.gitCommitRemindersEnabled,
      gitReminderThresholdMinutes: this.gitReminderThresholdMinutes,
      gitReminderMinChanges: this.gitReminderMinChanges,
      projectFolders: [...this.projectFolders],
      momentumMeterEnabled: this.momentumMeterEnabled,
      momentumMeterPosition: this.momentumMeterPosition,
      autoStartEnabled: this.autoStartEnabled,
      adminMode: this.adminMode,
      devServerOverride: this.devServerOverride,
      ...this._otherDefaults(),
    };
  }

  /** Current values of DEFAULT_SETTINGS keys not listed explicitly in getAll(). */
  _otherDefaults() {
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = this[key];
      out[key] = Array.isArray(value) ? [...value] : value;
    }
    return out;
  }

  /**
   * Whether the app in front (its executable name) is one of the coding
   * apps: the same name, or the name followed by a version or variant
   * ("pycharm64", "Code - Insiders", "godot_v4"). Not any name that merely contains it,
   * so "Cloudflare WARP" is not Warp and "lxcmdagent" is not cmd.
   */
  isCodingApp(appName) {
    if (!appName) return false;
    const exe = String(appName).trim().toLowerCase().replace(/\.exe$/, '');
    return this.codingApps.some((app) => {
      const name = String(app).trim().toLowerCase();
      if (!name) return false;
      // The name as written, without its spaces (WindowsTerminal), and aliases.
      return [...new Set([name, squash(name), ...(CODING_APP_EXES[name] || [])])].some((n) =>
        exe === n || (exe.startsWith(n) && /^[\d\s_.]/.test(exe.slice(n.length))));
    });
  }

  addCodingApp(appName) {
    if (!this.codingApps.includes(appName)) {
      this.codingApps.push(appName);
      this.save();
      eventBus.emit(Events.SETTINGS_CHANGED, { key: 'codingApps', value: this.codingApps });
    }
  }

  removeCodingApp(appName) {
    const index = this.codingApps.indexOf(appName);
    if (index > -1) {
      this.codingApps.splice(index, 1);
      this.save();
      eventBus.emit(Events.SETTINGS_CHANGED, { key: 'codingApps', value: this.codingApps });
    }
  }

  reset() {
    this.workInterval = DEFAULT_SETTINGS.workInterval;
    this.breakInterval = DEFAULT_SETTINGS.breakInterval;
    this.notificationsEnabled = DEFAULT_SETTINGS.notificationsEnabled;
    this.position = { ...DEFAULT_SETTINGS.position };
    this.breakMode = DEFAULT_SETTINGS.breakMode;
    this.idleThresholdMinutes = DEFAULT_SETTINGS.idleThresholdMinutes;
    this.longBreakInterval = DEFAULT_SETTINGS.longBreakInterval;
    this.longBreakMinutes = DEFAULT_SETTINGS.longBreakMinutes;
    this.breakHistory = [...DEFAULT_SETTINGS.breakHistory];
    this.boundaryAwarenessEnabled = DEFAULT_SETTINGS.boundaryAwarenessEnabled;
    this.hydrationEnabled = DEFAULT_SETTINGS.hydrationEnabled;
    this.hydrationFrequency = DEFAULT_SETTINGS.hydrationFrequency;
    this.hydrationDailyCount = DEFAULT_SETTINGS.hydrationDailyCount;
    this.hydrationLastReset = DEFAULT_SETTINGS.hydrationLastReset;
    this.learningResourcesEnabled = DEFAULT_SETTINGS.learningResourcesEnabled;
    this.encouragementEnabled = DEFAULT_SETTINGS.encouragementEnabled;
    this.encouragementFrequency = DEFAULT_SETTINGS.encouragementFrequency;
    this.eyeStrainEnabled = DEFAULT_SETTINGS.eyeStrainEnabled;
    this.postureReminderEnabled = DEFAULT_SETTINGS.postureReminderEnabled;
    this.postureFrequency = DEFAULT_SETTINGS.postureFrequency;
    this.fatigueDetectionEnabled = DEFAULT_SETTINGS.fatigueDetectionEnabled;
    this.stuckDetectionEnabled = DEFAULT_SETTINGS.stuckDetectionEnabled;
    this.stuckThresholds = DEFAULT_SETTINGS.stuckThresholds;
    this.overworkPreventionEnabled = DEFAULT_SETTINGS.overworkPreventionEnabled;
    this.focusModeDuration = DEFAULT_SETTINGS.focusModeDuration;
    this.focusModeEndTime = DEFAULT_SETTINGS.focusModeEndTime;
    this.resumeSuggestionsEnabled = DEFAULT_SETTINGS.resumeSuggestionsEnabled;
    this.notificationPosition = DEFAULT_SETTINGS.notificationPosition;
    this.notifyBreaks = DEFAULT_SETTINGS.notifyBreaks;
    this.notifyHydration = DEFAULT_SETTINGS.notifyHydration;
    this.notifyPosture = DEFAULT_SETTINGS.notifyPosture;
    this.notifyEyeStrain = DEFAULT_SETTINGS.notifyEyeStrain;
    this.notifyFatigue = DEFAULT_SETTINGS.notifyFatigue;
    this.notifyStuck = DEFAULT_SETTINGS.notifyStuck;
    this.notifyOverwork = DEFAULT_SETTINGS.notifyOverwork;
    this.notifyAchievements = DEFAULT_SETTINGS.notifyAchievements;
    this.notifyBoundary = DEFAULT_SETTINGS.notifyBoundary;
    this.popupDuration = DEFAULT_SETTINGS.popupDuration;
    this.clickThroughGhostEnabled = DEFAULT_SETTINGS.clickThroughGhostEnabled;
    this.mouseNudgeEnabled = DEFAULT_SETTINGS.mouseNudgeEnabled;
    this.mouseNudgeSpeed   = DEFAULT_SETTINGS.mouseNudgeSpeed;
    this.walkingEnabled = DEFAULT_SETTINGS.walkingEnabled;
    this.walkingLockedToScreen = DEFAULT_SETTINGS.walkingLockedToScreen;
    this.walkingBoundLeftPercent = DEFAULT_SETTINGS.walkingBoundLeftPercent;
    this.walkingBoundRightPercent = DEFAULT_SETTINGS.walkingBoundRightPercent;
    this.selectedSkin = DEFAULT_SETTINGS.selectedSkin;
    this.selectedSkinTone = DEFAULT_SETTINGS.selectedSkinTone;
    this.aiAgent = DEFAULT_SETTINGS.aiAgent;
    this.characterScale = DEFAULT_SETTINGS.characterScale;
    this.soundReactionsEnabled = DEFAULT_SETTINGS.soundReactionsEnabled;
    this.soundTalkEnabled = DEFAULT_SETTINGS.soundTalkEnabled;
    this.soundVolume = DEFAULT_SETTINGS.soundVolume;
    this.soundTalkVoice = DEFAULT_SETTINGS.soundTalkVoice;
    this.gitTrackingEnabled = DEFAULT_SETTINGS.gitTrackingEnabled;
    this.gitCommitNotificationsEnabled = DEFAULT_SETTINGS.gitCommitNotificationsEnabled;
    this.gitBranchNotificationsEnabled = DEFAULT_SETTINGS.gitBranchNotificationsEnabled;
    this.gitPollIntervalMinutes = DEFAULT_SETTINGS.gitPollIntervalMinutes;
    this.gitCommitRemindersEnabled = DEFAULT_SETTINGS.gitCommitRemindersEnabled;
    this.gitReminderThresholdMinutes = DEFAULT_SETTINGS.gitReminderThresholdMinutes;
    this.gitReminderMinChanges = DEFAULT_SETTINGS.gitReminderMinChanges;
    this.momentumMeterEnabled = DEFAULT_SETTINGS.momentumMeterEnabled;
    this.momentumMeterPosition = DEFAULT_SETTINGS.momentumMeterPosition;
    this.autoStartEnabled = DEFAULT_SETTINGS.autoStartEnabled;
    this.adminMode = DEFAULT_SETTINGS.adminMode;
    this.devServerOverride = DEFAULT_SETTINGS.devServerOverride;
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      this[key] = Array.isArray(value) ? [...value] : value;
    }
    this.save();
    eventBus.emit(Events.SETTINGS_LOADED, this.getAll());
  }
}
