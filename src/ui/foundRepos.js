// Dr. Vibe - Found repos list (Settings → Tracking): pure helpers.

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

/** Repos not ignored, most recently committed first, then by name. */
export function visibleRepos(repos, ignored) {
  return (repos || [])
    .filter(r => r?.path && !isIgnoredRepo(r.path, ignored))
    .sort((a, b) => (b.lastCommit || 0) - (a.lastCommit || 0) ||
      String(a.name).localeCompare(String(b.name)));
}

/** One-line summary: how many, when, and whether a limit cut it short. */
export function scanSummary(status, count, now = Date.now()) {
  if (status?.scanning) return 'Scanning…';
  if (!status?.lastScanTime) return 'Not scanned yet';
  const parts = [`${count} repo${count === 1 ? '' : 's'} found`, `last scan ${formatAgo(status.lastScanTime, now)}`];
  if (status.stats?.truncated) parts.push('stopped at the repo limit');
  else if (status.stats?.timedOut) parts.push('stopped at the time limit');
  return parts.join(' · ');
}
