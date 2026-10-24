//! Automatic git repo discovery ("Find my repos automatically").
//!
//! Walks the home folder, every fixed local drive (Windows) or common mount
//! point (macOS/Linux), and the user's own project folders, breadth-first so
//! every root gets its shallow levels looked at before any one root's deep
//! ones. The walk is time-boxed and capped, never follows symlinks or
//! junctions, never recurses into a repo, and skips system and build folders.

use crate::system::dirs_home;
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Levels below the home folder searched (~/Desktop/a/b/c/repo).
pub(crate) const HOME_DEPTH: u32 = 6;
/// Levels below each drive root or mount point searched (E:\a\b\c\repo).
pub(crate) const DRIVE_DEPTH: u32 = 4;
/// Levels below a folder the user added.
pub(crate) const FOLDER_DEPTH: u32 = 4;
pub(crate) const MAX_REPOS: usize = 300;
pub(crate) const TIME_BUDGET: Duration = Duration::from_secs(30);

/// Folder names never descended into, compared case-insensitively. Hidden
/// folders (leading `.`) and Windows system folders (leading `$`) are skipped
/// too, and so is everything the file watcher ignores.
const SKIP_DIRS: &[&str] = &[
    // Windows system
    "windows",
    "windows.old",
    "program files",
    "program files (x86)",
    "programdata",
    "system volume information",
    "recovery",
    "perflogs",
    "config.msi",
    "msocache",
    "windowsapps",
    "wpsystem",
    "appdata",
    // macOS / Linux system
    "library",
    "applications",
    "system",
    "lost+found",
    "snap",
    // Dependencies, build output, caches
    "node_modules",
    "bower_components",
    "vendor",
    "pods",
    "target",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    "venv",
    "env",
    "__pycache__",
    "site-packages",
    "cache",
    "caches",
    "temp",
    "tmp",
    // Version control metadata other than .git (hidden ones are caught by the dot rule)
    "cvs",
    "_darcs",
    // Game libraries: huge trees, never repos
    "steamapps",
    "steamlibrary",
    "epic games",
];

/// Suffixes of folders that are bundles, not places to look for repos.
const SKIP_SUFFIXES: &[&str] = &[".app", ".framework", ".bundle"];

pub(crate) fn should_skip_dir(name: &str) -> bool {
    if name.starts_with('.') || name.starts_with('$') {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    SKIP_DIRS.contains(&lower.as_str())
        || crate::watcher::IGNORED_DIRS.contains(&lower.as_str())
        || SKIP_SUFFIXES.iter().any(|s| lower.ends_with(s))
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoScanRequest {
    /// Also walk the home folder and every local drive / mount point.
    pub scan_drives: bool,
    /// Folders the user added (Settings → Tracking).
    pub folders: Vec<String>,
    /// Repos remembered from runtime detection; kept if they still exist.
    pub known_repos: Vec<String>,
    /// Repos the user ignored: never returned.
    pub ignored: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundRepo {
    pub name: String,
    pub path: String,
    /// Unix seconds of the last commit in the HEAD reflog, if there is one.
    pub last_commit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoScanResult {
    pub repos: Vec<FoundRepo>,
    pub roots: usize,
    pub dirs_visited: usize,
    pub elapsed_ms: u64,
    /// Stopped at the repo cap.
    pub truncated: bool,
    /// Stopped at the time budget.
    pub timed_out: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ScanRoot {
    pub path: PathBuf,
    pub depth: u32,
}

pub(crate) struct ScanLimits {
    pub max_repos: usize,
    pub time_budget: Duration,
}

static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Run one scan on the blocking pool. A second call while one is running is
/// refused rather than queued, so "Scan now" can't stack walks.
#[tauri::command]
pub(crate) async fn scan_git_repos(request: RepoScanRequest) -> Result<RepoScanResult, String> {
    if SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("A repo scan is already running".to_string());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let roots = build_roots(&request);
        scan(
            &roots,
            &request.known_repos,
            &request.ignored,
            &ScanLimits {
                max_repos: MAX_REPOS,
                time_budget: TIME_BUDGET,
            },
        )
    })
    .await
    .map_err(|e| e.to_string());
    SCAN_RUNNING.store(false, Ordering::SeqCst);
    result
}

pub(crate) fn build_roots(request: &RepoScanRequest) -> Vec<ScanRoot> {
    let home = dirs_home();
    let mut roots = Vec::new();
    if request.scan_drives {
        if let Some(h) = &home {
            roots.push(ScanRoot {
                path: h.clone(),
                depth: HOME_DEPTH,
            });
        }
        for path in system_roots() {
            roots.push(ScanRoot {
                path,
                depth: DRIVE_DEPTH,
            });
        }
    }
    for folder in &request.folders {
        if let Some(path) = expand_home(folder, home.as_deref()) {
            roots.push(ScanRoot {
                path,
                depth: FOLDER_DEPTH,
            });
        }
    }
    roots
}

fn expand_home(path: &str, home: Option<&Path>) -> Option<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "~" {
        return home.map(Path::to_path_buf);
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return home.map(|h| h.join(rest));
    }
    Some(PathBuf::from(trimmed))
}

/// Drive roots (Windows) or mount points (macOS/Linux) to walk.
#[cfg(target_os = "windows")]
pub(crate) fn system_roots() -> Vec<PathBuf> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    // SAFETY: GetLogicalDrives takes no arguments and only returns a bitmask.
    let mask = unsafe { GetLogicalDrives() };
    fixed_drives(mask, |letter| {
        let root: Vec<u16> = format!("{letter}:\\")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: `root` is a NUL-terminated UTF-16 string that outlives the call.
        unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) }
    })
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn system_roots() -> Vec<PathBuf> {
    let user = std::env::var("USER").unwrap_or_default();
    let mut parents = vec![
        PathBuf::from("/Volumes"),
        PathBuf::from("/mnt"),
        PathBuf::from("/media"),
    ];
    if !user.is_empty() {
        parents.push(PathBuf::from("/media").join(&user));
        parents.push(PathBuf::from("/run/media").join(&user));
    }
    mount_points(&parents)
}

