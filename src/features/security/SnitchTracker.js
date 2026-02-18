// Dr. Vibe — Snitch Integration
// Watches Claude Code activity and suggests security scans at the right moments.

import { eventBus, Events } from '../../core/EventBus.js';

const SUGGESTION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between suggestions
const MIN_FILES_FOR_SUGGESTION = 3;             // need at least 3 written files to suggest
const HOTSPOT_THRESHOLD = 15;                   // edits before a hotspot triggers a suggestion

const MESSAGES = [
  {
    text: (n) => `${n} files just changed. Worth a quick security check before you ship?`,
    tip: 'Run /snitch --diff in your terminal.',
  },
  {
    text: (n) => `Big session — ${n} files written. Snitch can scan the diff before it goes out.`,
    tip: 'Run /snitch --diff',
  },
  {
    text: (n) => `Session wrapped with ${n} changed files. A /snitch --diff takes 30 seconds.`,
    tip: 'Security review before you ship.',
  },
  {
    text: (n) => `${n} file${n !== 1 ? 's' : ''} modified this session. Want Snitch to take a look?`,
    tip: 'Run /snitch --diff to audit the diff.',
  },
];

const HOTSPOT_MESSAGES = [
  {
    text: (file) => `${file} is a hotspot. Might be worth a /snitch scan on it.`,
    tip: 'Heavily-edited files are higher risk.',
  },
  {
    text: (file) => `${file} has been edited a lot this session. Snitch can check it.`,
    tip: 'Run /snitch --diff',
  },
];

export class SnitchTracker {
  constructor(settings) {
    this._settings = settings;
    this._unsubs = [];
    this._currentCwd = null;
    this._currentProject = null;
    this._lastSuggestionAt = 0;
    this._suggestedHotspots = new Set();
  }

  init() {
    // Capture the active project path when a Claude Code session starts
    this._unsubs.push(
      eventBus.on(Events.CLAUDE_CODE_SESSION_START, ({ cwd, projectName }) => {
        this._currentCwd = cwd || null;
        this._currentProject = projectName || null;
      })
    );

    // When a session ends, decide whether to suggest a scan based on written file count
    this._unsubs.push(
      eventBus.on(Events.CLAUDE_CODE_SESSION_END, ({ filesWritten, writtenPaths }) => {
        if (filesWritten >= MIN_FILES_FOR_SUGGESTION) {
          this._suggestDiffScan(filesWritten, writtenPaths);
        }
        // Reset hotspot suggestions for the next session
        this._suggestedHotspots.clear();
      })
    );

    // Suggest a scan when a specific file has been hammered heavily
    this._unsubs.push(
      eventBus.on(Events.CLAUDE_CODE_HOTSPOT, ({ path, editCount }) => {
        if (editCount >= HOTSPOT_THRESHOLD && path && !this._suggestedHotspots.has(path)) {
          this._suggestedHotspots.add(path);
          this._suggestHotspotScan(path);
        }
      })
    );

    return this;
  }

  destroy() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  // --- Private ---

  _canSuggest() {
    return Date.now() - this._lastSuggestionAt > SUGGESTION_COOLDOWN_MS;
  }

  _suggestDiffScan(fileCount, writtenPaths) {
    if (!this._canSuggest()) return;
    this._lastSuggestionAt = Date.now();

    const template = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    eventBus.emit(Events.SNITCH_SCAN_SUGGESTED, {
      mode: 'diff',
      fileCount,
      writtenPaths: writtenPaths || [],
      cwd: this._currentCwd,
      projectName: this._currentProject,
      text: template.text(fileCount),
      tip: template.tip,
    });
  }

  _suggestHotspotScan(filePath) {
    if (!this._canSuggest()) return;
    this._lastSuggestionAt = Date.now();

    const fileName = filePath.split('/').pop();
    const template = HOTSPOT_MESSAGES[Math.floor(Math.random() * HOTSPOT_MESSAGES.length)];
    eventBus.emit(Events.SNITCH_SCAN_SUGGESTED, {
      mode: 'hotspot',
      filePath,
      cwd: this._currentCwd,
      projectName: this._currentProject,
      text: template.text(fileName),
      tip: template.tip,
    });
  }
}
