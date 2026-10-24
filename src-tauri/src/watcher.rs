//! Project file watcher (notify) and its ignore rules.

use crate::gitignore::GitignoreCache;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

// Global file watcher state — one notify watcher that can watch multiple paths.
#[derive(Default)]
pub(crate) struct WatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_paths: Vec<String>,
    filter: Arc<Mutex<ChangeFilter>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub event_type: String, // "create", "modify", "delete"
    pub path: String,
    pub timestamp: u64,
}

// Folders whose file changes are noise (whole path segments, compared
// case-insensitively). The repo scan skips them too.
pub(crate) const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "out",
    "release",
    "coverage",
    "__pycache__",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".vite",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".cargo",
];

// Build and editor output by extension (Rust .pdb/.rlib/.rmeta/.d, source
// maps, TypeScript build info...).
const IGNORED_EXTENSIONS: &[&str] = &[
    "lock",
    "log",
    "tmp",
    "swp",
    "swo",
    "pyc",
    "pyo",
    "o",
    "obj",
    "exe",
    "dll",
    "so",
    "dylib",
    "class",
    "jar",
    "pdb",
    "rlib",
    "rmeta",
    "d",
    "map",
    "tsbuildinfo",
];

/// The fixed ignore rules, for a path relative to the watched folder:
/// a noise folder anywhere in it (whole segments only, so `targets/` and
/// `target-notes.md` still count), Tauri's generated `src-tauri/gen/`, or a
/// build-output extension.
pub(crate) fn should_ignore_path(path: &Path) -> bool {
    let segments: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => s.to_str().map(str::to_ascii_lowercase),
            _ => None,
        })
        .collect();
    if segments.iter().any(|s| IGNORED_DIRS.contains(&s.as_str())) {
        return true;
    }
    if segments
        .windows(2)
        .any(|w| w[0] == "src-tauri" && w[1] == "gen")
    {
        return true;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| IGNORED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Decides which watcher events count as files changed: the fixed rules
/// above, any folder marked as a cache with `CACHEDIR.TAG` (cargo writes one
/// into every target dir, whatever CARGO_TARGET_DIR calls it), and the repo's
/// own `.gitignore` files.
#[derive(Default)]
pub(crate) struct ChangeFilter {
    roots: Vec<PathBuf>,
    gitignore: GitignoreCache,
    cache_dirs: HashMap<PathBuf, bool>,
}

impl ChangeFilter {
    pub(crate) fn add_root(&mut self, root: PathBuf) {
        if !self.roots.contains(&root) {
            self.roots.push(root);
        }
    }

    pub(crate) fn clear(&mut self) {
        *self = ChangeFilter::default();
    }

    pub(crate) fn is_ignored(&mut self, path: &Path) -> bool {
        self.gitignore.note_change(path);

        // Fixed rules apply below the watched folder, so a project that
        // happens to live under e.g. D:\build\ still counts.
        let base = self
            .roots
            .iter()
            .filter(|r| path.starts_with(r))
            .max_by_key(|r| r.components().count())
            .cloned();
        let rel = base
            .as_deref()
            .and_then(|b| path.strip_prefix(b).ok())
            .unwrap_or(path);
        if should_ignore_path(rel) {
            return true;
        }
        if self.inside_cache_dir(path, base.as_deref()) {
            return true;
        }
        self.gitignore.is_ignored(path, || path.is_dir())
    }

    /// Does a folder between `path` and the watched folder hold `CACHEDIR.TAG`?
    fn inside_cache_dir(&mut self, path: &Path, base: Option<&Path>) -> bool {
        if self.cache_dirs.len() > 20_000 {
            self.cache_dirs.clear();
        }
        let mut current = path.parent();
        while let Some(dir) = current {
            if base.is_some_and(|b| !dir.starts_with(b)) {
                break;
            }
            let tagged = *self
                .cache_dirs
                .entry(dir.to_path_buf())
                .or_insert_with(|| dir.join("CACHEDIR.TAG").is_file());
            if tagged {
                return true;
            }
            if base.is_none() {
                break; // outside any watched folder: only the immediate parent
            }
            current = dir.parent();
        }
        false
    }
}

pub(crate) fn event_kind_to_string(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(_) => Some("modify"),
        EventKind::Remove(_) => Some("delete"),
        _ => None,
    }
}

