// Dr. Vibe - Walking Behavior
// Occasionally moves Dr. Vibe left/right on screen during idle time.
// Enhanced with smooth acceleration/deceleration curves and body lean.

import { tauri } from '../../core/TauriBridge.js';
import { eventBus, Events } from '../../core/EventBus.js';

const MAX_WALK_SPEED = 2;            // pixels per frame at full speed (~60px/s at 30fps)
const MIN_IDLE_BEFORE_WALK = 15000;  // minimum ms idle before considering a walk
const MAX_IDLE_BEFORE_WALK = 45000;  // maximum ms idle before walking
const WALK_COOLDOWN = 10000;         // ms after a walk before another can start
const ARRIVAL_THRESHOLD = 4;         // px — close enough to destination to stop
const MIN_WALK_DISTANCE = 80;        // px — don't walk tiny distances

// Acceleration / deceleration
const ACCEL_DURATION = 400;          // ms to reach full speed from standstill
const DECEL_DISTANCE = 40;           // px from target to begin decelerating
const MIN_SPEED_FRACTION = 0.15;     // minimum speed during accel/decel (prevents stalling)

// Easing helpers
function easeInQuad(t) { return t * t; }
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

export class WalkingBehavior {
  constructor(settings, character, windowDrag) {
    this.settings = settings;
    this.character = character;
    this.windowDrag = windowDrag;

    this.enabled = true;
    this.isWalking = false;
    this.walkDirection = null;  // 'left' or 'right'
    this.targetX = 0;
    this.currentX = 0;
    this.currentY = 0;

    // Acceleration state
    this._walkElapsed = 0;       // ms since walk started (for accel curve)
    this._currentSpeed = 0;      // actual speed this frame

    this.idleAccumulator = 0;
    this.idleThreshold = this._randomIdleThreshold();
    this.cooldownTimer = 0;

    this.monitorBounds = null;  // { x, y, width, height }
    this.windowWidth = 200;

    this._unsubs = [];
  }

  async init() {
    if (!tauri.isAvailable) return;

    this.enabled = this.settings.get('walkingEnabled') ?? true;

    await this._refreshMonitorBounds();
    await this._cacheWindowPosition();

    this._unsubs.push(
      eventBus.on(Events.WINDOW_DRAG_START, () => this._onDragStart()),
      eventBus.on(Events.WINDOW_DRAG_END, () => this._onDragEnd()),
      eventBus.on(Events.CHARACTER_STATE_CHANGED, (data) => this._onStateChanged(data)),
      eventBus.on(Events.SETTINGS_CHANGED, (data) => this._onSettingsChanged(data)),
    );
  }

  update(deltaTime) {
    if (!tauri.isAvailable || !this.enabled) return;

    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= deltaTime;
    }

    if (this.isWalking) {
      this._stepWalk(deltaTime);
      return;
    }

    // Only accumulate idle time when we're allowed to walk
    if (!this._canWalk()) {
      this.idleAccumulator = 0;
      return;
    }

    this.idleAccumulator += deltaTime;

