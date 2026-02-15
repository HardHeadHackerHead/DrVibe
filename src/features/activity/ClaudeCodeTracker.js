// Dr. Vibe - Claude Code Integration Tracker
// Polls the JSONL event log written by Claude Code hooks and feeds
// file change / session events into the existing Dr. Vibe event pipeline.
// This gives Dr. Vibe precise knowledge of every file Claude Code touches.
//
// Detection features:
//   1. Hotspot File Commentary — quips when same file is edited 3+ times
//   2. Refactor Radar — reacts to read-to-write ratio patterns
//   5. Project Journey Narrator — natural language session summary
//   7. Bug Squash Detector — recognizes fix-test-fix cycles
//   8. New File Celebration — celebrates brand-new file creation
//   9. Session Stats Ticker — live stats for ambient display
//  10. Code Insights — commentary on directory exploration patterns

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';

const POLL_INTERVAL_MS = 3000;
const IDLE_TIMEOUT_MS = 60000;

// --- Hotspot thresholds ---
const HOTSPOT_THRESHOLDS = [3, 6, 10, 15, 25];
const HOTSPOT_QUIPS = [
  [
    '{file} again? That file is getting a workout!',
    'Back to {file}... this one needs attention, huh?',
    '{file} is popular today!',
    'Oh hey, {file} again! Third time\'s the charm.',
  ],
  [
    '6 edits to {file}... this one\'s putting up a fight!',
    '{file} just won\'t quit! 6 rounds and counting.',
    'You and {file} are really getting to know each other.',
  ],
  [
    '10 edits?! {file} is officially the star of this session.',
    '{file}: 10 edits deep. That\'s dedication.',
    'A whole 10 rounds with {file}. Respect.',
  ],
  [
    '15 edits to {file}! At this point it\'s a relationship.',
    '{file} — 15 edits. Are we refactoring or rewriting?',
  ],
  [
    '25 edits to {file}?! That file owes you dinner.',
    '{file}: 25 edits. You could probably recite it by heart.',
  ],
];

// --- Refactor Radar thresholds ---
const RADAR_COOLDOWN_MS = 120000; // 2 min between pattern comments

const RADAR_RESEARCH = [
  'Claude\'s studying your codebase... something big is brewing.',
  'Lots of reading, not much writing — research mode activated.',
  'Claude is doing recon across your files. A plan is forming.',
];

const RADAR_RAMPAGE = [
  'Whoa, {count} files changed — Claude\'s on a rampage!',
  '{count} files modified! Claude is rewriting the world.',
  'Mass edits detected — {count} files touched. Big moves!',
];

const RADAR_SURGICAL = [
  'One file in, one file out — surgical precision.',
  'Claude read the code, found the spot, made the fix. Clean.',
];

// --- Bug Squash quips ---
const BUG_SQUASH_QUIPS = [
  'Looks like you\'re squashing bugs! {count} fix cycles so far.',
  'Edit, test, repeat — {count} cycles in. Hang in there!',
  'Bug hunt mode: {count} fix-test cycles and counting.',
];

const BUG_FIXED_QUIPS = [
  'Tests passing! Looks like that bug is squashed.',
  'The fix-test cycle broke — in a good way! Bug defeated.',
  'Clean run after {count} cycles. Victory!',
];

// --- New File quips ---
const NEW_FILE_QUIPS = [
  'New file alert: {file} just entered the chat!',
  'Fresh code! {file} has been created.',
  '{file} is born! A new chapter begins.',
  'Look at that — {file} didn\'t exist a moment ago.',
];

// --- Code Insight quips ---
const INSIGHT_DEEP_DIVE = [
  'Claude just scanned {count} files in {dir} — deep dive mode!',
  '{count} files read from {dir}. Thorough investigation.',
];

const INSIGHT_CROSS_CUT = [
  'Cross-cutting changes across {count} directories — this is architectural work.',
  'Edits spanning {count} directories. Big picture stuff.',
  '{count} directories touched — this change has wide reach.',
];

