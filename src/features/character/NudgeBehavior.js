// Dr. Vibe - Mouse Nudge Behavior
// When enabled, Dr. Vibe continuously accelerates away from the cursor
// whenever it enters his personal-space radius, then coasts to a stop.
// Runs in the game loop (spring physics) for smooth, responsive movement.

import { tauri } from '../../core/TauriBridge.js';
import { eventBus, Events } from '../../core/EventBus.js';

// ── Tuning constants ──────────────────────────────────────────────────────────

// Physical-pixel distance from the window edge at which fleeing starts.
const FLEE_RADIUS = 100;

// Base physics values at speed setting = 5 (midpoint).
// _fleeAccel and _fleeMaxSpeed are computed per-instance from the speed setting.
const BASE_ACCEL     = 1.5;
const BASE_MAX_SPEED = 25;

// Velocity multiplier per game-frame — controls how quickly he coasts to a stop.
// 0.86 ≈ stops cleanly without sliding too far after he's cleared the cursor.
const DAMPING = 0.86;

// Slight elastic bounce when he hits the monitor edge (fraction of velocity reflected).
const EDGE_BOUNCE = 0.35;

// How often (ms) to fetch the cursor position from Rust (async IPC).
// Physics updates every game frame using this cached value.
const CURSOR_POLL_MS = 40;

// How often (ms) to refresh cached window position when not actively fleeing.
const POS_REFRESH_MS = 1500;

// States that are preserved when a nudge ends — long-running contextual states
// that should resume after the nudge. Walk states are intentionally excluded
// (nudge never re-enters walkLeft/walkRight on settle). Short autoRevert states
// (excited, celebrating, beaker, etc.) are also excluded — they auto-revert anyway.
const PRESERVE_THROUGH_NUDGE = new Set([
  'idle', 'coding', 'tired', 'focused', 'concerned',
  'alert', 'stretching', 'coverEyes', 'thinking',
]);

// ── Class ─────────────────────────────────────────────────────────────────────

export class NudgeBehavior {
  constructor(settings, character, windowDrag, walkingBehavior) {
    this.settings        = settings;
    this.character       = character;
    this.windowDrag      = windowDrag;
    this.walkingBehavior = walkingBehavior;

    this.enabled         = false;
    this._lockedToScreen = true; // mirrors walkingLockedToScreen, read in init()

    // Speed-scaled physics (recomputed whenever mouseNudgeSpeed changes)
    this._fleeAccel    = BASE_ACCEL;
    this._fleeMaxSpeed = BASE_MAX_SPEED;

    // Physics state (all values in physical screen pixels)
    this._velocity     = 0;   // horizontal flee velocity, px/game-frame
    this._isMoving     = false;
    this._priorState   = 'idle';
    this._activeAnim   = null; // 'walkLeft' | 'walkRight' | null

    // Cached data shared between poll and update loops
    this._cursorX      = null;
    this._cursorY      = null;
    this._winPos       = { x: 0, y: 0 };
    this._winSize      = { width: 128, height: 128 };
    this._monitorBounds = null;
    this._allMonitors   = [];   // all connected monitors, for cross-monitor span
    this._posLastFetch  = 0;
    this._fetchingCursor = false;
    this._refreshingAfterDrag = false; // blocks flee until _winPos re-syncs post-drag

    this._pollInterval  = null;
    this._monRefresh    = null;
    this._unsubs        = [];
  }

  // ── Init / destroy ─────────────────────────────────────────────────────────

