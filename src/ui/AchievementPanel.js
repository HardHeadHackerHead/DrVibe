// Dr. Vibe - Achievement Gallery Panel
// Displays all achievements with locked/unlocked status and progress

import { eventBus, Events } from '../core/EventBus.js';

export class AchievementPanel {
  constructor(achievementSystem) {
    this.achievementSystem = achievementSystem;
    this.panel = null;
    this.closeButton = null;
    this.grid = null;
  }

  init() {
    this.panel = document.getElementById('achievement-panel');
    this.closeButton = document.getElementById('achievement-close');
    this.grid = document.getElementById('achievement-grid');

    this.closeButton?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel?.classList.contains('hidden')) {
        this.hide();
      }
    });

    eventBus.on(Events.ACHIEVEMENT_PANEL_TOGGLE, () => this.toggle());
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, () => this.render());
    eventBus.on(Events.ACHIEVEMENT_PROGRESS, () => this.render());

    this.render();
  }

  buildCard(a) {
    const isUnlocked = a.unlocked;
    const progressPct = a.maxProgress > 1
      ? Math.round((a.progress / a.maxProgress) * 100)
      : (isUnlocked ? 100 : 0);

    let dateHtml = '';
    if (isUnlocked && a.unlockedAt) {
      const d = new Date(a.unlockedAt);
      dateHtml = `<div class="achievement-date">Achieved ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>`;
    }

    return `
      <div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-emblem">${a.icon}</div>
        <div class="achievement-info">
          <div class="achievement-title">${a.title}</div>
          <div class="achievement-desc">${a.description}</div>
          ${a.maxProgress > 1 && !isUnlocked ? `
            <div class="achievement-progress-bar">
              <div class="achievement-progress-fill" style="width: ${progressPct}%"></div>
            </div>
            <div class="achievement-progress-text">${a.progress} / ${a.maxProgress}</div>
          ` : ''}
          ${dateHtml}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.grid) return;

    const achievements = this.achievementSystem.getAll();
    const unlockedList = achievements.filter(a => a.unlocked);
    const lockedList = achievements.filter(a => !a.unlocked);

    let html = '';

    // Unlocked section (top)
    html += '<div class="achievement-section-label unlocked-label">Unlocked</div>';
    html += '<div class="achievement-grid">';
    if (unlockedList.length > 0) {
      html += unlockedList.map(a => this.buildCard(a)).join('');
    } else {
      html += '<div class="achievement-empty">No achievements unlocked yet</div>';
    }
    html += '</div>';

    // Locked section (bottom)
    html += '<div class="achievement-section-label">Locked</div>';
    html += '<div class="achievement-grid">';
    if (lockedList.length > 0) {
      html += lockedList.map(a => this.buildCard(a)).join('');
    } else {
      html += '<div class="achievement-empty">All achievements unlocked!</div>';
    }
    html += '</div>';

    this.grid.innerHTML = html;

    // Update counter in header
    const counter = this.panel?.querySelector('.achievement-counter');
    if (counter) {
      counter.textContent = `${unlockedList.length} / ${achievements.length}`;
    }
  }

  show() {
    this.render();
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.ACHIEVEMENT_PANEL_OPENED, {});
  }

  hide() {
    this.panel?.classList.add('hidden');
    eventBus.emit(Events.ACHIEVEMENT_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }
}
