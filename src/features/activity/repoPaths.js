// Dr. Vibe - Path helpers shared by TrackedRepos, GitTracker and Settings.
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
