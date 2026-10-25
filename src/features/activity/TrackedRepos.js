// Dr. Vibe - Tracked repos
// The git repos GitTracker polls for commits and the momentum meter watches
// for file changes. A repo is tracked because Claude Code works in it (a
// session starts there, or Claude writes or edits a file there) while "Track
// repos Claude Code works in" is on, or because it's in a folder the user
// added in Settings → Tracking. The project open in an editor is tracked too,
// only while the person is using that editor (see editorInUse; never
// remembered). Rust's resolve_repo turns each path into its repo: a subfolder or file maps to the repo root, a linked worktree to its
// main repo, and temp, app-data and system places are refused. Claude's repos
// are remembered across restarts. Paths never leave this computer.

import { eventBus, Events } from '../../core/EventBus.js';
import { tauri } from '../../core/TauriBridge.js';
import { db } from '../../core/Database.js';
import { repoKey, isIgnoredRepo } from './repoPaths.js';
import { migrateRepoScan } from './repoMigration.js';

const SECTION = 'trackedRepos';
const MAX_REMEMBERED = 200;
// A remembered repo's "last seen" is saved at most this often.
const LAST_SEEN_SAVE_MS = 60 * 60 * 1000;

// The editor's repo counts while the editor was in front within the last 2
// minutes and there was keyboard or mouse input within the last 2 minutes.
// Long enough for a look at the docs in a browser or a pause to read and
// think; short enough that a minimized editor, a game or a walk away stops
// counting within about two minutes.
export const EDITOR_FOREGROUND_GRACE_MS = 2 * 60 * 1000;
export const EDITOR_INPUT_GRACE_MS = 2 * 60 * 1000;
// How often input is checked while an editor repo is known.
const EDITOR_CHECK_MS = 15 * 1000;

/**
 * Whether the person is using the editor: it's in front (or left the front
 * less than EDITOR_FOREGROUND_GRACE_MS ago) and the last input is recent.
 * `lastInputAt` null means the OS can't tell; then the window alone decides.
 */
export function editorInUse({ foreground, leftAt, lastInputAt, now }) {
  const inFront = foreground || (leftAt != null && now - leftAt <= EDITOR_FOREGROUND_GRACE_MS);
  const recentInput = lastInputAt == null || now - lastInputAt <= EDITOR_INPUT_GRACE_MS;
  return inFront && recentInput;
}

/** Same app, ignoring case and a trailing .exe. */
function sameApp(a, b) {
  const norm = (x) => String(x || '').toLowerCase().replace(/\.exe$/, '');
  return !!a && !!b && norm(a) === norm(b);
}

