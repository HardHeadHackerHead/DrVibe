// Dr. Vibe - Main Application Orchestrator

import { eventBus, Events } from './core/EventBus.js';
import { tauri } from './core/TauriBridge.js';
import { gameLoop } from './core/GameLoop.js';
import { db } from './core/Database.js';
import { IS_DEV, WEB_BASE, reloadWebBase, syncWebBaseFromRust } from './core/config.js';

import { SpriteAnimator } from './features/character/SpriteAnimator.js';
import { Character } from './features/character/Character.js';
import { CharacterReactions } from './features/character/CharacterReactions.js';

import { Timer } from './features/timer/Timer.js';
import { TimerUI } from './features/timer/TimerUI.js';
import { BreakScheduler } from './features/timer/BreakScheduler.js';

import { ActivityMonitor } from './features/activity/ActivityMonitor.js';
import { ProjectDetector } from './features/activity/ProjectDetector.js';
import { TrackedRepos } from './features/activity/TrackedRepos.js';
import { MomentumTracker } from './features/activity/MomentumTracker.js';
import { StuckDetector } from './features/activity/StuckDetector.js';
import { ClaudeCodeTracker } from './features/activity/ClaudeCodeTracker.js';
import { applyClaudeHooksSetting } from './features/activity/claudeHooks.js';
import { AIPairTracker } from './features/activity/AIPairTracker.js';
import { AntiGravityTracker } from './features/activity/AntiGravityTracker.js';
import { GitTracker } from './features/activity/GitTracker.js';
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
import { WeeklyRecapSync } from './features/session/WeeklyRecap.js';
import { EncouragementSystem } from './features/encouragement/EncouragementSystem.js';
import { CelebrationSystem } from './features/encouragement/CelebrationSystem.js';
import { CelebrationEffect } from './features/encouragement/CelebrationEffect.js';
import { ResumeSuggester } from './features/resume/ResumeSuggester.js';

import { LearningDetector } from './features/learning/LearningDetector.js';
import { ResourceSuggester } from './features/learning/ResourceSuggester.js';

import { SkillTracker } from './features/skills/SkillTracker.js';
import { PersonalBestTracker } from './features/personalBest/PersonalBestTracker.js';
import { DailyStreakTracker } from './features/streak/DailyStreakTracker.js';
import { StreakDisplay } from './features/streak/StreakDisplay.js';
import { FocusMode } from './features/focus/FocusMode.js';
import { ClickThrough } from './features/clickthrough/ClickThrough.js';
import { WalkingBehavior } from './features/character/WalkingBehavior.js';
import { NudgeBehavior } from './features/character/NudgeBehavior.js';
import { SoundManager } from './features/sound/SoundManager.js';
import { WindowDrag } from './ui/WindowDrag.js';

import { ProjectDisplay } from './ui/ProjectDisplay.js';
import { ResourcePanel } from './ui/ResourcePanel.js';
import { eventHistory } from './core/EventHistory.js';
import { storyGenerator } from './core/StoryGenerator.js';
import { accountState } from './core/AccountState.js';
import { PollClient } from './core/PollClient.js';
import { createProfileRefresher } from './core/accountProfile.js';
import { privacySync } from './features/privacy/PrivacySync.js';
import { PresenceGuard } from './features/presence/PresenceGuard.js';
import { VisitorController, visitSpeech } from './features/visits/VisitorController.js';
import { communityFromSync, visitErrorMessage } from './core/api/contract.js';
import { desktopApi } from './core/api/client.js';
import { WebRoutes } from './core/api/endpoints.js';
import { companionManager } from './features/companion/CompanionManager.js';
import { balanceManager } from './features/economy/BalanceManager.js';
import { economyClient } from './features/economy/EconomyClient.js';
import { activityReporter } from './features/economy/ActivityReporter.js';
import { installErrorReporter } from './core/errorReporter.js';
import { localDay } from './core/localDay.js';

