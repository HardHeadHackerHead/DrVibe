// Dr. Vibe - Skill Development Visualization Panel

import { eventBus, Events } from '../core/EventBus.js';
import { LANGUAGE_COLORS } from '../features/skills/SkillTracker.js';

export class SkillPanel {
  constructor(skillTracker) {
    this.tracker = skillTracker;
    this.panel = null;
    this.closeButton = null;
    this.exportButton = null;
    this.skillList = null;
    this._unsubscribers = [];
  }

  init() {
    this.panel = document.getElementById('skill-panel');
    this.closeButton = document.getElementById('skill-close');
    this.exportButton = document.getElementById('skill-export');
    this.skillList = document.getElementById('skill-list');

    this.closeButton?.addEventListener('click', () => this.hide());
    this.exportButton?.addEventListener('click', () => this._exportAsImage());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel?.classList.contains('hidden')) {
        this.hide();
      }
    });

    this._unsubscribers.push(
      eventBus.on(Events.SKILL_UPDATED, () => {
        if (!this.panel?.classList.contains('hidden')) {
          this._render();
        }
      })
    );

    this._unsubscribers.push(
      eventBus.on(Events.SKILL_PANEL_TOGGLE, () => this.toggle())
    );
  }

  show() {
    this._render();
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.SKILL_PANEL_OPENED, {});
  }

  hide() {
    this.panel?.classList.add('hidden');
    eventBus.emit(Events.SKILL_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  _render() {
    if (!this.skillList) return;

    const stats = this.tracker.getStats();
    const entries = Object.entries(stats);

    if (entries.length === 0) {
      this.skillList.innerHTML = '<div class="skill-empty">No skills tracked yet. Start coding to see your progress!</div>';
      this._updateCounter(0);
      return;
    }

    // Sort by total time descending
    entries.sort((a, b) => b[1].totalSeconds - a[1].totalSeconds);

    // Find max for relative bar sizing
    const maxSeconds = entries[0][1].totalSeconds;

    this.skillList.innerHTML = '';

    for (const [lang, data] of entries) {
      const card = this._createSkillCard(lang, data, maxSeconds);
      this.skillList.appendChild(card);
    }

    this._updateCounter(entries.length);
  }

  _createSkillCard(language, data, maxSeconds) {
    const card = document.createElement('div');
    card.className = 'skill-card';

    const totalStr = this._formatTime(data.totalSeconds);
    const sessionStr = data.sessionSeconds > 0 ? `+${this._formatTime(data.sessionSeconds)}` : '';
    const barWidth = maxSeconds > 0 ? Math.max((data.totalSeconds / maxSeconds) * 100, 2) : 0;
    const color = data.color || '#a0a0a0';

    // Progress toward next milestone
    let milestoneHtml = '';
    if (data.nextMilestone) {
      const progress = Math.min((data.totalSeconds / data.nextMilestone.seconds) * 100, 100);
      milestoneHtml = `
        <div class="skill-milestone">
          <div class="skill-milestone-bar">
            <div class="skill-milestone-fill" style="width: ${progress}%; background: ${color}"></div>
          </div>
          <span class="skill-milestone-label">Next: ${data.nextMilestone.label}</span>
        </div>
      `;
    } else {
      milestoneHtml = '<div class="skill-milestone-complete">All milestones reached!</div>';
    }

    card.innerHTML = `
      <div class="skill-header">
        <span class="skill-language" style="color: ${color}">${language}</span>
        <span class="skill-time">${totalStr}</span>
      </div>
      <div class="skill-bar-container">
        <div class="skill-bar" style="width: ${barWidth}%; background: ${color}"></div>
      </div>
      ${sessionStr ? `<div class="skill-session">This session: <span style="color: ${color}">${sessionStr}</span></div>` : ''}
      ${milestoneHtml}
    `;

    return card;
  }

  _formatTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
  }

  _updateCounter(count) {
    const counter = this.panel?.querySelector('.skill-counter');
    if (counter) {
      counter.textContent = `${count} ${count === 1 ? 'language' : 'languages'}`;
    }
  }

  async _exportAsImage() {
    if (!this.skillList) return;

    try {
      // Use html2canvas-like approach: render to a canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const stats = this.tracker.getStats();
      const entries = Object.entries(stats).sort((a, b) => b[1].totalSeconds - a[1].totalSeconds);

      if (entries.length === 0) return;

      const padding = 24;
      const rowHeight = 48;
      const barHeight = 12;
      const width = 400;
      const headerHeight = 50;
      const height = headerHeight + (entries.length * rowHeight) + padding * 2;

      canvas.width = width * 2; // 2x for retina
      canvas.height = height * 2;
      ctx.scale(2, 2);

      // Background
      ctx.fillStyle = '#1e1e1e';
      ctx.roundRect(0, 0, width, height, 12);
      ctx.fill();

      // Title
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillText('Skill Development', padding, padding + 20);

      ctx.fillStyle = '#a0a0a0';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillText(`${entries.length} languages tracked`, padding, padding + 38);

      const maxSeconds = entries[0][1].totalSeconds;
      const barMaxWidth = width - padding * 2 - 120;

      entries.forEach(([lang, data], i) => {
        const y = headerHeight + padding + (i * rowHeight);
        const color = data.color || '#a0a0a0';

        // Language name
        ctx.fillStyle = color;
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillText(lang, padding, y + 14);

        // Time
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '11px "Segoe UI", sans-serif';
        const timeStr = this._formatTime(data.totalSeconds);
        ctx.fillText(timeStr, width - padding - ctx.measureText(timeStr).width, y + 14);

        // Bar background
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.roundRect(padding, y + 22, barMaxWidth, barHeight, 4);
        ctx.fill();

        // Bar fill
        const barWidth = maxSeconds > 0 ? Math.max((data.totalSeconds / maxSeconds) * barMaxWidth, 4) : 0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(padding, y + 22, barWidth, barHeight, 4);
        ctx.fill();
      });

      // Footer
      ctx.fillStyle = '#555';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillText('Dr. Vibe - Skill Tracker', padding, height - 10);

      // Download
      const link = document.createElement('a');
      link.download = `dr-vibe-skills-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('SkillPanel: Export failed', e);
    }
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
