// Dr. Vibe - Achievement Toast Notification
// Shows a brief animated toast when an achievement is unlocked

import { eventBus, Events } from '../core/EventBus.js';

const TOAST_FADE_MS = 300;

export class AchievementToast {
  constructor(settings) {
    this.settings = settings;
    this.container = null;
    this.timeoutId = null;
  }

  init() {
    this.container = document.getElementById('achievement-toast');
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, (data) => this.show(data));
  }

  show({ title, description, icon }) {
    if (!this.container) return;

    // Clear any existing toast timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.container.innerHTML = `
      <div class="achievement-toast-icon">${icon}</div>
      <div class="achievement-toast-text">
        <div class="achievement-toast-label">Achievement Unlocked!</div>
        <div class="achievement-toast-title">${title}</div>
        <div class="achievement-toast-desc">${description}</div>
      </div>
    `;

    this.container.classList.remove('hidden', 'toast-exit');
    this.container.classList.add('toast-enter');

    const duration = (this.settings?.get('popupDuration') || 20) * 1000;

    this.timeoutId = setTimeout(() => {
      this.container.classList.remove('toast-enter');
      this.container.classList.add('toast-exit');

      setTimeout(() => {
        this.container.classList.add('hidden');
        this.container.classList.remove('toast-exit');
      }, TOAST_FADE_MS);
    }, duration);
  }
}
