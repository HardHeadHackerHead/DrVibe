// Dr. Vibe - Game Loop Manager

export class GameLoop {
  constructor() {
    this.isRunning = false;
    this.lastTime = 0;
    this.callbacks = new Set();
    this.frameId = null;

    // FPS cap — 30 FPS is plenty for pixel art animations (6-27 FPS)
    this.targetFPS = 30;
    this.frameInterval = 1000 / this.targetFPS;
    this.accumulated = 0;

    // Visibility-based pause
    this._paused = false;
    this._onVisibilityChange = () => {
      if (document.hidden) {
        this._pause();
      } else {
        this._resume();
      }
    };
  }

  // Add an update callback
  add(callback) {
    this.callbacks.add(callback);
    return () => this.remove(callback);
  }

  // Remove an update callback
  remove(callback) {
    this.callbacks.delete(callback);
  }

  // Start the game loop
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this._paused = false;
    this.lastTime = performance.now();
    this.accumulated = 0;
    this.frameId = requestAnimationFrame((t) => this.tick(t));
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    console.log('Game loop started');
  }

  // Stop the game loop
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    this._paused = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    console.log('Game loop stopped');
  }

  // Pause when window is hidden
  _pause() {
    if (!this.isRunning || this._paused) return;
    this._paused = true;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    console.log('Game loop paused (window hidden)');
  }

  // Resume when window becomes visible
  _resume() {
    if (!this.isRunning || !this._paused) return;
    this._paused = false;
    this.lastTime = performance.now();
    this.accumulated = 0;
    this.frameId = requestAnimationFrame((t) => this.tick(t));
    console.log('Game loop resumed');
  }

  // Main tick function — throttled to targetFPS
  tick(timestamp) {
    if (!this.isRunning || this._paused) return;

    const deltaTime = timestamp - this.lastTime;
    this.lastTime = timestamp;

    // Accumulate time and only update when enough has passed
    this.accumulated += deltaTime;
    if (this.accumulated >= this.frameInterval) {
      const updateDelta = this.accumulated;
      this.accumulated = 0;

      this.callbacks.forEach(callback => {
        try {
          callback(updateDelta, timestamp);
        } catch (e) {
          console.error('Error in game loop callback:', e);
        }
      });
    }

    this.frameId = requestAnimationFrame((t) => this.tick(t));
  }
}

// Singleton instance
export const gameLoop = new GameLoop();
