// Dr. Vibe - Character State Machine

export class Character {
  constructor(animator) {
    this.animator = animator;
    this.currentState = 'idle';
    this.previousState = null;
    this.stateTimer = 0;
    this.transitionQueue = [];

    // State-specific behaviors
    this.stateBehaviors = {
      idle: {
        enter: () => this.animator.play('idle', true),
        update: (dt) => {},
        exit: () => {}
      },
      coding: {
        enter: () => this.animator.play('coding', true),
        update: (dt) => {},
        exit: () => {}
      },
      thinking: {
        enter: () => this.animator.play('thinking', true),
        update: (dt) => {
          // Auto-transition to idle after 2 minutes of thinking
          this.stateTimer += dt;
          if (this.stateTimer > 120000) {
            this.setState('idle');
          }
        },
        exit: () => {}
      },
      tired: {
        enter: () => this.animator.play('tired', true),
        update: (dt) => {},
        exit: () => {}
      },
      excited: {
        enter: () => {
          this.animator.play('excited', true);
          // Return to previous state after celebration
          this.stateTimer = 0;
        },
        update: (dt) => {
          this.stateTimer += dt;
          if (this.stateTimer > 3000) {
            this.setState(this.previousState || 'idle');
          }
        },
        exit: () => {}
      },
      alert: {
        enter: () => this.animator.play('alert', true),
        update: (dt) => {},
        exit: () => {}
      }
    };

    // Valid state transitions
    this.validTransitions = {
      idle: ['coding', 'thinking', 'tired', 'alert', 'excited'],
      coding: ['idle', 'thinking', 'tired', 'alert', 'excited'],
      thinking: ['idle', 'coding', 'tired', 'alert', 'excited'],
      tired: ['idle', 'coding', 'alert', 'excited'],
      excited: ['idle', 'coding', 'thinking', 'tired', 'alert'],
      alert: ['idle', 'coding', 'excited', 'tired']
    };

    // Start in idle state (use forceState to bypass transition check)
    this.forceState('idle');
  }

  setState(newState) {
    if (newState === this.currentState) return;

    // Check if transition is valid
    const validNext = this.validTransitions[this.currentState];
    if (!validNext || !validNext.includes(newState)) {
      console.warn(`Invalid state transition: ${this.currentState} -> ${newState}`);
      return;
    }

    // Exit current state
    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].exit();
    }

    // Store previous state (for returning after temporary states)
    this.previousState = this.currentState;
    this.currentState = newState;
    this.stateTimer = 0;

    console.log(`Character state: ${this.previousState} -> ${this.currentState}`);

    // Enter new state
    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].enter();
    }
  }

  update(deltaTime) {
    // Update current state behavior
    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].update(deltaTime);
    }

    // Update animator
    this.animator.update(deltaTime);
  }

  // Force a state change (bypasses transition validation)
  forceState(newState) {
    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].exit();
    }

    this.previousState = this.currentState;
    this.currentState = newState;
    this.stateTimer = 0;

    if (this.stateBehaviors[this.currentState]) {
      this.stateBehaviors[this.currentState].enter();
    }
  }

  // Get current state info
  getStateInfo() {
    return {
      current: this.currentState,
      previous: this.previousState,
      timer: this.stateTimer
    };
  }
}
