// Dr. Vibe - Tracked repos list (Settings → Tracking): pure helpers.

import { isIgnoredRepo } from '../features/activity/repoPaths.js';

/** "3d ago" style age for a time in ms; '' when unknown. */
export function formatAgo(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 24) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

/** Repos not ignored, most recently seen first, then by name. */
export function visibleRepos(repos, ignored) {
  return (repos || [])
    .filter(r => r?.path && !isIgnoredRepo(r.path, ignored))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) ||
      String(a.name).localeCompare(String(b.name)));
}

/** One-line summary of the list. */
export function trackedSummary(status, count) {
  if (!status) return 'Loading…';
  if (count === 0) return 'No repos tracked yet';
  return `${count} repo${count === 1 ? '' : 's'} tracked`;
}

/** Why a repo is tracked, and how many working trees are in use. */
export function repoTag(repo) {
  const why = { claude: 'Claude Code', folder: 'your folder', editor: 'open in editor' }[repo?.source] || '';
  const trees = repo?.worktrees?.length || 0;
  return trees > 1 ? `${why} · ${trees} worktrees` : why;
}
