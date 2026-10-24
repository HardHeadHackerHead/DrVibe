// Dr. Vibe - Anti-Gravity IDE Tracker
// Detects when the user is actively using the Anti-Gravity vibe coding IDE
// and emits events that trigger Dr. Vibe's levitation animations.
//
// Detection strategy:
//   - Listens to activity events from ActivityMonitor
//   - Checks if the active app name matches Anti-Gravity IDE identifiers
//   - Distinguishes passive (app open) from active (coding) usage
//   - Emits ANTI_GRAVITY_ACTIVE when Anti-Gravity session begins
//   - Emits ANTI_GRAVITY_IDLE after a configurable period of inactivity

import { eventBus, Events } from '../../core/EventBus.js';

// App name substrings that identify Anti-Gravity IDE
const ANTI_GRAVITY_IDENTIFIERS = ['anti-gravity', 'antigravity'];

// How long (ms) Anti-Gravity must be away before we consider it idle
const IDLE_TIMEOUT_MS = 30000; // 30 seconds

export class AntiGravityTracker {
  constructor() {
    this._isActive = false;
    this._idleTimer = null;
    this._unsubscribers = [];
  }

  init() {
    // React to general coding start/stop transitions
    const unsubActivity = eventBus.on(Events.ACTIVITY_CHANGED, ({ isCoding, appName }) => {
      if (isCoding && this._isAntiGravity(appName)) {
        this._onAntiGravityActive();
      } else if (!isCoding && this._isActive) {
        this._scheduleIdle();
      }
    });

    // Also track window changes while still coding (user may switch to/from Anti-Gravity)
    const unsubWindow = eventBus.on(Events.ACTIVITY_WINDOW_CHANGED, ({ appName, isCoding }) => {
      if (!isCoding) return;
      if (this._isAntiGravity(appName)) {
        this._onAntiGravityActive();
      } else if (this._isActive) {
        // Switched to a different coding app — start idle countdown
        this._scheduleIdle();
      }
    });

    // When coding starts, check if it's in Anti-Gravity
    const unsubCodingStart = eventBus.on(Events.ACTIVITY_CODING_START, ({ appName }) => {
      if (this._isAntiGravity(appName)) {
        this._onAntiGravityActive();
      }
    });

    // When coding stops entirely, go idle immediately
    const unsubCodingStop = eventBus.on(Events.ACTIVITY_CODING_STOP, () => {
      if (this._isActive) {
        this._scheduleIdle();
      }
    });

    this._unsubscribers = [unsubActivity, unsubWindow, unsubCodingStart, unsubCodingStop];
    console.log('AntiGravityTracker initialized');
  }

  destroy() {
    this._clearIdleTimer();
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  _isAntiGravity(appName) {
    if (!appName) return false;
    const lower = appName.toLowerCase();
    return ANTI_GRAVITY_IDENTIFIERS.some(id => lower.includes(id));
  }

  _onAntiGravityActive() {
    this._clearIdleTimer();
    if (this._isActive) return; // already active — nothing to do

    this._isActive = true;
    console.log('Anti-Gravity IDE active — emitting ANTI_GRAVITY_ACTIVE');
    eventBus.emit(Events.ANTI_GRAVITY_ACTIVE, { appName: 'Anti-Gravity' });
  }

  _scheduleIdle() {
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (this._isActive) {
        this._isActive = false;
        console.log('Anti-Gravity IDE idle — emitting ANTI_GRAVITY_IDLE');
        eventBus.emit(Events.ANTI_GRAVITY_IDLE, {});
      }
    }, IDLE_TIMEOUT_MS);
  }

  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  isActive() {
    return this._isActive;
  }
}