/** Folder holding a file. */
export function parentDir(path) {
  const trimmed = String(path).replace(/[/\\]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

/**
 * Adds `repo` ({ name, path, worktrees, ... }) to `list`, or merges its
 * worktrees and last-seen time into the entry for the same repo.
 * Returns the entry and whether anything but the time changed.
 */
function mergeRepo(list, repo) {
  const key = repoKey(repo.path);
  const have = list.find(r => repoKey(r.path) === key);
  if (!have) {
    const entry = { ...repo, worktrees: [...(repo.worktrees || [])] };
    list.push(entry);
    return { entry, changed: true };
  }
  let changed = false;
  for (const w of repo.worktrees || []) {
    if (!have.worktrees.some(x => repoKey(x) === repoKey(w))) {
      have.worktrees.push(w);
      changed = true;
    }
  }
  if ((repo.lastSeen || 0) > (have.lastSeen || 0)) have.lastSeen = repo.lastSeen;
  return { entry: have, changed };
}

export class TrackedRepos {
  constructor(settings) {
    this.settings = settings;
    this.claudeRepos = [];       // [{ name, path, worktrees, lastSeen }], remembered
    this.folderRepos = [];       // [{ name, path, worktrees }] from the user's folders
    this.editor = null;          // { repo, app, foreground, leftAt }: the editor's project, this run
    this.editorActive = false;   // editorInUse() at the last check
    this._lastInputAt = null;    // ms; null when the OS can't tell
    this._lastCursor = null;     // fallback input signal: cursor position
    this._editorTimer = null;
    this._now = () => Date.now();
    this._resolved = new Map();  // folder key → Promise<repo | null | undefined>, this run
    this._lastSeenSaved = 0;
    this._foldersRun = 0;
    this._unsubscribers = [];
  }

  async init() {
    let saved = db.getSection(SECTION);
    if (!saved) {
      saved = await migrateRepoScan({
        settings: this.settings,
        db,
        untrackedPlaces: (paths) => tauri.untrackedPlaces(paths),
      });
    }
    if (Array.isArray(saved?.repos)) this.claudeRepos = saved.repos;
    console.log(`TrackedRepos: ${this.claudeRepos.length} repos remembered from Claude Code`);
    this._emit();

    this._unsubscribers.push(
      eventBus.on(Events.CLAUDE_CODE_SESSION_START, ({ cwd }) => {
        if (cwd) this.noteClaudePath(cwd).catch(() => {});
      }),
      eventBus.on(Events.CLAUDE_CODE_FILE_CHANGED, ({ path }) => {
        if (path) this.noteClaudePath(parentDir(path)).catch(() => {});
      }),
      eventBus.on(Events.PROJECT_DETECTED, (project) => {
        if (project?.path && project.source !== 'claude_code') {
          this.noteEditorPath(project.path, project.appName).catch(() => {});
        }
      }),
      // Which app is in front: ActivityMonitor reports coding/not-coding
      // switches and window changes between coding apps
      eventBus.on(Events.ACTIVITY_CHANGED, ({ appName }) => this.noteForegroundApp(appName)),
      eventBus.on(Events.ACTIVITY_WINDOW_CHANGED, ({ appName }) => this.noteForegroundApp(appName)),
      eventBus.on(Events.SETTINGS_CHANGED, ({ key }) => {
        if (key === 'projectFolders') {
          this.refreshFolders().catch(e => console.error('TrackedRepos: folder refresh failed:', e));
        } else if (key === 'trackClaudeRepos' || key === 'ignoredRepos') {
          this._emit();
        }
      }),
    );

    // Off the startup path: both ask git about each repo.
    this.refreshFolders().catch(e => console.error('TrackedRepos: folder refresh failed:', e));
    this.recheckRemembered().catch(e => console.error('TrackedRepos: recheck failed:', e));
  }

  destroy() {
    this._stopEditorTimer();
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  /**
   * Claude Code is working in folder `dir`: track the repo it's in. Returns
   * the repo ({ name, root, worktree }) or null when it isn't tracked.
   */
  async noteClaudePath(dir) {
    if (!this._trackClaude()) return null;
    const repo = await this._resolve(dir);
    if (!repo || !this._trackClaude()) return null;

    const now = Date.now();
    const { entry, changed } = mergeRepo(this.claudeRepos, {
      name: repo.name, path: repo.root, worktrees: [repo.worktree], lastSeen: now,
    });
    entry.lastSeen = now;
    if (changed) {
      console.log(`TrackedRepos: tracking "${entry.name}" (Claude Code worked in ${repo.worktree})`);
      this._trim();
      this._save();
      this._emit();
    } else if (now - this._lastSeenSaved > LAST_SEEN_SAVE_MS) {
      this._save();
    }
    return repo;
  }

  /**
   * The editor `app` (in front right now) has the project in folder `dir`
   * open: its repo is tracked while the person keeps using that editor.
   */
  async noteEditorPath(dir, app = null) {
    const repo = await this._resolve(dir);
    if (!repo) {
      this.editor = null;
      this._stopEditorTimer();
      this._updateEditorActive();
      return null;
    }
    const wasActive = this.editorActive;
    this.editor = {
      repo: { name: repo.name, path: repo.root, worktrees: [repo.worktree] },
      app,
      foreground: true,
      leftAt: null,
    };
    this._startEditorTimer();
    await this.checkEditor();
    // Another project while it stayed in use: the list still changed
    if (wasActive && this.editorActive) this._emit();
    return repo;
  }

  /** `app` is now the window in front. */
  noteForegroundApp(app) {
    if (!this.editor) return;
    const inFront = this.editor.app ? sameApp(app, this.editor.app) : this.editor.foreground;
    if (this.editor.foreground && !inFront) this.editor.leftAt = this._now();
    const cameBack = inFront && !this.editor.foreground;
    this.editor.foreground = inFront;
    if (cameBack) this.checkEditor().catch(() => {});
    else this._updateEditorActive();
  }

  /** Reads the last input time and updates whether the editor counts. */
  async checkEditor() {
    if (!this.editor) return;
    const age = await tauri.lastInputAgeMs();
    const now = this._now();
    if (typeof age === 'number') {
      this._lastInputAt = now - age;
    } else {
      // No idle time from the OS: a moving cursor is input
      const pos = await tauri.getCursorPosition();
      if (Array.isArray(pos)) {
        const moved = !this._lastCursor || pos[0] !== this._lastCursor[0] || pos[1] !== this._lastCursor[1];
        if (moved) this._lastInputAt = now;
        this._lastCursor = pos;
      }
    }
    this._updateEditorActive();
  }

  /**
   * Asks git about every remembered repo again: worktrees that are gone (or
   * now in a place never tracked) are dropped, and each is filed under the
   * repo it belongs to today.
   */
  async recheckRemembered() {
    const checked = this.claudeRepos;
    const next = [];
    for (const repo of checked) {
      for (const worktree of repo.worktrees || []) {
        const found = await tauri.resolveRepo(worktree);
        if (found === null) continue;
        mergeRepo(next, found
          ? { name: found.name, path: found.root, worktrees: [found.worktree], lastSeen: repo.lastSeen }
          : { ...repo, worktrees: [worktree] });
      }
    }
    // Repos Claude worked in while this ran
    for (const repo of this.claudeRepos) {
      if (!checked.includes(repo)) mergeRepo(next, repo);
    }
    if (JSON.stringify(next) === JSON.stringify(this.claudeRepos)) return;
    console.log(`TrackedRepos: ${this.claudeRepos.length} remembered repos rechecked, ${next.length} kept`);
    this.claudeRepos = next;
    this._save();
    this._emit();
  }

  /** Re-reads the repos in the user's folders. */
  async refreshFolders() {
    const run = ++this._foldersRun;
    const next = [];
    for (const folder of this._folders()) {
      for (const r of await tauri.findFolderRepos(folder)) {
        mergeRepo(next, { name: r.name, path: r.root, worktrees: [r.worktree] });
      }
    }
    if (run !== this._foldersRun) return; // a newer refresh is running
    this.folderRepos = next;
    this._emit();
  }

  /**
   * Repos to track ({ name, path, worktrees, source, lastSeen? }): Claude's
   * (while the setting is on), the user's folders' and the editor's, minus
   * ignored ones.
   * `path` is the main repo; `worktrees` the working trees in use.
   */
  getRepos() {
    const all = [];
    if (this._trackClaude()) {
      for (const r of this.claudeRepos) mergeRepo(all, { ...r, source: 'claude' });
    }
    for (const r of this.folderRepos) mergeRepo(all, { ...r, source: 'folder' });
    if (this.editor && this.editorActive) mergeRepo(all, { ...this.editor.repo, source: 'editor' });
    const ignored = this._ignored();
    return all.filter(r => !isIgnoredRepo(r.path, ignored));
  }

  /** Snapshot for Settings → Tracking. */
  getStatus() {
    return { trackClaude: this._trackClaude(), repos: this.getRepos() };
  }

  // --- Private ---

  _updateEditorActive() {
    const active = !!this.editor && editorInUse({
      foreground: this.editor.foreground,
      leftAt: this.editor.leftAt,
      lastInputAt: this._lastInputAt,
      now: this._now(),
    });
    if (active === this.editorActive) return;
    this.editorActive = active;
    console.log(`TrackedRepos: editor project ${active ? `"${this.editor.repo.name}" in use` : 'not in use'}`);
    this._emit();
  }

  _startEditorTimer() {
    if (this._editorTimer) return;
    this._editorTimer = setInterval(() => this.checkEditor().catch(() => {}), EDITOR_CHECK_MS);
  }

  _stopEditorTimer() {
    if (this._editorTimer) clearInterval(this._editorTimer);
    this._editorTimer = null;
  }

  /** The repo folder `dir` is in, asked once per folder; null when untracked or ignored. */
  async _resolve(dir) {
    if (isIgnoredRepo(dir, this._ignored())) return null;
    const key = repoKey(dir);
    if (!this._resolved.has(key)) this._resolved.set(key, tauri.resolveRepo(dir));
    const repo = await this._resolved.get(key);
    if (repo === undefined) this._resolved.delete(key); // Rust couldn't be asked; ask again later
    const ignored = this._ignored();
    if (!repo || isIgnoredRepo(repo.root, ignored) || isIgnoredRepo(repo.worktree, ignored)) return null;
    return repo;
  }

  _trackClaude() {
    return this.settings?.get('trackClaudeRepos') !== false;
  }

  _folders() {
    const folders = this.settings?.get('projectFolders');
    return Array.isArray(folders) ? folders : [];
  }

  _ignored() {
    const ignored = this.settings?.get('ignoredRepos');
    return Array.isArray(ignored) ? ignored : [];
  }

  /** Keeps the most recently seen repos. */
  _trim() {
    if (this.claudeRepos.length <= MAX_REMEMBERED) return;
    this.claudeRepos = [...this.claudeRepos]
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, MAX_REMEMBERED);
  }

  _emit() {
    eventBus.emit(Events.REPOS_CHANGED, { repos: this.getRepos() });
  }

  _save() {
    this._lastSeenSaved = Date.now();
    db.setSection(SECTION, { repos: this.claudeRepos });
  }
}
