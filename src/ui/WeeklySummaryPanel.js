// Dr. Vibe - Weekly Summary Panel UI
// Displays the weekly report card with encouraging tone, goals, and markdown export.

import { eventBus, Events } from '../core/EventBus.js';

export class WeeklySummaryPanel {
  constructor(weeklySummary) {
    this.summary = weeklySummary;
    this.panel = document.getElementById('weekly-summary-panel');
    this.closeButton = document.getElementById('weekly-summary-close');
    this._unsubscribers = [];
  }

  init() {
    this.closeButton?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel?.classList.contains('hidden')) {
        this.hide();
      }
    });

    // Auto-show when weekly summary is available
    this._unsubscribers.push(
      eventBus.on(Events.WEEKLY_SUMMARY_AVAILABLE, () => {
        this.show();
      })
    );

    // Toggle from external triggers
    this._unsubscribers.push(
      eventBus.on(Events.WEEKLY_SUMMARY_PANEL_TOGGLE, () => {
        this.toggle();
      })
    );
  }

  async show() {
    await this.summary.refreshSummary();
    this._render();
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.WEEKLY_SUMMARY_PANEL_OPENED, {});
  }

  hide() {
    this.panel?.classList.add('hidden');
    eventBus.emit(Events.WEEKLY_SUMMARY_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  async _render() {
    const s = await this.summary.getSummary();
    if (!s) return;

    // Week label
    const weekLabelEl = document.getElementById('weekly-week-label');
    if (weekLabelEl) weekLabelEl.textContent = s.weekLabel;

    // Encouragement
    const encourageEl = document.getElementById('weekly-encouragement');
    if (encourageEl) encourageEl.textContent = s.encouragement;

    // Stats
    const hours = Math.floor(s.totalSeconds / 3600);
    const minutes = Math.floor((s.totalSeconds % 3600) / 60);
    const codingTimeEl = document.getElementById('weekly-coding-time');
    if (codingTimeEl) {
      codingTimeEl.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }

    const activeDaysEl = document.getElementById('weekly-active-days');
    if (activeDaysEl) activeDaysEl.textContent = `${s.activeDays} / 7`;

    const filesEl = document.getElementById('weekly-files');
    if (filesEl) {
      const total = s.totalFilesCreated + s.totalFilesModified;
      filesEl.textContent = `${total} files`;
    }

    const longestH = Math.floor(s.longestSessionSeconds / 3600);
    const longestM = Math.floor((s.longestSessionSeconds % 3600) / 60);
    const longestEl = document.getElementById('weekly-longest-session');
    if (longestEl) {
      longestEl.textContent = longestH > 0 ? `${longestH}h ${longestM}m` : `${longestM}m`;
    }

    const streakEl = document.getElementById('weekly-streak');
    if (streakEl) {
      streakEl.textContent = s.streak === 0 ? 'New start!' : `${s.streak} days`;
    }

    const projectsEl = document.getElementById('weekly-projects');
    if (projectsEl) {
      projectsEl.textContent = s.projects.length > 0
        ? s.projects.join(', ')
        : 'No projects tracked yet';
    }

    // Daily breakdown chart
    this._renderDailyChart(s.dailyBreakdown);

    // Goal section
    this._renderGoals(s.goalStatus);

    // Wire up buttons
    this._setupButtons();
  }

  _renderDailyChart(dailyBreakdown) {
    const container = document.getElementById('weekly-daily-chart');
    if (!container) return;
    container.innerHTML = '';

    const maxSeconds = Math.max(...dailyBreakdown.map(d => d.codingSeconds || 0), 1);

    for (const day of dailyBreakdown) {
      const dayEl = document.createElement('div');
      dayEl.className = 'weekly-day-bar';

      const barContainer = document.createElement('div');
      barContainer.className = 'weekly-bar-container';

      const bar = document.createElement('div');
      bar.className = 'weekly-bar-fill';
      const pct = ((day.codingSeconds || 0) / maxSeconds) * 100;
      bar.style.height = `${Math.max(pct, 2)}%`;
      if ((day.codingSeconds || 0) > 0) {
        bar.classList.add('active');
      }

      barContainer.appendChild(bar);

      const label = document.createElement('span');
      label.className = 'weekly-day-label';
      label.textContent = new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });

      dayEl.appendChild(barContainer);
      dayEl.appendChild(label);
      container.appendChild(dayEl);
    }
  }

  _renderGoals(goalStatus) {
    const goalsSection = document.getElementById('weekly-goals-section');
    if (!goalsSection) return;

    if (!goalStatus) {
      goalsSection.innerHTML = `
        <span class="weekly-section-label">Goals</span>
        <p class="weekly-no-goals">No goals set. Want to set some for next week?</p>
      `;
      return;
    }

    let html = '<span class="weekly-section-label">Goal Progress</span>';

    if (goalStatus.codingHoursGoal != null) {
      const actual = goalStatus.codingHoursActual;
      const goal = goalStatus.codingHoursGoal;
      const pct = Math.min((actual / goal) * 100, 100);
      const met = actual >= goal;
      html += `
        <div class="weekly-goal-row">
          <span class="weekly-goal-label">Coding: ${actual.toFixed(1)}h / ${goal}h ${met ? '&#10003;' : ''}</span>
          <div class="weekly-goal-bar">
            <div class="weekly-goal-fill ${met ? 'met' : ''}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }

    if (goalStatus.activeDaysGoal != null) {
      const actual = goalStatus.activeDaysActual;
      const goal = goalStatus.activeDaysGoal;
      const pct = Math.min((actual / goal) * 100, 100);
      const met = actual >= goal;
      html += `
        <div class="weekly-goal-row">
          <span class="weekly-goal-label">Active Days: ${actual} / ${goal} ${met ? '&#10003;' : ''}</span>
          <div class="weekly-goal-bar">
            <div class="weekly-goal-fill ${met ? 'met' : ''}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }

    goalsSection.innerHTML = html;
  }

  _setupButtons() {
    // Export button
    const exportBtn = document.getElementById('weekly-export');
    if (exportBtn) {
      const newBtn = exportBtn.cloneNode(true);
      exportBtn.parentNode.replaceChild(newBtn, exportBtn);
      newBtn.addEventListener('click', () => this._exportMarkdown());
    }

    // Set goals button
    const goalsBtn = document.getElementById('weekly-set-goals');
    if (goalsBtn) {
      const newBtn = goalsBtn.cloneNode(true);
      goalsBtn.parentNode.replaceChild(newBtn, goalsBtn);
      newBtn.addEventListener('click', () => this._toggleGoalForm());
    }

    // Goal form save
    const goalSaveBtn = document.getElementById('weekly-goal-save');
    if (goalSaveBtn) {
      const newBtn = goalSaveBtn.cloneNode(true);
      goalSaveBtn.parentNode.replaceChild(newBtn, goalSaveBtn);
      newBtn.addEventListener('click', () => this._saveGoals());
    }

    // Goal form clear
    const goalClearBtn = document.getElementById('weekly-goal-clear');
    if (goalClearBtn) {
      const newBtn = goalClearBtn.cloneNode(true);
      goalClearBtn.parentNode.replaceChild(newBtn, goalClearBtn);
      newBtn.addEventListener('click', () => this._clearGoals());
    }
  }

  _exportMarkdown() {
    const md = this.summary.exportAsMarkdown();
    if (!md) return;

    // Copy to clipboard
    navigator.clipboard.writeText(md).then(() => {
      const exportBtn = document.getElementById('weekly-export');
      if (exportBtn) {
        const original = exportBtn.textContent;
        exportBtn.textContent = 'Copied!';
        setTimeout(() => { exportBtn.textContent = original; }, 1500);
      }
    }).catch(() => {
      // Fallback: show in a textarea for manual copy
      const textarea = document.createElement('textarea');
      textarea.value = md;
      textarea.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      const exportBtn = document.getElementById('weekly-export');
      if (exportBtn) {
        const original = exportBtn.textContent;
        exportBtn.textContent = 'Copied!';
        setTimeout(() => { exportBtn.textContent = original; }, 1500);
      }
    });
  }

  _toggleGoalForm() {
    const form = document.getElementById('weekly-goal-form');
    if (!form) return;
    form.classList.toggle('hidden');

    // Populate with current goals if any
    if (!form.classList.contains('hidden') && this.summary.goals) {
      const hoursInput = document.getElementById('weekly-goal-hours');
      const daysInput = document.getElementById('weekly-goal-days');
      if (hoursInput && this.summary.goals.codingHours) {
        hoursInput.value = this.summary.goals.codingHours;
      }
      if (daysInput && this.summary.goals.activeDays) {
        daysInput.value = this.summary.goals.activeDays;
      }
    }
  }

  async _saveGoals() {
    const hoursInput = document.getElementById('weekly-goal-hours');
    const daysInput = document.getElementById('weekly-goal-days');
    const hoursVal = hoursInput ? parseFloat(hoursInput.value) : null;
    const daysVal = daysInput ? parseInt(daysInput.value, 10) : null;

    const goals = {};
    if (hoursVal && hoursVal > 0) goals.codingHours = hoursVal;
    if (daysVal && daysVal > 0) goals.activeDays = Math.min(daysVal, 7);

    if (Object.keys(goals).length > 0) {
      await this.summary.setGoals(goals);
    }

    const form = document.getElementById('weekly-goal-form');
    if (form) form.classList.add('hidden');

    // Re-render to show updated goals
    this._render();
  }

  async _clearGoals() {
    await this.summary.clearGoals();
    const form = document.getElementById('weekly-goal-form');
    if (form) form.classList.add('hidden');
    this._render();
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
