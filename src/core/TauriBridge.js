// Dr. Vibe - Centralized Tauri API access

class TauriBridge {
  constructor() {
    this.isAvailable = false;
    this.window = null;
    this.invoke = null;
    // Standalone functions from the window module
    this._availableMonitors = null;
    this._primaryMonitor = null;
    this._currentMonitor = null;
  }

  // Initialize Tauri APIs
  async init() {
    try {
      // With withGlobalTauri: true, APIs are on window.__TAURI__
      if (!window.__TAURI__) {
        throw new Error('window.__TAURI__ not available');
      }

      const windowModule = window.__TAURI__.window;
      const { invoke } = window.__TAURI__.core;

      this.window = windowModule.getCurrentWindow();
      this.invoke = invoke;
      this._availableMonitors = windowModule.availableMonitors;
      this._primaryMonitor = windowModule.primaryMonitor;
      this._currentMonitor = windowModule.currentMonitor;
      this.isAvailable = true;

      console.log('Tauri APIs initialized');
      return true;
    } catch (e) {
      console.log('Running in browser mode (Tauri not available)');
      this.isAvailable = false;
      return false;
    }
  }

  // Window management
  async getWindowPosition() {
    if (!this.isAvailable) return { x: 0, y: 0 };
    try {
      const pos = await this.window.outerPosition();
      return { x: pos.x, y: pos.y };
    } catch (e) {
      console.error('Failed to get window position:', e);
      return { x: 0, y: 0 };
    }
  }

  async setWindowPosition(x, y) {
    if (!this.isAvailable) return;
    try {
      await this.window.setPosition({ type: 'Physical', x, y });
    } catch (e) {
      console.error('Failed to set window position:', e);
    }
  }

  async getWindowSize() {
    if (!this.isAvailable) return { width: 200, height: 200 };
    try {
      const size = await this.window.outerSize();
      return { width: size.width, height: size.height };
    } catch (e) {
      console.error('Failed to get window size:', e);
      return { width: 200, height: 200 };
    }
  }

  async setWindowSize(width, height) {
    if (!this.isAvailable || !this.invoke) return;
    try {
      // Use a direct Rust command to resize the main window reliably.
      // The Tauri v2 JS window.setSize() API has a complex serialization chain
      // that can silently fail on Windows; invoking the Rust side directly avoids it.
      await this.invoke('set_main_window_size', { width, height });
    } catch (e) {
      console.error('Failed to set window size:', e);
    }
  }

  async openSettingsWindow() {
    if (!this.isAvailable || !this.invoke) return;
    try {
      await this.invoke('open_settings_window');
    } catch (e) {
      console.error('Failed to open settings window:', e);
    }
  }

  async openDashboardWindow() {
    if (!this.isAvailable || !this.invoke) return;
    try {
      await this.invoke('open_dashboard_window');
    } catch (e) {
      console.error('Failed to open dashboard window:', e);
    }
  }

  // decorations: false for pages that draw their own title bar (match tray.rs).
  async openPanelWindow(label, url, title, width, height, resizable = true, decorations = true) {
    if (!this.isAvailable || !this.invoke) return;
    try {
      await this.invoke('open_panel_window', { label, url, title, width, height, resizable, decorations });
    } catch (e) {
      console.error(`Failed to open panel window '${label}':`, e);
    }
  }

  async getMonitors() {
    if (!this.isAvailable || !this._availableMonitors) return [];
    try {
      return await this._availableMonitors();
    } catch (e) {
      console.error('Failed to get monitors:', e);
      return [];
    }
  }

  async getCurrentMonitor() {
    if (!this.isAvailable || !this._currentMonitor) return null;
    try {
      return await this._currentMonitor();
    } catch (e) {
      console.error('Failed to get current monitor:', e);
      return null;
    }
  }

  async getMonitorWorkAreas() {
    if (!this.isAvailable || !this.invoke) return [];
    try {
      return await this.invoke('get_monitor_work_areas');
    } catch (e) {
      console.error('Failed to get monitor work areas:', e);
      return [];
    }
  }

  async getPrimaryMonitor() {
    if (!this.isAvailable || !this._primaryMonitor) return null;
    try {
      return await this._primaryMonitor();
    } catch (e) {
      console.error('Failed to get primary monitor:', e);
      return null;
    }
  }

  async showWindow() {
    if (!this.isAvailable) return;
    try {
      await this.window.show();
      // Do NOT call setFocus() — the main window is always-on-top and has no
      // text input, so there is never a reason to steal focus from the user's editor.
    } catch (e) {
      console.error('Failed to show window:', e);
    }
  }

  async hideWindow() {
    if (!this.isAvailable) return;
    try {
      await this.window.hide();
    } catch (e) {
      console.error('Failed to hide window:', e);
    }
  }

  // Active window detection (calls Rust backend)
  async getActiveWindow() {
    if (!this.isAvailable || !this.invoke) {
      return { app_name: 'Unknown', window_title: '', process_id: 0 };
    }
    try {
      return await this.invoke('get_active_window');
    } catch (e) {
      console.error('Failed to get active window:', e);
      return { app_name: 'Unknown', window_title: '', process_id: 0 };
    }
  }

  async isCodingApp(appName) {
    if (!this.isAvailable || !this.invoke) {
      return false;
    }
    try {
      return await this.invoke('is_coding_app', { appName });
    } catch (e) {
      console.error('Failed to check coding app:', e);
      return false;
    }
  }

