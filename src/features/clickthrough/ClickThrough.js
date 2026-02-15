// Dr. Vibe - Click-Through Background
// Makes transparent areas click-through while keeping character/UI interactive.
// When ghost mode is enabled, hovering the character fades it transparent
// and clicks pass through.

import { tauri } from '../../core/TauriBridge.js';
import { eventBus, Events } from '../../core/EventBus.js';

export class ClickThrough {
  constructor(settings) {
    this.settings = settings;

    // Interactive elements that should block click-through
    this.hitTargets = [];
    this.panelElements = [];

    this.isClickThrough = false;
    this.isPanelOpen = false;
    this.isDragging = false;
    this.isGhosted = false; // character is transparent & passthrough
    this.ghostEnabled = settings?.clickThroughGhostEnabled ?? true;
    this._ghostReady = false; // prevents ghosting during startup
    this.pollInterval = null;
    this.scaleFactor = 1;

    this.POLL_MS = 50;
    this.HIT_PADDING = 4; // Extra pixels around hit targets for easier targeting
    this.GHOST_OPACITY = 0.12; // How transparent the character gets when ghosted
    this.GHOST_FADE_MS = 180; // Transition speed for ghost fade

    // Bound handler for mousemove (used when window is interactive)
    this._onMouseMove = (e) => this.onMouseMove(e);

    // Elements that fade when ghosted
    this._ghostTargets = [];
    this._characterCanvas = null;
  }

