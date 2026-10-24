// Dr. Vibe - Path helpers shared by the repo scanner, GitTracker and Settings.
// Windows paths compare case-insensitively and with either slash.

/** Comparison key: forward slashes, no trailing slash, lowercase on Windows paths. */
export function repoKey(path) {
  if (!path) return '';
  const unified = String(path).replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^[a-z]:/i.test(unified) ? unified.toLowerCase() : unified;
}

/** True when `path` is `root` or somewhere inside it. */
export function isInside(path, root) {
  const p = repoKey(path);
  const r = repoKey(root);
  if (!p || !r) return false;
  return p === r || p.startsWith(r.endsWith('/') ? r : `${r}/`);
}

/** True when `path` is an ignored repo or inside one. */
export function isIgnoredRepo(path, ignored) {
  return Array.isArray(ignored) && ignored.some(root => isInside(path, root));
}

/** Folder name at the end of a path. */
export function repoName(path) {
  const parts = String(path || '').split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] || String(path || '');
}

/**
 * Folder to add to projectFolders when a Claude Code session starts in `cwd`:
 * its parent, so sibling projects get file watching after a restart. Only
 * with "Find my repos automatically" on. Returns { folder } or { skip }.
 */
export function claudeFolderToAutoAdd(cwd, { autoDetect, projectFolders = [], ignored = [] }) {
  if (!cwd) return { skip: 'no-cwd' };
  if (!autoDetect) return { skip: 'auto-detect-off' };
  if (isIgnoredRepo(cwd, ignored)) return { skip: 'ignored' };
  // Collapse any double-backslash sequences that may have leaked in from
  // older hook versions, then strip trailing separators.
  const cleaned = cwd.replace(/\\{2,}/g, '\\').replace(/[/\\]+$/, '');
  const parent = cleaned.replace(/[/\\][^/\\]+$/, '') || cleaned;
  // Reject parents too shallow to be a real project root: anything at or
  // above `C:\Users\<name>` on Windows or a 2-segment path on POSIX.
  if (parent.split(/[/\\]+/).filter(Boolean).length < 3) return { skip: 'too-shallow' };
  if (/\\{2,}/.test(parent)) return { skip: 'malformed' };
  if (projectFolders.includes(parent)) return { skip: 'already-added' };
  return { folder: parent };
}
