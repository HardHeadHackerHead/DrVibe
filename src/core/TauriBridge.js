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

  async openPanelWindow(label, url, title, width, height, resizable = true) {
    if (!this.isAvailable || !this.invoke) return;
    try {
      await this.invoke('open_panel_window', { label, url, title, width, height, resizable });
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
      await this.window.setFocus();
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

  async getRecentGitRepos(searchPaths) {
    if (!this.isAvailable || !this.invoke) return [];
    try {
      return await this.invoke('get_recent_git_repos', { searchPaths });
    } catch (e) {
      console.error('Failed to get recent git repos:', e);
      return [];
    }
  }

  // Filesystem scanning for project discovery
  async scanDirectoriesForProjects(searchPaths, maxDepth = 5) {
    if (!this.isAvailable || !this.invoke) return [];
    try {
      return await this.invoke('scan_directories_for_projects', { searchPaths, maxDepth });
    } catch (e) {
      console.error('Failed to scan directories for projects:', e);
      return [];
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
    if (!this.isAvailable || !this.window) return null;
    try {
      return this.window.listen('file-changed', (event) => {
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

  // Claude Code integration - hook lifecycle management
  async installClaudeCodeHooks() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      const result = await this.invoke('install_claude_code_hooks');
      console.log('Claude Code hooks:', result);
      return result;
    } catch (e) {
      console.error('Failed to install Claude Code hooks:', e);
      return null;
    }
  }

  async uninstallClaudeCodeHooks() {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      const result = await this.invoke('uninstall_claude_code_hooks');
      console.log('Claude Code hooks:', result);
      return result;
    } catch (e) {
      console.error('Failed to uninstall Claude Code hooks:', e);
      return null;
    }
  }

  // Claude Code integration - read new events from hook log
  async readClaudeCodeEvents(offset) {
    if (!this.isAvailable || !this.invoke) return null;
    try {
      return await this.invoke('read_claude_code_events', { offset });
    } catch (e) {
      // Log file may not exist yet - that's fine
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
