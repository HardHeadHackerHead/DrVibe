// Dr. Vibe - Activity Monitor

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { TIMING } from '../../config/animations.js';

export class ActivityMonitor {
  constructor(settings) {
    this.settings = settings;
    this.isCoding = false;
    this.lastActivity = Date.now();
    this.pollInterval = null;
    this.idleCheckInterval = null;
    this.idleThresholdMs = 5 * 60 * 1000; // default 5 min
    this.isIdle = false;
    this.lastWindowTitle = '';
    this.lastAppName = '';
  }

  start() {
    if (!tauri.isAvailable) {
      console.log('Activity monitoring not available (no Tauri)');
      return;
    }

    this.pollInterval = setInterval(() => this.poll(), TIMING.activityPollMs);

    // Idle check runs every 10 seconds
    this.idleCheckInterval = setInterval(() => this.checkIdle(), 10000);

    console.log('Activity monitoring started');
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    console.log('Activity monitoring stopped');
  }

  setIdleThreshold(minutes) {
    this.idleThresholdMs = minutes * 60 * 1000;
  }

  checkIdle() {
    const idleTime = Date.now() - this.lastActivity;
    const wasIdle = this.isIdle;
    this.isIdle = idleTime >= this.idleThresholdMs;

    if (this.isIdle && !wasIdle) {
      console.log(`User idle for ${Math.floor(idleTime / 1000)}s — emitting idle event`);
      eventBus.emit(Events.ACTIVITY_IDLE, { idleTimeMs: idleTime });
    }
  }

  async poll() {
    try {
      const windowInfo = await tauri.getActiveWindow();
      const wasCoding = this.isCoding;
      this.isCoding = this.settings
        ? this.settings.isCodingApp(windowInfo.app_name)
        : await tauri.isCodingApp(windowInfo.app_name);

      if (this.isCoding !== wasCoding) {
        this.onActivityChanged(this.isCoding, windowInfo);
      }

      // Emit window change even while still coding (for project tracking)
      if (this.isCoding && (
        windowInfo.window_title !== this.lastWindowTitle ||
        windowInfo.app_name !== this.lastAppName
      )) {
        eventBus.emit(Events.ACTIVITY_WINDOW_CHANGED, {
          appName: windowInfo.app_name,
          windowTitle: windowInfo.window_title,
          isCoding: true,
        });
      }

      this.lastWindowTitle = windowInfo.window_title;
      this.lastAppName = windowInfo.app_name;

      if (this.isCoding) {
        this.lastActivity = Date.now();
      }
    } catch (e) {
      console.log('Activity detection error:', e);
    }
  }

  onActivityChanged(isCoding, windowInfo) {
    console.log(`Activity changed: ${isCoding ? 'coding' : 'not coding'} (${windowInfo.app_name})`);

    eventBus.emit(Events.ACTIVITY_CHANGED, {
      isCoding,
      appName: windowInfo.app_name,
      windowTitle: windowInfo.window_title,
    });

    if (isCoding) {
      this.isIdle = false;
      eventBus.emit(Events.ACTIVITY_CODING_START, { appName: windowInfo.app_name });
    } else {
      eventBus.emit(Events.ACTIVITY_CODING_STOP, {});
      // Emit window switch when user leaves coding for another app
      eventBus.emit(Events.ACTIVITY_WINDOW_SWITCH, {
        fromApp: this.lastAppName,
        toApp: windowInfo.app_name,
      });
    }
  }

  getState() {
    return {
      isCoding: this.isCoding,
      lastActivity: this.lastActivity,
      idleTime: Date.now() - this.lastActivity,
    };
  }
}