// Crash reports to drvibe.io's own /errors endpoint (opt-out in Settings → Privacy).
installErrorReporter();
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
    this.trackedRepos = null;
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
    this.weeklyRecap = null;
    this.personalBestTracker = null;
    this.dailyStreakTracker = null;
    this.streakDisplay = null;
    this.claudeCodeTracker = null;
    this.aiPairTracker = null;
    this.antiGravityTracker = null;
    this.gitTracker = null;
    this.focusMode = null;
    this.walkingBehavior = null;
    this.nudgeBehavior = null;
    this.soundManager = null;
    this.pollClient = null;
    this.presenceGuard = null;
    this.visitorController = null;
    this.speechBubbleTimer = null;
    this._todayWinsIsQuitFlow = false;
  }

  async init() {
    console.log('Initializing Dr. Vibe...');

    // Initialize Tauri bridge
    await tauri.init();

    // Sync WEB_BASE with whatever Rust resolved at startup. This is what
    // makes `npm run dev:prod` (DR_VIBE_WEB_BASE_URL=https://drvibe.io) work
    // — without it, JS would pick its server URL from the
    // live-server port and diverge from Rust.
    await syncWebBaseFromRust();
    console.log('[dr-vibe] WEB_BASE =', WEB_BASE);

    // Initialize unified database (before any features)
    await db.init();

    // Initialize settings first (other modules depend on it)
    this.settings = new Settings();
    await this.settings.init();

    // First-run setup wizard: open if the user hasn't completed it yet
    const setupState = db.getSection('setupWizard');
    if (!setupState || !setupState.completed) {
      tauri.openPanelWindow('setup-wizard', 'setup-wizard.html', 'Welcome to Dr. Vibe', 560, 640, false, false);
    }

    // Initialize animator and character
    const canvas = document.getElementById('character-canvas');
    this.animator = new SpriteAnimator(canvas);
    try {
      await this.animator.init(this.settings.get('selectedSkin'), this.settings.get('selectedSkinTone'), this.settings.get('characterScale'));
    } catch (err) {
      // One broken asset must not stop the window from showing.
      console.error('Animator init failed, using placeholder sprites:', err);
      try {
        this.animator.createPlaceholderSprites();
        this.animator.preSliceFrames();
        this.animator.needsRender = true;
      } catch (e) {
        console.error('Placeholder sprites failed:', e);
      }
    }

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
    eventHistory.init();

    // --- Optional modules: each wrapped so failures don't break the app ---

    // ProjectDetector listens before ActivityMonitor starts polling, and
    // before TrackedRepos announces the repos it resolves names to.
    await this._initOptional('ProjectDetector', async () => {
      this.projectDetector = new ProjectDetector();
      this.projectDetector.init();
    });

    await this._initOptional('ActivityMonitor', async () => {
      this.activityMonitor = new ActivityMonitor(this.settings);
      this.activityMonitor.setIdleThreshold(this.settings.idleThresholdMinutes);
      this.activityMonitor.start();
    });

    await this._initOptional('TrackedRepos', async () => {
      this.trackedRepos = new TrackedRepos(this.settings);
      await this.trackedRepos.init();

      // Settings -> Tracking lists the tracked repos.
      const sendRepoStatus = () => {
        try {
          window.__TAURI__.event.emitTo('settings', 'tracked-repos-status', this.trackedRepos.getStatus());
        } catch {}
      };
      eventBus.on(Events.REPOS_CHANGED, sendRepoStatus);
      window.__TAURI__?.event?.listen?.('request-tracked-repos-status', sendRepoStatus);
    });

    await this._initOptional('ClaudeCodeHooks', async () => {
      if (!tauri.isAvailable) return;
      const r = await applyClaudeHooksSetting(
        this.settings.get('claudeCodeHooksEnabled') !== false,
        (cmd) => tauri.invoke(cmd),
        { onLaunch: true },
      );
      if (r.error && !r.notFound) console.warn('Claude Code hooks:', r.error);
    });

    await this._initOptional('ClaudeCodeTracker', async () => {
      this.claudeCodeTracker = new ClaudeCodeTracker();
      await this.claudeCodeTracker.init();
    });

    await this._initOptional('AIPairTracker', async () => {
      this.aiPairTracker = new AIPairTracker();
      this.aiPairTracker.init();
    });

    await this._initOptional('AntiGravityTracker', async () => {
      this.antiGravityTracker = new AntiGravityTracker();
      this.antiGravityTracker.init();
    });

    await this._initOptional('GitTracker', async () => {
      this.gitTracker = new GitTracker(this.settings);
      this.gitTracker.init();

      // TrackedRepos already announced its list: seed the watchlist now
      const repos = this.trackedRepos?.getRepos();
      if (repos?.length > 0) {
        this.gitTracker.populateFromRepos(repos);
      }
    });

    await this._initOptional('MomentumTracker', async () => {
      this.momentumTracker = new MomentumTracker(this.trackedRepos?.getRepos() || []);
      await this.momentumTracker.init();
      this.setupMomentumMeter();
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

    // The server's builder streak when linked (refreshed on ACCOUNT_LINKED,
    // which AccountState emits at launch for a linked install).
    await this._initOptional('StreakDisplay', async () => {
      this.streakDisplay = new StreakDisplay({
        tracker: this.dailyStreakTracker,
        isLinked: () => accountState.linked,
        fetchStreak: () => desktopApi.streak(),
      });
      this.streakDisplay.init();
    });

    await this._initOptional('Notifier', async () => {
      this.notifier = new Notifier(this.settings);
      this.notifier.init();
      this.notifier.setEnabled(this.settings.notificationsEnabled);
      this._initToastWindow();
    });

    // Screen shares and fullscreen apps: Dr. Vibe hides, toasts and visits wait.
    await this._initOptional('PresenceGuard', async () => {
      this.presenceGuard = new PresenceGuard({
        settings: this.settings,
        character: {
          isVisible: async () => (tauri.isAvailable ? tauri.window.isVisible() : false),
          hide: async () => { this._emitToSpeech('speech-hide', {}); await tauri.hideWindow(); },
          show: async () => { await tauri.showWindow(); this.repositionSpeechWindow(); },
        },
      });
      this.notifier?.holdWhile(() => this.presenceGuard.holding);
      await this.presenceGuard.init();
    });

    // Visits: another player's Dr. Vibe walks onto this desktop.
    await this._initOptional('Visits', async () => {
      this._initVisits();
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
      // Dim the character canvas while the eye strain reminder is active
      const canvas = document.getElementById('character-canvas');
      eventBus.on(Events.EYE_STRAIN_REMINDER, () => canvas?.classList.add('cover-eyes-dim'));
      eventBus.on(Events.EYE_STRAIN_COMPLETE, () => canvas?.classList.remove('cover-eyes-dim'));
      eventBus.on(Events.EYE_STRAIN_SNOOZED, () => canvas?.classList.remove('cover-eyes-dim'));
    });

    await this._initOptional('PostureReminder', async () => {
      this.postureReminder = new PostureReminder();
      this.postureReminder.loadState(this.settings.getAll());
      this.postureReminder.init();
    });

    // Save hydration state back to settings when water is logged
    eventBus.on(Events.HYDRATION_LOGGED, ({ count }) => {
      this.settings.set('hydrationDailyCount', count);
    });
    eventBus.on(Events.HYDRATION_DAILY_RESET, () => {
      this.settings.set('hydrationDailyCount', 0);
      this.settings.set('hydrationLastReset', localDay());
    });

    await this._initOptional('AchievementSystem', async () => {
      this.achievementSystem = new AchievementSystem();
      await this.achievementSystem.init();
    });

    // Celebrate achievement unlocks with full celebrating animation
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, () => {
      this.character.forceState('celebrating');
      this._maybeInviteToJoin();
    });

    // Major mastery milestones get the same "big win" treatment.
    eventBus.on(Events.MASTERY_LEVEL_UP, ({ isMajor, title, level, levelName, progress, unit }) => {
      if (!isMajor) return;
      this.character.forceState('celebrating');
      eventBus.emit(Events.CELEBRATION_TRIGGERED, {
        id: `mastery-${title}-${level}`,
        message: `${title} - Level ${level} (${levelName})`,
        tip: `${progress} ${unit}`,
      });
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

    // Track live coding state for profile sync.
    // AI tool activity is the primary signal — vibe coding counts.
    // A change syncs right away (at most once a minute; the server allows 60
    // an hour) so the site's "coding now" doesn't wait for the 15-min sync.
    const setCodingNow = (on) => {
      if (this._isCodingNow === on) return;
      this._isCodingNow = on;
      if (this._codingSyncTimer) return;
      const wait = Math.max(0, (this._lastCodingSyncAt || 0) + 60_000 - Date.now());
      this._codingSyncTimer = setTimeout(() => {
        this._codingSyncTimer = null;
        this._lastCodingSyncAt = Date.now();
        this._syncProfile().catch(() => {});
      }, wait);
    };
    eventBus.on(Events.CLAUDE_CODE_ACTIVE, () => setCodingNow(true));
    eventBus.on(Events.CLAUDE_CODE_IDLE,   () => setCodingNow(false));
    // Also set coding state from app focus as a fallback
    eventBus.on(Events.ACTIVITY_CODING_START, () => setCodingNow(true));
    eventBus.on(Events.ACTIVITY_CODING_STOP,  () => { if (!this.claudeCodeTracker?.isActive()) setCodingNow(false); });

    // Celebrate streak milestones with notification
    eventBus.on(Events.STREAK_MILESTONE, ({ text, tip }) => {
      this.notifier?.send(text, tip, 'achievement');
    });

    // Gentle streak reminder notification
    eventBus.on(Events.STREAK_REMINDER, ({ text, tip }) => {
      this.notifier?.send(text, tip, 'achievement');
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

    // Initialize nudge behavior (Dr. Vibe hops away when cursor approaches)
    await this._initOptional('NudgeBehavior', async () => {
      this.nudgeBehavior = new NudgeBehavior(this.settings, this.character, this.windowDrag, this.walkingBehavior);
      await this.nudgeBehavior.init();
    });

    // Initialize sound effects (procedural character noises)
    await this._initOptional('SoundManager', async () => {
      this.soundManager = new SoundManager();
      this.soundManager.init(this.settings);
    });

    // Show window after positioning to avoid flash at default location
    if (tauri.isAvailable) {
      // Resize the window to match the current characterScale before showing,
      // so it fits the canvas tightly rather than using the hardcoded default.
      const initScale = this.settings.get('characterScale');
      const { width, height } = this.animator.getWindowSize(initScale);
      await tauri.setWindowSize(width, height);
      await tauri.showWindow();
      // Position and show the speech bubble window above Dr. Vibe
      await this.repositionSpeechWindow();
      this._showSpeechWindow();
    }

    // Set initial facing direction based on position on current monitor
    if (this.animator && this.windowDrag) {
      const facing = await this.windowDrag.getFacingDirection();
      if (facing) this.animator.setFacing(facing, { autoRevert: false });
    }

    // Reposition speech bubble and update facing direction when dragged
    eventBus.on(Events.WINDOW_DRAG_END, ({ facingDirection }) => {
      this.repositionSpeechWindow();
      // Turn mirrored skins to face toward the open side of the screen
      if (facingDirection && this.animator) {
        this.animator.setFacing(facingDirection, { autoRevert: false });
      }
    });

    // After a walk ends, face toward the open side of the current monitor
    eventBus.on(Events.WALKING_STOPPED, async () => {
      if (!this.animator || !this.windowDrag) return;
      const facing = await this.windowDrag.getFacingDirection();
      if (facing) this.animator.setFacing(facing, { autoRevert: false });
    });

    // Initialize project display (shows active project name)
    this.projectDisplay = new ProjectDisplay();
    this.projectDisplay.init();


    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'characterScale') {
        const { width, height } = this.animator.getWindowSize(value);
        tauri.setWindowSize(width, height).then(() => this.repositionSpeechWindow());
      }
    });

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
      tauri.openPanelWindow('about', 'about.html', 'About Dr. Vibe', 320, 540, false, false);
    });

    eventBus.on(Events.SESSION_PANEL_TOGGLE, () => {
      tauri.openPanelWindow('session', 'session.html', 'Session Stats', 380, 580, true, false);
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
        // Failsafe: if the Today's Wins window doesn't respond within 5 minutes, quit anyway
        this._quitFailsafeTimer = setTimeout(async () => {
          console.log('Today\'s Wins quit failsafe triggered - forcing quit');
          try { await this.shutdown(); } catch (e) { console.error('Shutdown error:', e); }
          tauri.quitApp();
        }, 300000);
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

      // User unchecked auto-close checkbox — cancel the failsafe so app stays open
      tauri.window.listen('today-wins-cancel-autoclose', () => {
        if (this._quitFailsafeTimer) {
          clearTimeout(this._quitFailsafeTimer);
          this._quitFailsafeTimer = null;
        }
      });

      // Auto-updater: notify character when a new version is available on startup
      tauri.window.listen('update-available', (event) => {
        const version = event.payload;
        console.log(`Dr. Vibe update available: v${version}`);
        this._emitToSpeech('speech-show', {
          text: `Update v${version} available! Open About from the tray menu to install it.`,
          tip: null,
          durationMs: 8000,
        });
      });

      // What's New: open panel on first launch after a version update
      (async () => {
        try {
          const version = await tauri.invoke('check_whats_new');
          if (version) {
            tauri.openPanelWindow('whats-new', 'whats-new.html', "What's New", 380, 500, false, false);
          }
        } catch (e) {
          console.log("What's New check skipped:", e);
        }
      })();

      // Listen for settings saved from the separate settings window
      tauri.window.listen('settings-saved', (event) => {
        const saved = event.payload;
        const oldWork = this.settings.workInterval;
        const oldBreak = this.settings.breakInterval;
        for (const [key, value] of Object.entries(saved)) {
          // Use set() so values are validated/clamped and events are emitted
          // (set() skips values that didn't change)
          this.settings.set(key, value);
        }
        // The settings window wrote only its form fields to the shared
        // section; write the full set back so hidden keys aren't lost.
        this.settings.save();
        // Only touch the timer when an interval changed — setIntervals resets the pomodoro
        if (this.settings.workInterval !== oldWork || this.settings.breakInterval !== oldBreak) {
          this.timer.setIntervals(this.settings.workInterval, this.settings.breakInterval);
        }
        // Directly resize the window for characterScale — belt-and-suspenders with the
        // SETTINGS_CHANGED handler, since the Tauri event round-trip can silently drop
        // the resize if the LogicalSize API path fails or the event chain breaks.
        if (saved.characterScale != null && this.animator) {
          const scale = this.settings.get('characterScale');
          const { width, height } = this.animator.getWindowSize(scale);
          tauri.setWindowSize(width, height).then(() => this.repositionSpeechWindow());
        }
      });

      // Listen for setup wizard completion
      tauri.window.listen('setup-wizard-completed', () => {
        db.setSection('setupWizard', { completed: true });
        console.log('Setup wizard completed');
      });

      // Community engagement events from settings/deep links
      tauri.window.listen('community-account-connected', (event) => {
        eventBus.emit(Events.COMMUNITY_ACCOUNT_CONNECTED, event.payload || {});
      });

      tauri.window.listen('community-gallery-submitted', (event) => {
        eventBus.emit(Events.COMMUNITY_GALLERY_SUBMITTED, event.payload || {});
      });

      tauri.window.listen('community-skin-installed', (event) => {
        eventBus.emit(Events.COMMUNITY_SKIN_INSTALLED, event.payload || {});
      });

      // Device linked (dr-vibe://auth/callback → code exchange in Rust).
      tauri.window.listen('account-linked', (event) => {
        const { username, firstLink } = event.payload || {};
        eventBus.emit(Events.COMMUNITY_ACCOUNT_CONNECTED, { username });
        if (firstLink) {
          // Welcome grants are made server-side (API.md §2).
          this.character?.forceState('celebrating');
          this.notifier?.send('Welcome aboard!', '50 VP, Dr. Vibe Original and a free pull are waiting for you.', 'community', null, `${WEB_BASE}${WebRoutes.machines()}`);
        }
        // Open settings on the account tab to show the linked state.
        localStorage.setItem('drvibe-open-tab', 'community');
        tauri.openSettingsWindow();
        // AccountState listens for account-linked itself and emits
        // ACCOUNT_LINKED, which starts polling, the economy queue and VP.
      });
      tauri.window.listen('account-link-error', (event) => {
        this.notifier?.send('Linking did not work', event.payload?.message || 'Try again from Settings.', 'community');
      });
      // Server toasts that ask for it (donations, graduations) get the big celebration.
      eventBus.on(Events.NOTIFICATION_RECEIVED, ({ notification } = {}) => {
        if (notification?.celebrate && !this.presenceGuard?.holding) this.character?.forceState('celebrating');
      });
      tauri.window.listen('skin-installed', (event) => {
        const payload = event?.payload;
        const normalized = typeof payload === 'string'
          ? { slug: payload, updated: false }
          : (payload || {});
        eventBus.emit(Events.COMMUNITY_SKIN_INSTALLED, normalized);
      });

      // Developer → Dev Server hot-swap (debug builds): the settings window
      // fires this after the user clicks Apply. Rust's runtime web_base_url
      // has already been updated; match it on the JS side. Auth was cleared
      // by the settings window, so AccountState flips to unlinked and the
      // poll pauses until the player links again on the new server.
      tauri.window.listen('server-switched', (event) => {
        const { newUrl } = event.payload || {};
        console.log('[app] server switched to', newUrl);
        reloadWebBase();
        accountState.refresh().catch(() => {});
      });

      // Workshop / Settings can ask the main window to switch the active skin
      tauri.window.listen('switch-skin', (event) => {
        const slug = event?.payload?.slug;
        if (slug) this.settings.set('selectedSkin', slug);
      });

      // Forward live data to dashboard window on request
      tauri.window.listen('dashboard-request-data', () => {
        this._sendDashboardData();
      });

      // Dashboard asked us to claim a quest — POST the claim and re-push the
      // updated quest list so the UI reflects the new state.
      tauri.window.listen('dashboard-claim-quest', async (event) => {
        const userQuestId = event?.payload?.userQuestId;
        if (!userQuestId) return;
        try {
          await this._claimQuest(userQuestId);
        } catch (e) {
          console.warn('[app] quest claim failed:', e);
        }
        // Refresh dashboard either way — either the claim succeeded (show
        // claimed state) or failed (keep prior state, user sees no change).
        this._sendDashboardData();
      });

      // "Connect GitHub" hint on the streak card: shown once, until dismissed.
      tauri.window.listen('dashboard-dismiss-github-hint', () => {
        this.streakDisplay?.dismissGithubHint();
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

      // Goals are owned here (WeeklySummary): the weekly window can only ask,
      // or main's next save of the section would overwrite them.
      tauri.window.listen('weekly-set-goals', async (event) => {
        const goals = event.payload?.goals ?? null;
        if (goals) await this.weeklySummary?.setGoals(goals);
        else await this.weeklySummary?.clearGoals();
        this._sendWeeklyData();
      });

      // Handle debug commands from the debug window
      console.log('[dr-vibe] registering debug-command listener');
      tauri.window.listen('debug-command', (event) => {
        console.log('[dr-vibe] debug-command received:', event.payload);
        this._handleDebugCommand(event.payload);
      });

      // Push updated bonus animations to debug window when skin changes
      eventBus.on(Events.SKIN_ANIMATIONS_CHANGED, () => {
        this._sendBonusAnimationsToDebug();
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
        this.activityMonitor?.setIdleThreshold(value);
      }
      // Sync immediately when skin changes so the website shows the new skin
      if (key === 'selectedSkin') {
        // Small delay to let the store flush the setting before sync reads it
        setTimeout(() => this._syncProfile().catch(() => {}), 3000);
      }
    });

    // Account link state: every online feature below waits for ACCOUNT_LINKED.
    await this._initOptional('AccountState', async () => {
      await accountState.init();
    });

    // Privacy settings: sent to the site only after a local change.
    await this._initOptional('PrivacySync', async () => {
      privacySync.init();
    });

    // Weekly recap: last week's numbers go to drvibe.io once, for the share
    // card and the Monday feed post (linked, not private, switch on).
    await this._initOptional('WeeklyRecap', async () => {
      this.weeklyRecap = new WeeklyRecapSync({
        getHistory: () => this.sessionTracker?.getSessionHistory() ?? [],
        getStreak: () => this.sessionTracker?.streak ?? 0,
        settings: this.settings,
        onSent: (cardUrl, { summary }) => {
          const hours = Math.floor(summary.totalSeconds / 3600);
          this.notifier?.send(
            'Your weekly recap card is ready',
            `${hours}h coded on ${summary.activeDays}/7 days last week.`,
            'community', null, cardUrl, 'View card',
          );
        },
      });
      this.weeklyRecap.init();
    });

    // 60 s poll for the equipped Dr. Vibe, notifications and visits (linked only).
    // Its status feeds the badge in Settings → Account and community.
    await this._initOptional('PollClient', async () => {
      this.pollClient = new PollClient({ getEquippedId: () => companionManager.getEquippedId() });
      this._latestSyncStatus = { state: accountState.linked ? 'connecting' : 'unlinked' };
      const broadcastSyncStatus = (status) => {
        this._latestSyncStatus = status;
        try {
          const { emitTo } = window.__TAURI__.event;
          emitTo('settings', 'sync-status', status);
        } catch {}
      };
      eventBus.on(Events.POLL_STATUS, broadcastSyncStatus);
      // Replay current state when the Settings window asks (it does so on load).
      window.__TAURI__?.event?.listen?.('request-sync-status', () => {
        broadcastSyncStatus(this._latestSyncStatus);
      });
      // A changed name or profile picture on the site updates the stored
      // profile (Rust emits account-profile-updated to Settings).
      const invoke = window.__TAURI__?.core?.invoke;
      if (invoke) {
        const stored = await invoke('get_profile').catch(() => null);
        const refreshProfile = createProfileRefresher(invoke, stored?.linked ? stored : null);
        eventBus.on(Events.ACCOUNT_PROFILE_FROM_SERVER, (account) => { refreshProfile(account); });
      }
      this.pollClient.start();
    });

    // Companion Manager: handles equip/unequip events, LRU sprite caching, tray updates, and living stats.
    await this._initOptional('CompanionManager', async () => {
      await companionManager.init(this.settings);
    });

    // Balance Manager: fetches VP balance on launch and keeps tray tooltip updated.
    await this._initOptional('BalanceManager', async () => {
      await balanceManager.init();
    });

    // Economy Client: outbound activity event queue (persistent, retries, offline-safe).
    // Must init before ActivityReporter so queued events have a destination.
    await this._initOptional('EconomyClient', async () => {
      await economyClient.init();
    });

    // Activity Reporter: subscribes to activity events and forwards them to the server.
    await this._initOptional('ActivityReporter', async () => {
      // Init order is deliberate (EconomyClient must load its persisted queue
      // before anything reports), so events from earlier modules can predate
      // this; re-report today's once-a-day streak.
      await activityReporter.init({ streakToday: () => this.dailyStreakTracker?.countedToday() ?? null });
    });

    // Start game loop
    gameLoop.add((deltaTime) => {
      this.character.update(deltaTime);
      this.walkingBehavior?.update(deltaTime);
      if (this.nudgeBehavior) this.nudgeBehavior.update(deltaTime);
      this.achievementSystem?.update();
    });
    gameLoop.start();

    // Start timer
    this.timer.start();

    // Safety net: push in-memory session stats to DB, then flush to disk.
    // This prevents data loss during dev hot-reloads.
    window.addEventListener('beforeunload', () => {
      this.sessionTracker?.saveSession();
      db.saveNow();
    });

    eventBus.emit(Events.APP_READY, {});
    console.log('Dr. Vibe initialized!');

    // Sync profile stats to the website so it can show live
    // "currently coding" status and up-to-date stats.
    // Dev: every 2 min for rapid feedback.  Prod: every 15 min.
    this._isCodingNow = false;
    this._syncProfile().catch(() => {});
    const syncIntervalMs = IS_DEV ? 2 * 60 * 1000 : 15 * 60 * 1000;
    setInterval(() => this._syncProfile().catch(() => {}), syncIntervalMs);
  }

  _initVisits() {
    // Returns the emit promise so showVisitor's failures reach VisitorController.
    const emitTo = (target, event, payload) => {
      const send = window.__TAURI__?.event?.emitTo;
      if (!send) return Promise.reject(new Error('Tauri events unavailable'));
      return send(target, event, payload);
    };
    const pomodoroRunning = () =>
      this.settings.get('breakMode') === 'pomodoro' && this.timer?.isRunning && !this.timer?.isBreak;

    this.visitorController = new VisitorController({
      isBusy: () => !!(this.presenceGuard?.holding || this.focusMode?.active || pomodoroRunning()),
      showVisitor: async (payload) => emitTo('visitor', 'visitor-play', payload),
      resolveSprite: async (visit) => {
        const s = visit.from.sprite;
        if (visit.test || !s?.pngUrl) {
          // Test visits, and senders with no edition equipped, use a local
          // Lab Original (PLAN: fall back to their chosen original).
          return { localSkin: s?.localSkin || s?.slug || 'dr-vibe-default', skinTone: s?.skinTone || null };
        }
        const cached = await tauri.invoke('cache_visitor_sprite', { slug: s.slug, pngUrl: s.pngUrl, animUrl: null });
        const animJson = s.animJson ? JSON.stringify(s.animJson) : cached.animJson;
        return { pngBase64: cached.pngBase64, animJson, slug: s.slug, skinTone: s.skinTone, finish: s.finish || null };
      },
      getStage: async () => {
        const [pos, size, areas] = await Promise.all([
          tauri.getWindowPosition(), tauri.getWindowSize(), tauri.getMonitorWorkAreas(),
        ]);
        const cx = pos.x + size.width / 2;
        const area = (areas || []).find(a => cx >= a.work_x && cx < a.work_x + a.work_width) || (areas || [])[0];
        return {
          scale: this.settings.get('characterScale'),
          size,
          geometry: {
            mainX: pos.x, mainY: pos.y, width: size.width,
            workX: area ? area.work_x : 0,
            workWidth: area ? area.work_width : window.screen.width,
          },
        };
      },
      onArrive: (visit) => {
        this.animator?.wave();
        const { text, tip } = visitSpeech(visit);
        this._emitToSpeech('speech-show', { text, tip, durationMs: 8000 });
        this.soundManager?.playChatNoise(text);
      },
      sendVisit: (toUsername, inReplyTo) => desktopApi.sendVisit(toUsername, null, inReplyTo),
      // POST /desktop/ack: played walk-ons are delivered; missed ones become a
      // "visited while you were away" notification server-side.
      ackVisit: (id, outcome) => desktopApi.ack({ visits: [{ id, outcome }] }),
    });
    this.visitorController.init();

    // A screen share starting mid-visit sends the visitor away at once.
    eventBus.on(Events.PRESENTING_STARTED, () => { emitTo('visitor', 'visitor-dismiss', {}).catch(() => { /* window gone */ }); });

    if (tauri.isAvailable && tauri.window) {
      tauri.window.listen('visitor-arrived', (e) => this.visitorController.arrived(e.payload?.visit));
      tauri.window.listen('visitor-done', () => this.visitorController.done());
      tauri.window.listen('visitor-wave-back', async (e) => {
        const { toUsername, visitId } = e.payload || {};
        const r = await this.visitorController.waveBack(toUsername, visitId);
        if (r.ok) this.notifier?.send('Wave sent!', `Your Dr. Vibe is on the way to @${toUsername}.`, 'community');
        else this.notifier?.send('Wave did not go through', visitErrorMessage(r, toUsername), 'community');
      });
    }
    // Devtools helper for the local test trigger.
    window.__testVisit = () => this.testVisit();
  }

  /** Local test trigger: your own Dr. Vibe pays you a visit (no server). */
  testVisit() {
    this.visitorController?.enqueue({
      id: `test-${Date.now()}`,
      test: true,
      preset: 'keep_shipping',
      createdAt: new Date().toISOString(),
      from: {
        id: 'local-test',
        username: 'test-visitor',
        displayName: 'Test Visitor',
        avatarUrl: null,
        sprite: { slug: this.settings.get('selectedSkin') || 'dr-vibe-default', skinTone: this.settings.get('selectedSkinTone') || null, pngUrl: null, animUrl: null, editionId: null },
      },
    });
  }

  /**
   * The one-time invite after the first achievement: unlinked players get a
   * single toast offering to join. Never shown again once seen, once they
   * joined, or if they ticked "Don't ask me again" in the setup wizard.
   */
  _maybeInviteToJoin() {
    if (accountState.linked) return;
    if (this.settings.get('communityInviteDismissed') || this.settings.get('communityInviteShown')) return;
    this.settings.set('communityInviteShown', true);
    setTimeout(() => {
      this.notifier?.send(
        'Nice! Want to collect Dr. Vibes?',
        'Join the community (Settings → Account and community) to earn Vibe Points for coding like this. Optional, free, and Dr. Vibe works the same either way.',
        'community',
      );
    }, 6000);
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

    // Listen for snooze actions forwarded from the toast overlay window
    if (tauri.isAvailable && tauri.window) {
      tauri.window.listen('toast-snooze', (event) => {
        const { action } = event.payload || {};
        if (action === 'eyestrain') this.eyeStrainReminder?.snooze();
        else if (action === 'posture') this.postureReminder?.snooze();
      });
    }

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
      // Dr. Vibe is hidden during screen shares and fullscreen apps.
      if (this.presenceGuard?.holding) return;
      this._speechDismissCallback = onDismiss || null;
      this._emitToSpeech('speech-show', { text, tip, durationMs: popupMs() });
      this.soundManager?.playChatNoise(text);
      // Ensure Dr. Vibe and the heat bar are fully visible when he speaks.
      // The ghost effect can get stuck if the cursor is over the character
      // when the speech window appears (a separate OS window above), because
      // the polling loop keeps seeing isOverCharacter=true and never unghosts.
      this.clickThrough?.unghost();
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

    // Git commit — celebrate with a message about the commit
    eventBus.on(Events.GIT_COMMIT_MADE, ({ commit, project, branch }) => {
      if (this.settings.get('gitCommitNotificationsEnabled') === false) return;
      const msg = commit?.message ? `"${commit.message}"` : 'a new commit';
      showSpeech(
        'Commit made!',
        `Pushed ${msg} on ${branch || 'main'}.`
      );
    });

    // Git branch change — acknowledge the context switch
    eventBus.on(Events.GIT_BRANCH_CHANGED, ({ from, to, project }) => {
      if (this.settings.get('gitBranchNotificationsEnabled') === false) return;
      showSpeech(
        `Switched to ${to}`,
        `Left ${from} behind. New branch, new focus!`
      );
    });

    // Git commit reminder — Dr. Vibe nags with escalating urgency
    eventBus.on(Events.GIT_COMMIT_REMINDER, ({ urgency, minutesSince, changedFiles, project, repoPath }) => {
      const timeStr = minutesSince >= 60
        ? `${Math.floor(minutesSince / 60)}h ${minutesSince % 60}m`
        : `${minutesSince}m`;
      const files = changedFiles === 1 ? '1 file' : `${changedFiles} files`;
      const repoLabel = project ? ` in ${project}` : '';

      const gentleMessages = [
        ['Hey, commit check!',   `${files} changed${repoLabel}. Maybe lock in your progress?`],
        ['Psst... commit time?', `Been ${timeStr} since your last commit${repoLabel}. Those ${files} aren't saving themselves.`],
        ['Just a nudge!',        `${files} changed${repoLabel}. Future you will thank present you for committing.`],
        ['Quick check-in!',      `It's been ${timeStr}. Got ${files} worth saving${repoLabel}?`],
        ['Progress check!',      `You've got ${files} in the hopper${repoLabel}. How about a commit?`],
      ];

      const urgentMessages = [
        ['Okay, for real now.',   `${timeStr} with ${files} uncommitted${repoLabel}. Please save your work!`],
        ['I\'m getting nervous.', `${files} changed${repoLabel}, ${timeStr} since your last commit. Don't risk it!`],
        ['Hey! HEY!',             `${timeStr} of changes across ${files}${repoLabel}. Commit already!`],
        ['This is your reminder.', `${files} in limbo for ${timeStr}${repoLabel}. Commit before the universe decides.`],
        ['Dr. Vibe is concerned.', `${timeStr} with no commit? ${files} on the line${repoLabel}. Save them!`],
      ];

      const emergencyMessages = [
        ['CODE RED. COMMIT NOW.', `${timeStr} with ${files} uncommitted${repoLabel}. This is not a drill.`],
        ['I am BEGGING you.',      `${files} changed${repoLabel}. ${timeStr} exposed. What are you doing. COMMIT.`],
        ['SOS from Dr. Vibe.',     `${timeStr}. ${files}${repoLabel}. No commit. My anxiety has anxiety.`],
        ['PLEASE.',                `${files} sitting out there unprotected for ${timeStr}${repoLabel}. COMMIT IT.`],
        ['Critical: commit now!',  `${timeStr} of work, ${files} at risk${repoLabel}. One command saves it all: git commit.`],
      ];

      const pool = urgency === 'emergency' ? emergencyMessages
        : urgency === 'urgent' ? urgentMessages
        : gentleMessages;

      const [text, tip] = pool[Math.floor(Math.random() * pool.length)];

      // For non-emergency reminders, offer a 30-min snooze via the dismiss callback (per-repo)
      const onDismiss = urgency !== 'emergency'
        ? () => this.gitTracker?.snoozeReminders(30, repoPath)
        : null;

      showSpeech(text, tip, onDismiss);
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
      const size = await tauri.getWindowSize();
      const speechWidth = 200;  // matches the speech window width in tauri.conf.json
      const speechHeight = 100; // matches the speech window height in tauri.conf.json
      // Center the speech window horizontally over the main window.
      const x = pos.x + Math.round((size.width - speechWidth) / 2);
      const y = Math.max(0, pos.y - speechHeight);
      this._emitToSpeech('speech-reposition', { x, y });
    } catch (e) {
      // Ignore positioning errors
    }
  }

  setupMomentumMeter() {
    const meter = document.getElementById('momentum-meter');
    const fill = document.getElementById('momentum-fill');
    if (!meter || !fill) return;

    const applyVisibility = (enabled) => {
      meter.style.display = enabled ? '' : 'none';
    };

    const applyPosition = (position) => {
      const app = document.getElementById('app');
      if (position === 'top') {
        const canvas = document.getElementById('character-canvas');
        app.insertBefore(meter, canvas);
        meter.style.marginTop = '0';
        meter.style.marginBottom = '4px';
      } else {
        app.appendChild(meter);
        meter.style.marginTop = '4px';
        meter.style.marginBottom = '0';
      }
    };

    applyVisibility(this.settings.momentumMeterEnabled !== false);
    applyPosition(this.settings.momentumMeterPosition || 'bottom');

    const renderMomentum = ({ momentum, level, concurrentSessions = 0, sessionMultiplier = 1 }) => {
      fill.style.width = `${momentum}%`;
      fill.className = level;
      const boost = (concurrentSessions > 1) ? ` | ${concurrentSessions} sessions (${sessionMultiplier}x)` : '';
      meter.title = `Momentum: ${level} (${momentum}%)${boost}`;
    };

    eventBus.on(Events.MOMENTUM_CHANGED, renderMomentum);

    // Prime the bar from the tracker's current state. MomentumTracker can
    // process events from ClaudeCodeTracker's first poll before this DOM
    // listener is registered, in which case the initial 0→N transition fires
    // its MOMENTUM_CHANGED event into the void and every subsequent recalc
    // short-circuits as "unchanged". Without this prime, the UI stays at 0%
    // forever even when the backend is at 100%.
    const initial = this.momentumTracker?.getState?.();
    if (initial) renderMomentum(initial);

    // Devtools-accessible probe: window.__momentumDebug() returns the live
    // tracker state plus the actual DOM dimensions of the bar. Use this to
    // distinguish "no data" vs "data arriving but UI not rendering".
    window.__momentumDebug = () => {
      const trackerState = this.momentumTracker?.getState?.() ?? null;
      const fillEl = document.getElementById('momentum-fill');
      const meterEl = document.getElementById('momentum-meter');
      const fillRect = fillEl?.getBoundingClientRect();
      const meterRect = meterEl?.getBoundingClientRect();
      return {
        tracker: trackerState,
        ui: {
          fillStyleWidth: fillEl?.style.width,
          fillClass: fillEl?.className,
          fillRenderedPx: fillRect ? `${fillRect.width.toFixed(2)} x ${fillRect.height.toFixed(2)}` : null,
          meterRenderedPx: meterRect ? `${meterRect.width.toFixed(2)} x ${meterRect.height.toFixed(2)}` : null,
          meterDisplay: meterEl ? getComputedStyle(meterEl).display : null,
          meterVisibility: meterEl ? getComputedStyle(meterEl).visibility : null,
        },
      };
    };

    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'momentumMeterEnabled') applyVisibility(value);
      if (key === 'momentumMeterPosition') applyPosition(value);
    });
  }

  _handleDebugCommand({ command, payload }) {
    console.log('[dr-vibe] _handleDebugCommand:', command, payload);
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

      case 'playBonus':
        // Play a bonus animation directly on the animator (bypasses character state)
        if (this.animator?.animations[payload]) {
          this.animator.play(payload, false);
        } else {
          console.warn(`Bonus animation '${payload}' not found`);
        }
        break;

      case 'getBonusAnimations':
        // Send current skin's bonus animation names back to the debug window
        this._sendBonusAnimationsToDebug();
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
        else if (payload === 'stop') this.focusMode?.end();
        break;

      case 'achievement':
        this.achievementSystem?.checkAndUnlock(payload, 1);
        break;

      case 'walk':
        if (payload === 'start') this.walkingBehavior?.forceWalk();
        else if (payload === 'stop') this.walkingBehavior?.forceStop();
        break;

      case 'syncProfile': {
        // Use global emit — debug window uses global listen(), not window-targeted listen()
        const reply = (msg) => {
          try { window.__TAURI__?.event?.emit('debug-sync-result', msg); } catch {}
          console.log('[debug] sync:', msg);
        };
        (async () => {
          const invoke = window.__TAURI__?.core?.invoke;
          if (!invoke) { reply('FAILED: no tauri invoke'); return; }
          const profile = await invoke('get_profile').catch(() => ({}));
          if (!profile?.linked) { reply('skipped — not linked'); return; }
          reply('syncing…');
          try {
            await this._syncProfile();
            reply('sync OK ✓');
          } catch (e) {
            reply(`sync FAILED: ${e?.message || e}`);
          }
        })();
        break;
      }

      case 'openSettings':
        tauri.openSettingsWindow();
        break;

      case 'visit':
        this.testVisit();
        break;

      case 'presenting':
        this.presenceGuard?.apply(payload
          ? { presenting: true, reason: 'screen_share', app: 'Debug menu' }
          : { presenting: false });
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
      'mastery:levelUp': [Events.MASTERY_LEVEL_UP, { id: 'git_mastery', title: 'Version Control Mastery', level: 3, levelName: 'Adept', progress: 100, unit: 'commits', isMajor: true }],
      'community:accountConnected': [Events.COMMUNITY_ACCOUNT_CONNECTED, { username: 'debugger' }],
      'community:gallerySubmitted': [Events.COMMUNITY_GALLERY_SUBMITTED, { slug: 'debug-skin', name: 'Debug Skin' }],
      'community:skinInstalled': [Events.COMMUNITY_SKIN_INSTALLED, { slug: 'debug-skin', updated: false }],
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
      'antiGravity:active': [Events.ANTI_GRAVITY_ACTIVE, { appName: 'Anti-Gravity' }],
      'antiGravity:idle': [Events.ANTI_GRAVITY_IDLE, {}],
    };

    const entry = eventData[eventKey];
    if (entry) {
      eventBus.emit(entry[0], entry[1]);
    }
  }

  _sendBonusAnimationsToDebug() {
    try {
      const { emitTo } = window.__TAURI__.event;
      // Collect animation names that are NOT in the standard set
      const standardAnims = new Set([
        'idle', 'coding', 'thinking', 'tired', 'excited', 'alert',
        'libraryCard', 'presenting', 'concerned', 'focused',
        'coverEyes', 'thumbsUp', 'celebrating', 'beaker', 'stretching',
        'walkRight', 'walkLeft', 'levitating',
      ]);
      const bonusNames = Object.keys(this.animator?.animations || {})
        .filter(name => !standardAnims.has(name));
      const skinName = this.animator?._currentSkin || '';
      emitTo('debug', 'debug-bonus-animations', { skinName, bonusNames });
    } catch (e) {
      console.error('Failed to send bonus animations to debug:', e);
    }
  }

  async _sendDashboardData() {
    try {
      const { emitTo } = window.__TAURI__.event;
      // Fetch quests in the background — don't block other dashboard data
      // if the server is slow/down. Null when offline or not authenticated.
      const quests = await this._fetchQuests().catch(() => null);
      emitTo('dashboard', 'dashboard-live-data', {
        sessionStats: this.sessionTracker?.getStats() ?? null,
        momentum: this.momentumTracker?.getState() ?? null,
        hydrationCount: this.hydrationReminder?.dailyCount ?? 0,
        streakData: this.dailyStreakTracker?.getData() ?? null,
        streakShown: this.streakDisplay?.get() ?? null,
        achievements: this.achievementSystem?.getAll() ?? null,
        mastery: this.achievementSystem?.getMasteryTracks() ?? null,
        claudeCode: this.claudeCodeTracker?.getStats() ?? null,
        aiPair: this.aiPairTracker?.getState() ?? null,
        eventHistory: eventHistory.getHistory(),
        stateTimeline: eventHistory.getStateTimeline(),
        vibePoints: balanceManager.getBalance?.() ?? null,
        vibePointsLifetime: balanceManager.getLifetimeStats?.() ?? null,
        community: accountState.linked ? (this._community ?? null) : null,
        linked: accountState.linked,
        quests,
      });
    } catch (e) {
      // Dashboard window may not be open - ignore
    }
  }

  /**
   * Active daily/weekly quests for the linked player. Returns null if
   * offline or unlinked so the dashboard shows the "not connected" placeholder.
   */
  async _fetchQuests() {
    if (!accountState.linked) return null;
    const r = await desktopApi.quests();
    if (!r.ok) return null;
    return Array.isArray(r.data?.quests) ? r.data.quests : null;
  }

  /**
   * Claim the VP reward for a completed UserQuest. Dashboard re-fetches +
   * re-renders on the next 10s tick (or immediately via _sendDashboardData).
   */
  async _claimQuest(userQuestId) {
    const r = await desktopApi.claimQuest(userQuestId);
    if (r.unlinked) throw new Error('not linked');
    if (!r.ok) throw new Error(r.data?.error || `claim failed (${r.status})`);
    // QuestClaimResponse { awarded, balance, alreadyClaimed } — update the
    // tray and dashboard hero tile right away.
    const data = r.data || {};
    if (typeof data?.balance === 'number') {
      eventBus.emit(Events.ECONOMY_EARNED, {
        amount: data.alreadyClaimed ? 0 : (data.awarded || 0),
        newBalance: data.balance,
        reasonCode: 'quest_complete',
        metadata: { userQuestId },
      });
    }
    return data;
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
      const stats = this.sessionTracker?.getStats() ?? {};
      emitTo('session', 'session-data', { ...stats, stateTimeline: eventHistory.getStateTimeline() });
    } catch (e) {
      // Session window may not be open - ignore
    }
  }

  _sendTodayWinsData(isQuitFlow) {
    try {
      const { emitTo } = window.__TAURI__.event;
      const stats = this.sessionTracker?.getStats() ?? {};
      const story = storyGenerator.generate(eventHistory.getHistory(), stats);
      emitTo('today-wins', 'today-wins-data', { stats, isQuitFlow, story });
    } catch (e) {
      // Today's Wins window may not be open - ignore
    }
  }

  _sendPersonalBestsData() {
    try {
      const { emitTo } = window.__TAURI__.event;
      const stats = this.sessionTracker?.getStats() ?? {};
      const momentum = this.momentumTracker?.getState() ?? {};
      emitTo('personal-bests', 'personal-bests-data', {
        codingSeconds: stats.codingSeconds,
        filesCreated: stats.filesCreated,
        filesModified: stats.filesModified,
        streak: this.streakDisplay?.get().current ?? this.dailyStreakTracker?.data?.current ?? stats.streak,
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
    // Persist all tracker data to the database BEFORE the final sync.
    // The sync reads from the Tauri store via Rust, so data must be flushed first.
    try {
      await this.sessionTracker?.saveSession();
      this.skillTracker?._saveStore();
      this.personalBestTracker?._save();
      this.dailyStreakTracker?._save();
      this.achievementSystem?.save();
      await db.saveNow();
    } catch (e) {
      console.warn('[dr-vibe] pre-sync save failed (non-fatal):', e);
    }

    // Send a final sync to mark user as offline
    try {
      this._isCodingNow = false;
      await this._syncProfile();
      console.log('[dr-vibe] final offline sync sent');
    } catch (e) {
      console.warn('[dr-vibe] final sync failed (non-fatal):', e);
    }

    // Close the speech bubble and toast windows
    try {
      const speechWin = await window.__TAURI__?.window?.Window?.getByLabel('speech');
      if (speechWin) await speechWin.destroy();
    } catch (e) { /* ignore */ }
    try {
      const toastWin = await window.__TAURI__?.window?.Window?.getByLabel('toast');
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
    this.trackedRepos?.destroy();
    this.claudeCodeTracker?.destroy();
    this.aiPairTracker?.destroy();
    this.antiGravityTracker?.destroy();
    this.gitTracker?.destroy();
    this.momentumTracker?.destroy();
    await this.sessionTracker?.destroy();
    this.achievementSystem?.destroy();
    this.fatigueDetector?.destroy();
    this.stuckDetector?.destroy();
    this.overworkPrevention?.destroy();
    this.weeklySummary?.destroy();
    this.weeklyRecap?.destroy();
    this.encouragementSystem?.destroy();
    this.celebrationSystem?.destroy();
    this.celebrationEffect?.destroy();
    this.resumeSuggester?.destroy();
  }

  async _syncProfile() {
    if (!tauri.isAvailable) return;
    // Profile sync is a community feature: nothing leaves the machine unlinked.
    if (!accountState.linked) return;
    try {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) return;

      // Gather transient in-memory state. Skin and "show project names" are
      // passed here because the JS Database persists to localStorage, which
      // the Rust store handle cannot read — so we forward them explicitly.
      // Privacy settings themselves are never part of the sync (PrivacySync).
      const transient = {
        isCodingNow: this._isCodingNow,
        selectedSkin: this.settings.get('selectedSkin') || 'dr-vibe-default',
        selectedSkinTone: this.settings.get('selectedSkinTone') || null,
        showProjectNames: privacySync.get().showProjectNames,
        currentMomentum: this.momentumTracker?.getState()?.momentum ?? 0,
        peakMomentumSession: this.personalBestTracker?._peakMomentum ?? 0,
        currentSessionMinutes: Math.floor((this.sessionTracker?.getCodingSeconds() ?? 0) / 60),
        currentProject: this.sessionTracker?.getStats?.()?.projectName || null,
        codingHourOfDay: this.sessionTracker?.getCodingHourOfDay() ?? new Array(24).fill(0),
        // Every achievement, locked ones too (protocol `Achievement`).
        achievements: (this.achievementSystem?.getAll() ?? []).map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          icon: a.icon,
          category: a.category,
          progress: Number(a.progress) || 0,
          maxProgress: Number(a.maxProgress) || 1,
          unlocked: !!a.unlocked,
          unlockedAt: a.unlockedAt ?? null,
        })),
        masteryTracks: (this.achievementSystem?.getMasteryTracks() ?? []).map(t => ({
          id: t.id,
          level: t.level,
          maxLevel: t.maxLevel,
          progress: t.progress,
          maxProgress: t.nextThreshold ?? t.currentThreshold ?? t.progress,
        })),
        sessionCommitCount: this.achievementSystem?.sessionCommitCount ?? 0,
        equippedCompanionId: companionManager.getEquippedId() || null,
      };

      // POST /desktop/sync (signed in Rust). Errors come back as the API
      // code: unlinked, offline, implausible_stats, rate_limited, ...
      const data = await invoke('sync_profile', { transient });

      if (data.success) {
        if (data.newAchievements?.length) {
          for (const a of data.newAchievements) {
            eventBus.emit(Events.ACHIEVEMENT_UNLOCKED, a);
          }
        }
        // Rank and friends coding now: tray tooltip and the dashboard
        // Community tab (API.md has no separate community endpoint).
        this._community = communityFromSync(data);
        balanceManager.setCommunitySummary(this._community.rank, this._community.activeFriends);
        this.streakDisplay?.applySync(data.streak);
      }
      console.log('[dr-vibe] profile synced');
    } catch (e) {
      console.warn('[dr-vibe] profile sync failed:', e);
      throw e;
    }
  }

  async destroy() {
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
    this.nudgeBehavior?.destroy();
    this.soundManager?.destroy();
    this.windowDrag?.destroy();
    this.pollClient?.stop();
    await db.saveNow();
    console.log('Dr. Vibe shutdown');
  }
}

// Create and start app
const app = new App();
app.init().catch(console.error);

// Export for potential external access
export { app };
