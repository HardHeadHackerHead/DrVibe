// Dr. Vibe - Status Indicator UI

import { eventBus, Events } from '../core/EventBus.js';

export class StatusIndicator {
  constructor() {
    this.indicator = document.getElementById('status-indicator');
    this.isCoding = false;
    this.isBreak = false;
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    eventBus.on(Events.ACTIVITY_CHANGED, ({ isCoding }) => {
      this.isCoding = isCoding;
      this.updateDisplay();
    });

    eventBus.on(Events.TIMER_PROGRESS, ({ isBreak }) => {
      this.isBreak = isBreak;
      this.updateDisplay();
    });

    eventBus.on(Events.TIMER_WORK_COMPLETE, () => {
      this.isBreak = true;
      this.updateDisplay();
    });

    eventBus.on(Events.TIMER_BREAK_COMPLETE, () => {
      this.isBreak = false;
      this.updateDisplay();
    });
  }

  updateDisplay() {
    if (!this.indicator) return;

    this.indicator.classList.remove('coding', 'idle', 'break');

    if (this.isBreak) {
      this.indicator.classList.add('break');
    } else if (this.isCoding) {
      this.indicator.classList.add('coding');
    } else {
      this.indicator.classList.add('idle');
    }
  }

  setStatus(status) {
    if (!this.indicator) return;

    this.indicator.classList.remove('coding', 'idle', 'break');
    this.indicator.classList.add(status);
  }
}