    if (this.idleAccumulator >= this.idleThreshold && this.cooldownTimer <= 0) {
      this._decideToWalk();
    }
  }

  // --- Public: debug commands ---

  async forceWalk() {
    if (!tauri.isAvailable) return;
    if (this.isWalking) return;

    await this._refreshMonitorBounds();
    await this._cacheWindowPosition();

    const bounds = this._getWalkableBounds();
    if (!bounds) return;

    const { minX, maxX } = bounds;
    const range = maxX - minX;
    if (range < MIN_WALK_DISTANCE) return;

    // Pick a random destination
    let targetX;
    let attempts = 0;
    do {
      targetX = minX + Math.random() * range;
      attempts++;
    } while (Math.abs(targetX - this.currentX) < MIN_WALK_DISTANCE && attempts < 10);

    if (Math.abs(targetX - this.currentX) < MIN_WALK_DISTANCE) {
      targetX = this.currentX < (minX + maxX) / 2 ? maxX : minX;
    }

    this._startWalk(targetX);
  }

  forceStop() {
    if (this.isWalking) {
      this._stopWalk();
    }
  }

  // --- Private: walk decision ---

  async _decideToWalk() {
    await this._refreshMonitorBounds();
    await this._cacheWindowPosition();

    const bounds = this._getWalkableBounds();
    if (!bounds) return;

    const { minX, maxX } = bounds;
    const range = maxX - minX;
    if (range < MIN_WALK_DISTANCE) return;

    let targetX;
    let attempts = 0;
    do {
      targetX = minX + Math.random() * range;
      attempts++;
    } while (Math.abs(targetX - this.currentX) < MIN_WALK_DISTANCE && attempts < 10);

    if (Math.abs(targetX - this.currentX) < MIN_WALK_DISTANCE) return;

    this._startWalk(targetX);
  }

  _startWalk(targetX) {
    this.isWalking = true;
    this.targetX = targetX;
    this.walkDirection = targetX > this.currentX ? 'right' : 'left';
    this.idleAccumulator = 0;
    this._walkElapsed = 0;
    this._currentSpeed = 0;

    const animName = this.walkDirection === 'right' ? 'walkRight' : 'walkLeft';
    this.character.setState(animName);

    eventBus.emit(Events.WALKING_STARTED, { direction: this.walkDirection });
  }

  _stepWalk(deltaTime) {
    const dx = this.targetX - this.currentX;
    const absDx = Math.abs(dx);

    if (absDx <= ARRIVAL_THRESHOLD) {
      this._stopWalk();
      return;
    }

    // Track elapsed time for acceleration curve
    this._walkElapsed += deltaTime;

    // --- Calculate speed ---
    let speedFraction = 1;

    // Acceleration phase — ease-in from standstill
    if (this._walkElapsed < ACCEL_DURATION) {
      const t = this._walkElapsed / ACCEL_DURATION;
      speedFraction = MIN_SPEED_FRACTION + (1 - MIN_SPEED_FRACTION) * easeInQuad(t);
    }

    // Deceleration phase — ease-out near destination
    if (absDx < DECEL_DISTANCE) {
      const t = absDx / DECEL_DISTANCE;
      const decelFraction = MIN_SPEED_FRACTION + (1 - MIN_SPEED_FRACTION) * easeOutQuad(t);
      speedFraction = Math.min(speedFraction, decelFraction);
    }

    this._currentSpeed = MAX_WALK_SPEED * speedFraction;
    const step = dx > 0 ? this._currentSpeed : -this._currentSpeed;
    this.currentX += step;

    // Move the window — fire and forget for smooth animation
    tauri.window.setPosition({
      type: 'Physical',
      x: Math.round(this.currentX),
      y: Math.round(this.currentY)
    }).catch(() => {});

    // Reposition speech bubble
    this._repositionSpeechWindow(Math.round(this.currentX), Math.round(this.currentY));
  }

  _stopWalk() {
    this.isWalking = false;
    this.walkDirection = null;
    this._currentSpeed = 0;
    this._walkElapsed = 0;
    this.cooldownTimer = WALK_COOLDOWN;
    this.idleThreshold = this._randomIdleThreshold();
    this.idleAccumulator = 0;

    // Revert to idle
    this.character.setState('idle');

    // Save new position
    this.settings.set('position', { x: Math.round(this.currentX), y: Math.round(this.currentY) });

    eventBus.emit(Events.WALKING_STOPPED, {});
  }

  _cancelWalk() {
    if (!this.isWalking) return;
    this.isWalking = false;
    this.walkDirection = null;
    this._currentSpeed = 0;
    this._walkElapsed = 0;
    this.idleAccumulator = 0;
    this.idleThreshold = this._randomIdleThreshold();
    eventBus.emit(Events.WALKING_STOPPED, {});
  }

  // --- Private: conditions ---

  _canWalk() {
    if (!this.enabled) return false;
    if (this.windowDrag.isDragging) return false;

    const contextual = this.character.contextualState;
    const current = this.character.currentState;
    if (contextual !== 'idle') return false;
    if (current !== 'idle') return false;

    return true;
  }

  // --- Private: bounding box ---

  _getWalkableBounds() {
    if (!this.monitorBounds) return null;

    const { x: monX, width: monW } = this.monitorBounds;
    const leftPct = this.settings.get('walkingBoundLeftPercent') || 0;
    const rightPct = this.settings.get('walkingBoundRightPercent') || 0;

    const leftMargin = monW * (leftPct / 100);
    const rightMargin = monW * (rightPct / 100);

    const minX = monX + leftMargin;
    const maxX = monX + monW - rightMargin - this.windowWidth;

    return { minX, maxX };
  }

  // --- Private: monitor/window queries ---

  async _refreshMonitorBounds() {
    if (!tauri.isAvailable) return;
    try {
      const monitor = await tauri.getCurrentMonitor();
      if (monitor) {
        this.monitorBounds = {
          x: monitor.position.x,
          y: monitor.position.y,
          width: monitor.size.width,
          height: monitor.size.height,
        };
      }
    } catch (e) {
      // Ignore
    }
  }

  async _cacheWindowPosition() {
    if (!tauri.isAvailable) return;
    try {
      const pos = await tauri.window.outerPosition();
      this.currentX = pos.x;
      this.currentY = pos.y;

      const size = await tauri.getWindowSize();
      if (size) this.windowWidth = size.width;
    } catch (e) {
      // Ignore
    }
  }

  _repositionSpeechWindow(mainX, mainY) {
    try {
      const { emitTo } = window.__TAURI__.event;
      const speechHeight = 100;
      emitTo('speech', 'speech-reposition', { x: mainX, y: mainY - speechHeight });
    } catch (e) {
      // Speech window may not be open
    }
  }

  // --- Private: event handlers ---

  _onDragStart() {
    this._cancelWalk();
  }

  async _onDragEnd() {
    await this._cacheWindowPosition();
    this.idleAccumulator = 0;
    this.idleThreshold = this._randomIdleThreshold();
  }

  _onStateChanged({ current }) {
    if (this.isWalking && current !== 'walkRight' && current !== 'walkLeft') {
      this._cancelWalk();
    }
  }

  _onSettingsChanged({ key, value }) {
    if (key === 'walkingEnabled') {
      this.enabled = value;
      if (!value) this._cancelWalk();
    }
  }

  // --- Private: helpers ---

  _randomIdleThreshold() {
    return MIN_IDLE_BEFORE_WALK + Math.random() * (MAX_IDLE_BEFORE_WALK - MIN_IDLE_BEFORE_WALK);
  }

  destroy() {
    this._cancelWalk();
    for (const unsub of this._unsubs) {
      unsub();
    }
    this._unsubs = [];
  }
}
