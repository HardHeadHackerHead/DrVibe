// Dr. Vibe - One-time move from the 2.0.x repo scan to tracked repos.
// 2.0.1 scanned every drive for repos (the repoScan section), and 2.0.x
// added the parent folder of each Claude Code session to projectFolders,
// which pulled in the temp folder and app data. Those folders can't be told
// apart from ones added by hand, so the list is emptied (people add theirs
// again in Settings → Tracking). Repos remembered from Claude Code or editor
// work are kept, unless they sit in a temp, app-data or system place; scanned
// repos are dropped. The ignore list and achievements are untouched. It runs
// when the trackedRepos section doesn't exist yet, and writes it.

import { repoKey, repoName } from './repoPaths.js';

/**
 * `settings` has get/set, `db` getSection/setSection, and
 * `untrackedPlaces(paths)` resolves to one boolean per path (true = never
 * tracked) or null when it can't be asked. Returns the new trackedRepos
 * section, or null when it couldn't run (it runs again next launch).
 */
export async function migrateRepoScan({ settings, db, untrackedPlaces }) {
  const scan = db.getSection('repoScan');
  // An install from before: it ran the scan or finished the setup wizard. On a
  // first launch the wizard (open meanwhile) may be adding folders by hand.
  const upgrading = !!scan || !!db.getSection('setupWizard')?.completed;
  const folders = settings.get('projectFolders');
  const folderCount = Array.isArray(folders) ? folders.length : 0;
  const remembered = [
    ...(Array.isArray(scan?.remembered) ? scan.remembered : []),
    ...(Array.isArray(scan?.repos) ? scan.repos.filter(r => r?.source === 'detected') : []),
  ].filter(r => typeof r?.path === 'string' && r.path.trim());

  const paths = remembered.map(r => r.path);
  let untracked = [];
  if (paths.length > 0) {
    untracked = await untrackedPlaces(paths);
    if (!Array.isArray(untracked) || untracked.length !== paths.length) return null;
  }

  const repos = [];
  remembered.forEach((r, i) => {
    if (untracked[i] || repos.some(x => repoKey(x.path) === repoKey(r.path))) return;
    repos.push({ name: r.name || repoName(r.path), path: r.path, worktrees: [r.path], lastSeen: 0 });
  });

  if (upgrading && folderCount > 0) settings.set('projectFolders', []);
  if (scan) db.setSection('repoScan', null);

  const section = { repos };
  db.setSection('trackedRepos', section);
  const scanned = Array.isArray(scan?.repos) ? scan.repos.filter(r => r?.source === 'scan').length : 0;
  console.log(`Repo tracking: kept ${repos.length} remembered repos; cleared ${upgrading ? folderCount : 0} ` +
    `project folders and ${scanned} scanned repos`);
  return section;
}
