// Dr. Vibe - Auto-update checker using Tauri updater plugin

import { tauri } from './TauriBridge.js';

class UpdateChecker {
  constructor() {
    this._checking = false;
  }

  async checkForUpdates({ silent = false } = {}) {
    if (!tauri.isAvailable || this._checking) return null;
    if (!window.__TAURI__?.updater) {
      if (!silent) console.log('Updater plugin not available');
      return null;
    }

    this._checking = true;
    try {
      const { check } = window.__TAURI__.updater;
      const update = await check();

      if (update) {
        console.log(`Update available: v${update.version}`);
        return update;
      }

      if (!silent) console.log('No update available');
      return null;
    } catch (e) {
      if (!silent) console.error('Update check failed:', e);
      return null;
    } finally {
      this._checking = false;
    }
  }

  async downloadAndInstall(update) {
    if (!update) return false;
    try {
      console.log(`Downloading update v${update.version}...`);
      await update.downloadAndInstall();
      console.log('Update installed — relaunch to apply');
      return true;
    } catch (e) {
      console.error('Update install failed:', e);
      return false;
    }
  }

  // Check silently after a delay (called on app startup)
  scheduleCheck(delayMs = 30000) {
    setTimeout(() => this.checkForUpdates({ silent: true }), delayMs);
  }
}

export const updateChecker = new UpdateChecker();
