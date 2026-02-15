// Dr. Vibe - Personal Best Panel UI
// Displays current vs. best metrics and improvement history.

import { eventBus, Events } from '../core/EventBus.js';
import { METRICS } from '../features/personalBest/PersonalBestTracker.js';

export class PersonalBestPanel {
  constructor(tracker, sessionTracker, settings) {
    this.tracker = tracker;
    this.sessionTracker = sessionTracker;
    this.settings = settings || null;
    this.panel = document.getElementById('personal-best-panel');
    this.closeButton = document.getElementById('personal-best-close');
    this.grid = document.getElementById('personal-best-grid');
    this.historyContainer = document.getElementById('personal-best-history');
    this.toast = document.getElementById('personal-best-toast');
    this._unsubscribers = [];
    this._toastTimer = null;
    this._selectedMetric = null;
  }

  init() {
    this.closeButton?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel?.classList.contains('hidden')) {
        this.hide();
      }
    });

    // Toggle via event
    this._unsubscribers.push(
      eventBus.on(Events.PERSONAL_BEST_PANEL_TOGGLE, () => this.toggle())
    );

    // Refresh while open
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, () => {
        if (!this.panel?.classList.contains('hidden')) {
          this._render();
        }
      })
    );

    // Show toast on new record
    this._unsubscribers.push(
      eventBus.on(Events.PERSONAL_BEST_SET, (data) => {
        this._showToast(data);
        if (!this.panel?.classList.contains('hidden')) {
          this._render();
        }
      })
    );
  }

  show() {
    this._render();
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.PERSONAL_BEST_PANEL_OPENED, {});
  }

  hide() {
    this.panel?.classList.add('hidden');
    eventBus.emit(Events.PERSONAL_BEST_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  _render() {
    if (!this.grid) return;

    const bests = this.tracker.getFormattedBests();
    const stats = this.sessionTracker.getStats();
    const current = this.tracker.getCurrentValues(stats);

    const icons = {
      longestSession: '\u23F1',
      mostFiles: '\uD83D\uDCC1',
      longestStreak: '\uD83D\uDD25',
      bestMomentum: '\u26A1',
    };

    this.grid.innerHTML = Object.entries(METRICS).map(([key, def]) => {
      const best = bests[key];
      const cur = current[key];
      const isNewBest = cur.value > 0 && cur.value >= best.value && best.value > 0;
      const pct = best.value > 0 ? Math.min((cur.value / best.value) * 100, 100) : 0;

      return `
        <div class="pb-card${isNewBest ? ' pb-record' : ''}" data-metric="${key}">
          <div class="pb-card-header">
            <span class="pb-icon">${icons[key]}</span>
            <span class="pb-label">${def.label}</span>
          </div>
          <div class="pb-values">
            <div class="pb-current">
              <span class="pb-value-number">${cur.formatted}</span>
              <span class="pb-value-label">now</span>
            </div>
            <div class="pb-vs">vs</div>
            <div class="pb-best">
              <span class="pb-value-number pb-best-number">${best.formatted}</span>
              <span class="pb-value-label">best</span>
            </div>
          </div>
          <div class="pb-progress-bar">
            <div class="pb-progress-fill${isNewBest ? ' pb-record-fill' : ''}" style="width: ${pct}%"></div>
          </div>
          ${best.date ? `<span class="pb-date">Set ${best.date}</span>` : ''}
        </div>
      `;
    }).join('');

    // Add click handlers for history view
    this.grid.querySelectorAll('.pb-card').forEach(card => {
      card.addEventListener('click', () => {
        const metric = card.dataset.metric;
        this._toggleHistory(metric);
      });
    });

    // Render history if a metric is selected
    if (this._selectedMetric) {
      this._renderHistory(this._selectedMetric);
    } else if (this.historyContainer) {
      this.historyContainer.innerHTML = '<span class="pb-history-hint">Click a metric to see history</span>';
    }
  }

  _toggleHistory(metric) {
    if (this._selectedMetric === metric) {
      this._selectedMetric = null;
    } else {
      this._selectedMetric = metric;
    }
    this._render();
  }

  _renderHistory(metric) {
    if (!this.historyContainer) return;

    const history = this.tracker.getHistory(metric);
    const def = METRICS[metric];

    if (history.length === 0) {
      this.historyContainer.innerHTML = `<span class="pb-history-empty">No history yet for ${def.label}</span>`;
      return;
    }

    // Show last 10 entries as a bar chart
    const recent = history.slice(-10);
    const maxVal = Math.max(...recent.map(h => h.value), 1);

    const barsHtml = recent.map(h => {
      const heightPct = Math.max((h.value / maxVal) * 100, 4);
      return `
        <div class="pb-history-bar-wrapper" title="${h.date}: ${def.format(h.value)}">
          <div class="pb-history-bar" style="height: ${heightPct}%"></div>
          <span class="pb-history-bar-label">${h.date.slice(5)}</span>
        </div>
      `;
    }).join('');

    this.historyContainer.innerHTML = `
      <span class="pb-history-title">${def.label} History</span>
      <div class="pb-history-chart">${barsHtml}</div>
    `;
  }

  _showToast(data) {
    if (!this.toast) return;

    const icons = {
      longestSession: '\u23F1',
      mostFiles: '\uD83D\uDCC1',
      longestStreak: '\uD83D\uDD25',
      bestMomentum: '\u26A1',
    };

    this.toast.innerHTML = `
      <span class="pb-toast-icon">${icons[data.metric] || '\uD83C\uDFC6'}</span>
      <div class="pb-toast-text">
        <span class="pb-toast-label">New Personal Best!</span>
        <span class="pb-toast-title">${data.label}</span>
        <span class="pb-toast-desc">${data.formatted.new}${data.formatted.previous !== 'none' ? ` (was ${data.formatted.previous})` : ''}</span>
      </div>
    `;

    this.toast.classList.remove('hidden', 'pb-toast-exit');
    this.toast.classList.add('pb-toast-enter');

    const duration = (this.settings?.get?.('popupDuration') || 20) * 1000;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.classList.remove('pb-toast-enter');
      this.toast.classList.add('pb-toast-exit');
      setTimeout(() => this.toast.classList.add('hidden'), 300);
    }, duration);
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
    clearTimeout(this._toastTimer);
  }
}
