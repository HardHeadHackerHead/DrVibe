// Dr. Vibe - Main Application Orchestrator

import { eventBus, Events } from './core/EventBus.js';
import { tauri } from './core/TauriBridge.js';
import { gameLoop } from './core/GameLoop.js';
import { db } from './core/Database.js';

import { SpriteAnimator } from './features/character/SpriteAnimator.js';
import { Character } from './features/character/Character.js';
import { CharacterReactions } from './features/character/CharacterReactions.js';

import { Timer } from './features/timer/Timer.js';
import { TimerUI } from './features/timer/TimerUI.js';
import { BreakScheduler } from './features/timer/BreakScheduler.js';

import { ActivityMonitor } from './features/activity/ActivityMonitor.js';
import { ProjectDetector } from './features/activity/ProjectDetector.js';
import { FileSystemScanner } from './features/activity/FileSystemScanner.js';
import { MomentumTracker } from './features/activity/MomentumTracker.js';
import { SessionContext } from './features/activity/SessionContext.js';
import { StuckDetector } from './features/activity/StuckDetector.js';
import { ClaudeCodeTracker } from './features/activity/ClaudeCodeTracker.js';
import { AIPairTracker } from './features/activity/AIPairTracker.js';
import { Settings } from './features/settings/Settings.js';
import { Notifier } from './features/notifications/Notifier.js';
import { BoundaryAwareness } from './features/boundaries/BoundaryAwareness.js';
import { HydrationReminder } from './features/hydration/HydrationReminder.js';
import { EyeStrainReminder } from './features/eyestrain/EyeStrainReminder.js';
import { PostureReminder } from './features/posture/PostureReminder.js';

import { BreakActivities } from './features/breaks/BreakActivities.js';
import { AchievementSystem } from './features/achievements/AchievementSystem.js';

import { SessionTracker } from './features/session/SessionTracker.js';
import { FatigueDetector } from './features/session/FatigueDetector.js';
import { OverworkPrevention } from './features/session/OverworkPrevention.js';
import { WeeklySummary } from './features/session/WeeklySummary.js';
import { EncouragementSystem } from './features/encouragement/EncouragementSystem.js';
import { CelebrationSystem } from './features/encouragement/CelebrationSystem.js';
import { CelebrationEffect } from './features/encouragement/CelebrationEffect.js';
import { ResumeSuggester } from './features/resume/ResumeSuggester.js';

import { LearningDetector } from './features/learning/LearningDetector.js';
import { ResourceSuggester } from './features/learning/ResourceSuggester.js';

import { SkillTracker } from './features/skills/SkillTracker.js';
import { PersonalBestTracker } from './features/personalBest/PersonalBestTracker.js';
import { DailyStreakTracker } from './features/streak/DailyStreakTracker.js';
import { FocusMode } from './features/focus/FocusMode.js';
import { ClickThrough } from './features/clickthrough/ClickThrough.js';
import { WalkingBehavior } from './features/character/WalkingBehavior.js';
import { SnitchTracker } from './features/security/SnitchTracker.js';
import { SoundManager } from './features/sound/SoundManager.js';
import { updateChecker } from './core/UpdateChecker.js';
import { WindowDrag } from './ui/WindowDrag.js';

import { ProjectDisplay } from './ui/ProjectDisplay.js';
import { AchievementToast } from './ui/AchievementToast.js';
import { ResourcePanel } from './ui/ResourcePanel.js';
import { SessionContextDisplay } from './ui/SessionContextDisplay.js';
class App {
  constructor() {
    this.settings = null;
    this.animator = null;
    this.character = null;
    this.characterReactions = null;
    this.timer = null;
    this.timerUI = null;
    this.breakScheduler = null;
    this.activityMonitor = null;
    this.projectDetector = null;
    this.fileSystemScanner = null;
    this.momentumTracker = null;
    this.notifier = null;
    this.boundaryAwareness = null;
    this.hydrationReminder = null;
    this.eyeStrainReminder = null;
    this.postureReminder = null;
    this.contextMenu = null;
    this.clickThrough = null;
    this.windowDrag = null;
    this.statusIndicator = null;
    this.projectDisplay = null;
    this.breakActivities = null;
    this.achievementSystem = null;
    this.achievementToast = null;
    this.sessionTracker = null;
    this.fatigueDetector = null;
    this.stuckDetector = null;
    this.overworkPrevention = null;
    this.encouragementSystem = null;
    this.celebrationSystem = null;
    this.celebrationEffect = null;
    this.celebrationToastTimer = null;
    this.resumeSuggester = null;
    this.learningDetector = null;
    this.resourceSuggester = null;
    this.resourcePanel = null;
    this.skillTracker = null;
    this.weeklySummary = null;
    this.personalBestTracker = null;
    this.dailyStreakTracker = null;
    this.sessionContext = null;
    this.sessionContextDisplay = null;
    this.claudeCodeTracker = null;
    this.aiPairTracker = null;
    this.focusMode = null;
    this.walkingBehavior = null;
    this.soundManager = null;
    this.speechBubbleTimer = null;
    this.snitchTracker = null;
    this._todayWinsIsQuitFlow = false;
  }

