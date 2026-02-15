// Dr. Vibe - Settings Panel UI (legacy - settings now use a separate window)

import { eventBus, Events } from '../core/EventBus.js';

export class SettingsPanel {
  constructor(settings, timer) {
    this.settings = settings;
    this.timer = timer;
    this.panel = document.getElementById('settings-panel');
    this.workInput = document.getElementById('work-interval');
    this.breakInput = document.getElementById('break-interval');
    this.notificationsInput = document.getElementById('notifications');
    this.boundaryAwarenessInput = document.getElementById('boundary-awareness');
    this.breakModeInput = document.getElementById('break-mode');
    this.idleThresholdInput = document.getElementById('idle-threshold');
    this.idleThresholdRow = document.getElementById('idle-threshold-row');
    this.longBreakIntervalInput = document.getElementById('long-break-interval');
    this.longBreakMinutesInput = document.getElementById('long-break-minutes');
    this.hydrationEnabledInput = document.getElementById('hydration-enabled');
    this.hydrationFrequencyInput = document.getElementById('hydration-frequency');
    this.learningResourcesInput = document.getElementById('learning-resources');
    this.eyeStrainEnabledInput = document.getElementById('eye-strain-enabled');
    this.postureEnabledInput = document.getElementById('posture-enabled');
    this.postureFrequencyInput = document.getElementById('posture-frequency');
    this.postureFrequencyRow = document.getElementById('posture-frequency-row');
    this.encouragementEnabledInput = document.getElementById('encouragement-enabled');
    this.encouragementFrequencyInput = document.getElementById('encouragement-frequency');
    this.encouragementFrequencyRow = document.getElementById('encouragement-frequency-row');
    this.focusDurationInput = document.getElementById('focus-duration');
    this.overworkPreventionInput = document.getElementById('overwork-prevention');
    this.resumeSuggestionsInput = document.getElementById('resume-suggestions');
    this.saveButton = document.getElementById('settings-save');
    this.closeButton = document.getElementById('settings-close');
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.saveButton?.addEventListener('click', () => this.save());
    this.closeButton?.addEventListener('click', () => this.hide());

    // Show/hide idle threshold based on break mode
    this.breakModeInput?.addEventListener('change', () => {
      this.updateIdleThresholdVisibility();
    });

    // Show/hide posture frequency based on enabled toggle
    this.postureEnabledInput?.addEventListener('change', () => {
      this.updatePostureFrequencyVisibility();
    });

    // Show/hide encouragement frequency based on enabled toggle
    this.encouragementEnabledInput?.addEventListener('change', () => {
      this.updateEncouragementFrequencyVisibility();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });

    // Listen for settings loaded to populate initial values
    eventBus.on(Events.SETTINGS_LOADED, (settings) => {
      this.populateValues(settings);
    });
  }

  show() {
    if (!this.panel) return;

    this.populateValues(this.settings.getAll());
    this.panel.classList.remove('hidden');

    eventBus.emit(Events.SETTINGS_PANEL_OPENED, {});
  }

  hide() {
    if (!this.panel) return;

    this.panel.classList.add('hidden');
    eventBus.emit(Events.SETTINGS_PANEL_CLOSED, {});
  }

  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  populateValues(settings) {
    if (this.workInput) this.workInput.value = settings.workInterval;
    if (this.breakInput) this.breakInput.value = settings.breakInterval;
    if (this.notificationsInput) this.notificationsInput.checked = settings.notificationsEnabled;
    if (this.boundaryAwarenessInput) this.boundaryAwarenessInput.checked = settings.boundaryAwarenessEnabled;
    if (this.breakModeInput) this.breakModeInput.value = settings.breakMode;
    if (this.idleThresholdInput) this.idleThresholdInput.value = settings.idleThresholdMinutes;
    if (this.longBreakIntervalInput) this.longBreakIntervalInput.value = settings.longBreakInterval;
    if (this.longBreakMinutesInput) this.longBreakMinutesInput.value = settings.longBreakMinutes;
    if (this.hydrationEnabledInput) this.hydrationEnabledInput.checked = settings.hydrationEnabled !== false;
    if (this.hydrationFrequencyInput) this.hydrationFrequencyInput.value = settings.hydrationFrequency || 45;
    if (this.learningResourcesInput) this.learningResourcesInput.checked = settings.learningResourcesEnabled || false;
    if (this.eyeStrainEnabledInput) this.eyeStrainEnabledInput.checked = settings.eyeStrainEnabled !== false;
    if (this.postureEnabledInput) this.postureEnabledInput.checked = settings.postureReminderEnabled !== false;
    if (this.postureFrequencyInput) this.postureFrequencyInput.value = settings.postureFrequency || 30;
    if (this.encouragementEnabledInput) this.encouragementEnabledInput.checked = settings.encouragementEnabled !== false;
    if (this.encouragementFrequencyInput) this.encouragementFrequencyInput.value = settings.encouragementFrequency || 60;
    if (this.focusDurationInput) this.focusDurationInput.value = settings.focusModeDuration || 25;
    if (this.overworkPreventionInput) this.overworkPreventionInput.checked = settings.overworkPreventionEnabled !== false;
    if (this.resumeSuggestionsInput) this.resumeSuggestionsInput.checked = settings.resumeSuggestionsEnabled !== false;
    this.updateIdleThresholdVisibility();
    this.updatePostureFrequencyVisibility();
    this.updateEncouragementFrequencyVisibility();
  }

