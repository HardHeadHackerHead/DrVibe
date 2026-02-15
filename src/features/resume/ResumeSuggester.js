// Dr. Vibe - Smart Resume Suggestions
// Shows where to continue coding after returning from idle (30+ min).
// One-time suggestion per idle return, dismissible, non-intrusive.

import { eventBus, Events } from '../../core/EventBus.js';

// Friendly messages shown alongside the filename suggestion
const RESUME_MESSAGES = [
  { text: 'Welcome back!', tip: 'You were working on {file}.' },
  { text: 'Pick up where you left off?', tip: 'Last active file: {file}' },
  { text: 'Ready to continue?', tip: '{file} was your last edit.' },
  { text: 'Hey, welcome back!', tip: 'Continue with {file}?' },
];

const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after dismiss before next suggestion

export class ResumeSuggester {
  constructor(settings, sessionTracker) {
    this.settings = settings;
    this.sessionTracker = sessionTracker;
    this.enabled = settings.resumeSuggestionsEnabled;
    this._unsubscribers = [];
    this._lastSuggestionTime = 0;
    this._idleSince = null; // timestamp when idle started
    this._suggestedThisReturn = false; // prevent repeat for same idle return
  }

  init() {
    // Track when user goes idle — reset suggestion flag for next return
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_IDLE, ({ idleTimeMs }) => {
        if (!this._idleSince) {
          this._idleSince = Date.now() - idleTimeMs;
          this._suggestedThisReturn = false;
        }
      })
    );

    // When coding resumes, check if we should suggest
    this._unsubscribers.push(
      eventBus.on(Events.ACTIVITY_CODING_START, () => {
        this._onCodingResume();
      })
    );

    // Handle dismiss (from speech bubble "Got it!" button)
    this._unsubscribers.push(
      eventBus.on(Events.RESUME_DISMISSED, () => {
        this._lastSuggestionTime = Date.now();
      })
    );

    // React to settings changes
    this._unsubscribers.push(
      eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
        if (key === 'resumeSuggestionsEnabled') {
          this.enabled = value;
        }
      })
    );

    // On first init, if we have recent files from a previous session,
    // treat this as a "resume" opportunity (new session = was idle)
    if (this.sessionTracker.recentFiles.length > 0) {
      this._idleSince = 0; // treat app start as coming back from idle
    }

    console.log('ResumeSuggester initialized');
  }

  _onCodingResume() {
    if (!this.enabled) return;
    if (this._suggestedThisReturn) return;

    // Check if we were idle long enough
    if (this._idleSince === null) return;
    const idleDuration = Date.now() - this._idleSince;
    if (idleDuration < IDLE_THRESHOLD_MS && this._idleSince !== 0) return;

    // Respect cooldown after dismiss
    if (Date.now() - this._lastSuggestionTime < COOLDOWN_MS) return;

    // Get recent files
    const recentFiles = this.sessionTracker.recentFiles;
    if (!recentFiles || recentFiles.length === 0) return;

    // Pick the most recent file and extract just the filename
    const fullPath = recentFiles[0];
    const filename = fullPath.split(/[\\/]/).pop();

    // Pick a random message
    const pick = RESUME_MESSAGES[Math.floor(Math.random() * RESUME_MESSAGES.length)];
    const tip = pick.tip.replace('{file}', filename);

    this._suggestedThisReturn = true;
    this._lastSuggestionTime = Date.now();
    this._idleSince = null;

    eventBus.emit(Events.RESUME_SUGGESTION_TRIGGERED, {
      text: pick.text,
      tip,
      filename,
      filepath: fullPath,
      recentFiles: recentFiles.slice(0, 3),
    });

    console.log(`ResumeSuggester: suggested resuming ${filename}`);
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
