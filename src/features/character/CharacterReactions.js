// Dr. Vibe - Character Reactions
// Links activity monitoring and timer events to character state changes

import { eventBus, Events } from '../../core/EventBus.js';

export class CharacterReactions {
  constructor(character) {
    this.character = character;
    this.isCoding = false;
    this.timerProgress = 0;
    this.isBreak = false;
    this.momentumLevel = 'cold';
    this.suppressed = false;
  }

  init() {
    this.setupEventListeners();
  }

  updateContextualState() {
    this.character.contextualState = this.isCoding ? 'coding' : 'idle';
  }

  revertToContextual() {
    if (this.isCoding) {
      this.character.setState('coding');
    } else {
      this.character.setState('idle');
    }
  }

  setupEventListeners() {
    // Activity events
    eventBus.on(Events.ACTIVITY_CODING_START, ({ appName }) => {
      console.log(`Coding started in ${appName}`);
      this.isCoding = true;
      this.updateContextualState();
      if (!this.suppressed) this.character.setState('coding');
    });

    eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      console.log('Coding stopped');
      this.isCoding = false;
      this.updateContextualState();
      if (!this.suppressed) this.character.setState('thinking');
    });

    // Timer progress events — use remaining time for state thresholds
    eventBus.on(Events.TIMER_PROGRESS, ({ progress, isBreak, elapsed, duration }) => {
      this.timerProgress = progress;
      this.isBreak = isBreak;

      if (this.suppressed || isBreak) return;
      if (this.character.currentState === 'alert') return;

      const remainingMin = (duration - elapsed) / 60000;

      if (remainingMin <= 5) {
        // Final 5 minutes — show tired regardless of activity
        this.character.setState('tired');
      } else if (remainingMin <= 10 && !this.isCoding) {
        // Mid-session (5-10 min remaining) — show thinking if not actively coding
        this.character.setState('thinking');
      }
    });

    // Timer completion events
    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      if (this.suppressed) return;
      console.log('Work complete - showing alert');
      this.character.setState('alert');
    });

    // Break started — show excitement when user takes a break
    eventBus.on(Events.TIMER_BREAK_START, () => {
      if (this.suppressed) return;
      console.log('Break started - showing excitement');
      // Brief delay so the 'alert' state from work-complete is visible first
      setTimeout(() => {
        if (this.suppressed) return;
        this.character.forceState('excited');
      }, 2000);
    });

    // Break complete — return to idle, ready for next work session
    eventBus.on(Events.TIMER_BREAK_COMPLETE, () => {
      if (this.suppressed) return;
      console.log('Break complete - returning to idle');
      this.character.setState('idle');
    });

    // Break suggestion — show alert state
    eventBus.on(Events.BREAK_SUGGESTED, ({ breakType }) => {
      if (this.suppressed) return;
      console.log(`Break suggested (${breakType}) — showing alert`);
      this.character.setState('alert');
    });

    // Break activity suggested — stretching for physical activities, alert for others
    eventBus.on(Events.BREAK_ACTIVITY_SUGGESTED, (activity) => {
      if (this.suppressed) return;
      if (activity.physical) {
        console.log('Physical break activity — showing stretching');
        this.character.forceState('stretching');
      }
    });

    // Idle detection — show thinking state
    eventBus.on(Events.ACTIVITY_IDLE, () => {
      if (this.suppressed) return;
      if (!this.isBreak) {
        this.character.setState('thinking');
      }
    });

    // Timer pause/resume
    eventBus.on(Events.TIMER_PAUSED, () => {
      // Could show a special paused animation if desired
    });

    eventBus.on(Events.TIMER_RESUMED, () => {
      if (this.suppressed) return;
      if (this.isCoding) {
        this.character.setState('coding');
      }
    });

    // Project switch — brief excited reaction (auto-reverts via config)
    eventBus.on(Events.PROJECT_CHANGED, ({ current, previous }) => {
      if (!previous || this.suppressed) return;
      console.log(`Project switched to ${current.name} — showing excitement`);
      this.character.forceState('excited');
    });

    // Momentum level changes affect character energy
    eventBus.on(Events.MOMENTUM_LEVEL_CHANGED, ({ previous, current }) => {
      this.momentumLevel = current;
      if (this.suppressed) return;

      // Only react if we're actively coding (don't override alert/break states)
      if (!this.isCoding) return;
      const state = this.character.currentState;
      if (state === 'alert' || state === 'tired') return;

      if (current === 'fire' || current === 'hot') {
        this.character.forceState('excited');
      } else if (current === 'cold' && previous !== 'cold') {
        this.character.setState('thinking');
      }
    });

    // Weekly summary — present the report
    eventBus.on(Events.WEEKLY_SUMMARY_AVAILABLE, () => {
      if (this.suppressed) return;
      this.character.forceState('presenting');
    });

    // Weekly summary panel closed — return to contextual state
    eventBus.on(Events.WEEKLY_SUMMARY_PANEL_CLOSED, () => {
      if (this.suppressed) return;
      this.revertToContextual();
    });

    // Today's Wins summary — thumbs up celebration
    eventBus.on(Events.TODAY_WINS_SHOW, () => {
      if (this.suppressed) return;
      this.character.forceState('thumbsUp');
    });

    // Personal best — celebrate new records (auto-reverts via config)
    eventBus.on(Events.PERSONAL_BEST_SET, () => {
      if (this.suppressed) return;
      console.log('New personal best — showing excitement');
      this.character.forceState('excited');
    });

    // Personal best approaching — show alert to build anticipation
    eventBus.on(Events.PERSONAL_BEST_APPROACHING, () => {
      if (this.suppressed) return;
      if (this.character.currentState !== 'excited') {
        this.character.forceState('alert');
      }
    });

    // Hydration reminder — beaker animation (auto-reverts via config)
    eventBus.on(Events.HYDRATION_REMINDER, () => {
      if (this.suppressed) return;
      console.log('Hydration reminder — showing beaker');
      this.character.forceState('beaker');
    });

    // Water logged — brief excited reaction (auto-reverts via config)
    eventBus.on(Events.HYDRATION_LOGGED, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Fatigue detected — show concern for the user (not Dr. Vibe being tired)
    eventBus.on(Events.FATIGUE_DETECTED, () => {
      if (this.suppressed) return;
      console.log('Fatigue detected — showing concern');
      this.character.forceState('concerned');
    });

    // Stuck detected — show empathetic concern
    eventBus.on(Events.STUCK_DETECTED, () => {
      if (this.suppressed) return;
      console.log('Stuck detected — showing concern');
      this.character.forceState('concerned');
    });

    // Eye strain reminder — cover eyes animation during countdown
    eventBus.on(Events.EYE_STRAIN_REMINDER, () => {
      if (this.suppressed) return;
      console.log('Eye strain reminder — showing coverEyes');
      this.character.forceState('coverEyes');
    });

    // Eye strain countdown complete — brief excited reaction (auto-reverts via config)
    eventBus.on(Events.EYE_STRAIN_COMPLETE, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Eye strain snoozed — return to normal state
    eventBus.on(Events.EYE_STRAIN_SNOOZED, () => {
      if (this.suppressed) return;
      this.revertToContextual();
    });

    // Posture reminder — stretching animation during countdown
    eventBus.on(Events.POSTURE_REMINDER, () => {
      if (this.suppressed) return;
      console.log('Posture reminder — showing stretching');
      this.character.forceState('stretching');
    });

    // Posture countdown complete — brief excited reaction (auto-reverts via config)
    eventBus.on(Events.POSTURE_COMPLETE, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Posture snoozed — return to normal state
    eventBus.on(Events.POSTURE_SNOOZED, () => {
      if (this.suppressed) return;
      this.revertToContextual();
    });


    // Streak milestone — celebrate with full celebration animation (auto-reverts via config)
    eventBus.on(Events.STREAK_MILESTONE, ({ milestone }) => {
      if (this.suppressed) return;
      console.log(`Streak milestone ${milestone} — celebrating`);
      this.character.forceState('celebrating');
    });

    // Streak recovered — brief excited reaction (auto-reverts via config)
    eventBus.on(Events.STREAK_RECOVERED, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Streak reminder — gentle alert
    eventBus.on(Events.STREAK_REMINDER, () => {
      if (this.suppressed) return;
      this.character.forceState('alert');
      setTimeout(() => {
        if (this.suppressed) return;
        this.revertToContextual();
      }, 3000);
    });

    // Overwork warning — show increasing concern based on level
    eventBus.on(Events.OVERWORK_WARNING, ({ level, characterState }) => {
      if (this.suppressed) return;
      console.log('Overwork warning (' + level + ') — showing ' + characterState);
      this.character.forceState(characterState);
    });
    // Celebration — full celebrating animation for progress milestones (auto-reverts via config)
    eventBus.on(Events.CELEBRATION_TRIGGERED, () => {
      if (this.suppressed) return;
      this.character.forceState('celebrating');
    });

    // Claude Code active — show monitoring state (Feature 4: Claude's Working On It)
    eventBus.on(Events.CLAUDE_CODE_ACTIVE, () => {
      this._claudeWorking = true;
      if (this.suppressed) return;
      // Only show monitoring if we're not in a higher-priority state
      const state = this.character.currentState;
      if (state === 'alert' || state === 'celebrating' || state === 'excited') return;
      if (!this.isCoding) {
        // User isn't coding but Claude is working — show thinking/monitoring
        this.character.setState('thinking');
      }
    });

    eventBus.on(Events.CLAUDE_CODE_IDLE, () => {
      this._claudeWorking = false;
      if (this.suppressed) return;
      this.revertToContextual();
    });

    // Claude Code new file created — brief excitement (Feature 8)
    eventBus.on(Events.CLAUDE_CODE_FILE_CREATED, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Claude Code bug fixed — celebrate! (Feature 7)
    eventBus.on(Events.CLAUDE_CODE_BUG_FIXED, () => {
      if (this.suppressed) return;
      this.character.forceState('celebrating');
    });

    // AI pair programming milestone — celebrate (Feature 3)
    eventBus.on(Events.AI_PAIR_MILESTONE, () => {
      if (this.suppressed) return;
      this.character.forceState('celebrating');
    });

    // AI pair session started — show excitement
    eventBus.on(Events.AI_PAIR_STARTED, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Claude Code session start — brief excitement
    eventBus.on(Events.CLAUDE_CODE_SESSION_START, () => {
      if (this.suppressed) return;
      this.character.forceState('excited');
    });

    // Claude Code session summary — present the wrap-up (Feature 5)
    eventBus.on(Events.CLAUDE_CODE_SUMMARY, () => {
      if (this.suppressed) return;
      this.character.forceState('presenting');
    });

    // Focus mode — suppress all character reactions, show focused animation
    eventBus.on(Events.FOCUS_MODE_STARTED, () => {
      this.suppressed = true;
      this.character.forceState('focused');
    });

    eventBus.on(Events.FOCUS_MODE_ENDED, () => {
      this.suppressed = false;
      this.revertToContextual();
    });
  }

  // Allow manual state overrides from UI
  triggerState(state) {
    this.character.forceState(state);
  }
}