  async init() {
    console.log('Initializing Dr. Vibe...');

    // Initialize Tauri bridge
    await tauri.init();

    // Initialize unified database (before any features)
    await db.init();

    // Initialize settings first (other modules depend on it)
    this.settings = new Settings();
    await this.settings.init();

    // Initialize animator and character
    const canvas = document.getElementById('character-canvas');
    this.animator = new SpriteAnimator(canvas);
    await this.animator.init(this.settings.get('selectedSkin'), this.settings.get('selectedSkinTone'));

    this.character = new Character(this.animator);
    this.character.init();

    // Initialize timer
    this.timer = new Timer(this.settings.workInterval, this.settings.breakInterval);
    this.timerUI = new TimerUI();

    // Initialize character reactions (links activity/timer to character)
    this.characterReactions = new CharacterReactions(this.character);
    this.characterReactions.init();

    // Initialize break scheduler (coordinates multiple break triggers)
    this.breakScheduler = new BreakScheduler(this.settings, this.timer);
    this.breakScheduler.init();

    // Initialize break activity suggestions (mindful break activities)
    this.breakActivities = new BreakActivities();
    this.breakActivities.init();
    this.setupSpeechBubble();

    // --- Optional modules: each wrapped so failures don't break the app ---

    await this._initOptional('ActivityMonitor', async () => {
      this.activityMonitor = new ActivityMonitor(this.settings);
      this.activityMonitor.setIdleThreshold(this.settings.idleThresholdMinutes);
      this.activityMonitor.start();
    });

    await this._initOptional('ProjectDetector', async () => {
      this.projectDetector = new ProjectDetector();
      this.projectDetector.init();
      this.projectDetector.scanCommonDirectories();
    });

    await this._initOptional('FileSystemScanner', async () => {
      this.fileSystemScanner = new FileSystemScanner();
      await this.fileSystemScanner.init();
    });

    await this._initOptional('ClaudeCodeHooks', async () => {
      await tauri.installClaudeCodeHooks();
    });

    await this._initOptional('ClaudeCodeTracker', async () => {
      this.claudeCodeTracker = new ClaudeCodeTracker();
      await this.claudeCodeTracker.init();
    });

    await this._initOptional('AIPairTracker', async () => {
      this.aiPairTracker = new AIPairTracker();
      this.aiPairTracker.init();
    });

    await this._initOptional('SnitchTracker', async () => {
      this.snitchTracker = new SnitchTracker(this.settings);
      this.snitchTracker.init();
    });

    await this._initOptional('MomentumTracker', async () => {
      this.momentumTracker = new MomentumTracker();
      await this.momentumTracker.init();
      this.setupMomentumMeter();
    });

    await this._initOptional('SessionContext', async () => {
      this.sessionContext = new SessionContext();
      await this.sessionContext.init();
    });

    await this._initOptional('SessionTracker', async () => {
      this.sessionTracker = new SessionTracker();
      await this.sessionTracker.init();
    });

    await this._initOptional('FatigueDetector', async () => {
      this.fatigueDetector = new FatigueDetector(this.settings);
      this.fatigueDetector.init();
    });

    await this._initOptional('StuckDetector', async () => {
      this.stuckDetector = new StuckDetector(this.settings);
      this.stuckDetector.init();
    });

    await this._initOptional('OverworkPrevention', async () => {
      this.overworkPrevention = new OverworkPrevention(this.settings, this.sessionTracker);
      await this.overworkPrevention.init();
    });

    await this._initOptional('EncouragementSystem', async () => {
      this.encouragementSystem = new EncouragementSystem(this.settings);
      this.encouragementSystem.init();
    });

    await this._initOptional('CelebrationSystem', async () => {
      this.celebrationSystem = new CelebrationSystem(this.settings);
      this.celebrationSystem.init();
      this.celebrationEffect = new CelebrationEffect();
      this.celebrationEffect.init(this.animator);
      this.setupCelebrationToast();
    });

    await this._initOptional('ResumeSuggester', async () => {
      this.resumeSuggester = new ResumeSuggester(this.settings, this.sessionTracker);
      this.resumeSuggester.init();
    });

    await this._initOptional('LearningResources', async () => {
      this.learningDetector = new LearningDetector(this.settings);
      this.learningDetector.init();
      this.resourceSuggester = new ResourceSuggester(this.character, this.learningDetector);
      this.resourceSuggester.init();
    });

    await this._initOptional('SkillTracker', async () => {
      this.skillTracker = new SkillTracker();
      await this.skillTracker.init();
    });

    await this._initOptional('PersonalBestTracker', async () => {
      this.personalBestTracker = new PersonalBestTracker();
      await this.personalBestTracker.init();
    });

    await this._initOptional('DailyStreakTracker', async () => {
      this.dailyStreakTracker = new DailyStreakTracker();
      await this.dailyStreakTracker.init();
    });

    await this._initOptional('Notifier', async () => {
      this.notifier = new Notifier(this.settings);
      this.notifier.init();
      this.notifier.setEnabled(this.settings.notificationsEnabled);
      this._initToastWindow();
    });

    await this._initOptional('BoundaryAwareness', async () => {
      this.boundaryAwareness = new BoundaryAwareness(this.settings);
      this.boundaryAwareness.init();
      this.boundaryAwareness.start();
    });

    await this._initOptional('HydrationReminder', async () => {
      this.hydrationReminder = new HydrationReminder();
      this.hydrationReminder.loadState(this.settings.getAll());
      this.hydrationReminder.init();
    });

    await this._initOptional('EyeStrainReminder', async () => {
      this.eyeStrainReminder = new EyeStrainReminder();
      this.eyeStrainReminder.loadState(this.settings.getAll());
      this.eyeStrainReminder.init();
      this.setupEyeStrainOverlay();
    });

    await this._initOptional('PostureReminder', async () => {
      this.postureReminder = new PostureReminder();
      this.postureReminder.loadState(this.settings.getAll());
      this.postureReminder.init();
      this.setupPostureOverlay();
    });

    // Save hydration state back to settings when water is logged
    eventBus.on(Events.HYDRATION_LOGGED, ({ count }) => {
      this.settings.set('hydrationDailyCount', count);
    });
    eventBus.on(Events.HYDRATION_DAILY_RESET, () => {
      this.settings.set('hydrationDailyCount', 0);
      this.settings.set('hydrationLastReset', new Date().toISOString().slice(0, 10));
    });

    await this._initOptional('AchievementSystem', async () => {
      this.achievementSystem = new AchievementSystem();
      await this.achievementSystem.init();
    });

    // Celebrate achievement unlocks with full celebrating animation
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, () => {
      this.character.forceState('celebrating');
    });