// --- Session summary templates ---
const SUMMARY_TEMPLATES = [
  'Claude touched {files} file{s} this session — mostly {lang}. Heaviest work: {top} ({topCount} edits).',
  'This session: {files} file{s} changed, {reads} read. Top language: {lang}. Most edited: {top}.',
  'Session wrap-up: {files} file{s} modified across {dirs} director{ds}. Star file: {top} ({topCount} edits).',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function basename(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() || filePath;
}

function dirname(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  parts.pop();
  // Return last 2 segments for readability
  return parts.slice(-2).join('/') || '/';
}

function extToLang(filePath) {
  const ext = ('.' + filePath.split('.').pop()).toLowerCase();
  const map = {
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
    '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go',
    '.c': 'C', '.cpp': 'C++', '.h': 'C', '.hpp': 'C++',
    '.cs': 'C#', '.java': 'Java', '.kt': 'Kotlin',
    '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift',
    '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS',
    '.json': 'JSON', '.yaml': 'YAML', '.toml': 'TOML',
    '.sql': 'SQL', '.sh': 'Shell', '.ps1': 'PowerShell',
    '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart',
    '.md': 'Markdown', '.zig': 'Zig',
  };
  return map[ext] || null;
}

export class ClaudeCodeTracker {
  constructor() {
    this._offset = 0;
    this._pollTimer = null;
    this._lastEventTime = 0;
    this._isActive = false;
    this._currentSession = null;
    this._sessionFiles = new Map(); // path -> { reads, writes, lastTool }
    this._unsubscribers = [];

    // --- Feature: Hotspot tracking ---
    this._hotspotAlerted = new Map(); // path -> last threshold index alerted

    // --- Feature: Refactor Radar ---
    this._recentReads = 0;
    this._recentWrites = 0;
    this._radarWindowStart = 0;
    this._lastRadarAlert = 0;

    // --- Feature: Bug Squash Detector ---
    this._eventSequence = []; // recent event types: 'file_changed' | 'command_run'
    this._fixCycleCount = 0;
    this._lastFixCycleAlert = 0;
    this._lastCommandWasClean = false; // command_run not followed by file_changed

    // --- Feature: New File Celebration ---
    this._lastNewFileAlert = 0;

    // --- Feature: Code Insights ---
    this._dirReads = new Map();  // dir -> count (within window)
    this._dirWrites = new Map(); // dir -> count (within window)
    this._lastInsightAlert = 0;
    this._insightWindowStart = 0;
  }

  async init() {
    const saved = db.getSection('claudeCode');
    if (saved) {
      this._offset = saved.offset || 0;
    }

    this._startPolling();
    console.log('ClaudeCodeTracker initialized');
  }

  destroy() {
    this._stopPolling();
    this._saveState();
    for (const unsub of this._unsubscribers) unsub();
  }

  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    this._poll();
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _poll() {
    const result = await tauri.readClaudeCodeEvents(this._offset);
    if (!result) return;

    if (result.events.length > 0) {
      this._offset = result.new_offset;

      for (const event of result.events) {
        this._processEvent(event);
      }

      // After processing a batch, run pattern detectors
      this._checkRefactorRadar();
      this._checkCodeInsights();

      this._scheduleSave();
    }

    if (this._isActive && Date.now() - this._lastEventTime > IDLE_TIMEOUT_MS) {
      this._setActive(false);
    }
  }

  _processEvent(event) {
    this._lastEventTime = event.ts || Date.now();

    switch (event.event) {
      case 'session_start':
        this._onSessionStart(event);
        break;
      case 'session_end':
        this._onSessionEnd(event);
        break;
      case 'file_changed':
        this._onFileChanged(event);
        break;
      case 'file_read':
        this._onFileRead(event);
        break;
      case 'command_run':
        this._onCommandRun(event);
        break;
      case 'response_complete':
        this._setActive(true);
        break;
    }
  }

  // =========================================================================
  // Core event handlers
  // =========================================================================

  _onSessionStart(event) {
    this._currentSession = {
      id: event.session,
      cwd: event.cwd,
      startedAt: event.ts,
    };
    this._resetSessionState();
    this._setActive(true);

    const projectName = this._projectNameFromPath(event.cwd);

    eventBus.emit(Events.CLAUDE_CODE_SESSION_START, {
      sessionId: event.session,
      cwd: event.cwd,
      projectName,
    });

    if (event.cwd) {
      eventBus.emit(Events.PROJECT_DETECTED, {
        name: projectName,
        path: event.cwd,
        source: 'claude_code',
        projectType: null,
        typeInfo: null,
        detectedAt: Date.now(),
      });
    }

    console.log(`Claude Code session started: ${projectName} (${event.cwd})`);
  }

  _onSessionEnd(event) {
    // Feature 5: Project Journey Narrator — emit summary
    const summary = this._buildNarrativeSummary();
    if (summary) {
      eventBus.emit(Events.CLAUDE_CODE_SUMMARY, { text: summary, ...this._getSessionSummary() });
    }

    eventBus.emit(Events.CLAUDE_CODE_SESSION_END, {
      sessionId: this._currentSession?.id,
      ...this._getSessionSummary(),
    });

    this._currentSession = null;
    this._setActive(false);
  }

  _onFileChanged(event) {
    this._setActive(true);

    // Track the file
    const fileInfo = this._trackFile(event.file, 'write', event.tool);

    // Feature 8: New File Celebration
    if (fileInfo.writes === 1 && fileInfo.reads === 0) {
      this._onNewFileCreated(event.file);
    }

    // Feature 1: Hotspot detection
    this._checkHotspot(event.file, fileInfo.writes);

    // Feature 7: Bug Squash — track sequence
    this._pushEventSequence('file_changed');

    // Feature 2: Refactor Radar — count writes
    this._recentWrites++;

    // Feature 10: Code Insights — track dir writes
    const dir = dirname(event.file);
    this._dirWrites.set(dir, (this._dirWrites.get(dir) || 0) + 1);

    // Emit standard events
    eventBus.emit(Events.CLAUDE_CODE_FILE_CHANGED, {
      path: event.file,
      tool: event.tool,
      sessionId: event.session,
      cwd: event.cwd,
    });

    eventBus.emit('file-changed-synthetic', {
      event_type: 'modify',
      path: event.file,
      timestamp: event.ts,
      source: 'claude_code',
    });
  }

  _onFileRead(event) {
    this._setActive(true);
    this._trackFile(event.file, 'read', event.tool);

    // Feature 2: Refactor Radar — count reads
    this._recentReads++;

    // Feature 10: Code Insights — track dir reads
    const dir = dirname(event.file);
    this._dirReads.set(dir, (this._dirReads.get(dir) || 0) + 1);

    eventBus.emit(Events.CLAUDE_CODE_FILE_READ, {
      path: event.file,
      sessionId: event.session,
      cwd: event.cwd,
    });
  }

  _onCommandRun(event) {
    this._setActive(true);

    // Feature 7: Bug Squash — track sequence
    this._pushEventSequence('command_run');

    eventBus.emit(Events.CLAUDE_CODE_COMMAND_RUN, {
      sessionId: event.session,
      cwd: event.cwd,
    });
  }

  // =========================================================================
  // Feature 1: Hotspot File Commentary
  // =========================================================================

  _checkHotspot(filePath, writeCount) {
    const lastIndex = this._hotspotAlerted.get(filePath) ?? -1;

    for (let i = 0; i < HOTSPOT_THRESHOLDS.length; i++) {
      if (writeCount >= HOTSPOT_THRESHOLDS[i] && i > lastIndex) {
        this._hotspotAlerted.set(filePath, i);
        const quip = pick(HOTSPOT_QUIPS[i]).replace('{file}', basename(filePath));
        eventBus.emit(Events.CLAUDE_CODE_HOTSPOT, {
          path: filePath,
          editCount: writeCount,
          text: quip,
        });
        break;
      }
    }
  }

  // =========================================================================
  // Feature 2: Refactor Radar
  // =========================================================================

  _checkRefactorRadar() {
    const now = Date.now();

    // Reset window every 60 seconds
    if (now - this._radarWindowStart > 60000) {
      this._analyzeRadarWindow();
      this._recentReads = 0;
      this._recentWrites = 0;
      this._radarWindowStart = now;
    }
  }

  _analyzeRadarWindow() {
    const now = Date.now();
    if (now - this._lastRadarAlert < RADAR_COOLDOWN_MS) return;
    if (this._recentReads === 0 && this._recentWrites === 0) return;

    const total = this._recentReads + this._recentWrites;
    if (total < 5) return; // Need enough activity to say something

    const readRatio = this._recentReads / total;
    const writeRatio = this._recentWrites / total;

    let text = null;
    let pattern = null;

    if (readRatio > 0.75 && this._recentReads >= 5) {
      // Heavy reading — research mode
      text = pick(RADAR_RESEARCH);
      pattern = 'research';
    } else if (writeRatio > 0.7 && this._recentWrites >= 5) {
      // Heavy writing — rampage mode
      text = pick(RADAR_RAMPAGE).replace('{count}', this._recentWrites);
      pattern = 'rampage';
    } else if (this._recentReads >= 3 && this._recentWrites <= 2 && this._recentWrites >= 1) {
      // Surgical — lots of reading, few writes
      text = pick(RADAR_SURGICAL);
      pattern = 'surgical';
    }

    if (text) {
      this._lastRadarAlert = now;
      eventBus.emit(Events.CLAUDE_CODE_PATTERN, {
        pattern,
        reads: this._recentReads,
        writes: this._recentWrites,
        text,
      });
    }
  }

  // =========================================================================
  // Feature 5: Project Journey Narrator
  // =========================================================================

  _buildNarrativeSummary() {
    const summary = this._getSessionSummary();
    if (summary.filesWritten === 0) return null;

    // Find top edited file
    let topFile = null;
    let topCount = 0;
    for (const [path, info] of this._sessionFiles) {
      if (info.writes > topCount) {
        topFile = path;
        topCount = info.writes;
      }
    }

    // Detect top language
    const langCounts = {};
    for (const [path, info] of this._sessionFiles) {
      if (info.writes > 0) {
        const lang = extToLang(path);
        if (lang) langCounts[lang] = (langCounts[lang] || 0) + info.writes;
      }
    }
    const topLang = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed';

    // Count directories
    const dirs = new Set();
    for (const [path] of this._sessionFiles) {
      dirs.add(dirname(path));
    }

    const template = pick(SUMMARY_TEMPLATES);
    return template
      .replace('{files}', summary.filesWritten)
      .replace('{s}', summary.filesWritten === 1 ? '' : 's')
      .replace('{reads}', summary.filesRead)
      .replace('{lang}', topLang)
      .replace('{top}', topFile ? basename(topFile) : 'unknown')
      .replace('{topCount}', topCount)
      .replace('{dirs}', dirs.size)
      .replace('{ds}', dirs.size === 1 ? 'y' : 'ies');
  }

  // =========================================================================
  // Feature 7: Bug Squash Detector
  // =========================================================================

  _pushEventSequence(type) {
    this._eventSequence.push({ type, time: Date.now() });
    // Keep only last 20 events
    if (this._eventSequence.length > 20) {
      this._eventSequence.shift();
    }

    this._checkBugSquashCycle();
  }

  _checkBugSquashCycle() {
    const seq = this._eventSequence;
    if (seq.length < 2) return;

    const last = seq[seq.length - 1];
    const prev = seq[seq.length - 2];
    const now = Date.now();

    // Detect: command_run -> file_changed -> command_run (fix cycle)
    if (last.type === 'command_run' && prev.type === 'file_changed') {
      // Check there was a command_run before the file_changed
      let foundPriorCommand = false;
      for (let i = seq.length - 3; i >= 0; i--) {
        if (seq[i].type === 'command_run') {
          // Make sure it's within 5 minutes
          if (now - seq[i].time < 300000) {
            foundPriorCommand = true;
          }
          break;
        }
      }

      if (foundPriorCommand) {
        this._fixCycleCount++;

        if (now - this._lastFixCycleAlert > 30000) { // Max one alert per 30s
          this._lastFixCycleAlert = now;
          const text = pick(BUG_SQUASH_QUIPS).replace('{count}', this._fixCycleCount);
          eventBus.emit(Events.CLAUDE_CODE_FIX_CYCLE, {
            cycleCount: this._fixCycleCount,
            text,
          });
        }
        this._lastCommandWasClean = false;
      }
    }

    // Detect: command_run NOT followed by file_changed (bug fixed!)
    if (last.type === 'command_run' && this._fixCycleCount >= 2) {
      // Set flag — if next event is NOT file_changed, it's a clean run
      this._lastCommandWasClean = true;
    } else if (last.type === 'file_changed' && this._lastCommandWasClean) {
      // Nope, more edits — not fixed yet
      this._lastCommandWasClean = false;
    }

    // Check for clean run after a delay (on next response_complete or command_run)
    if (last.type === 'command_run' && this._lastCommandWasClean && this._fixCycleCount >= 2) {
      // Look back — if the previous command_run was followed by no file_changed
      // and we're now at another command_run, celebrate
      const text = pick(BUG_FIXED_QUIPS).replace('{count}', this._fixCycleCount);
      eventBus.emit(Events.CLAUDE_CODE_BUG_FIXED, {
        cycleCount: this._fixCycleCount,
        text,
      });
      this._fixCycleCount = 0;
      this._lastCommandWasClean = false;
    }
  }

  // =========================================================================
  // Feature 8: New File Celebration
  // =========================================================================

  _onNewFileCreated(filePath) {
    const now = Date.now();
    // Throttle: max one celebration per 10 seconds
    if (now - this._lastNewFileAlert < 10000) return;
    this._lastNewFileAlert = now;

    const text = pick(NEW_FILE_QUIPS).replace('{file}', basename(filePath));
    eventBus.emit(Events.CLAUDE_CODE_FILE_CREATED, {
      path: filePath,
      text,
    });
  }

  // =========================================================================
  // Feature 10: Code Insights
  // =========================================================================

  _checkCodeInsights() {
    const now = Date.now();

    // Analyze every 90 seconds
    if (now - this._insightWindowStart < 90000) return;
    this._insightWindowStart = now;

    if (now - this._lastInsightAlert < 300000) return; // Max once per 5 min

    // Deep dive: many reads in one directory
    for (const [dir, count] of this._dirReads) {
      if (count >= 8) {
        this._lastInsightAlert = now;
        const text = pick(INSIGHT_DEEP_DIVE)
          .replace('{count}', count)
          .replace('{dir}', dir);
        eventBus.emit(Events.CLAUDE_CODE_INSIGHT, { pattern: 'deep_dive', dir, count, text });
        break;
      }
    }

    // Cross-cutting: writes across many directories
    if (now > this._lastInsightAlert) {
      const writeDirs = [...this._dirWrites.keys()].filter(d => this._dirWrites.get(d) >= 1);
      if (writeDirs.length >= 4) {
        this._lastInsightAlert = now;
        const text = pick(INSIGHT_CROSS_CUT).replace('{count}', writeDirs.length);
        eventBus.emit(Events.CLAUDE_CODE_INSIGHT, { pattern: 'cross_cutting', count: writeDirs.length, text });
      }
    }

    // Reset window counters
    this._dirReads.clear();
    this._dirWrites.clear();
  }

  // =========================================================================
  // Core helpers
  // =========================================================================

  _trackFile(filePath, action, tool) {
    if (!this._sessionFiles.has(filePath)) {
      this._sessionFiles.set(filePath, { reads: 0, writes: 0, lastTool: null });
    }
    const info = this._sessionFiles.get(filePath);
    if (action === 'read') info.reads++;
    else info.writes++;
    info.lastTool = tool;
    return info;
  }

  _setActive(active) {
    if (active === this._isActive) return;
    this._isActive = active;

    if (active) {
      eventBus.emit(Events.CLAUDE_CODE_ACTIVE, {
        sessionId: this._currentSession?.id,
        cwd: this._currentSession?.cwd,
      });
    } else {
      eventBus.emit(Events.CLAUDE_CODE_IDLE, {
        sessionId: this._currentSession?.id,
      });
    }
  }

  _resetSessionState() {
    this._sessionFiles.clear();
    this._hotspotAlerted.clear();
    this._recentReads = 0;
    this._recentWrites = 0;
    this._radarWindowStart = Date.now();
    this._eventSequence = [];
    this._fixCycleCount = 0;
    this._lastCommandWasClean = false;
    this._dirReads.clear();
    this._dirWrites.clear();
    this._insightWindowStart = Date.now();
  }

  _projectNameFromPath(dirPath) {
    if (!dirPath) return 'Unknown';
    const normalized = dirPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Unknown';
  }

  _getSessionSummary() {
    let filesWritten = 0;
    let filesRead = 0;
    const writtenPaths = [];
    const readPaths = [];

    for (const [path, info] of this._sessionFiles) {
      if (info.writes > 0) {
        filesWritten++;
        writtenPaths.push(path);
      }
      if (info.reads > 0) {
        filesRead++;
        readPaths.push(path);
      }
    }

    return { filesWritten, filesRead, writtenPaths, readPaths };
  }

  // --- Public API ---

  isActive() {
    return this._isActive;
  }

  getCurrentSession() {
    return this._currentSession;
  }

  getSessionFiles() {
    return Object.fromEntries(this._sessionFiles);
  }

  getStats() {
    return {
      isActive: this._isActive,
      session: this._currentSession,
      fixCycles: this._fixCycleCount,
      ...this._getSessionSummary(),
    };
  }

  // --- Persistence ---

  _savePending = false;

  _scheduleSave() {
    if (this._savePending) return;
    this._savePending = true;
    setTimeout(() => {
      this._savePending = false;
      this._saveState();
    }, 10000);
  }

  _saveState() {
    db.setSection('claudeCode', {
      offset: this._offset,
    });
  }
}