/// GetDriveTypeW's DRIVE_FIXED: a local disk, not removable, network,
/// optical or RAM.
#[cfg(any(target_os = "windows", test))]
const DRIVE_FIXED: u32 = 3;

/// The fixed drives in a GetLogicalDrives bitmask, as `X:\` roots.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn fixed_drives(mask: u32, drive_type: impl Fn(char) -> u32) -> Vec<PathBuf> {
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| (b'A' + i) as char)
        .filter(|&letter| drive_type(letter) == DRIVE_FIXED)
        .map(|letter| PathBuf::from(format!("{letter}:\\")))
        .collect()
}

/// Real directories (not symlinks: macOS's `/Volumes/Macintosh HD` points at
/// `/`) directly inside each parent.
#[cfg(any(not(target_os = "windows"), test))]
pub(crate) fn mount_points(parents: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for parent in parents {
        let Ok(entries) = std::fs::read_dir(parent) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                out.push(entry.path());
            }
        }
    }
    out
}

/// Comparison key for a path: forward slashes, no trailing slash, and
/// lowercase on Windows where paths are case-insensitive.
pub(crate) fn path_key(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let trimmed = unified.trim_end_matches('/');
    let key = if trimmed.is_empty() { "/" } else { trimmed };
    if cfg!(windows) {
        key.to_lowercase()
    } else {
        key.to_string()
    }
}

