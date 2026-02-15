// Dr. Vibe - Settings Management

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';

const DEFAULT_SETTINGS = {
  workInterval: 25,
  breakInterval: 5,
  notificationsEnabled: true,
  position: { x: 100, y: 100 },
  codingApps: [
    'Code',
    'Visual Studio',
    'Cursor',
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
  // Pop-up display duration (seconds)
  popupDuration: 8,               // how long toasts/pop-ups stay visible (seconds)
  // Click-through ghost mode
  clickThroughGhostEnabled: true, // fade character transparent on hover so clicks pass through
  // Walking behavior
  walkingEnabled: true,            // enable/disable walking behavior
  walkingBoundLeftPercent: 0,      // left boundary as % from left screen edge (0 = edge)
  walkingBoundRightPercent: 0,     // right boundary as % from right screen edge (0 = edge)
  // Character skin
  selectedSkin: 'dr-vibe-default', // name of the sprite sheet in assets/sprites/skins/
  selectedSkinTone: 'medium-light',    // skin tone preset key (e.g. 'default', 'dark', 'green')
  // Sound settings
  soundReactionsEnabled: false,   // opt-in: character makes sounds on state changes
  soundTalkEnabled: false,        // opt-in: chattering noises when speech bubble appears
  soundVolume: 50,                // 0-100 volume level
  soundTalkVoice: 'mumble',       // voice style preset for talk sounds
};

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
    this.walkingEnabled = DEFAULT_SETTINGS.walkingEnabled;
    this.walkingBoundLeftPercent = DEFAULT_SETTINGS.walkingBoundLeftPercent;
    this.walkingBoundRightPercent = DEFAULT_SETTINGS.walkingBoundRightPercent;
    this.selectedSkin = DEFAULT_SETTINGS.selectedSkin;
    this.selectedSkinTone = DEFAULT_SETTINGS.selectedSkinTone;
    this.soundReactionsEnabled = DEFAULT_SETTINGS.soundReactionsEnabled;
    this.soundTalkEnabled = DEFAULT_SETTINGS.soundTalkEnabled;
    this.soundVolume = DEFAULT_SETTINGS.soundVolume;
    this.soundTalkVoice = DEFAULT_SETTINGS.soundTalkVoice;
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
    if (key in this) {
      this[key] = Settings.clamp(key, value);
      this.save();
      eventBus.emit(Events.SETTINGS_CHANGED, { key, value: this[key] });
    }
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
      soundVolume: { min: 0, max: 100 },
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
      walkingEnabled: this.walkingEnabled,
      walkingBoundLeftPercent: this.walkingBoundLeftPercent,
      walkingBoundRightPercent: this.walkingBoundRightPercent,
      selectedSkin: this.selectedSkin,
      selectedSkinTone: this.selectedSkinTone,
      soundReactionsEnabled: this.soundReactionsEnabled,
      soundTalkEnabled: this.soundTalkEnabled,
      soundVolume: this.soundVolume,
      soundTalkVoice: this.soundTalkVoice,
    };
  }

  isCodingApp(appName) {
    if (!appName) return false;
    const lowerName = appName.toLowerCase();
    return this.codingApps.some(app => lowerName.includes(app.toLowerCase()));
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
    this.walkingEnabled = DEFAULT_SETTINGS.walkingEnabled;
    this.walkingBoundLeftPercent = DEFAULT_SETTINGS.walkingBoundLeftPercent;
    this.walkingBoundRightPercent = DEFAULT_SETTINGS.walkingBoundRightPercent;
    this.selectedSkin = DEFAULT_SETTINGS.selectedSkin;
    this.selectedSkinTone = DEFAULT_SETTINGS.selectedSkinTone;
    this.soundReactionsEnabled = DEFAULT_SETTINGS.soundReactionsEnabled;
    this.soundTalkEnabled = DEFAULT_SETTINGS.soundTalkEnabled;
    this.soundVolume = DEFAULT_SETTINGS.soundVolume;
    this.soundTalkVoice = DEFAULT_SETTINGS.soundTalkVoice;
    this.save();
    eventBus.emit(Events.SETTINGS_LOADED, this.getAll());
  }
}