  async init() {
    if (!tauri.isAvailable) return;

    this._characterCanvas = document.getElementById('character-canvas');

    // Gather interactive elements
    this.hitTargets = [
      this._characterCanvas,
      document.getElementById('speech-bubble'),
      document.getElementById('status-indicator'),
      document.getElementById('focus-overlay'),
    ].filter(Boolean);

    this.panelElements = [
      document.getElementById('about-panel'),
    ].filter(Boolean);

    // Elements that should ghost (fade) when cursor is over the character
    this._ghostTargets = [
      this._characterCanvas,
      document.getElementById('status-indicator'),
      document.getElementById('momentum-meter'),
      document.getElementById('project-display'),
    ].filter(Boolean);

    // Set transition on ghost targets
    for (const el of this._ghostTargets) {
      el.style.transition = `opacity ${this.GHOST_FADE_MS}ms ease, filter 0.6s ease`;
    }

    // Cache scale factor
    this.scaleFactor = await tauri.getScaleFactor();

    // Listen for panel open/close
    eventBus.on(Events.ABOUT_PANEL_OPENED, () => this.onPanelOpened());
    eventBus.on(Events.ABOUT_PANEL_CLOSED, () => this.onPanelClosed());

    // Listen for drag state to prevent re-enabling click-through during drag
    eventBus.on(Events.WINDOW_DRAG_START, () => {
      this.isDragging = true;
      // Un-ghost immediately when dragging starts
      if (this.isGhosted) this.unghost();
    });
    eventBus.on(Events.WINDOW_DRAG_END, () => {
      this.isDragging = false;
    });

    // React to setting changes at runtime
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'clickThroughGhostEnabled') {
        this.ghostEnabled = value;
        // If disabled while currently ghosted, restore immediately
        if (!value && this.isGhosted) {
          this.unghost();
        }
      }
    });

    // Listen for mouse leaving the window content when interactive
    document.addEventListener('mouseleave', () => {
      if (!this.isClickThrough && !this.isPanelOpen && !this.isDragging) {
        this.enableClickThrough();
      }
      // Un-ghost when cursor leaves the window entirely
      if (this.isGhosted) this.unghost();
    });

    // Enable click-through by default
    await this.enableClickThrough();

    // Grace period: don't ghost for the first second so the character
    // is visible on startup even if the cursor is already over it
    setTimeout(() => { this._ghostReady = true; }, 1000);
  }

  async enableClickThrough() {
    if (this.isClickThrough) return;

    document.removeEventListener('mousemove', this._onMouseMove);
    this.isClickThrough = true;
    await tauri.setIgnoreCursorEvents(true);
    this.startPolling();
  }

  async disableClickThrough() {
    if (!this.isClickThrough) return;

    this.stopPolling();
    this.isClickThrough = false;
    await tauri.setIgnoreCursorEvents(false);
    // Listen for mouse moving away from interactive elements
    document.addEventListener('mousemove', this._onMouseMove);
  }

  onMouseMove(e) {
    if (this.isClickThrough || this.isPanelOpen || this.isDragging) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const isOverInteractive = this.isInteractiveElement(el);

    if (!isOverInteractive) {
      this.enableClickThrough();
    }
  }

  isInteractiveElement(el) {
    if (!el) return false;
    // Check hit targets (canvas, timer, status indicator)
    for (const target of this.hitTargets) {
      if (target === el || target.contains(el)) return true;
    }
    // Check panel elements (settings, about)
    for (const panel of this.panelElements) {
      if (panel === el || panel.contains(el)) return true;
    }
    return false;
  }

  onPanelOpened() {
    this.isPanelOpen = true;
    if (this.isClickThrough) {
      this.disableClickThrough();
    }
    // Un-ghost while a panel is open
    if (this.isGhosted) this.unghost();
  }

  onPanelClosed() {
    this.isPanelOpen = this.isAnyPanelVisible();
    if (!this.isPanelOpen) {
      this.enableClickThrough();
    }
  }

  isAnyPanelVisible() {
    return this.panelElements.some(el => !el.classList.contains('hidden'));
  }

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.checkCursorPosition(), this.POLL_MS);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async checkCursorPosition() {
    if (!this.isClickThrough) return;

    const cursorPos = await tauri.getCursorPosition();
    if (!cursorPos) return;

    const [screenX, screenY] = cursorPos;
    const windowPos = await tauri.getWindowPosition();

    // Convert cursor to window-relative logical (CSS) coordinates
    const relX = (screenX - windowPos.x) / this.scaleFactor;
    const relY = (screenY - windowPos.y) / this.scaleFactor;

    // Check if cursor is over the character canvas specifically
    const isOverCharacter = this._isOverElement(this._characterCanvas, relX, relY);

    if (this.ghostEnabled) {
      // Ghost the character when hovering over it
      if (isOverCharacter && !this.isGhosted && !this.isPanelOpen && !this.isDragging) {
        this.ghost();
        return; // Stay in click-through mode — don't disable it
      }

      // Un-ghost when cursor moves away from character
      if (!isOverCharacter && this.isGhosted) {
        this.unghost();
      }
    }

    // Check if cursor is over any hit target
    // When ghost mode is off, include the character canvas as interactive
    const isOverTarget = this.hitTargets.some(el => {
      if (this.ghostEnabled && el === this._characterCanvas) return false;
      return this._isOverElement(el, relX, relY);
    });

    if (isOverTarget && !this.isGhosted) {
      await this.disableClickThrough();
    }
  }

  _isOverElement(el, relX, relY) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
      relX >= rect.left - this.HIT_PADDING &&
      relX <= rect.right + this.HIT_PADDING &&
      relY >= rect.top - this.HIT_PADDING &&
      relY <= rect.bottom + this.HIT_PADDING
    );
  }

  // Fade the character to near-transparent so clicks pass through
  ghost() {
    if (this.isGhosted || !this._ghostReady) return;
    this.isGhosted = true;

    for (const el of this._ghostTargets) {
      el.style.opacity = this.GHOST_OPACITY;
    }
  }

  // Restore the character to full opacity
  unghost() {
    if (!this.isGhosted) return;
    this.isGhosted = false;

    for (const el of this._ghostTargets) {
      el.style.opacity = '';
    }
  }

  destroy() {
    this.stopPolling();
    this.unghost();
    document.removeEventListener('mousemove', this._onMouseMove);
    if (tauri.isAvailable) {
      tauri.setIgnoreCursorEvents(false);
    }
  }
}
