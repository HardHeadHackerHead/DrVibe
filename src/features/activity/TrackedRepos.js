// Dr. Vibe - Tracked repos
// The git repos GitTracker polls for commits and the momentum meter watches
// for file changes. A repo is tracked because Claude Code works in it (a
// session starts there, or Claude writes or edits a file there) while "Track
// repos Claude Code works in" is on, or because it's in a folder the user
// added in Settings → Tracking. The project open in an editor is tracked too
// while it's open (never remembered). Rust's resolve_repo turns each path into its
// repo: a subfolder or file maps to the repo root, a linked worktree to its
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
    this.editorRepo = null;      // { name, path, worktrees }: the editor's project, this run
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
        if (project?.path && project.source !== 'claude_code') this.noteEditorPath(project.path).catch(() => {});
      }),
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

  /** An editor has the project in folder `dir` open: track its repo this run. */
  async noteEditorPath(dir) {
    const repo = await this._resolve(dir);
    if (!repo) return null;
    const next = { name: repo.name, path: repo.root, worktrees: [repo.worktree] };
    if (JSON.stringify(next) !== JSON.stringify(this.editorRepo)) {
      this.editorRepo = next;
      this._emit();
    }
    return repo;
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
    if (this.editorRepo) mergeRepo(all, { ...this.editorRepo, source: 'editor' });
    const ignored = this._ignored();
    return all.filter(r => !isIgnoredRepo(r.path, ignored));
  }

  /** Snapshot for Settings → Tracking. */
  getStatus() {
    return { trackClaude: this._trackClaude(), repos: this.getRepos() };
  }

  // --- Private ---

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