    // Celebrate skill milestones
    eventBus.on(Events.SKILL_MILESTONE, ({ language, milestone }) => {
      this.character.setState('excited');
      this.notifier?.send(`${milestone} in ${language}!`, `You've reached ${milestone} of coding in ${language}!`, 'achievement');
    });

    // Celebrate personal bests with notification
    eventBus.on(Events.PERSONAL_BEST_SET, ({ label, formatted }) => {
      this.notifier?.send('New Personal Best!', `${label}: ${formatted.new}`, 'achievement');
    });

    // Celebrate streak milestones with notification
    eventBus.on(Events.STREAK_MILESTONE, ({ text, tip }) => {
      this.notifier?.send(text, tip, 'achievement');
    });

    // Gentle streak reminder notification
    eventBus.on(Events.STREAK_REMINDER, ({ text, tip }) => {
      this.notifier?.send(text, tip, 'achievement');
    });

    // Initialize UI components (toasts + resource panel stay in main window)
    await this._initOptional('AchievementToast', async () => {
      this.achievementToast = new AchievementToast(this.settings);
      this.achievementToast.init();
    });

    await this._initOptional('ResourcePanel', async () => {
      this.resourcePanel = new ResourcePanel(this.settings);
      this.resourcePanel.init();
    });

    await this._initOptional('WeeklySummary', async () => {
      this.weeklySummary = new WeeklySummary(this.sessionTracker);
      await this.weeklySummary.init();
    });

    this.windowDrag = new WindowDrag(this.settings);
    await this.windowDrag.init();
    await this.windowDrag.restorePosition();

    // Initialize walking behavior (moves window during idle)
    await this._initOptional('WalkingBehavior', async () => {
      this.walkingBehavior = new WalkingBehavior(this.settings, this.character, this.windowDrag);
      await this.walkingBehavior.init();
    });

    // Initialize sound effects (procedural character noises)
    await this._initOptional('SoundManager', async () => {
      this.soundManager = new SoundManager();
      this.soundManager.init(this.settings);
    });

    // Show window after positioning to avoid flash at default location
    if (tauri.isAvailable) {
      await tauri.showWindow();
      // Position and show the speech bubble window above Dr. Vibe
      await this.repositionSpeechWindow();
      this._showSpeechWindow();
    }

    // Reposition speech bubble when main window is dragged
    eventBus.on(Events.WINDOW_DRAG_END, () => {
      this.repositionSpeechWindow();
    });

    // Initialize project display (shows active project name)
    this.projectDisplay = new ProjectDisplay();
    this.projectDisplay.init();

    // Initialize session context display (shows active files)
    this.sessionContextDisplay = new SessionContextDisplay();
    this.sessionContextDisplay.init();

    // Initialize focus mode (before click-through so elements exist)
    await this._initOptional('FocusMode', async () => {
      this.focusMode = new FocusMode(this.settings);
      this.focusMode.init();
    });

    // Initialize click-through (after UI elements are ready)
    await this._initOptional('ClickThrough', async () => {
      this.clickThrough = new ClickThrough(this.settings);
      await this.clickThrough.init();
    });

    // Context menu removed — use system tray instead

