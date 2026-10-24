//! Which git repos Dr. Vibe tracks. A repo is tracked because Claude Code
//! worked in it (or the user added its folder); this module turns a path into
//! the repo it belongs to, with a linked worktree counting as its main repo,
//! and refuses places that are never tracked whatever runs there: the temp
//! folder, app data, program and system folders, and anything at or above the
//! home folder.

use crate::projects::run_git;
use crate::system::dirs_home;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// A git repo: `root` is its identity (the main worktree), `worktree` the
/// working tree the path was in (the same folder unless it's a linked worktree).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TrackedRepo {
    pub name: String,
    pub root: String,
    pub worktree: String,
}

// ---- Places never tracked ----

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Style {
    Windows,
    Posix,
}

/// Top-level folders of a Windows drive that never hold the user's projects.
const WINDOWS_SYSTEM: &[&str] = &[
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "$recycle.bin",
    "system volume information",
    "recovery",
    "perflogs",
    "temp",
    "tmp",
];

/// POSIX system folders (first segment), and `/var`/`/private` subfolders.
const POSIX_SYSTEM: &[&str] = &[
    "tmp",
    "proc",
    "sys",
    "dev",
    "run",
    "boot",
    "etc",
    "usr",
    "bin",
    "sbin",
    "lib",
    "lib32",
    "lib64",
    "snap",
    "nix",
    "System",
    "Library",
    "Applications",
];
const POSIX_VAR: &[&str] = &["tmp", "folders", "cache", "log", "lib", "run", "spool"];

/// Folders directly in a home folder that hold app or tool state, not projects
/// (compared lowercase). `Library` keeps iCloud Drive and other cloud folders.
const HOME_STATE: &[&str] = &[
    "appdata",
    "library",
    ".cache",
    ".local",
    ".npm",
    ".pnpm-store",
    ".yarn",
    ".cargo",
    ".rustup",
    ".nvm",
    ".gradle",
    ".m2",
    ".trash",
    ".claude",
    ".vscode",
    ".cursor",
];
const LIBRARY_CLOUD: &[&str] = &["mobile documents", "cloudstorage"];

/// The rules for one machine: path style, the home folder, and the temp and
/// app-data folders its environment names.
#[derive(Debug, Clone)]
pub(crate) struct Places {
    style: Style,
    home: Option<String>,
    blocked: Vec<String>,
    #[cfg(test)]
    off: bool,
}

impl Places {
    pub(crate) fn new(style: Style, home: Option<&str>, blocked: &[&str]) -> Self {
        Self {
            style,
            home: home.map(|h| key(style, h)).filter(|h| !h.is_empty()),
            blocked: blocked
                .iter()
                .map(|b| key(style, b))
                .filter(|b| !b.is_empty())
                .collect(),
            #[cfg(test)]
            off: false,
        }
    }

    /// This machine's rules.
    pub(crate) fn current() -> Self {
        let style = if cfg!(windows) {
            Style::Windows
        } else {
            Style::Posix
        };
        let mut blocked = vec![std::env::temp_dir().to_string_lossy().into_owned()];
        for var in [
            "TEMP",
            "TMP",
            "TMPDIR",
            "APPDATA",
            "LOCALAPPDATA",
            "ProgramData",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramW6432",
            "SystemRoot",
            "windir",
            "XDG_CACHE_HOME",
            "XDG_RUNTIME_DIR",
        ] {
            if let Ok(v) = std::env::var(var) {
                blocked.push(v);
            }
        }
        let home = dirs_home().map(|h| h.to_string_lossy().into_owned());
        let blocked: Vec<&str> = blocked.iter().map(String::as_str).collect();
        Self::new(style, home.as_deref(), &blocked)
    }

    /// Rules that allow everything, for tests whose fixtures live in temp.
    #[cfg(test)]
    pub(crate) fn none() -> Self {
        Self {
            off: true,
            ..Self::new(Style::Posix, None, &[])
        }
    }