  async init() {
    if (!tauri.isAvailable) return;

    this.enabled         = this.settings.get('mouseNudgeEnabled')    ?? false;
    this._lockedToScreen = this.settings.get('walkingLockedToScreen') ?? true;
    this._applySpeedSetting(this.settings.get('mouseNudgeSpeed') ?? 7);

    // Cache initial geometry
    await this._refreshWindowPos();
    await this._refreshMonitorBounds();

    this._unsubs.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'mouseNudgeSpeed')        { this._applySpeedSetting(value); return; }
        if (key === 'walkingLockedToScreen')  { this._lockedToScreen = value;   return; }
        if (key !== 'mouseNudgeEnabled') return;
        this.enabled = value;
        if (value) {
          this._refreshWindowPos(); // re-sync position in case window moved while disabled
          this._startPolling();
        } else {
          this._stopPolling();
          this._halt(); // zero velocity, revert animation
        }
      }),

      // Re-sync our cached window position after anything else moves the window
      eventBus.on(Events.WINDOW_DRAG_START,  () => { this._halt(); this._posLastFetch = 0; }),
      eventBus.on(Events.WINDOW_DRAG_END, () => {
        this._posLastFetch = 0;
        this._refreshMonitorBounds();
        // Re-sync _winPos before allowing flee, so stale pre-drag position
        // can't trigger an immediate snap-back move.
        this._refreshingAfterDrag = true;
        this._refreshWindowPos().finally(() => { this._refreshingAfterDrag = false; });
      }),
      eventBus.on(Events.WALKING_STOPPED,    () => { this._posLastFetch = 0; }),
    );

    if (this.enabled) this._startPolling();
  }

  destroy() {
    this._stopPolling();
    this._halt();
    for (const u of this._unsubs) u();
    this._unsubs = [];
  }

  // ── Game loop update (called every frame by app.js) ────────────────────────

  update(deltaTime) {
    if (!tauri.isAvailable) return;
    if (!this.enabled)       return;
    if (this.windowDrag?.isDragging) { this._halt(); return; }

    // Normalize to 33 ms reference frame so physics feel the same at any FPS
    const frameScale = Math.min(deltaTime / 33, 3); // clamp huge deltas (tab focus)

    // ── Sync position from WalkingBehavior ────────────────────────────────
    // WalkingBehavior moves the window every frame. Without this, _winPos goes
    // stale during a walk and the flee-zone check fires from the wrong position.
    if (this.walkingBehavior?.isWalking) {
      const wx = this.walkingBehavior.currentX;
      const wy = this.walkingBehavior.currentY;
      if (wx !== undefined) {
        this._winPos       = { x: wx, y: wy };
        this._posLastFetch = Date.now();
      }
    }

    const { x: wx, y: wy } = this._winPos;

    // ── Apply flee force ───────────────────────────────────────────────────
    if (this._cursorX !== null && !this._refreshingAfterDrag) {
      const { width: winW, height: winH } = this._winSize;
      const nearX   = Math.max(wx, Math.min(wx + winW, this._cursorX));
      const nearY   = Math.max(wy, Math.min(wy + winH, this._cursorY));
      const dist    = Math.hypot(this._cursorX - nearX, this._cursorY - nearY);

      if (dist <= FLEE_RADIUS) {
        const proximity   = 1 - dist / FLEE_RADIUS;
        const charCenterX = wx + winW / 2;
        const fleeDir     = this._cursorX < charCenterX ? 1 : -1; // away from cursor
        this._velocity   += fleeDir * this._fleeAccel * proximity * frameScale;

        // Immediately take over from walking — no threshold, instant response
        if (this.walkingBehavior?.isWalking) {
          this.walkingBehavior.forceStop();
        }
      }
    }

    // ── Clamp and damp ────────────────────────────────────────────────────
    this._velocity = Math.max(-this._fleeMaxSpeed, Math.min(this._fleeMaxSpeed, this._velocity));
    this._velocity *= Math.pow(DAMPING, frameScale);

    if (Math.abs(this._velocity) < 0.02) {
      this._velocity = 0;
    }

    // ── Move or stop ──────────────────────────────────────────────────────
    if (this._velocity !== 0) {
      this._applyVelocity(frameScale);
    } else if (this._isMoving) {
      this._settle();
    } else {
      // Idle: refresh cached window position so we notice external moves
      const now = Date.now();
      if (now - this._posLastFetch > POS_REFRESH_MS) {
        this._refreshWindowPos(); // async, fire-and-forget
      }
    }
  }

  // ── Private: move window by current velocity ───────────────────────────────

  _applyVelocity(frameScale) {
    const { x: wx, y: wy } = this._winPos;
    const { width: ww }    = this._winSize;

    let newX = wx + this._velocity * frameScale;

    // Always enforce edges — current monitor when locked, full multi-monitor span when not.
    // Either way prevents walking off into empty space.
    const bounds = this._lockedToScreen ? this._monitorBounds : this._getFullMonitorSpan();
    if (bounds) {
      const minX = bounds.x;
      const maxX = bounds.x + bounds.width - ww;
      if (newX < minX) { newX = minX; this._velocity =  Math.abs(this._velocity) * EDGE_BOUNCE; }
      else if (newX > maxX) { newX = maxX; this._velocity = -Math.abs(this._velocity) * EDGE_BOUNCE; }
    }

    // Update cached position first so next frame uses the right value
    this._winPos = { x: newX, y: wy };
    this._posLastFetch = Date.now();

    // Move the window — fire-and-forget, same pattern as WalkingBehavior
    tauri.window.setPosition({ type: 'Physical', x: Math.round(newX), y: Math.round(wy) })
      .catch(() => {});

    // Update walk animation to match direction
    const anim = this._velocity > 0 ? 'walkRight' : 'walkLeft';
    if (!this._isMoving) {
      // Save state to restore after nudge. Prefer the actual current state for
      // long-running states (tired, focused, alert, etc.) so they survive the
      // nudge. Walk states are excluded — we never re-enter walking on settle.
      // Short autoRevert states are also excluded; they'd auto-revert anyway.
      const cur = this.character.currentState;
      this._priorState = PRESERVE_THROUGH_NUDGE.has(cur)
        ? cur
        : (this.character.contextualState || 'idle');
      this._isMoving   = true;
      this._activeAnim = anim;
      this.character.forceState(anim);
    } else if (anim !== this._activeAnim) {
      // Direction reversed mid-flee
      this._activeAnim = anim;
      this.character.forceState(anim);
    }

    // Reposition speech bubble (fire-and-forget)
    this._repositionSpeech(Math.round(newX), Math.round(wy));

    eventBus.emit(Events.MOUSE_NUDGE, { direction: this._velocity > 0 ? 'right' : 'left' });
  }

  // Called once when velocity reaches zero after a flee
  _settle() {
    this._isMoving   = false;
    this._activeAnim = null;
    this.character.forceState(this._priorState);

    // Persist new resting position
    const { x, y } = this._winPos;
    this.settings.set('position', { x: Math.round(x), y: Math.round(y) });

    // Re-lock to whatever monitor he settled on (handles cross-monitor nudges)
    this._refreshMonitorBounds();

    // Let WalkingBehavior re-sync its own cached position
    this.walkingBehavior?._cacheWindowPosition?.();
  }

  // Zero out velocity and revert character animation immediately
  _halt() {
    if (this._isMoving) {
      this._isMoving   = false;
      this._activeAnim = null;
      this.character.forceState(this._priorState);
    }
    this._velocity = 0;
  }

  // ── Private: speed scaling ─────────────────────────────────────────────────

  // Maps the 1–10 speed setting to physics constants.
  // Scale factor: 1 → 0.2×, 5 → 0.6×, 7 → 1.0× (default), 10 → 1.6×
  _applySpeedSetting(speed) {
    const s = Math.max(1, Math.min(10, speed ?? 7));
    const factor = 0.2 + (s - 1) * (1.4 / 9); // linear 0.2 → 1.6
    this._fleeAccel    = BASE_ACCEL     * factor;
    this._fleeMaxSpeed = BASE_MAX_SPEED * factor;
  }

  // ── Private: polling (cursor + monitor) ───────────────────────────────────

  _startPolling() {
    this._stopPolling();

    // Cursor position — fast interval, protected against overlapping fetches
    this._pollInterval = setInterval(async () => {
      if (this._fetchingCursor) return;
      this._fetchingCursor = true;
      const pos = await tauri.getCursorPosition();
      if (pos) { [this._cursorX, this._cursorY] = pos; }
      this._fetchingCursor = false;
    }, CURSOR_POLL_MS);

    // Monitor bounds — infrequent refresh
    this._monRefresh = setInterval(() => this._refreshMonitorBounds(), 10_000);
  }

  _stopPolling() {
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    if (this._monRefresh)   { clearInterval(this._monRefresh);   this._monRefresh   = null; }
    this._cursorX = null;
    this._cursorY = null;
  }

  // ── Private: geometry helpers ──────────────────────────────────────────────

  async _refreshWindowPos() {
    try {
      this._winPos  = await tauri.getWindowPosition();
      this._winSize = await tauri.getWindowSize();
      this._posLastFetch = Date.now();
    } catch (_) {}
  }

  async _refreshMonitorBounds() {
    try {
      const mon = await tauri.getCurrentMonitor();
      if (mon) {
        this._monitorBounds = {
          x:      mon.position.x,
          y:      mon.position.y,
          width:  mon.size.width,
          height: mon.size.height,
        };
      }
      const all = await tauri.getMonitors();
      if (all?.length) {
        this._allMonitors = all.map(m => ({
          x: m.position.x, y: m.position.y,
          width: m.size.width, height: m.size.height,
        }));
      }
    } catch (_) {}
  }

  // Returns a rect spanning the full width of all connected monitors.
  // Used when lock is OFF so he can cross monitors but can't walk into empty space.
  _getFullMonitorSpan() {
    if (this._allMonitors.length) {
      const left  = Math.min(...this._allMonitors.map(m => m.x));
      const right = Math.max(...this._allMonitors.map(m => m.x + m.width));
      return { x: left, width: right - left };
    }
    return this._monitorBounds; // fallback: treat single monitor as span
  }

  _repositionSpeech(winX, winY) {
    try {
      const { emitTo } = window.__TAURI__.event;
      const sw = 200, sh = 100;
      emitTo('speech', 'speech-reposition', {
        x: winX + Math.round((this._winSize.width - sw) / 2),
        y: winY - sh,
      });
    } catch (_) {}
  }
}