    // Panel toggles — open as separate windows
    eventBus.on(Events.ABOUT_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('about', 'about.html', 'About Dr. Vibe', 320, 540, false);
    });

    eventBus.on(Events.SESSION_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('session', 'session.html', 'Session Stats', 380, 580, true);
    });

    eventBus.on(Events.ACHIEVEMENT_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('achievements', 'achievements.html', 'Achievements', 400, 500, true);
    });

    eventBus.on(Events.SKILL_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('skills', 'skills.html', 'Skill Development', 400, 480, true);
    });

    eventBus.on(Events.WEEKLY_SUMMARY_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('weekly', 'weekly.html', 'Weekly Report', 420, 560, true);
    });

    eventBus.on(Events.TODAY_WINS_TOGGLE, () => {
      this._openTodayWins(false);
    });

    eventBus.on(Events.PERSONAL_BEST_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('personal-bests', 'personal-bests.html', 'Personal Bests', 400, 500, true);
    });

    // Auto-open weekly report window when summary is ready
    eventBus.on(Events.WEEKLY_SUMMARY_AVAILABLE, () => {
      tauri.openPanelWindow('weekly', 'weekly.html', 'Weekly Report', 420, 560, true);
    });

    // Listen for tray menu events from Rust backend
    if (tauri.isAvailable && tauri.window) {
      // tray-about now handled directly by Rust (opens about window)

      // Intercept quit to show Today's Wins summary
      // Note: Rust opens the today-wins window directly before emitting this event
      tauri.window.listen('tray-quit', () => {
        eventBus.emit(Events.APP_QUIT_REQUESTED, {});
        this._sendTodayWinsQuitData();
        // Failsafe: if the Today's Wins window doesn't respond within 10 seconds, quit anyway
        this._quitFailsafeTimer = setTimeout(async () => {
          console.log('Today\'s Wins quit failsafe triggered - forcing quit');
          try { await this.shutdown(); } catch (e) { console.error('Shutdown error:', e); }
          tauri.quitApp();
        }, 10000);
      });

      // Listen for quit confirmation from Today's Wins window
      tauri.window.listen('today-wins-quit-confirmed', async () => {
        if (this._quitFailsafeTimer) clearTimeout(this._quitFailsafeTimer);
        try { await this.shutdown(); } catch (e) { console.error('Shutdown error:', e); }
        tauri.quitApp();
      });

      // Listen for quit cancellation (user clicked "Keep going!")
      tauri.window.listen('today-wins-quit-cancelled', () => {
        if (this._quitFailsafeTimer) clearTimeout(this._quitFailsafeTimer);
      });

      // Listen for settings saved from the separate settings window
      tauri.window.listen('settings-saved', (event) => {
        const saved = event.payload;
        for (const [key, value] of Object.entries(saved)) {
          // Use set() so values are validated/clamped and events are emitted
          this.settings.set(key, value);
        }
        // Update timer with potentially new intervals
        this.timer.setIntervals(this.settings.workInterval, this.settings.breakInterval);
      });

      // Forward live data to dashboard window on request
      tauri.window.listen('dashboard-request-data', () => {
        this._sendDashboardData();
      });

      // Respond to panel data requests from standalone windows
      tauri.window.listen('session-request-data', () => {
        this._sendSessionData();
      });

      tauri.window.listen('today-wins-request-data', () => {
        this._sendTodayWinsData(this._todayWinsIsQuitFlow || false);
      });

      tauri.window.listen('personal-bests-request-data', () => {
        this._sendPersonalBestsData();
      });

      tauri.window.listen('weekly-request-data', () => {
        this._sendWeeklyData();
      });

      // Handle debug commands from the debug window
      tauri.window.listen('debug-command', (event) => {
        this._handleDebugCommand(event.payload);
      });

      // Periodically forward live data to dashboard (every 10s)
      this._dashboardInterval = setInterval(() => {
        this._sendDashboardData();
      }, 10000);

      // Periodically send live data to open panel windows (every 5s)
      this._panelDataInterval = setInterval(() => {
        this._sendSessionData();
        this._sendPersonalBestsData();
      }, 5000);
    }

    // Update timer and break system when settings change
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'workInterval' || key === 'breakInterval') {
        this.timer.setIntervals(this.settings.workInterval, this.settings.breakInterval);
      }
      if (key === 'idleThresholdMinutes') {
        this.activityMonitor.setIdleThreshold(value);
      }
    });

    // Start game loop
    gameLoop.add((deltaTime) => {
      this.character.update(deltaTime);
      this.walkingBehavior.update(deltaTime);
      this.achievementSystem.update();
    });
    gameLoop.start();

    // Start timer
    this.timer.start();

    // Safety net: flush database on unexpected page unload
    window.addEventListener('beforeunload', () => {
      db.saveNow();
    });

    eventBus.emit(Events.APP_READY, {});
    console.log('Dr. Vibe initialized!');

    // Check for updates 30 seconds after startup (silent, non-blocking)
    updateChecker.scheduleCheck();
  }

  async _initOptional(name, fn) {
    try {
      await fn();
    } catch (e) {
      console.error(`[init] ${name} failed to initialize — skipping:`, e);
    }
  }

  setupSpeechBubble() {
    // The speech bubble window is defined in tauri.conf.json and created on startup.
    // It starts hidden and transparent — we just send events to show/hide content.
    this._speechBubbleReady = tauri.isAvailable;

    // Listen for dismiss events from the speech window
    if (tauri.isAvailable && tauri.window) {
      tauri.window.listen('speech-dismissed', () => {
        // Handle any post-dismiss logic (e.g. stuck dismissed)
        if (this._speechDismissCallback) {
          this._speechDismissCallback();
          this._speechDismissCallback = null;
        }
      });
    }

    const popupMs = () => (this.settings?.get('popupDuration') || 20) * 1000;

    const showSpeech = (text, tip, onDismiss) => {
      this._speechDismissCallback = onDismiss || null;
      this._emitToSpeech('speech-show', { text, tip, durationMs: popupMs() });
      this.soundManager?.playChatNoise(text);
    };

    const hideSpeech = () => {
      this._emitToSpeech('speech-hide', {});
    };

    eventBus.on(Events.BREAK_ACTIVITY_SUGGESTED, ({ text, tip }) => {
      showSpeech(text, tip);
    });

    // Hide bubble when break ends
    eventBus.on(Events.TIMER_BREAK_COMPLETE, hideSpeech);

    // Show encouragement messages in speech bubble
    eventBus.on(Events.ENCOURAGEMENT_TRIGGERED, ({ text, tip }) => {
      showSpeech(text, tip);
      this.character?.setState('excited');
    });

    // Show stuck detection messages in speech bubble
    eventBus.on(Events.STUCK_DETECTED, ({ message }) => {
      showSpeech(message.body, message.tip, () => {
        eventBus.emit(Events.STUCK_DISMISSED, {});
      });
    });

    // Show resume suggestions in speech bubble
    eventBus.on(Events.RESUME_SUGGESTION_TRIGGERED, ({ text, tip }) => {
      showSpeech(text, tip, () => {
        eventBus.emit(Events.RESUME_DISMISSED, {});
      });
    });

    // Show streak milestone celebrations in speech bubble
    eventBus.on(Events.STREAK_MILESTONE, ({ text, tip }) => {
      showSpeech(text, tip);
    });

    // Show streak reminders in speech bubble
    eventBus.on(Events.STREAK_REMINDER, ({ text, tip }) => {
      showSpeech(text, tip);
    });

    // Show streak recovery message in speech bubble
    eventBus.on(Events.STREAK_RECOVERED, ({ text, tip }) => {
      showSpeech(text, tip);
    });

    // Show timer milestone messages in speech bubble
    eventBus.on(Events.TIMER_SPEECH, ({ text, tip }) => {
      showSpeech(text, tip);
    });

    // Show hydration reminders in speech bubble
    eventBus.on(Events.HYDRATION_REMINDER, ({ title, body }) => {
      showSpeech(
        title || 'Time for water!',
        body || 'Stay hydrated — your brain needs it.'
      );
    });

    // --- Claude Code integration speech events ---

    // Feature 1: Hotspot File Commentary
    eventBus.on(Events.CLAUDE_CODE_HOTSPOT, ({ text }) => {
      showSpeech(text, 'Hotspot file detected');
    });

    // Feature 2: Refactor Radar
    eventBus.on(Events.CLAUDE_CODE_PATTERN, ({ text, pattern }) => {
      const tips = {
        research: 'Claude is reading more than writing.',
        rampage: 'Claude is making lots of changes at once!',
        surgical: 'Precise, targeted edit detected.',
      };
      showSpeech(text, tips[pattern] || 'Coding pattern detected');
    });

    // Feature 3: AI Pair Programming Milestones
    eventBus.on(Events.AI_PAIR_MILESTONE, ({ text, tip }) => {
      showSpeech(text, tip);
    });

    // Feature 3: AI Pair Started
    eventBus.on(Events.AI_PAIR_STARTED, () => {
      showSpeech(
        'Pair programming session started!',
        'You and Claude are both active — let\'s go!'
      );
    });

    // Feature 5: Project Journey Narrator (session summary)
    eventBus.on(Events.CLAUDE_CODE_SUMMARY, ({ text }) => {
      showSpeech(text, 'Session wrap-up');
    });

    // Feature 7: Bug Squash Detector — fix cycles
    eventBus.on(Events.CLAUDE_CODE_FIX_CYCLE, ({ text }) => {
      showSpeech(text, 'Fix-test cycle detected');
    });

    // Feature 7: Bug Squash Detector — bug fixed!
    eventBus.on(Events.CLAUDE_CODE_BUG_FIXED, ({ text }) => {
      showSpeech(text, 'Bug squashed!');
    });

    // Feature 8: New File Celebration
    eventBus.on(Events.CLAUDE_CODE_FILE_CREATED, ({ text }) => {
      showSpeech(text, 'New file created');
    });

    // Feature 10: Code Insights
    eventBus.on(Events.CLAUDE_CODE_INSIGHT, ({ text, pattern }) => {
      const tips = {
        deep_dive: 'Claude is thoroughly investigating this area.',
        cross_cutting: 'Changes spanning multiple directories.',
      };
      showSpeech(text, tips[pattern] || 'Code insight');
    });

    // Claude Code session start
    eventBus.on(Events.CLAUDE_CODE_SESSION_START, ({ projectName }) => {
      showSpeech(
        `Claude just joined the session!`,
        projectName ? `Working on: ${projectName}` : 'A new Claude Code session started.'
      );
    });

    // Snitch security scan suggestion
    eventBus.on(Events.SNITCH_SCAN_SUGGESTED, ({ text, tip }) => {
      this.character?.setState('worried');
      showSpeech(text, tip);
    });
  }

  _showSpeechWindow() {
    try {
      const { emitTo } = window.__TAURI__.event;
      // Tell the speech window to show itself (it handles its own window.show())
      emitTo('speech', 'speech-init', {});
    } catch (e) {
      // Speech window may not be ready yet
    }
  }

  _emitToSpeech(event, payload) {
    try {
      const { emitTo } = window.__TAURI__.event;
      emitTo('speech', event, payload);
    } catch (e) {
      // Speech window may not be open
    }
  }

  _initToastWindow() {
    try {
      const { emitTo } = window.__TAURI__.event;
      const position = this.settings?.get('notificationPosition') || 'bottom-right';
      emitTo('toast', 'toast-init', { position });
    } catch (e) {
      // Toast window may not be ready yet
    }
  }

  async repositionSpeechWindow() {
    if (!tauri.isAvailable || !this._speechBubbleReady) return;
    try {
      const pos = await tauri.getWindowPosition();
      const speechHeight = 100; // matches the speech window height
      // Clamp Y so the speech bubble never goes off-screen
      const y = Math.max(0, pos.y - speechHeight);
      this._emitToSpeech('speech-reposition', {
        x: pos.x,
        y
      });
    } catch (e) {
      // Ignore positioning errors
    }
  }

  setupEyeStrainOverlay() {
    const overlay = document.getElementById('eye-strain-overlay');
    const messageEl = document.getElementById('eye-strain-message');
    const countdownEl = document.getElementById('eye-strain-countdown');
    const snoozeBtn = document.getElementById('eye-strain-snooze');
    const canvas = document.getElementById('character-canvas');
    if (!overlay || !messageEl || !countdownEl || !snoozeBtn) return;

    const removeDim = () => canvas?.classList.remove('cover-eyes-dim');

    eventBus.on(Events.EYE_STRAIN_REMINDER, ({ title }) => {
      messageEl.textContent = title;
      countdownEl.textContent = '20';
      overlay.classList.remove('hidden');
      canvas?.classList.add('cover-eyes-dim');
    });

    eventBus.on(Events.EYE_STRAIN_COUNTDOWN, ({ remaining }) => {
      countdownEl.textContent = remaining;
    });

    eventBus.on(Events.EYE_STRAIN_COMPLETE, () => {
      overlay.classList.add('hidden');
      removeDim();
    });

    snoozeBtn.addEventListener('click', () => {
      this.eyeStrainReminder.snooze();
      overlay.classList.add('hidden');
      removeDim();
    });

    eventBus.on(Events.EYE_STRAIN_SNOOZED, () => {
      overlay.classList.add('hidden');
      removeDim();
    });

    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'eyeStrainEnabled' && !value) {
        overlay.classList.add('hidden');
        removeDim();
      }
    });
  }

  setupPostureOverlay() {
    const overlay = document.getElementById('posture-overlay');
    const messageEl = document.getElementById('posture-message');
    const tipEl = document.getElementById('posture-tip');
    const countdownEl = document.getElementById('posture-countdown');
    const snoozeBtn = document.getElementById('posture-snooze');
    if (!overlay || !messageEl || !tipEl || !countdownEl || !snoozeBtn) return;

    eventBus.on(Events.POSTURE_REMINDER, ({ title, tip }) => {
      messageEl.textContent = title;
      tipEl.textContent = tip;
      countdownEl.textContent = '15';
      overlay.classList.remove('hidden');
    });

    eventBus.on(Events.POSTURE_COUNTDOWN, ({ remaining }) => {
      countdownEl.textContent = remaining;
    });

    eventBus.on(Events.POSTURE_COMPLETE, () => {
      overlay.classList.add('hidden');
    });

    snoozeBtn.addEventListener('click', () => {
      this.postureReminder.snooze();
      overlay.classList.add('hidden');
    });

    eventBus.on(Events.POSTURE_SNOOZED, () => {
      overlay.classList.add('hidden');
    });

    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'postureReminderEnabled' && !value) {
        overlay.classList.add('hidden');
      }
    });
  }

  setupCelebrationToast() {
    const toast = document.getElementById('celebration-toast');
    if (!toast) return;

    const FADE_MS = 300;

    eventBus.on(Events.CELEBRATION_TRIGGERED, ({ message, tip }) => {
      if (this.celebrationToastTimer) {
        clearTimeout(this.celebrationToastTimer);
      }

      toast.innerHTML = `
        <div class="celebration-toast-icon">&#127881;</div>
        <div class="celebration-toast-text">
          <span class="celebration-toast-label">Progress!</span>
          <span class="celebration-toast-title">${message}</span>
          <span class="celebration-toast-desc">${tip}</span>
        </div>
      `;

      toast.classList.remove('hidden', 'celebration-toast-exit');
      toast.classList.add('celebration-toast-enter');

      const duration = (this.settings?.get('popupDuration') || 20) * 1000;
      this.celebrationToastTimer = setTimeout(() => {
        toast.classList.remove('celebration-toast-enter');
        toast.classList.add('celebration-toast-exit');

        setTimeout(() => {
          toast.classList.add('hidden');
          toast.classList.remove('celebration-toast-exit');
        }, FADE_MS);
      }, duration);
    });
  }


  setupMomentumMeter() {
    const meter = document.getElementById('momentum-meter');
    const fill = document.getElementById('momentum-fill');
    if (!meter || !fill) return;

    eventBus.on(Events.MOMENTUM_CHANGED, ({ momentum, level }) => {
      fill.style.width = `${momentum}%`;
      fill.className = level;
      meter.title = `Momentum: ${level} (${momentum}%)`;
    });
  }

  _handleDebugCommand({ command, payload }) {
    const momentumLevels = { cold: 0, warming: 30, flowing: 50, hot: 75, fire: 100 };

    switch (command) {
      case 'suppress':
        if (this.characterReactions) {
          this.characterReactions.suppressed = !!payload;
          console.log(`Character reactions ${payload ? 'suppressed' : 'resumed'} (debug menu)`);
        }
        break;

      case 'animation':
        this.character?.forceState(payload);
        break;

      case 'timer':
        if (payload === 'start') this.timer?.start();
        else if (payload === 'pause') this.timer?.pause();
        else if (payload === 'resume') this.timer?.resume();
        else if (payload === 'stop') this.timer?.stop();
        break;

      case 'momentum':
        eventBus.emit(Events.MOMENTUM_CHANGED, { momentum: momentumLevels[payload] ?? 0, level: payload });
        break;

      case 'focus':
        if (payload === 'start') this.focusMode?.start();
        else if (payload === 'stop') this.focusMode?.stop();
        break;

      case 'achievement':
        this.achievementSystem?.checkAndUnlock(payload, 1);
        break;

      case 'walk':
        if (payload === 'start') this.walkingBehavior?.forceWalk();
        else if (payload === 'stop') this.walkingBehavior?.forceStop();
        break;

      case 'openSettings':
        tauri.openSettingsWindow();
        break;

      case 'notification':
        this.notifier?.send('Debug Test', 'This is a test notification from the debug menu.');
        break;

      case 'event':
        this._emitDebugEvent(payload);
        break;
    }
  }

  _emitDebugEvent(eventKey) {
    const eventData = {
      'timer:workComplete': [Events.TIMER_WORK_COMPLETE, {}],
      'timer:breakStart': [Events.TIMER_BREAK_START, {}],
      'timer:breakComplete': [Events.TIMER_BREAK_COMPLETE, {}],
      'timer:speech': [Events.TIMER_SPEECH, { text: 'Keep going!', tip: 'Debug test message' }],
      'activity:codingStart': [Events.ACTIVITY_CODING_START, { appName: 'VS Code (Debug)' }],
      'activity:codingStop': [Events.ACTIVITY_CODING_STOP, {}],
      'activity:idle': [Events.ACTIVITY_IDLE, { idleTimeMs: 300000 }],
      'activity:windowSwitch': [Events.ACTIVITY_WINDOW_SWITCH, {}],
      'project:detected': [Events.PROJECT_DETECTED, { name: 'debug-project', path: '/test/debug-project' }],
      'project:lost': [Events.PROJECT_LOST, {}],
      'stuck:detected': [Events.STUCK_DETECTED, { message: { body: 'Stuck detected (debug)', tip: 'Try breaking the problem into smaller pieces.' } }],
      'fatigue:detected': [Events.FATIGUE_DETECTED, {}],
      'overwork:warning': [Events.OVERWORK_WARNING, {}],
      'hydration:reminder': [Events.HYDRATION_REMINDER, { title: 'Time for water!', body: 'Stay hydrated \u2014 your brain needs it.' }],
      'hydration:logged': [Events.HYDRATION_LOGGED, { count: (this.hydrationReminder?.dailyCount ?? 0) + 1 }],
      'eyestrain:reminder': [Events.EYE_STRAIN_REMINDER, { title: 'Look away for 20 seconds' }],
      'eyestrain:complete': [Events.EYE_STRAIN_COMPLETE, {}],
      'posture:reminder': [Events.POSTURE_REMINDER, { title: 'Check your posture!', tip: 'Sit up straight, shoulders back.' }],
      'posture:complete': [Events.POSTURE_COMPLETE, {}],
      'boundary:reminderSent': [Events.BOUNDARY_REMINDER_SENT, {}],
      'break:activitySuggested': [Events.BREAK_ACTIVITY_SUGGESTED, { text: 'Take a stretch break!', tip: 'Stand up and reach for the sky.' }],
      'ui:sessionPanelToggle': [Events.SESSION_PANEL_TOGGLE, {}],
      'ui:aboutPanelToggle': [Events.ABOUT_PANEL_TOGGLE, {}],
      'ui:achievementPanelToggle': [Events.ACHIEVEMENT_PANEL_TOGGLE, {}],
      'ui:skillPanelToggle': [Events.SKILL_PANEL_TOGGLE, {}],
      'ui:weeklySummaryPanelToggle': [Events.WEEKLY_SUMMARY_PANEL_TOGGLE, {}],
      'ui:todayWinsToggle': [Events.TODAY_WINS_TOGGLE, {}],
      'ui:personalBestPanelToggle': [Events.PERSONAL_BEST_PANEL_TOGGLE, {}],
      'ui:sessionContextToggle': [Events.SESSION_CONTEXT_TOGGLE, {}],
      'encouragement:triggered': [Events.ENCOURAGEMENT_TRIGGERED, { text: "You're doing great!", tip: 'Keep up the momentum.' }],
      'celebration:triggered': [Events.CELEBRATION_TRIGGERED, { message: 'Milestone reached!', tip: 'You hit a new record.' }],
      'resume:suggestionTriggered': [Events.RESUME_SUGGESTION_TRIGGERED, { text: 'Pick up where you left off', tip: 'You were working on app.js' }],
      'learning:resourceSuggested': [Events.LEARNING_RESOURCE_SUGGESTED, { message: 'Debug resource suggestion', resources: [{ title: 'Example Resource', url: 'https://example.com' }] }],
      'streak:milestone': [Events.STREAK_MILESTONE, { text: '7-day streak!', tip: "You've coded every day this week." }],
      'streak:reminder': [Events.STREAK_REMINDER, { text: "Don't break your streak!", tip: 'Code a little today to keep it going.' }],
      'streak:broken': [Events.STREAK_BROKEN, {}],
      'streak:recovered': [Events.STREAK_RECOVERED, { text: 'Streak recovered!', tip: 'Welcome back, coder.' }],
      'skill:milestone': [Events.SKILL_MILESTONE, { language: 'JavaScript', milestone: '10 hours' }],
      'personalBest:set': [Events.PERSONAL_BEST_SET, { label: 'Longest Session', formatted: { new: '2h 30m', old: '1h 45m' } }],
      'achievement:unlocked': [Events.ACHIEVEMENT_UNLOCKED, { id: 'hello_world', name: 'Hello World', description: 'Start your first session', icon: '\uD83D\uDC4B' }],
      'claudeCode:sessionStart': [Events.CLAUDE_CODE_SESSION_START, { sessionId: 'debug-session', cwd: '/test/project', projectName: 'debug-project' }],
      'claudeCode:fileChanged': [Events.CLAUDE_CODE_FILE_CHANGED, { path: '/test/project/src/app.js', tool: 'Edit', sessionId: 'debug-session', cwd: '/test/project' }],
      'claudeCode:active': [Events.CLAUDE_CODE_ACTIVE, { sessionId: 'debug-session', cwd: '/test/project' }],
      'claudeCode:idle': [Events.CLAUDE_CODE_IDLE, { sessionId: 'debug-session' }],
      'claudeCode:hotspot': [Events.CLAUDE_CODE_HOTSPOT, { path: '/test/project/src/app.js', editCount: 6, text: 'app.js again? That file is getting a workout!' }],
      'claudeCode:pattern': [Events.CLAUDE_CODE_PATTERN, { pattern: 'rampage', reads: 2, writes: 8, text: '8 files modified! Claude is rewriting the world.' }],
      'claudeCode:fileCreated': [Events.CLAUDE_CODE_FILE_CREATED, { path: '/test/project/src/NewComponent.js', text: 'New file alert: NewComponent.js just entered the chat!' }],
      'claudeCode:fixCycle': [Events.CLAUDE_CODE_FIX_CYCLE, { cycleCount: 3, text: 'Bug hunt mode: 3 fix-test cycles and counting.' }],
      'claudeCode:bugFixed': [Events.CLAUDE_CODE_BUG_FIXED, { cycleCount: 3, text: 'Clean run after 3 cycles. Victory!' }],
      'claudeCode:insight': [Events.CLAUDE_CODE_INSIGHT, { pattern: 'cross_cutting', count: 5, text: 'Edits spanning 5 directories. Big picture stuff.' }],
      'claudeCode:summary': [Events.CLAUDE_CODE_SUMMARY, { text: 'This session: 12 files changed, 8 read. Top language: JavaScript. Most edited: app.js.' }],
      'aiPair:milestone': [Events.AI_PAIR_MILESTONE, { seconds: 1800, label: '30 minutes', text: '30 minutes of pair programming!', tip: 'You two are in sync.' }],
      'aiPair:started': [Events.AI_PAIR_STARTED, { startedAt: Date.now() }],
      'aiPair:ended': [Events.AI_PAIR_ENDED, { duration: 3600, startedAt: Date.now() - 3600000 }],
      'snitch:scanSuggested': [Events.SNITCH_SCAN_SUGGESTED, { mode: 'diff', fileCount: 7, cwd: '/test/project', projectName: 'debug-project', text: '7 files just changed. Worth a quick security check before you ship?', tip: 'Run /snitch --diff in your terminal.' }],
    };

    const entry = eventData[eventKey];
    if (entry) {
      eventBus.emit(entry[0], entry[1]);
    }
  }

  _sendDashboardData() {
    try {
      const { emitTo } = window.__TAURI__.event;
      emitTo('dashboard', 'dashboard-live-data', {
        sessionStats: this.sessionTracker.getStats(),
        momentum: this.momentumTracker.getState(),
        hydrationCount: this.hydrationReminder?.dailyCount ?? 0,
        streakData: this.dailyStreakTracker.getData(),
        claudeCode: this.claudeCodeTracker?.getStats() ?? null,
        aiPair: this.aiPairTracker?.getState() ?? null,
      });
    } catch (e) {
      // Dashboard window may not be open - ignore
    }
  }

  _openTodayWins(isQuitFlow) {
    this._todayWinsIsQuitFlow = isQuitFlow;
    tauri.openPanelWindow('today-wins', 'today-wins.html', "Today's Wins", 360, 400, true);
    // Send data with retries - WebView2 on Windows can be slow to initialize
    const sendData = () => this._sendTodayWinsData(isQuitFlow);
    setTimeout(sendData, 300);
    setTimeout(sendData, 800);
    setTimeout(sendData, 1500);
  }

  _sendTodayWinsQuitData() {
    // Rust already opened the today-wins window; just send data with retries
    this._todayWinsIsQuitFlow = true;
    const sendData = () => this._sendTodayWinsData(true);
    setTimeout(sendData, 300);
    setTimeout(sendData, 800);
    setTimeout(sendData, 1500);
  }

  _sendSessionData() {
    try {
      const { emitTo } = window.__TAURI__.event;
      const stats = this.sessionTracker.getStats();
      emitTo('session', 'session-data', stats);
    } catch (e) {
      // Session window may not be open - ignore
    }
  }

  _sendTodayWinsData(isQuitFlow) {
    try {
      const { emitTo } = window.__TAURI__.event;
      const stats = this.sessionTracker.getStats();
      emitTo('today-wins', 'today-wins-data', { stats, isQuitFlow });
    } catch (e) {
      // Today's Wins window may not be open - ignore
    }
  }

  _sendPersonalBestsData() {
    try {
      const { emitTo } = window.__TAURI__.event;
      const stats = this.sessionTracker.getStats();
      const momentum = this.momentumTracker.getState();
      emitTo('personal-bests', 'personal-bests-data', {
        codingSeconds: stats.codingSeconds,
        filesCreated: stats.filesCreated,
        filesModified: stats.filesModified,
        streak: stats.streak,
        peakMomentum: momentum.momentum,
      });
    } catch (e) {
      // Personal Bests window may not be open - ignore
    }
  }

  async _sendWeeklyData() {
    try {
      const { emitTo } = window.__TAURI__.event;
      const summary = await this.weeklySummary.getSummary();
      if (summary) {
        emitTo('weekly', 'weekly-data', summary);
      }
    } catch (e) {
      // Weekly window may not be open - ignore
    }
  }

  async shutdown() {
    // Close the speech bubble and toast windows
    try {
      const speechWin = window.__TAURI__?.window?.WebviewWindow?.getByLabel('speech');
      if (speechWin) await speechWin.destroy();
    } catch (e) { /* ignore */ }
    try {
      const toastWin = window.__TAURI__?.window?.WebviewWindow?.getByLabel('toast');
      if (toastWin) await toastWin.destroy();
    } catch (e) { /* ignore */ }
    if (this._dashboardInterval) clearInterval(this._dashboardInterval);
    if (this._panelDataInterval) clearInterval(this._panelDataInterval);
    if (this.celebrationToastTimer) clearTimeout(this.celebrationToastTimer);
    if (this.speechBubbleTimer) clearTimeout(this.speechBubbleTimer);
    if (this._quitFailsafeTimer) clearTimeout(this._quitFailsafeTimer);
    gameLoop.stop();
    this.activityMonitor?.stop();
    this.projectDetector?.destroy();
    this.fileSystemScanner?.destroy();
    this.claudeCodeTracker?.destroy();
    this.aiPairTracker?.destroy();
    this.snitchTracker?.destroy();
    this.momentumTracker?.destroy();
    this.sessionContext?.destroy();
    this.sessionTracker?.destroy();
    this.fatigueDetector?.destroy();
    this.stuckDetector?.destroy();
    this.overworkPrevention?.destroy();
    this.weeklySummary?.destroy();
    this.encouragementSystem?.destroy();
    this.celebrationSystem?.destroy();
    this.celebrationEffect?.destroy();
    this.resumeSuggester?.destroy();
    this.skillTracker?.destroy();
    this.personalBestTracker?.destroy();
    this.dailyStreakTracker?.destroy();
    this.timer.stop();
    this.boundaryAwareness?.stop();
    this.hydrationReminder?.destroy();
    this.eyeStrainReminder?.destroy();
    this.postureReminder?.destroy();
    this.focusMode?.destroy();
    this.clickThrough?.destroy();
    this.walkingBehavior?.destroy();
    this.soundManager?.destroy();
    this.windowDrag?.destroy();
    await tauri.uninstallClaudeCodeHooks();
    await db.saveNow();
    console.log('Dr. Vibe shutdown');
  }
}

// Create and start app
const app = new App();
app.init().catch(console.error);

// Export for potential external access
export { app };