/// Create the shared notify watcher (call once; reuse for all paths).
pub(crate) fn make_watcher(
    app_handle: tauri::AppHandle,
    filter: Arc<Mutex<ChangeFilter>>,
) -> Result<RecommendedWatcher, String> {
    let handle = app_handle.clone();
    RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if let Some(event_type) = event_kind_to_string(&event.kind) {
                    let Ok(mut filter) = filter.lock() else {
                        return;
                    };
                    for event_path in &event.paths {
                        if filter.is_ignored(event_path) {
                            continue;
                        }
                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;

                        let payload = FileChangeEvent {
                            event_type: event_type.to_string(),
                            path: event_path.to_string_lossy().to_string(),
                            timestamp,
                        };

                        let _ = handle.emit("file-changed", &payload);
                    }
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))
}

/// Add a directory to the file watcher. If the watcher doesn't exist yet it is
/// created. Calling this multiple times with different paths accumulates all of
/// them — the same notify watcher instance handles every registered path so all
/// configured project folders emit file-changed events simultaneously.
#[tauri::command]
pub(crate) fn start_watching(path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;

    let watch_path = Path::new(&path);
    if !watch_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    // Skip if already watching this exact path
    if state.watched_paths.contains(&path) {
        return Ok(format!("Already watching: {}", path));
    }

    // Create the watcher the first time; reuse on subsequent calls
    if state.watcher.is_none() {
        state.watcher = Some(make_watcher(app_handle.clone(), state.filter.clone())?);
    }

    state
        .watcher
        .as_mut()
        .unwrap()
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    if let Ok(mut filter) = state.filter.lock() {
        filter.add_root(watch_path.to_path_buf());
    }
    state.watched_paths.push(path.clone());
    Ok(format!("Watching: {}", path))
}

#[tauri::command]
pub(crate) fn stop_watching(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;

    state.watcher = None;
    if let Ok(mut filter) = state.filter.lock() {
        filter.clear();
    }
    let prev = std::mem::take(&mut state.watched_paths);

    Ok(format!("Stopped watching {} path(s)", prev.len()))
}

