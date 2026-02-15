// Dr. Vibe - Today's Wins Summary Panel
// Shows a positive end-of-session summary when quitting or on manual trigger.

import { eventBus, Events } from '../core/EventBus.js';

// Positive messages based on coding time
function getCodingMessage(seconds) {
  const hours = seconds / 3600;
  if (hours >= 4) return "What a powerhouse session! You were in the zone today.";
  if (hours >= 2) return "Solid work today! Consistency builds greatness.";
  if (hours >= 1) return "Great session! Every hour of practice counts.";
  if (seconds >= 1800) return "Nice work! You showed up and made progress.";
  if (seconds >= 300) return "You got started — that's the hardest part!";
  return "You showed up today. That counts for something!";
}

function getStreakMessage(streak) {
  if (streak >= 30) return `Incredible ${streak}-day streak! Unstoppable!`;
  if (streak >= 14) return `Amazing ${streak}-day streak! You're a machine!`;
  if (streak >= 7) return `You're on fire with a ${streak}-day streak!`;
  if (streak >= 3) return `Nice ${streak}-day streak going!`;
  if (streak === 1) return "Day 1 of a new streak — keep it going!";
  return "Every journey starts with day one.";
}

function getFilesMessage(created, modified) {
  const total = created + modified;
  if (created > 0 && modified > 0) return `Created ${created} and touched ${modified} files`;
  if (created > 0) return `Created ${created} new file${created > 1 ? 's' : ''}`;
  if (modified > 0) return `Touched ${modified} file${modified > 1 ? 's' : ''}`;
  return "Sometimes the best code is no code at all";
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildClipboardText(stats) {
  const lines = [];
  lines.push(`🏆 Today's Wins — ${new Date().toLocaleDateString()}`);
  lines.push('');
  lines.push(`⏱ Coded for ${formatTime(stats.codingSeconds)}`);
  lines.push(`📁 ${getFilesMessage(stats.filesCreated, stats.filesModified)}`);
  if (stats.projectName) lines.push(`📂 Worked on: ${stats.projectName}`);
  if (stats.streak > 0) lines.push(`🔥 ${stats.streak}-day streak`);
  lines.push('');
  lines.push(`— Dr. Vibe 🧑‍🔬`);
  return lines.join('\n');
}

export class TodayWinsPanel {
  constructor(sessionTracker) {
    this.tracker = sessionTracker;
    this.panel = document.getElementById('today-wins-panel');
    this._isQuitFlow = false;
    this._onQuitConfirm = null;
    this._unsubscribers = [];
  }

  init() {
    const doneBtn = document.getElementById('today-wins-done');
    const copyBtn = document.getElementById('today-wins-copy');
    const continueBtn = document.getElementById('today-wins-continue');

    doneBtn?.addEventListener('click', () => this._confirmQuit());
    copyBtn?.addEventListener('click', () => this._copyToClipboard());
    continueBtn?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel?.classList.contains('hidden')) {
        this.hide();
      }
    });
  }

  /**
   * Show the panel as part of quit flow.
   * @param {Function} onConfirmQuit - Called when user confirms they want to quit.
   */
  showForQuit(onConfirmQuit) {
    this._isQuitFlow = true;
    this._onQuitConfirm = onConfirmQuit;
    this._show();
  }

  /** Show the panel for manual viewing (no quit). */
  show() {
    this._isQuitFlow = false;
    this._onQuitConfirm = null;
    this._show();
  }

  hide() {
    this.panel?.classList.add('hidden');
    this._isQuitFlow = false;
    this._onQuitConfirm = null;
    eventBus.emit(Events.TODAY_WINS_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  _show() {
    this._render();
    this.panel?.classList.remove('hidden');
    eventBus.emit(Events.TODAY_WINS_SHOW, {});
    eventBus.emit(Events.TODAY_WINS_OPENED, {});
  }

  _render() {
    const stats = this.tracker.getStats();

    // Heading
    const titleEl = document.getElementById('today-wins-title');
    if (titleEl) titleEl.textContent = this._isQuitFlow ? "Today's Wins" : "Today's Wins So Far";

    // Main encouragement message
    const messageEl = document.getElementById('today-wins-message');
    if (messageEl) messageEl.textContent = getCodingMessage(stats.codingSeconds);

    // Stats
    const timeEl = document.getElementById('today-wins-time');
    if (timeEl) timeEl.textContent = formatTime(stats.codingSeconds);

    const filesEl = document.getElementById('today-wins-files');
    if (filesEl) filesEl.textContent = `${stats.filesCreated + stats.filesModified}`;

    const streakEl = document.getElementById('today-wins-streak');
    if (streakEl) streakEl.textContent = `${stats.streak}`;

    // Project
    const projectEl = document.getElementById('today-wins-project');
    if (projectEl) {
      projectEl.textContent = stats.projectName ? `Working on: ${stats.projectName}` : '';
    }

    // Encouragement sub-message
    const encourageEl = document.getElementById('today-wins-encouragement');
    if (encourageEl) {
      const parts = [];
      parts.push(getFilesMessage(stats.filesCreated, stats.filesModified));
      parts.push(getStreakMessage(stats.streak));
      encourageEl.textContent = parts.join(' · ');
    }

    // Button visibility
    const doneBtn = document.getElementById('today-wins-done');
    const continueBtn = document.getElementById('today-wins-continue');
    if (doneBtn) doneBtn.style.display = this._isQuitFlow ? '' : 'none';
    if (continueBtn) {
      continueBtn.textContent = this._isQuitFlow ? 'Keep going!' : 'Close';
    }
  }

  _confirmQuit() {
    eventBus.emit(Events.APP_QUIT_CONFIRMED, {});
    if (this._onQuitConfirm) {
      this._onQuitConfirm();
    }
  }

  async _copyToClipboard() {
    const stats = this.tracker.getStats();
    const text = buildClipboardText(stats);
    const copyBtn = document.getElementById('today-wins-copy');

    try {
      await navigator.clipboard.writeText(text);
      if (copyBtn) {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
      if (copyBtn) {
        copyBtn.textContent = 'Failed';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    }
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
