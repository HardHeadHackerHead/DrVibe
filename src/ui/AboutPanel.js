// Dr. Vibe - About Panel UI

import { eventBus, Events } from '../core/EventBus.js';

export class AboutPanel {
  constructor() {
    this.panel = document.getElementById('about-panel');
    this.closeButton = document.getElementById('about-close');
  }

  init() {
    this.closeButton?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });

    // Open links in external browser
    this.panel?.querySelectorAll('.about-link[data-url]').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = e.currentTarget.dataset.url;
        try {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(url);
        } catch {
          window.open(url, '_blank');
        }
      });
    });
  }

  show() {
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.ABOUT_PANEL_OPENED, {});
  }

  hide() {
    this.panel?.classList.add('hidden');
    eventBus.emit(Events.ABOUT_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }
}
