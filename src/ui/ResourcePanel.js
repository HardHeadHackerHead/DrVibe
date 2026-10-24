// Dr. Vibe - Resource Panel UI
// Displays learning resource suggestions in a non-intrusive panel.

import { eventBus, Events } from '../core/EventBus.js';

export class ResourcePanel {
  constructor(settings) {
    this.settings = settings || null;
    this.panel = null;
    this.autoHideTimer = null;
  }

  init() {
    this.panel = document.getElementById('resource-panel');

    // Listen for new suggestions
    eventBus.on(Events.LEARNING_RESOURCE_SUGGESTED, (suggestion) => {
      this.show(suggestion);
    });
  }

  show(suggestion) {
    if (!this.panel) return;

    // Clear any pending auto-hide
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    // Build the panel content
    const messageEl = this.panel.querySelector('.resource-message');
    const listEl = this.panel.querySelector('.resource-list');
    const dismissBtn = this.panel.querySelector('.resource-dismiss');
    const dismissProjectBtn = this.panel.querySelector('.resource-dismiss-project');

    if (messageEl) {
      messageEl.textContent = suggestion.message;
    }

    if (listEl) {
      listEl.innerHTML = '';
      for (const resource of suggestion.resources) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = resource.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = resource.title;

        const badge = document.createElement('span');
        badge.className = `resource-type resource-type-${resource.type}`;
        badge.textContent = resource.type;

        li.appendChild(link);
        li.appendChild(badge);
        listEl.appendChild(li);
      }
    }

    // Set up dismiss button
    if (dismissBtn) {
      dismissBtn.onclick = () => {
        this.hide();
        eventBus.emit(Events.LEARNING_RESOURCE_DISMISSED, {
          languageKey: suggestion.languageKey,
          projectName: suggestion.projectName,
          dismissForProject: false,
        });
      };
    }

    // Set up dismiss-for-project button
    if (dismissProjectBtn) {
      if (suggestion.projectName) {
        dismissProjectBtn.style.display = '';
        dismissProjectBtn.textContent = `Don't show for ${suggestion.projectName}`;
        dismissProjectBtn.onclick = () => {
          this.hide();
          eventBus.emit(Events.LEARNING_RESOURCE_DISMISSED, {
            languageKey: suggestion.languageKey,
            projectName: suggestion.projectName,
            dismissForProject: true,
          });
        };
      } else {
        dismissProjectBtn.style.display = 'none';
      }
    }

    this.panel.classList.remove('hidden');

    // Auto-hide based on popup duration setting
    const duration = (this.settings?.get?.('popupDuration') || 20) * 1000;
    this.autoHideTimer = setTimeout(() => {
      this.hide();
    }, duration);
  }

  hide() {
    if (!this.panel) return;
    this.panel.classList.add('hidden');

    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }
}