    /// True for a place Dr. Vibe never tracks a repo in.
    pub(crate) fn is_untracked(&self, path: &str) -> bool {
        #[cfg(test)]
        if self.off {
            return false;
        }
        let k = key(self.style, path);
        let segs: Vec<&str> = k.split('/').filter(|s| !s.is_empty()).collect();
        // A root or drive, and the home folder or anything above it
        if segs.len() <= 1 {
            return true;
        }
        if let Some(home) = &self.home {
            if inside(home, &k) {
                return true;
            }
        }
        if self.blocked.iter().any(|b| inside(&k, b)) {
            return true;
        }
        let lower: Vec<String> = segs.iter().map(|s| s.to_lowercase()).collect();
        let home_rest: Option<&[String]> = match self.style {
            Style::Windows => {
                if WINDOWS_SYSTEM.contains(&lower[1].as_str()) {
                    return true;
                }
                (lower[1] == "users").then(|| &lower[2..])
            }
            Style::Posix => {
                if POSIX_SYSTEM.contains(&segs[0]) {
                    return true;
                }
                if (segs[0] == "var" || segs[0] == "private") && POSIX_VAR.contains(&segs[1]) {
                    return true;
                }
                if segs[0] == "private" && segs[1] == "var" {
                    return true;
                }
                (segs[0] == "home" || segs[0] == "Users").then(|| &lower[1..])
            }
        };
        let home_rest = home_rest.or_else(|| {
            let home = self.home.as_ref()?;
            inside(&k, home).then(|| {
                let depth = home.split('/').filter(|s| !s.is_empty()).count();
                &lower[depth - 1..]
            })
        });
        // home_rest[0] is the user's folder name
        match home_rest {
            Some([] | [_]) => true,
            Some([_user, first, rest @ ..]) => {
                HOME_STATE.contains(&first.as_str())
                    && !(first == "library"
                        && rest
                            .first()
                            .is_some_and(|r| LIBRARY_CLOUD.contains(&r.as_str())))
            }
            _ => false,
        }
    }
}