fn is_ignored(key: &str, ignored: &HashSet<String>) -> bool {
    ignored.iter().any(|i| {
        key == i
            || key
                .strip_prefix(i.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

pub(crate) fn scan(
    roots: &[ScanRoot],
    known_repos: &[String],
    ignored: &[String],
    limits: &ScanLimits,
) -> RepoScanResult {
    let started = Instant::now();
    let deadline = started + limits.time_budget;
    let ignored: HashSet<String> = ignored.iter().map(|p| path_key(p)).collect();
    // Each root is walked once, by itself: a drive walk that reaches the home
    // folder or a user folder stops there.
    let root_keys: HashSet<String> = roots
        .iter()
        .map(|r| path_key(&r.path.to_string_lossy()))
        .collect();

    let mut seen: HashSet<String> = HashSet::new();
    let mut repos: Vec<FoundRepo> = Vec::new();
    let mut truncated = false;
    let mut timed_out = false;
    let mut dirs_visited = 0usize;

    let mut add = |path: &Path, repos: &mut Vec<FoundRepo>| -> bool {
        if repos.len() >= limits.max_repos {
            return false;
        }
        let path_str = path.to_string_lossy().to_string();
        let key = path_key(&path_str);
        if is_ignored(&key, &ignored) || !seen.insert(key) {
            return true;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path_str)
            .to_string();
        repos.push(FoundRepo {
            name,
            path: path_str,
            last_commit: last_commit_time(path),
        });
        true
    };

    // Remembered repos first: they're the ones the user really works in.
    for known in known_repos {
        let path = PathBuf::from(known);
        if path.join(".git").exists() && !add(&path, &mut repos) {
            truncated = true;
            break;
        }
    }

    let mut queue: VecDeque<(PathBuf, u32, u32)> = VecDeque::new();
    let mut seen_roots = HashSet::new();
    for root in roots {
        if seen_roots.insert(path_key(&root.path.to_string_lossy())) {
            queue.push_back((root.path.clone(), 0, root.depth));
        }
    }

    'walk: while let Some((dir, depth, max_depth)) = queue.pop_front() {
        if truncated {
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        dirs_visited += 1;

        let mut children = Vec::new();
        let mut is_repo = false;
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name == ".git" {
                is_repo = true;
                break;
            }
            if depth >= max_depth || should_skip_dir(name) {
                continue;
            }
            // file_type() doesn't follow links, so symlinks and junctions
            // are never entered (no loops, no walking a drive twice).
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                children.push(entry.path());
            }
        }

        if is_repo {
            if !add(&dir, &mut repos) {
                truncated = true;
                break;
            }
            for worktree in linked_worktrees(&dir) {
                if !add(&worktree, &mut repos) {
                    truncated = true;
                    break 'walk;
                }
            }
            continue;
        }

        for child in children {
            if !root_keys.contains(&path_key(&child.to_string_lossy())) {
                queue.push_back((child, depth + 1, max_depth));
            }
        }
    }

    RepoScanResult {
        repos,
        roots: roots.len(),
        dirs_visited,
        elapsed_ms: started.elapsed().as_millis() as u64,
        truncated,
        timed_out,
    }
}

/// The git directory of a repo or linked worktree (`.git` file → gitdir).
fn git_dir(repo: &Path) -> Option<PathBuf> {
    let dot_git = repo.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    let content = std::fs::read_to_string(&dot_git).ok()?;
    let target = content.trim().strip_prefix("gitdir:")?.trim();
    Some(repo.join(target))
}

/// Worktrees registered in a main repo (`.git/worktrees/*/gitdir`), which can
/// live anywhere, including inside the repo where the walk doesn't go.
fn linked_worktrees(repo: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(repo.join(".git").join("worktrees")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| std::fs::read_to_string(e.path().join("gitdir")).ok())
        .filter_map(|gitdir| PathBuf::from(gitdir.trim()).parent().map(Path::to_path_buf))
        .filter(|wt| wt.join(".git").exists())
        .collect()
}

/// Time of the newest commit recorded in the HEAD reflog. Reads only the
/// file's tail, so it costs one small read per repo instead of a git process.
pub(crate) fn last_commit_time(repo: &Path) -> Option<i64> {
    use std::io::{Read, Seek, SeekFrom};
    const TAIL: u64 = 16 * 1024;
    let mut file = std::fs::File::open(git_dir(repo)?.join("logs").join("HEAD")).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(TAIL))).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    text.lines().rev().find_map(reflog_commit_time)
}

