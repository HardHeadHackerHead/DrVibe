// Dr. Vibe - Window Dragging

import { tauri } from '../core/TauriBridge.js';
import { eventBus, Events } from '../core/EventBus.js';

const MIN_VISIBLE_PX = 50;
const MONITOR_POLL_MS = 30_000; // Check for monitor changes every 30s

export class WindowDrag {
  constructor(settings) {
    this.settings = settings;
    this.canvas = document.getElementById('character-canvas');
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.screenBounds = null;
    this.monitorWorkAreas = []; // Per-monitor work areas (Windows only; empty on macOS)
    this.windowSize = { width: 200, height: 200 };
    this.pendingMove = false; // Throttle flag
    this.lastMoveTime = 0;
    this.THROTTLE_MS = 16; // ~60fps
    this.monitorPollInterval = null;
  }

  async init() {
    if (!this.canvas) {
      console.warn('WindowDrag: canvas not found');
      return;
    }

    await this.refreshScreenBounds();
    this.setupEventListeners();
    this.startMonitorPolling();
    this.canvas.style.cursor = 'grab';
  }

  async refreshScreenBounds() {
    if (!tauri.isAvailable) return;

    try {
      const [monitors, workAreas] = await Promise.all([
        tauri.getMonitors(),
        tauri.getMonitorWorkAreas(),
      ]);
      this.windowSize = await tauri.getWindowSize();

      if (monitors.length === 0) return;

      // Build a bounding rect that covers all monitors
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      for (const monitor of monitors) {
        const pos = monitor.position;
        const size = monitor.size;
        if (pos.x < minX) minX = pos.x;
        if (pos.y < minY) minY = pos.y;
        if (pos.x + size.width > maxX) maxX = pos.x + size.width;
        if (pos.y + size.height > maxY) maxY = pos.y + size.height;
      }

      this.screenBounds = { minX, minY, maxX, maxY };
      this.monitorWorkAreas = workAreas || [];
    } catch (e) {
      console.log('Failed to get screen bounds:', e);
    }
  }

  // Find the work area for the monitor that contains (cx, cy).
  // Falls back to the nearest monitor if none contains the point.
  _findWorkArea(cx, cy) {
    if (!this.monitorWorkAreas || this.monitorWorkAreas.length === 0) return null;

    for (const wa of this.monitorWorkAreas) {
      if (cx >= wa.x && cx < wa.x + wa.width && cy >= wa.y && cy < wa.y + wa.height) {
        return wa;
      }
    }

    // Fallback: closest monitor center
    let closest = null;
    let minDist = Infinity;
    for (const wa of this.monitorWorkAreas) {
      const dist = Math.hypot(cx - (wa.x + wa.width / 2), cy - (wa.y + wa.height / 2));
      if (dist < minDist) { minDist = dist; closest = wa; }
    }
    return closest;
  }

  clampPosition(x, y) {
    if (!this.screenBounds) return { x, y };

    const { minX, minY, maxX, maxY } = this.screenBounds;
    const { width, height } = this.windowSize;

    // Keep at least MIN_VISIBLE_PX of the window on-screen horizontally
    const clampedX = Math.max(minX - width + MIN_VISIBLE_PX, Math.min(x, maxX - MIN_VISIBLE_PX));

    // Vertical floor: Dr. Vibe's feet must not go below the taskbar (Windows) or
    // the screen bottom (macOS).  Work areas come from the Rust backend; on macOS
    // the list is empty and we fall back to the full screen bottom.
    const winCenterX = x + width / 2;
    const winCenterY = y + height / 2;
    const workArea = this._findWorkArea(winCenterX, winCenterY);
    const maxY_floor = workArea
      ? workArea.work_y + workArea.work_height - height  // feet stop at taskbar top
      : maxY - height;                                   // feet stop at screen bottom
    const clampedY = Math.max(minY, Math.min(y, maxY_floor));

    return { x: clampedX, y: clampedY };
  }

  isPositionOnScreen(x, y) {
    if (!this.screenBounds) return true;

    const { minX, minY, maxX, maxY } = this.screenBounds;
    const { width, height } = this.windowSize;

    // Check if at least some portion of the window is visible horizontally
    if (x + width <= minX + MIN_VISIBLE_PX || x >= maxX - MIN_VISIBLE_PX) return false;
    if (y + height <= minY + MIN_VISIBLE_PX) return false;

    // Check that feet don't go below the taskbar/screen floor
    const workArea = this._findWorkArea(x + width / 2, y + height / 2);
    const maxY_floor = workArea
      ? workArea.work_y + workArea.work_height - height
      : maxY - height;
    if (y > maxY_floor) return false;

    return true;
  }

  setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this.startDrag(e));
    document.addEventListener('mousemove', (e) => this.drag(e));
    document.addEventListener('mouseup', () => this.endDrag());

    // Disable browser context menu on right-click
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  startDrag(e) {
    if (e.button !== 0) return; // Only left click

    this.isDragging = true;
    this.dragOffset.x = e.clientX;
    this.dragOffset.y = e.clientY;
    this.canvas.style.cursor = 'grabbing';
    eventBus.emit(Events.WINDOW_DRAG_START, {});
  }

  drag(e) {
    if (!this.isDragging || !tauri.isAvailable) return;

    // Throttle: skip if we're still processing the previous move
    const now = performance.now();
    if (now - this.lastMoveTime < this.THROTTLE_MS) return;
    if (this.pendingMove) return;

    this.lastMoveTime = now;
    this.pendingMove = true;

    const deltaX = e.clientX - this.dragOffset.x;
    const deltaY = e.clientY - this.dragOffset.y;

    // Fire and forget - don't await, just let it complete
    this.moveWindow(deltaX, deltaY).finally(() => {
      this.pendingMove = false;
    });
  }

  async moveWindow(deltaX, deltaY) {
    try {
      const position = await tauri.window.outerPosition();
      const { x, y } = this.clampPosition(position.x + deltaX, position.y + deltaY);
      await tauri.window.setPosition({
        type: 'Physical',
        x: Math.round(x),
        y: Math.round(y)
      });
      // Reposition speech bubble window to follow during drag
      this._repositionSpeechWindow(Math.round(x), Math.round(y));
    } catch (err) {
      // Ignore drag errors silently
    }
  }

  _repositionSpeechWindow(mainX, mainY) {
    try {
      const { emitTo } = window.__TAURI__.event;
      const speechWidth = 200;
      const speechHeight = 100;
      const x = mainX + Math.round((this.windowSize.width - speechWidth) / 2);
      emitTo('speech', 'speech-reposition', { x, y: mainY - speechHeight });
    } catch (e) {
      // Speech window may not be open
    }
  }

  endDrag() {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.canvas.style.cursor = 'grab';

    // Determine which side of the screen has more space — character should face that way
    this._emitDragEnd();

    // Save position
    this.saveWindowPosition();
  }

  async _emitDragEnd() {
    const facingDirection = await this.getFacingDirection();
    eventBus.emit(Events.WINDOW_DRAG_END, { facingDirection });
  }

  // Determine which direction the character should face based on its position
  // on the current monitor.  Returns 'left', 'right', or null.
  async getFacingDirection() {
    if (!tauri.isAvailable) return null;
    try {
      const [pos, monitor] = await Promise.all([
        tauri.window.outerPosition(),
        tauri.getCurrentMonitor(),
      ]);
      if (!monitor) return null;

      const winCenterX = pos.x + this.windowSize.width / 2;
      const monLeft = monitor.position.x;
      const monRight = monLeft + monitor.size.width;
      const monMidX = (monLeft + monRight) / 2;

      return winCenterX < monMidX ? 'right' : 'left';
    } catch {
      return null;
    }
  }

  async saveWindowPosition() {
    if (!tauri.isAvailable) return;

    try {
      const position = await tauri.window.outerPosition();
      await this.settings.set('position', { x: position.x, y: position.y });
    } catch (e) {
      console.log('Failed to save position:', e);
    }
  }

  async restorePosition() {
    if (!tauri.isAvailable) return;

    try {
      const position = this.settings.get('position');
      if (!position) return;

      // Refresh bounds in case monitors changed since last session
      await this.refreshScreenBounds();

      if (this.isPositionOnScreen(position.x, position.y)) {
        await tauri.window.setPosition({
          type: 'Physical',
          x: position.x,
          y: position.y
        });
      } else {
        // Saved position is off-screen — move to a safe default
        console.log('Saved position off-screen, resetting to safe default');
        await this.moveToSafePosition();
      }
    } catch (e) {
      console.log('Failed to restore position:', e);
    }
  }

  async moveToSafePosition() {
    const monitor = await tauri.getPrimaryMonitor();
    let safeX = 100, safeY = 100;
    if (monitor) {
      safeX = monitor.position.x + Math.round(monitor.size.width / 2 - this.windowSize.width / 2);
      safeY = monitor.position.y + Math.round(monitor.size.height / 2 - this.windowSize.height / 2);
    }
    await tauri.window.setPosition({
      type: 'Physical',
      x: safeX,
      y: safeY
    });
    this.settings.set('position', { x: safeX, y: safeY });
  }

  startMonitorPolling() {
    if (!tauri.isAvailable) return;

    this.monitorPollInterval = setInterval(async () => {
      if (this.isDragging) return;

      const prevBounds = this.screenBounds
        ? `${this.screenBounds.minX},${this.screenBounds.minY},${this.screenBounds.maxX},${this.screenBounds.maxY}`
        : null;

      await this.refreshScreenBounds();

      const newBounds = this.screenBounds
        ? `${this.screenBounds.minX},${this.screenBounds.minY},${this.screenBounds.maxX},${this.screenBounds.maxY}`
        : null;

      // If monitor configuration changed, verify window is still on-screen
      if (prevBounds !== newBounds) {
        console.log('Monitor configuration changed, checking window position');
        try {
          const position = await tauri.window.outerPosition();
          if (!this.isPositionOnScreen(position.x, position.y)) {
            console.log('Window off-screen after monitor change, repositioning');
            await this.moveToSafePosition();
          }
        } catch (e) {
          // Ignore — window may be mid-transition
        }
      }
    }, MONITOR_POLL_MS);
  }

  destroy() {
    if (this.monitorPollInterval) {
      clearInterval(this.monitorPollInterval);
      this.monitorPollInterval = null;
    }
  }
}
