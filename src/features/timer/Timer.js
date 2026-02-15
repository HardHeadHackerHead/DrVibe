// Dr. Vibe - Pomodoro Timer System

import { eventBus, Events } from '../../core/EventBus.js';

export class Timer {
  constructor(workMinutes = 25, breakMinutes = 5) {
    this.workDuration = workMinutes * 60 * 1000;
    this.breakDuration = breakMinutes * 60 * 1000;

    this.isRunning = false;
    this.isPaused = false;
    this.isBreak = false;

    this.startTime = 0;
    this.pausedTime = 0;
    this.elapsed = 0;

    this.tickInterval = null;
    this.lastProgress = 0;
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now() - this.elapsed;

    this.tickInterval = setInterval(() => this.tick(), 1000);
    console.log(`Timer started: ${this.isBreak ? 'Break' : 'Work'} period`);
  }

  pause() {
    if (!this.isRunning || this.isPaused) return;

    this.isPaused = true;
    this.pausedTime = Date.now();
    clearInterval(this.tickInterval);

    eventBus.emit(Events.TIMER_PAUSED, this.getState());
    console.log('Timer paused');
  }

  resume() {
    if (!this.isPaused) return;

    this.isPaused = false;
    const pauseDuration = Date.now() - this.pausedTime;
    this.startTime += pauseDuration;

    this.tickInterval = setInterval(() => this.tick(), 1000);

    eventBus.emit(Events.TIMER_RESUMED, this.getState());
    console.log('Timer resumed');
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.elapsed = 0;
    clearInterval(this.tickInterval);
    console.log('Timer stopped');
  }

  reset() {
    this.stop();
    this.isBreak = false;
    this.lastProgress = 0;
    this.emitTick();
  }

  tick() {
    this.elapsed = Date.now() - this.startTime;
    const duration = this.isBreak ? this.breakDuration : this.workDuration;
    const remaining = Math.max(0, duration - this.elapsed);

    // Emit tick event
    this.emitTick();

    // Calculate and emit progress
    const progress = Math.min(100, (this.elapsed / duration) * 100);
    if (Math.floor(progress) !== Math.floor(this.lastProgress)) {
      this.lastProgress = progress;
      eventBus.emit(Events.TIMER_PROGRESS, { progress, isBreak: this.isBreak, elapsed: this.elapsed, duration });
    }

    // Check if period is complete
    if (remaining <= 0) {
      this.completePeriod();
    }
  }

  emitTick() {
    const duration = this.isBreak ? this.breakDuration : this.workDuration;
    const remaining = Math.max(0, duration - this.elapsed);
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    eventBus.emit(Events.TIMER_TICK, { minutes, seconds, isBreak: this.isBreak });
  }

  completePeriod() {
    clearInterval(this.tickInterval);
    this.elapsed = 0;

    if (this.isBreak) {
      console.log('Break complete!');
      eventBus.emit(Events.TIMER_BREAK_COMPLETE, {});
      this.isBreak = false;
    } else {
      console.log('Work complete!');
      eventBus.emit(Events.TIMER_WORK_COMPLETE, {});
      this.isBreak = true;
      eventBus.emit(Events.TIMER_BREAK_START, {});
    }

    // Auto-start next period
    this.lastProgress = 0;
    this.startTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  setIntervals(workMinutes, breakMinutes) {
    this.workDuration = workMinutes * 60 * 1000;
    this.breakDuration = breakMinutes * 60 * 1000;

    if (!this.isBreak && this.isRunning) {
      this.elapsed = 0;
      this.startTime = Date.now();
      this.lastProgress = 0;
    }

    console.log(`Timer intervals updated: ${workMinutes}m work, ${breakMinutes}m break`);
  }

  skipToBreak() {
    if (this.isBreak) return;

    clearInterval(this.tickInterval);
    this.elapsed = 0;
    this.isBreak = true;
    this.lastProgress = 0;
    this.startTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);

    eventBus.emit(Events.TIMER_BREAK_START, {});
    console.log('Skipped to break');
  }

  skipBreak() {
    if (!this.isBreak) return;

    clearInterval(this.tickInterval);
    this.elapsed = 0;
    this.isBreak = false;
    this.lastProgress = 0;
    this.startTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);

    console.log('Break skipped');
  }

  getState() {
    const duration = this.isBreak ? this.breakDuration : this.workDuration;
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isBreak: this.isBreak,
      elapsed: this.elapsed,
      remaining: Math.max(0, duration - this.elapsed),
      progress: Math.min(100, (this.elapsed / duration) * 100),
    };
  }
}