#[tauri::command]
pub(crate) fn get_watched_path(app_handle: tauri::AppHandle) -> Option<String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let state = state.lock().ok()?;
    // Return comma-joined list for debug display
    if state.watched_paths.is_empty() {
        None
    } else {
        Some(state.watched_paths.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(parts: &[&str]) -> std::path::PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn source_files_are_watched() {
        assert!(!should_ignore_path(&p(&["work", "app", "src", "main.rs"])));
        assert!(!should_ignore_path(&p(&["work", "app", "README.md"])));
    }

    #[test]
    fn build_output_and_noise_are_ignored() {
        assert!(should_ignore_path(&p(&[
            "work",
            "app",
            "node_modules",
            "x",
            "index.js"
        ])));
        assert!(should_ignore_path(&p(&[
            "work", "app", "target", "debug", "app.d"
        ])));
        assert!(should_ignore_path(&p(&["work", "app", ".git", "HEAD"])));
        assert!(should_ignore_path(&p(&["work", "app", "Cargo.lock"])));
        assert!(should_ignore_path(&p(&["work", "app", "debug.log"])));
    }

    #[test]
    fn whole_segments_only() {
        assert!(!should_ignore_path(&p(&[
            "app", "src", "targets", "mod.rs"
        ])));
        assert!(!should_ignore_path(&p(&[
            "app",
            "notes",
            "target-notes.md"
        ])));
        assert!(!should_ignore_path(&p(&["app", "distance", "calc.py"])));
        assert!(!should_ignore_path(&p(&[
            "app",
            "src",
            "gen",
            "codegen.rs"
        ])));
        assert!(should_ignore_path(&p(&["app", "Target", "x.txt"])));
    }

    #[test]
    fn build_extensions_and_tauri_gen() {
        for f in [
            "a.pdb",
            "libx.rlib",
            "libx.rmeta",
            "main.d",
            "app.js.map",
            "tsconfig.tsbuildinfo",
        ] {
            assert!(should_ignore_path(&p(&["app", f])), "{f}");
        }
        assert!(should_ignore_path(&p(&[
            "app",
            "src-tauri",
            "gen",
            "schemas",
            "desktop-schema.json"
        ])));
        for d in [
            "out",
            "coverage",
            ".vite",
            ".turbo",
            ".cache",
            ".parcel-cache",
            "release",
        ] {
            assert!(should_ignore_path(&p(&["app", d, "x.js"])), "{d}");
        }
    }

    // ---- ChangeFilter against a real tree ----

    fn tree(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("drvibe-watch-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, text: &str) -> PathBuf {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }

    fn filter_for(root: &Path) -> ChangeFilter {
        let mut f = ChangeFilter::default();
        f.add_root(root.to_path_buf());
        f
    }

    #[test]
    fn rust_build_trees_never_count() {
        let repo = tree("rust");
        let mut f = filter_for(&repo);
        let src = write(&repo, "src/main.rs", "fn main() {}");
        let artifact = write(&repo, "target/debug/deps/app-1234.rlib", "");
        let fingerprint = write(&repo, "target/debug/.fingerprint/app/dep-lib", "");
        // A custom CARGO_TARGET_DIR with another name: cargo tags it
        write(
            &repo,
            "cargo-out/CACHEDIR.TAG",
            "Signature: 8a477f597d28d172789f06886806bc55",
        );
        let custom = write(
            &repo,
            "cargo-out/debug/incremental/app/s-abc/query-cache.bin",
            "",
        );
        assert!(!f.is_ignored(&src));
        assert!(f.is_ignored(&artifact));
        assert!(f.is_ignored(&fingerprint));
        assert!(f.is_ignored(&custom));
    }

    #[test]
    fn node_modules_and_tauri_gen_never_count() {
        let repo = tree("node");
        let mut f = filter_for(&repo);
        assert!(f.is_ignored(&write(&repo, "web/node_modules/react/index.js", "")));
        assert!(f.is_ignored(&write(
            &repo,
            "src-tauri/gen/schemas/acl-manifests.json",
            ""
        )));
        assert!(!f.is_ignored(&write(&repo, "src-tauri/src/lib.rs", "")));
    }

    #[test]
    fn gitignored_output_never_counts() {
        let repo = tree("gitignore");
        write(
            &repo,
            ".gitignore",
            "# build
/generated/
*.snap
!keep.snap
logs/
",
        );
        write(
            &repo,
            "web/.gitignore",
            "public/bundle
",
        );
        let mut f = filter_for(&repo);
        assert!(f.is_ignored(&write(&repo, "generated/api/client.ts", "")));
        assert!(!f.is_ignored(&write(&repo, "src/generated/real.ts", "")));
        assert!(f.is_ignored(&write(&repo, "tests/ui.snap", "")));
        assert!(!f.is_ignored(&write(&repo, "tests/keep.snap", "")));
        assert!(f.is_ignored(&write(&repo, "server/logs/today.txt", "")));
        assert!(f.is_ignored(&write(&repo, "web/public/bundle/app.js", "")));
        assert!(!f.is_ignored(&write(&repo, "public/bundle/app.js", "")));
        // A negation can't re-include a file inside an ignored folder
        write(
            &repo,
            "generated/.gitignore",
            "!*.ts
",
        );
        f.is_ignored(&repo.join("generated/.gitignore"));
        assert!(f.is_ignored(&write(&repo, "generated/other.ts", "")));
        // Real source still counts
        assert!(!f.is_ignored(&write(&repo, "src/main.ts", "")));
        assert!(!f.is_ignored(&repo.join(".gitignore")));
    }

    #[test]
    fn gitignore_edits_take_effect() {
        let repo = tree("refresh");
        write(
            &repo,
            ".gitignore",
            "*.tmpout
",
        );
        let mut f = filter_for(&repo);
        let file = write(&repo, "src/page.html", "");
        assert!(!f.is_ignored(&file));
        // The .gitignore's own change event drops the cached rules
        let gi = write(
            &repo,
            ".gitignore",
            "*.tmpout
*.html
",
        );
        assert!(!f.is_ignored(&gi));
        assert!(f.is_ignored(&file));
    }

    #[test]
    fn fixed_rules_start_at_the_watched_folder() {
        let outer = std::env::temp_dir().join(format!("drvibe-watch-{}-base", std::process::id()));
        let _ = std::fs::remove_dir_all(&outer);
        let repo = outer.join("build").join("my-app");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let mut f = filter_for(&repo);
        assert!(!f.is_ignored(&write(&repo, "src/lib.rs", "")));
    }

    /// Timing check over a real checkout: `DRVIBE_FILTER_ROOT=<repo> cargo test
    /// filter_timing -- --ignored --nocapture`. Prints counts only.
    #[test]
    #[ignore]
    fn filter_timing() {
        let Ok(root) = std::env::var("DRVIBE_FILTER_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let mut files = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                match e.file_type() {
                    Ok(t) if t.is_dir() => stack.push(e.path()),
                    Ok(t) if t.is_file() => files.push(e.path()),
                    _ => {}
                }
            }
        }
        let mut f = filter_for(&root);
        let started = std::time::Instant::now();
        let ignored = files.iter().filter(|p| f.is_ignored(p)).count();
        let first = started.elapsed();
        let started = std::time::Instant::now();
        let again = files.iter().filter(|p| f.is_ignored(p)).count();
        println!(
            "files={} ignored={} counted={} first_pass_ms={} cached_pass_ms={} same={}",
            files.len(),
            ignored,
            files.len() - ignored,
            first.as_millis(),
            started.elapsed().as_millis(),
            ignored == again
        );
    }
}