/// Comparison key: forward slashes, no `\\?\` prefix or trailing slash,
/// lowercase on Windows.
fn key(style: Style, path: &str) -> String {
    let p = path.trim();
    let p = p.strip_prefix(r"\\?\").unwrap_or(p);
    let mut k = p.replace('\\', "/");
    while k.contains("//") {
        k = k.replace("//", "/");
    }
    let k = k.trim_end_matches('/').to_string();
    match style {
        Style::Windows => k.to_lowercase(),
        Style::Posix => k,
    }
}

/// True when key `path` is key `root` or inside it.
fn inside(path: &str, root: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

// ---- Repo identity ----

/// The folder that identifies the repo whose working tree is `toplevel` and
/// whose `git rev-parse --git-common-dir` is `common_dir`.
pub(crate) fn repo_identity(toplevel: &Path, common_dir: &Path) -> PathBuf {
    let is_git = |c: Component| c.as_os_str().eq_ignore_ascii_case(".git");
    // The main worktree, or a linked worktree of a normal repo
    if common_dir
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case(".git"))
    {
        if let Some(parent) = common_dir.parent() {
            return parent.to_path_buf();
        }
    }
    // A submodule keeps its git dir inside the superproject's .git: it is a
    // repo of its own
    if common_dir.components().any(is_git) {
        return toplevel.to_path_buf();
    }
    // Worktrees of a bare repo: the bare folder
    common_dir.to_path_buf()
}

/// Folder name of a repo root, without a bare repo's `.git` suffix.
pub(crate) fn repo_name(root: &Path) -> String {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".to_string());
    match name.strip_suffix(".git") {
        Some(stem) if !stem.is_empty() => stem.to_string(),
        _ => name,
    }
}

/// `..` and `.` resolved without touching the disk.
fn clean(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// A path as this OS writes it (git prints forward slashes on Windows too).
fn native(path: &Path) -> String {
    let s = path.to_string_lossy();
    if cfg!(windows) {
        s.replace('/', "\\")
    } else {
        s.into_owned()
    }
}

/// The working tree and identity of the repo containing the folder `dir`.
pub(crate) fn git_repo_paths(dir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let out = run_git(
        &dir.to_string_lossy(),
        &["rev-parse", "--show-toplevel", "--git-common-dir"],
    )?;
    let mut lines = out.lines().map(str::trim).filter(|l| !l.is_empty());
    let (Some(top), Some(common)) = (lines.next(), lines.next()) else {
        return Err("not a working tree".to_string());
    };
    let toplevel = PathBuf::from(top);
    let common = Path::new(common);
    let common = clean(&if common.is_absolute() {
        common.to_path_buf()
    } else {
        dir.join(common)
    });
    let root = repo_identity(&toplevel, &common);
    Ok((toplevel, root))
}

/// The repo `path` (a file or folder, which may no longer exist) is in, or
/// None when it's in no repo or in a place never tracked.
pub(crate) fn resolve_repo_with(path: &str, places: &Places) -> Option<TrackedRepo> {
    if path.trim().is_empty() || places.is_untracked(path) {
        return None;
    }
    let dir = Path::new(path).ancestors().find(|p| p.is_dir())?;
    if places.is_untracked(&dir.to_string_lossy()) {
        return None;
    }
    let (toplevel, root) = git_repo_paths(dir).ok()?;
    let (worktree, root) = (native(&toplevel), native(&root));
    if places.is_untracked(&worktree) || places.is_untracked(&root) {
        return None;
    }
    Some(TrackedRepo {
        name: repo_name(Path::new(&root)),
        root,
        worktree,
    })
}

/// Repos in a folder the user added: the folder's own repo, or else the repos
/// directly inside it (one level down).
pub(crate) fn folder_repos_with(folder: &str, places: &Places) -> Vec<TrackedRepo> {
    let dir = Path::new(folder);
    if !dir.is_dir() || places.is_untracked(folder) {
        return Vec::new();
    }
    if let Some(repo) = resolve_repo_with(folder, places) {
        return vec![repo];
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .filter(|p| p.join(".git").exists())
        .collect();
    children.sort();
    children
        .iter()
        .filter_map(|p| resolve_repo_with(&p.to_string_lossy(), places))
        .collect()
}

#[tauri::command]
pub(crate) async fn resolve_repo(path: String) -> Option<TrackedRepo> {
    tauri::async_runtime::spawn_blocking(move || resolve_repo_with(&path, &Places::current()))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub(crate) async fn find_folder_repos(folder: String) -> Vec<TrackedRepo> {
    tauri::async_runtime::spawn_blocking(move || folder_repos_with(&folder, &Places::current()))
        .await
        .unwrap_or_default()
}

/// For each path: true when it's a place never tracked.
#[tauri::command]
pub(crate) fn untracked_places(paths: Vec<String>) -> Vec<bool> {
    let places = Places::current();
    paths.iter().map(|p| places.is_untracked(p)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TempDir;

    fn windows() -> Places {
        Places::new(
            Style::Windows,
            Some(r"C:\Users\Mara"),
            &[
                r"C:\Users\Mara\AppData\Local\Temp",
                r"C:\Users\Mara\AppData\Roaming",
            ],
        )
    }

    fn mac() -> Places {
        Places::new(
            Style::Posix,
            Some("/Users/mara"),
            &["/var/folders/xy/abc/T/"],
        )
    }

    fn linux() -> Places {
        Places::new(Style::Posix, Some("/home/mara"), &["/tmp"])
    }

    #[test]
    fn windows_temp_appdata_and_system_folders_are_never_tracked() {
        let w = windows();
        for p in [
            r"C:\Users\Mara\AppData\Local\Temp\drvibe-proj-123-git",
            r"C:\Users\Mara\AppData\Local\Temp",
            r"C:\Users\Mara\AppData\Local",
            r"C:\Users\Mara\AppData\Local\QuadFlow-preview\repo",
            r"C:\Users\Mara\AppData\Roaming\Code\User",
            r"C:\Users\Mara\AppData\LocalLow\Game",
            r"c:/users/mara/appdata/local/temp/x",
            r"\\?\C:\Users\Mara\AppData\Local\Temp\x",
            r"C:\Users\Other\AppData\Local\x",
            r"C:\Windows\System32",
            r"C:\Windows\Temp\x",
            r"C:\Program Files\Git",
            r"D:\Program Files (x86)\Steam\x",
            r"C:\ProgramData\chocolatey",
            r"C:\Temp\scratch",
            r"C:\$Recycle.Bin\S-1-5",
            r"C:\Users\Mara\.cargo\registry\src\x",
            r"C:\Users\Mara\.claude\plugins\x",
        ] {
            assert!(w.is_untracked(p), "{p}");
        }
    }

    #[test]
    fn windows_home_and_above_are_too_shallow() {
        let w = windows();
        for p in [
            r"C:\",
            "C:",
            r"E:\",
            r"C:\Users",
            r"C:\Users\Mara",
            r"C:\Users\Mara\",
            r"C:\Users\Other",
            "",
        ] {
            assert!(w.is_untracked(p), "{p:?}");
        }
    }

    #[test]
    fn windows_project_folders_are_tracked() {
        let w = windows();
        for p in [
            r"C:\Users\Mara\Desktop\Quads Lab\quads-lab",
            r"C:\Users\Mara\Desktop",
            r"C:\Users\Mara\Documents\code\app",
            r"C:\Users\Mara\source\repos\App",
            r"C:\Users\Mara\.dotfiles",
            r"C:\dev\ferivox",
            r"E:\hq",
            r"E:\emberville-mp-work\a1",
            r"E:\templates\app",
            r"C:\Users\Mara\Desktop\app\.claude\worktrees\fix",
        ] {
            assert!(!w.is_untracked(p), "{p}");
        }
    }

    #[test]
    fn posix_temp_caches_and_system_folders_are_never_tracked() {
        let (m, l) = (mac(), linux());
        for p in [
            "/tmp/drvibe-proj-1-git",
            "/private/tmp/x",
            "/var/tmp/x",
            "/var/folders/xy/abc/T/x",
            "/private/var/folders/xy/abc/T/x",
            "/Users/mara/Library/Caches/x",
            "/Users/mara/Library/Application Support/Code",
            "/Users/mara/.cache/x",
            "/Users/mara/.npm/_cacache",
            "/usr/local/lib/node_modules/x",
            "/System/Library",
            "/Applications/Xcode.app",
            "/",
            "/Users",
            "/Users/mara",
            "/Users/other",
        ] {
            assert!(m.is_untracked(p), "mac {p}");
        }
        for p in [
            "/tmp",
            "/tmp/x",
            "/home/mara",
            "/home",
            "/home/mara/.local/share/x",
            "/home/mara/.cargo/git/checkouts/x",
            "/proc/1",
            "/etc/nixos",
        ] {
            assert!(l.is_untracked(p), "linux {p}");
        }
    }

    #[test]
    fn posix_project_folders_are_tracked() {
        let (m, l) = (mac(), linux());
        for p in [
            "/Users/mara/code/app",
            "/Users/mara/Developer/app",
            "/Users/mara/Library/Mobile Documents/com~apple~CloudDocs/app",
            "/Users/mara/.dotfiles",
            "/Volumes/Work/app",
            "/opt/projects/app",
        ] {
            assert!(!m.is_untracked(p), "mac {p}");
        }
        for p in ["/home/mara/code/app", "/srv/git/app", "/var/www/site"] {
            assert!(!l.is_untracked(p), "linux {p}");
        }
    }

    #[test]
    fn a_home_outside_home_or_users_still_counts() {
        let p = Places::new(Style::Posix, Some("/root"), &[]);
        assert!(p.is_untracked("/root"));
        assert!(p.is_untracked("/root/.cache/x"));
        assert!(!p.is_untracked("/root/app"));
    }

    #[test]
    fn this_machines_temp_folder_is_never_tracked() {
        let places = Places::current();
        let temp = std::env::temp_dir();
        assert!(places.is_untracked(&temp.to_string_lossy()));
        assert!(places.is_untracked(&temp.join("drvibe-proj-1-git").to_string_lossy()));
        if let Some(home) = dirs_home() {
            assert!(places.is_untracked(&home.to_string_lossy()));
            assert!(!places.is_untracked(&home.join("code").join("app").to_string_lossy()));
        }
    }

    #[test]
    fn identity_of_worktrees_submodules_and_bare_repos() {
        let p = PathBuf::from;
        assert_eq!(repo_identity(&p("/w/app"), &p("/w/app/.git")), p("/w/app"));
        assert_eq!(
            repo_identity(&p("/w/app-wt/fix"), &p("/w/app/.git")),
            p("/w/app")
        );
        assert_eq!(
            repo_identity(&p("/w/app/vendor/lib"), &p("/w/app/.git/modules/lib")),
            p("/w/app/vendor/lib")
        );
        assert_eq!(
            repo_identity(&p("/w/app/main"), &p("/w/app.git")),
            p("/w/app.git")
        );
        assert_eq!(repo_name(&p("/w/app.git")), "app");
        assert_eq!(repo_name(&p("/w/app")), "app");
        assert_eq!(clean(&p("/w/app/sub/../.git")), p("/w/app/.git"));
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn git(dir: &Path, args: &[&str]) {
        run_git(&dir.to_string_lossy(), args).unwrap();
    }

    /// A repo with one commit in `dir`.
    fn init_repo(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        git(dir, &["config", "user.name", "Test"]);
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "first"]);
    }

    fn same(a: &str, b: &Path) -> bool {
        let (a, b) = (
            key(Style::Windows, a),
            key(Style::Windows, &b.to_string_lossy()),
        );
        a == b
    }

    #[test]
    fn resolves_files_and_subfolders_to_the_repo_root() {
        if !git_available() {
            eprintln!("git not installed; skipping");
            return;
        }
        let tmp = TempDir::new("repos-root");
        let repo = tmp.join("app");
        init_repo(&repo);
        std::fs::create_dir_all(repo.join("src/deep")).unwrap();
        let none = Places::none();

        for path in [
            repo.clone(),
            repo.join("src/deep"),
            repo.join("a.txt"),
            repo.join("src/deep/new-file.rs"),
            repo.join("src/not-yet/created.rs"),
        ] {
            let r = resolve_repo_with(&path.to_string_lossy(), &none).unwrap();
            assert!(same(&r.root, &repo), "{path:?} -> {}", r.root);
            assert!(same(&r.worktree, &repo));
            assert_eq!(r.name, "app");
        }
        // Outside any repo
        let plain = tmp.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        assert_eq!(resolve_repo_with(&plain.to_string_lossy(), &none), None);
        // The real rules refuse it: fixtures live in the temp folder
        assert_eq!(
            resolve_repo_with(&repo.to_string_lossy(), &Places::current()),
            None
        );
    }

    #[test]
    fn a_linked_worktree_resolves_to_its_main_repo() {
        if !git_available() {
            eprintln!("git not installed; skipping");
            return;
        }
        let tmp = TempDir::new("repos-wt");
        let repo = tmp.join("app");
        init_repo(&repo);
        let wt = tmp.join("app-wt").join("fix");
        git(
            &repo,
            &["worktree", "add", "-q", "-b", "fix", &wt.to_string_lossy()],
        );
        std::fs::create_dir_all(wt.join("src")).unwrap();

        let r = resolve_repo_with(&wt.join("src").to_string_lossy(), &Places::none()).unwrap();
        assert!(same(&r.root, &repo), "{}", r.root);
        assert!(same(&r.worktree, &wt), "{}", r.worktree);
        assert_eq!(r.name, "app");
    }

    #[test]
    fn a_folder_is_its_own_repo_or_holds_repos_one_level_down() {
        if !git_available() {
            eprintln!("git not installed; skipping");
            return;
        }
        let tmp = TempDir::new("repos-folder");
        let code = tmp.join("code");
        init_repo(&code.join("one"));
        init_repo(&code.join("two"));
        init_repo(&code.join("group").join("deeper"));
        std::fs::create_dir_all(code.join("notes")).unwrap();
        let none = Places::none();

        let names: Vec<String> = folder_repos_with(&code.to_string_lossy(), &none)
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(names, ["one", "two"]);

        let own = folder_repos_with(&code.join("one").to_string_lossy(), &none);
        assert_eq!(own.len(), 1);
        assert!(folder_repos_with(&tmp.join("missing").to_string_lossy(), &none).is_empty());
        assert!(folder_repos_with(&code.to_string_lossy(), &Places::current()).is_empty());
    }
}
