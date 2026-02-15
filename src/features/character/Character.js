// Dr. Vibe - Character State Machine
// Enhanced with transition anticipation — brief pause before entering high-energy
// states gives reactions a deliberate, organic feel.

import { eventBus, Events } from '../../core/EventBus.js';
import { ANIMATIONS, TRANSITION_RESTRICTIONS } from '../../config/animations.js';

// States that warrant an anticipation pause before entering.
// These are "reaction" states where a beat of anticipation looks better than
// an instant snap.
const ANTICIPATION_STATES = new Set([
  'excited', 'celebrating', 'beaker', 'thumbsUp', 'presenting',
  'libraryCard', 'concerned', 'alert',
]);

// Duration of the anticipation pause (ms).  During this time the character
// holds its current pose while the SpriteAnimator plays the transition
// squash/stretch effect.
const ANTICIPATION_DURATION = 120;

export class Character {
  constructor(animator) {
    this.animator = animator;
    this.currentState = 'idle';
    this.previousState = null;
    this.stateTimer = 0;
    this.contextualState = 'idle'; // Set by CharacterReactions (coding/idle)

    // Anticipation queue — when set, the character will hold briefly before
    // transitioning into the queued state.
    this._pendingState = null;
    this._anticipationTimer = 0;

    this.stateBehaviors = this.buildStateBehaviors();
  }

  buildStateBehaviors() {
    const behaviors = {};
    for (const [name, config] of Object.entries(ANIMATIONS)) {
      const loop = config.loop !== false;
      switch (config.behavior) {
        case 'loop':
          behaviors[name] = {
            enter: () => this.animator.play(name, true),
            update: () => {},
            exit: () => {}
          };
          break;
        case 'autoRevert':
          behaviors[name] = {
            enter: () => this.animator.play(name, loop),
            update: (dt) => {
              this.stateTimer += dt;
              if (this.stateTimer > config.duration) {
                this.setState(this.contextualState);
              }
            },
            exit: () => {}
          };
          break;
        case 'timeoutToIdle':
          behaviors[name] = {
            enter: () => this.animator.play(name, true),
            update: (dt) => {
              this.stateTimer += dt;
              if (this.stateTimer > config.duration) {
                this.setState('idle');
              }
            },
            exit: () => {}
          };
          break;
        case 'oneShot':
          behaviors[name] = {
            enter: () => this.animator.play(name, false),
            update: () => {},
            exit: () => {}
          };
          break;
      }
    }
    return behaviors;
  }

  init() {
    this.forceState('idle');
  }

  setState(newState) {
    if (newState === this.currentState) return;

    const restrictions = TRANSITION_RESTRICTIONS[newState];
    if (restrictions?.allowedFrom && !restrictions.allowedFrom.includes(this.currentState)) {
      console.warn(`Invalid state transition: ${this.currentState} -> ${newState}`);
      return;
    }

    // If this is a reaction state, queue it with anticipation
    if (ANTICIPATION_STATES.has(newState) && !this._pendingState) {
      this._pendingState = newState;
      this._anticipationTimer = 0;
      // Trigger the transition squash on the animator now (visual anticipation)
      this.animator._triggerTransition();
      return;
    }

    this.performStateChange(newState);
  }

  forceState(newState) {
    // Force skips anticipation for immediate reactions
    this._pendingState = null;
    this._anticipationTimer = 0;
    this.performStateChange(newState);
  }

  performStateChange(newState) {
    // Exit current state
    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].exit();
    }

    this.previousState = this.currentState;
    this.currentState = newState;
    this.stateTimer = 0;

    console.log(`Character state: ${this.previousState} -> ${this.currentState}`);

    // Emit state change event
    eventBus.emit(Events.CHARACTER_STATE_CHANGED, {
      previous: this.previousState,
      current: this.currentState
    });

    // Enter new state
    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].enter();
    }
  }

  update(deltaTime) {
    // Process anticipation queue
    if (this._pendingState) {
      this._anticipationTimer += deltaTime;
      if (this._anticipationTimer >= ANTICIPATION_DURATION) {
        const pending = this._pendingState;
        this._pendingState = null;
        this._anticipationTimer = 0;
        this.performStateChange(pending);
      }
    }

    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].update(deltaTime);
    }

    this.animator.update(deltaTime);
  }

  getState() {
    return {
      current: this.currentState,
      previous: this.previousState,
      timer: this.stateTimer
    };
  }
}
