// Dr. Vibe - Session Progress Panel UI

import { eventBus, Events } from '../core/EventBus.js';

export class SessionPanel {
  constructor(sessionTracker) {
    this.tracker = sessionTracker;
    this.panel = document.getElementById('session-panel');
    this.closeButton = document.getElementById('session-close');
    this._unsubscribers = [];
  }

  init() {
    this.closeButton?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel?.classList.contains('hidden')) {
        this.hide();
      }
    });


    // Listen for stats updates to refresh while panel is open
    this._unsubscribers.push(
      eventBus.on(Events.SESSION_STATS_UPDATED, () => {
        if (!this.panel?.classList.contains('hidden')) {
          this._render();
        }
      })
    );
  }

  show() {
    this._render();
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.SESSION_PANEL_OPENED, {});
  }

  hide() {
    this.panel?.classList.add('hidden');
    eventBus.emit(Events.SESSION_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  _render() {
    const stats = this.tracker.getStats();

    // Coding time
    const hours = Math.floor(stats.codingSeconds / 3600);
    const minutes = Math.floor((stats.codingSeconds % 3600) / 60);
    let timeStr;
    if (hours > 0) {
      timeStr = `${hours}h ${minutes}m`;
    } else {
      timeStr = `${minutes}m`;
    }

    // Session start time
    const startDate = new Date(stats.sessionStart);
    const startStr = startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    // Streak
    let streakStr;
    if (stats.streak === 0) {
      streakStr = 'Start your streak today!';
    } else if (stats.streak === 1) {
      streakStr = '1-day streak';
    } else {
      streakStr = `${stats.streak}-day streak`;
    }

    // Project name
    const projectStr = stats.projectName || 'No project detected';

    // Populate elements
    const codingTimeEl = document.getElementById('session-coding-time');
    const filesCreatedEl = document.getElementById('session-files-created');
    const filesModifiedEl = document.getElementById('session-files-modified');
    const streakEl = document.getElementById('session-streak');
    const startTimeEl = document.getElementById('session-start-time');
    const projectEl = document.getElementById('session-project');
    const timelineEl = document.getElementById('session-timeline');

    if (codingTimeEl) codingTimeEl.textContent = timeStr;
    if (filesCreatedEl) filesCreatedEl.textContent = `${stats.filesCreated} new`;
    if (filesModifiedEl) filesModifiedEl.textContent = `${stats.filesModified} changed`;
    if (streakEl) streakEl.textContent = streakStr;
    if (startTimeEl) startTimeEl.textContent = `Started ${startStr}`;
    if (projectEl) projectEl.textContent = projectStr;

    if (timelineEl) {
      this._renderTimeline(timelineEl, stats.timeline);
    }
  }

  _renderTimeline(container, timeline) {
    container.innerHTML = '';

    if (timeline.length === 0) {
      container.innerHTML = '<span class="session-timeline-empty">No activity yet</span>';
      return;
    }

    const now = Date.now();
    const sessionDuration = now - this.tracker.sessionStart;

    // Build segments from timeline events
    const segments = [];
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      const nextTime = (i + 1 < timeline.length) ? timeline[i + 1].time : now;
      const startPct = ((entry.time - this.tracker.sessionStart) / sessionDuration) * 100;
      const widthPct = ((nextTime - entry.time) / sessionDuration) * 100;

      if (widthPct > 0.5) {
        segments.push({ type: entry.type, startPct, widthPct });
      }
    }

    // Render as a horizontal bar
    const bar = document.createElement('div');
    bar.className = 'session-timeline-bar';

    for (const seg of segments) {
      const segEl = document.createElement('div');
      segEl.className = `session-timeline-segment ${seg.type}`;
      segEl.style.left = `${seg.startPct}%`;
      segEl.style.width = `${Math.min(seg.widthPct, 100 - seg.startPct)}%`;
      bar.appendChild(segEl);
    }

    container.appendChild(bar);
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
