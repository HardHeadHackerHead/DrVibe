// Dr. Vibe - Pomodoro Timer System

export class Timer {
  constructor(workMinutes = 25, breakMinutes = 5) {
    this.workDuration = workMinutes * 60 * 1000; // ms
    this.breakDuration = breakMinutes * 60 * 1000; // ms

    this.isRunning = false;
    this.isPaused = false;
    this.isBreak = false;

    this.startTime = 0;
    this.pausedTime = 0;
    this.elapsed = 0;

    // Callbacks
    this.onTick = null;        // (minutes, seconds) - called every second
    this.onWorkComplete = null; // called when work period ends
    this.onBreakComplete = null; // called when break period ends
    this.onProgress = null;    // (progress 0-100) - called on progress change

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
    console.log('Timer paused');
  }

  resume() {
    if (!this.isPaused) return;

    this.isPaused = false;
    // Adjust start time to account for pause duration
    const pauseDuration = Date.now() - this.pausedTime;
    this.startTime += pauseDuration;

    this.tickInterval = setInterval(() => this.tick(), 1000);
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
    this.updateDisplay();
  }

  tick() {
    this.elapsed = Date.now() - this.startTime;
    const duration = this.isBreak ? this.breakDuration : this.workDuration;
    const remaining = Math.max(0, duration - this.elapsed);

    // Update display
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (this.onTick) {
      this.onTick(minutes, seconds);
    }

    // Calculate and emit progress
    const progress = Math.min(100, (this.elapsed / duration) * 100);
    if (Math.floor(progress) !== Math.floor(this.lastProgress)) {
      this.lastProgress = progress;
      if (this.onProgress) {
        this.onProgress(progress);
      }
    }

    // Check if period is complete
    if (remaining <= 0) {
      this.completePeriod();
    }
  }

  completePeriod() {
    clearInterval(this.tickInterval);
    this.elapsed = 0;

    if (this.isBreak) {
      console.log('Break complete!');
      if (this.onBreakComplete) {
        this.onBreakComplete();
      }
      this.isBreak = false;
    } else {
      console.log('Work complete!');
      if (this.onWorkComplete) {
        this.onWorkComplete();
      }
      this.isBreak = true;
    }

    // Auto-start next period
    this.lastProgress = 0;
    this.startTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  setIntervals(workMinutes, breakMinutes) {
    this.workDuration = workMinutes * 60 * 1000;
    this.breakDuration = breakMinutes * 60 * 1000;

    // If not in a break, restart timer with new work duration
    if (!this.isBreak && this.isRunning) {
      this.elapsed = 0;
      this.startTime = Date.now();
      this.lastProgress = 0;
    }

    console.log(`Timer intervals updated: ${workMinutes}m work, ${breakMinutes}m break`);
  }

  updateDisplay() {
    const duration = this.isBreak ? this.breakDuration : this.workDuration;
    const remaining = Math.max(0, duration - this.elapsed);
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (this.onTick) {
      this.onTick(minutes, seconds);
    }
  }

  // Skip to break (manual break)
  skipToBreak() {
    if (this.isBreak) return;

    clearInterval(this.tickInterval);
    this.elapsed = 0;
    this.isBreak = true;
    this.lastProgress = 0;
    this.startTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);

    console.log('Skipped to break');
  }

  // Skip break and return to work
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

  // Get current timer state
  getState() {
    const duration = this.isBreak ? this.breakDuration : this.workDuration;
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isBreak: this.isBreak,
      elapsed: this.elapsed,
      remaining: Math.max(0, duration - this.elapsed),
      progress: Math.min(100, (this.elapsed / duration) * 100)
    };
  }
}
