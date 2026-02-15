// Dr. Vibe - Focus Mode
// Distraction-free mode: semi-transparent character, no notifications, no breaks

import { eventBus, Events } from '../../core/EventBus.js';

const MAX_FOCUS_MINUTES = 120;

export class FocusMode {
  constructor(settings) {
    this.settings = settings;
    this.active = false;
    this.startTime = null;
    this.endTime = null;
    this.countdownInterval = null;
  }

  init() {
    this.setupUI();
    this.setupHotkey();
    this.checkResume();
  }

  setupUI() {
    this.countdownEl = document.getElementById('focus-countdown');
    this.auraEl = document.getElementById('focus-aura');
    this.overlayEl = document.getElementById('focus-overlay');

    document.getElementById('focus-end')?.addEventListener('click', () => {
      this.end();
    });
  }

  setupHotkey() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+F to toggle focus mode
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  checkResume() {
    const savedEndTime = this.settings.focusModeEndTime;
    if (savedEndTime && savedEndTime > Date.now()) {
      this.resume(savedEndTime);
    } else if (savedEndTime) {
      this.settings.set('focusModeEndTime', null);
    }
  }

  toggle() {
    if (this.active) {
      this.end();
    } else {
      this.start();
    }
  }

  start(durationMinutes) {
    if (this.active) return;

    const duration = Math.min(
      durationMinutes || this.settings.focusModeDuration || 25,
      MAX_FOCUS_MINUTES
    );
    const durationMs = duration * 60 * 1000;

    this.active = true;
    this.startTime = Date.now();
    this.endTime = this.startTime + durationMs;

    this.settings.set('focusModeEndTime', this.endTime);
    this.applyVisuals(true);
    this.startCountdown();

    eventBus.emit(Events.FOCUS_MODE_STARTED, {
      duration,
      endTime: this.endTime,
    });

    console.log(`Focus mode started (${duration} min)`);
  }

  resume(endTime) {
    this.active = true;
    this.startTime = Date.now();
    this.endTime = endTime;

    this.applyVisuals(true);
    this.startCountdown();

    eventBus.emit(Events.FOCUS_MODE_STARTED, {
      duration: Math.ceil((endTime - Date.now()) / 60000),
      endTime,
    });

    console.log('Focus mode resumed');
  }

  end(completed = false) {
    if (!this.active) return;

    this.active = false;
    this.startTime = null;
    this.endTime = null;

    this.settings.set('focusModeEndTime', null);

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.applyVisuals(false);

    eventBus.emit(Events.FOCUS_MODE_ENDED, { completed });

    console.log(`Focus mode ended (${completed ? 'timer' : 'manual'})`);
  }

  startCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    const tick = () => {
      const remaining = Math.max(0, this.endTime - Date.now());

      if (remaining <= 0) {
        this.end(true);
        return;
      }

      // 5-minute warning
      const secs = Math.ceil(remaining / 1000);
      if (secs === 300) {
        eventBus.emit(Events.FOCUS_MODE_WARNING, { secondsRemaining: 300 });
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);

      if (this.countdownEl) {
        this.countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }

      eventBus.emit(Events.FOCUS_MODE_TICK, { remaining });
    };

    tick();
    this.countdownInterval = setInterval(tick, 1000);
  }

  applyVisuals(active) {
    const app = document.getElementById('app');
    const canvas = document.getElementById('character-canvas');

    if (active) {
      app?.classList.add('focus-mode');
      canvas?.classList.add('focus-mode');
      this.auraEl?.classList.remove('hidden');
      this.overlayEl?.classList.remove('hidden');
    } else {
      app?.classList.remove('focus-mode');
      canvas?.classList.remove('focus-mode');
      this.auraEl?.classList.add('hidden');
      this.overlayEl?.classList.add('hidden');
    }
  }

  destroy() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }
}