  updateIdleThresholdVisibility() {
    if (!this.idleThresholdRow || !this.breakModeInput) return;
    // Idle threshold only matters in smart mode
    this.idleThresholdRow.style.display = this.breakModeInput.value === 'smart' ? '' : 'none';
  }

  updatePostureFrequencyVisibility() {
    if (!this.postureFrequencyRow || !this.postureEnabledInput) return;
    this.postureFrequencyRow.style.display = this.postureEnabledInput.checked ? '' : 'none';
  }

  updateEncouragementFrequencyVisibility() {
    if (!this.encouragementFrequencyRow || !this.encouragementEnabledInput) return;
    this.encouragementFrequencyRow.style.display = this.encouragementEnabledInput.checked ? '' : 'none';
  }

  async save() {
    const workInterval = parseInt(this.workInput?.value) || 25;
    const breakInterval = parseInt(this.breakInput?.value) || 5;
    const notificationsEnabled = this.notificationsInput?.checked ?? true;
    const boundaryAwarenessEnabled = this.boundaryAwarenessInput?.checked ?? true;
    const breakMode = this.breakModeInput?.value || 'pomodoro';
    const idleThresholdMinutes = parseInt(this.idleThresholdInput?.value) || 5;
    const longBreakInterval = parseInt(this.longBreakIntervalInput?.value) || 4;
    const longBreakMinutes = parseInt(this.longBreakMinutesInput?.value) || 15;

    this.settings.set('workInterval', workInterval);
    this.settings.set('breakInterval', breakInterval);
    this.settings.set('notificationsEnabled', notificationsEnabled);
    this.settings.set('boundaryAwarenessEnabled', boundaryAwarenessEnabled);
    this.settings.set('breakMode', breakMode);
    this.settings.set('idleThresholdMinutes', idleThresholdMinutes);
    this.settings.set('longBreakInterval', longBreakInterval);
    this.settings.set('longBreakMinutes', longBreakMinutes);

    const hydrationEnabled = this.hydrationEnabledInput?.checked ?? true;
    const hydrationFrequency = parseInt(this.hydrationFrequencyInput?.value) || 45;
    this.settings.set('hydrationEnabled', hydrationEnabled);
    this.settings.set('hydrationFrequency', hydrationFrequency);

    const learningResourcesEnabled = this.learningResourcesInput?.checked ?? false;
    this.settings.set('learningResourcesEnabled', learningResourcesEnabled);

    const eyeStrainEnabled = this.eyeStrainEnabledInput?.checked ?? true;
    this.settings.set('eyeStrainEnabled', eyeStrainEnabled);

    const postureReminderEnabled = this.postureEnabledInput?.checked ?? true;
    const postureFrequency = parseInt(this.postureFrequencyInput?.value) || 30;
    this.settings.set('postureReminderEnabled', postureReminderEnabled);
    this.settings.set('postureFrequency', postureFrequency);

    const encouragementEnabled = this.encouragementEnabledInput?.checked ?? true;
    const encouragementFrequency = parseInt(this.encouragementFrequencyInput?.value) || 60;
    this.settings.set('encouragementEnabled', encouragementEnabled);
    this.settings.set('encouragementFrequency', encouragementFrequency);

    const overworkPreventionEnabled = this.overworkPreventionInput?.checked ?? true;
    this.settings.set('overworkPreventionEnabled', overworkPreventionEnabled);

    const focusModeDuration = parseInt(this.focusDurationInput?.value) || 25;
    this.settings.set('focusModeDuration', focusModeDuration);

    const resumeSuggestionsEnabled = this.resumeSuggestionsInput?.checked ?? true;
    this.settings.set('resumeSuggestionsEnabled', resumeSuggestionsEnabled);

    // Update timer with new intervals
    this.timer.setIntervals(workInterval, breakInterval);

    this.hide();
    console.log('Settings saved');
  }
}