/// `<old> <new> <name> <email> <unix-time> <tz>\t<message>` → the time, when
/// the message is a commit ("commit:", "commit (amend):", "commit (merge):").
fn reflog_commit_time(line: &str) -> Option<i64> {
    let (head, message) = line.split_once('\t')?;
    if !message.starts_with("commit") {
        return None;
    }
    let mut parts = head.rsplitn(3, ' ');
    let _tz = parts.next()?;
    parts.next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("drvibe-reposcan-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mkdirs(root: &Path, rel: &str) -> PathBuf {
        let p = root.join(rel);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn make_repo(root: &Path, rel: &str) -> PathBuf {
        let p = mkdirs(root, rel);
        std::fs::create_dir_all(p.join(".git")).unwrap();
        p
    }

    fn limits() -> ScanLimits {
        ScanLimits {
            max_repos: 100,
            time_budget: Duration::from_secs(30),
        }
    }

    fn names(result: &RepoScanResult) -> Vec<String> {
        let mut n: Vec<String> = result.repos.iter().map(|r| r.name.clone()).collect();
        n.sort();
        n
    }

    fn root(path: &Path, depth: u32) -> ScanRoot {
        ScanRoot {
            path: path.to_path_buf(),
            depth,
        }
    }

    #[test]
    fn fixed_drives_keeps_only_local_disks() {
        // A, C, D, E, Z present; C and E fixed, D removable (2), Z network (4), A optical (5)
        let mask = 1 | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 25);
        let drives = fixed_drives(mask, |l| match l {
            'C' | 'E' => 3,
            'D' => 2,
            'Z' => 4,
            _ => 5,
        });
        assert_eq!(drives, vec![PathBuf::from("C:\\"), PathBuf::from("E:\\")]);
        assert!(fixed_drives(0, |_| 3).is_empty());
    }

    #[test]
    fn mount_points_lists_directories_only() {
        let t = temp_tree("mounts");
        let volumes = mkdirs(&t, "Volumes");
        mkdirs(&volumes, "Data");
        mkdirs(&volumes, "Backup");
        std::fs::write(volumes.join("not-a-dir"), "").unwrap();
        let mut found = mount_points(&[volumes.clone(), t.join("missing")]);
        found.sort();
        assert_eq!(found, vec![volumes.join("Backup"), volumes.join("Data")]);
    }

    #[test]
    fn build_roots_respects_scan_drives() {
        let off = build_roots(&RepoScanRequest {
            scan_drives: false,
            folders: vec!["/work/code".into(), "  ".into()],
            ..Default::default()
        });
        assert_eq!(off, vec![root(Path::new("/work/code"), FOLDER_DEPTH)]);

        let on = build_roots(&RepoScanRequest {
            scan_drives: true,
            folders: vec!["/work/code".into()],
            ..Default::default()
        });
        assert!(on.len() >= 2);
        if let Some(home) = dirs_home() {
            assert_eq!(on[0], root(&home, HOME_DEPTH));
        }
        assert_eq!(
            on.last(),
            Some(&root(Path::new("/work/code"), FOLDER_DEPTH))
        );
    }

    #[test]
    fn skip_rules() {
        for name in [
            "Windows",
            "Program Files",
            "Program Files (x86)",
            "ProgramData",
            "$Recycle.Bin",
            "System Volume Information",
            "AppData",
            "node_modules",
            "target",
            "dist",
            ".git",
            ".svn",
            ".hg",
            ".cache",
            "__pycache__",
            ".next",
            "SteamLibrary",
            "Xcode.app",
        ] {
            assert!(should_skip_dir(name), "{name} should be skipped");
        }
        for name in ["code", "projects", "Desktop", "my-app", "Documents", "src"] {
            assert!(!should_skip_dir(name), "{name} should be walked");
        }
    }

    #[test]
    fn finds_repos_and_skips_noise() {
        let t = temp_tree("skips");
        make_repo(&t, "code/alpha");
        make_repo(&t, "code/node_modules/dep");
        make_repo(&t, "Program Files/vendor-tool");
        make_repo(&t, ".hidden/secret");
        make_repo(&t, "AppData/Local/thing");
        let r = scan(&[root(&t, 4)], &[], &[], &limits());
        assert_eq!(names(&r), vec!["alpha"]);
        assert!(!r.timed_out && !r.truncated);
    }

    #[test]
    fn depth_limit() {
        let t = temp_tree("depth");
        make_repo(&t, "a/b/c/at4");
        make_repo(&t, "a/b/c/d/at5");
        let r = scan(&[root(&t, 4)], &[], &[], &limits());
        assert_eq!(names(&r), vec!["at4"]);
        let r = scan(&[root(&t, 5)], &[], &[], &limits());
        assert_eq!(names(&r), vec!["at4", "at5"]);
    }

    #[test]
    fn root_that_is_a_repo_is_listed() {
        let t = temp_tree("rootrepo");
        let repo = make_repo(&t, "solo");
        let r = scan(&[root(&repo, 4)], &[], &[], &limits());
        assert_eq!(names(&r), vec!["solo"]);
    }

    #[test]
    fn does_not_recurse_into_repos_but_lists_worktrees() {
        let t = temp_tree("nested");
        let outer = make_repo(&t, "outer");
        make_repo(&t, "outer/packages/inner");
        // A linked worktree inside the repo, registered the way git does it
        let wt = mkdirs(&outer, ".worktrees/feature");
        std::fs::write(wt.join(".git"), "gitdir: ../../.git/worktrees/feature\n").unwrap();
        let reg = mkdirs(&outer, ".git/worktrees/feature");
        std::fs::write(
            reg.join("gitdir"),
            format!("{}\n", wt.join(".git").to_string_lossy()),
        )
        .unwrap();
        // A sibling worktree outside the repo is found by the walk itself
        let sibling = mkdirs(&t, "outer-wt");
        std::fs::write(sibling.join(".git"), "gitdir: x\n").unwrap();

        let r = scan(&[root(&t, 4)], &[], &[], &limits());
        assert_eq!(names(&r), vec!["feature", "outer", "outer-wt"]);
    }

    #[test]
    fn repo_cap() {
        let t = temp_tree("cap");
        for i in 0..10 {
            make_repo(&t, &format!("r{i}"));
        }
        let r = scan(
            &[root(&t, 4)],
            &[],
            &[],
            &ScanLimits {
                max_repos: 4,
                time_budget: Duration::from_secs(30),
            },
        );
        assert_eq!(r.repos.len(), 4);
        assert!(r.truncated);
    }

    #[test]
    fn time_limit() {
        let t = temp_tree("time");
        make_repo(&t, "a/repo");
        let r = scan(
            &[root(&t, 4)],
            &[],
            &[],
            &ScanLimits {
                max_repos: 100,
                time_budget: Duration::ZERO,
            },
        );
        assert!(r.timed_out);
        assert!(r.repos.is_empty());
    }

    #[test]
    fn ignored_repos_and_their_insides_are_left_out() {
        let t = temp_tree("ignored");
        let skip = make_repo(&t, "skip-me");
        make_repo(&t, "keep");
        make_repo(&t, "skip-me-not");
        let ignored = vec![format!("{}/", skip.to_string_lossy())];
        let r = scan(&[root(&t, 4)], &[], &ignored, &limits());
        assert_eq!(names(&r), vec!["keep", "skip-me-not"]);
    }

    #[test]
    fn known_repos_are_kept_while_they_exist() {
        let t = temp_tree("known");
        let far = make_repo(&t, "deep/a/b/c/d/e/far");
        let gone = t.join("gone");
        let r = scan(
            &[],
            &[
                far.to_string_lossy().into_owned(),
                gone.to_string_lossy().into_owned(),
            ],
            &[],
            &limits(),
        );
        assert_eq!(names(&r), vec!["far"]);
    }

    #[test]
    fn overlapping_roots_are_walked_once() {
        let t = temp_tree("overlap");
        let inner = mkdirs(&t, "home");
        make_repo(&inner, "proj");
        let r = scan(&[root(&inner, 6), root(&t, 4)], &[], &[], &limits());
        assert_eq!(names(&r), vec!["proj"]);
    }

    #[test]
    fn reflog_commit_time_parses_commit_lines_only() {
        let a = "0000 1111 A U Thor <a@example.com> 1700000000 +0100\tcommit (initial): first";
        let b = "1111 2222 A U Thor <a@example.com> 1700000500 +0100\tcheckout: moving from main to dev";
        assert_eq!(reflog_commit_time(a), Some(1_700_000_000));
        assert_eq!(reflog_commit_time(b), None);

        let t = temp_tree("reflog");
        let repo = make_repo(&t, "r");
        mkdirs(&repo, ".git/logs");
        std::fs::write(repo.join(".git/logs/HEAD"), format!("{a}\n{b}\n")).unwrap();
        assert_eq!(last_commit_time(&repo), Some(1_700_000_000));
        assert_eq!(last_commit_time(&t), None);
    }

    #[test]
    fn path_keys_compare_loosely() {
        assert_eq!(path_key("/a/b/"), "/a/b");
        assert_eq!(path_key("/"), "/");
        if cfg!(windows) {
            assert_eq!(path_key("E:\\Work\\Repo\\"), "e:/work/repo");
        }
        let ignored: HashSet<String> = ["/a/b".to_string()].into_iter().collect();
        assert!(is_ignored("/a/b", &ignored));
        assert!(is_ignored("/a/b/sub", &ignored));
        assert!(!is_ignored("/a/bc", &ignored));
    }

    /// Real-machine check: `cargo test -- --ignored real_machine_scan --nocapture`.
    /// Prints counts and timing only.
    #[test]
    #[ignore]
    fn real_machine_scan() {
        let roots = build_roots(&RepoScanRequest {
            scan_drives: true,
            ..Default::default()
        });
        let r = scan(
            &roots,
            &[],
            &[],
            &ScanLimits {
                max_repos: MAX_REPOS,
                time_budget: TIME_BUDGET,
            },
        );
        println!(
            "roots={} repos={} dirs={} elapsed_ms={} truncated={} timed_out={} with_commit_time={}",
            r.roots,
            r.repos.len(),
            r.dirs_visited,
            r.elapsed_ms,
            r.truncated,
            r.timed_out,
            r.repos.iter().filter(|x| x.last_commit.is_some()).count()
        );
        let mut per_volume = std::collections::BTreeMap::new();
        for repo in &r.repos {
            let volume: String = repo.path.chars().take(2).collect();
            *per_volume.entry(volume).or_insert(0) += 1;
        }
        println!("repos per volume: {per_volume:?}");
    }
}
