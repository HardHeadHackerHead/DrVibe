// Dr. Vibe - One-time move from the 2.0.x repo scan to tracked repos.
// 2.0.0 and 2.0.1 scanned every drive for repos (the repoScan section) and
// added the parent folder of each Claude Code session to projectFolders,
// which pulled in the temp folder and app data. This keeps what the user
// chose or worked in: folders that are real project places, and repos
// remembered from Claude Code or editor work. It drops scanned repos, and
// folders in temp, app-data or system places or at or above the home folder.
// It runs when the trackedRepos section doesn't exist yet, and writes it.

import { repoKey, repoName } from './repoPaths.js';

/**
 * `settings` has get/set, `db` getSection/setSection, and
 * `untrackedPlaces(paths)` resolves to one boolean per path (true = never
 * tracked) or null when it can't be asked. Returns the new trackedRepos
 * section, or null when it couldn't run (it runs again next launch).
 */
export async function migrateRepoScan({ settings, db, untrackedPlaces }) {
  const scan = db.getSection('repoScan');
  // Read before any settings.set(), which saves without this retired key
  const foldersOnly = db.getSection('settings')?.autoDetectRepos === false;
  const savedFolders = settings.get('projectFolders');
  const folders = Array.isArray(savedFolders) ? savedFolders.filter(f => typeof f === 'string' && f.trim()) : [];
  const remembered = [
    ...(Array.isArray(scan?.remembered) ? scan.remembered : []),
    ...(Array.isArray(scan?.repos) ? scan.repos.filter(r => r?.source === 'detected') : []),
  ].filter(r => typeof r?.path === 'string' && r.path.trim());

  const paths = [...folders, ...remembered.map(r => r.path)];
  let untracked = [];
  if (paths.length > 0) {
    untracked = await untrackedPlaces(paths);
    if (!Array.isArray(untracked) || untracked.length !== paths.length) return null;
  }

  const keptFolders = [];
  folders.forEach((folder, i) => {
    if (!untracked[i] && !keptFolders.some(f => repoKey(f) === repoKey(folder))) keptFolders.push(folder);
  });
  const repos = [];
  remembered.forEach((r, i) => {
    if (untracked[folders.length + i] || repos.some(x => repoKey(x.path) === repoKey(r.path))) return;
    repos.push({ name: r.name || repoName(r.path), path: r.path, worktrees: [r.path], lastSeen: 0 });
  });

  if (keptFolders.length !== (Array.isArray(savedFolders) ? savedFolders.length : 0)) {
    settings.set('projectFolders', keptFolders);
  }
  // "Find my repos automatically" off meant: only the folders I picked.
  if (foldersOnly) settings.set('trackClaudeRepos', false);
  if (scan) db.setSection('repoScan', null);

  const section = { repos };
  db.setSection('trackedRepos', section);
  const scanned = Array.isArray(scan?.repos) ? scan.repos.filter(r => r?.source === 'scan').length : 0;
  console.log(`Repo tracking: kept ${repos.length} remembered repos and ${keptFolders.length} of ` +
    `${folders.length} project folders; dropped ${scanned} scanned repos`);
  return section;
}