  // Project detection (calls Rust backend)
  async scanProjectMarkers(dirPath) {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('scan_project_markers', { dirPath });
    } catch (e) {
      console.error('Failed to scan project markers:', e);
      return null;
    }
  }

  // The repo a path is in (repos.rs): { name, root, worktree }; null when
  // it's in no repo or in a place never tracked (temp, app data, system);
  // undefined when Rust can't be asked.
  async resolveRepo(path) {
    if (!this.isAvailable || !this.invoke) return undefined;
    try {
      return (await this.invoke('resolve_repo', { path })) ?? null;
    } catch (e) {
      console.error('Failed to resolve repo:', e);
      return undefined;
    }
  }

  // Repos in a folder the user added: the folder's own repo, or the repos
  // directly inside it.
  async findFolderRepos(folder) {
    if (!this.isAvailable || !this.invoke) return [];
    try {
      return await this.invoke('find_folder_repos', { folder });
    } catch (e) {
      console.error('Failed to find repos in folder:', e);
      return [];
    }
  }

  // For each path, true when it's a place never tracked. Null when
  // unavailable.
  async untrackedPlaces(paths) {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('untracked_places', { paths });
    } catch (e) {
      console.error('Failed to check places:', e);
      return null;
    }
  }

  // File watching for momentum tracking
  async startWatching(path) {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('start_watching', { path });
    } catch (e) {
      console.error('Failed to start file watching:', e);
      return null;
    }
  }

  async stopWatching() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('stop_watching');
    } catch (e) {
      console.error('Failed to stop file watching:', e);
      return null;
    }
  }

  async getWatchedPath() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('get_watched_path');
    } catch (e) {
      return null;
    }
  }

  onFileChanged(callback) {
    if (!this.isAvailable) return null;
    try {
      // Use global listen — Rust emits via AppHandle::emit() which is a global
      // broadcast. In Tauri v2, getCurrentWindow().listen() only receives
      // window-targeted events; the global listen() receives app-level broadcasts.
      const listen = window.__TAURI__?.event?.listen;
      if (!listen) return null;
      return listen('file-changed', (event) => {
        callback(event.payload);
      });
    } catch (e) {
      console.error('Failed to listen for file changes:', e);
      return null;
    }
  }

  // Click-through control
  async setIgnoreCursorEvents(ignore) {
    if (!this.isAvailable) return;
    try {
      await this.window.setIgnoreCursorEvents(ignore);
    } catch (e) {
      console.error('Failed to set ignore cursor events:', e);
    }
  }

  // Ms since the last keyboard or mouse input; null where the OS can't say.
  async lastInputAgeMs() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return (await this.invoke('last_input_age_ms')) ?? null;
    } catch (e) {
      return null;
    }
  }

  async getCursorPosition() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('get_cursor_position');
    } catch (e) {
      return null;
    }
  }

  async getScaleFactor() {
    if (!this.isAvailable) return 1;
    try {
      return await this.window.scaleFactor();
    } catch (e) {
      return 1;
    }
  }

  // Claude Code integration - hook status (install/uninstall: features/activity/claudeHooks.js)
  async checkClaudeCodeHooks() {
    if (!this.isAvailable || !this.invoke) return false;
    try {
      return await this.invoke('check_claude_code_hooks');
    } catch (e) {
      return false;
    }
  }

  // Claude Code integration - read new events from hook log
  async getGitInfo(path) {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('get_git_info', { path });
    } catch (e) {
      return null;
    }
  }

  async readClaudeCodeEvents(offset) {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('read_claude_code_events', { offset });
    } catch (e) {
      // Log file may not exist yet - that's fine
      return null;
    }
  }

  // Auto-updater
  async checkForUpdates() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('check_for_updates');
    } catch (e) {
      console.error('Failed to check for updates:', e);
      return null;
    }
  }

  onUpdateAvailable(callback) {
    if (!this.isAvailable) return null;
    try {
      const listen = window.__TAURI__?.event?.listen;
      if (!listen) return null;
      return listen('update-available', (event) => {
        callback(event.payload);
      });
    } catch (e) {
      console.error('Failed to listen for update-available:', e);
      return null;
    }
  }

  // App lifecycle
  async quitApp() {
    if (!this.isAvailable || !this.invoke) return;
    try {
      await this.invoke('quit_app');
    } catch (e) {
      console.error('Failed to quit app:', e);
    }
  }

  // Profile / auth
  async getProfile() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('get_profile');
    } catch (e) {
      return null;
    }
  }

  // Update the system tray tooltip (e.g. to show the VP balance)
  async setTrayTooltip(tooltip) {
    if (!this.isAvailable || !this.invoke) return;
    try {
      await this.invoke('set_tray_tooltip', { tooltip });
    } catch (e) {
      // Non-critical — ignore
    }
  }

  // Notifications
  async sendNotification(title, body) {
    if (!this.isAvailable) {
      // Fallback to browser notification
      this.sendBrowserNotification(title, body);
      return;
    }

    try {
      // With withGlobalTauri: true, plugins are on window.__TAURI__
      if (window.__TAURI__?.notification) {
        await window.__TAURI__.notification.sendNotification({ title, body });
      } else {
        this.sendBrowserNotification(title, body);
      }
    } catch (e) {
      console.error('Tauri notification failed, trying browser:', e);
      this.sendBrowserNotification(title, body);
    }
  }

  sendBrowserNotification(title, body) {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(title, { body });
          }
        });
      }
    }
  }
}

// Singleton instance
export const tauri = new TauriBridge();
