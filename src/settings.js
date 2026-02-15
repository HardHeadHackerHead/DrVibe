// Dr. Vibe - Settings Management

export class Settings {
  constructor() {
    // Default settings
    this.workInterval = 2;
    this.breakInterval = 1;
    this.notificationsEnabled = true;
    this.position = { x: 100, y: 100 };
    this.codingApps = [
      'Code',
      'Visual Studio',
      'Cursor',
      'Zed',
      'Sublime Text',
      'IntelliJ',
      'WebStorm',
      'PyCharm',
      'vim',
      'nvim',
      'Emacs',
      'Windows Terminal',
      'Terminal',
      'iTerm'
    ];

    this.store = null;
  }

  async load() {
    try {
      // Try to use Tauri store
      const { Store } = await import('@tauri-apps/plugin-store');
      this.store = new Store('settings.json');

      const workInterval = await this.store.get('workInterval');
      const breakInterval = await this.store.get('breakInterval');
      const notificationsEnabled = await this.store.get('notificationsEnabled');
      const position = await this.store.get('position');
      const codingApps = await this.store.get('codingApps');

      if (workInterval !== null) this.workInterval = workInterval;
      if (breakInterval !== null) this.breakInterval = breakInterval;
      if (notificationsEnabled !== null) this.notificationsEnabled = notificationsEnabled;
      if (position !== null) this.position = position;
      if (codingApps !== null) this.codingApps = codingApps;

      console.log('Settings loaded from Tauri store');
    } catch (e) {
      // Fall back to localStorage
      console.log('Using localStorage for settings');
      this.loadFromLocalStorage();
    }
  }

  loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem('dr-vibe-settings');
      if (saved) {
        const data = JSON.parse(saved);
        Object.assign(this, data);
      }
    } catch (e) {
      console.log('Failed to load settings from localStorage:', e);
    }
  }

  async save() {
    try {
      if (this.store) {
        await this.store.set('workInterval', this.workInterval);
        await this.store.set('breakInterval', this.breakInterval);
        await this.store.set('notificationsEnabled', this.notificationsEnabled);
        await this.store.set('position', this.position);
        await this.store.set('codingApps', this.codingApps);
        await this.store.save();
        console.log('Settings saved to Tauri store');
      } else {
        this.saveToLocalStorage();
      }
    } catch (e) {
      console.log('Save to Tauri store failed, using localStorage:', e);
      this.saveToLocalStorage();
    }
  }

  saveToLocalStorage() {
    try {
      const data = {
        workInterval: this.workInterval,
        breakInterval: this.breakInterval,
        notificationsEnabled: this.notificationsEnabled,
        position: this.position,
        codingApps: this.codingApps
      };
      localStorage.setItem('dr-vibe-settings', JSON.stringify(data));
      console.log('Settings saved to localStorage');
    } catch (e) {
      console.log('Failed to save settings to localStorage:', e);
    }
  }

  // Check if an app name matches a coding app
  isCodingApp(appName) {
    if (!appName) return false;
    const lowerName = appName.toLowerCase();

    return this.codingApps.some(app =>
      lowerName.includes(app.toLowerCase())
    );
  }

  // Add a coding app to the list
  addCodingApp(appName) {
    if (!this.codingApps.includes(appName)) {
      this.codingApps.push(appName);
      this.save();
    }
  }

  // Remove a coding app from the list
  removeCodingApp(appName) {
    const index = this.codingApps.indexOf(appName);
    if (index > -1) {
      this.codingApps.splice(index, 1);
      this.save();
    }
  }

  // Reset to defaults
  reset() {
    this.workInterval = 2;
    this.breakInterval = 1;
    this.notificationsEnabled = true;
    this.position = { x: 100, y: 100 };
    this.save();
  }
}
