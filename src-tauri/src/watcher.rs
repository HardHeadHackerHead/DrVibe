//! Project file watcher (notify) and its ignore rules.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// Global file watcher state — one notify watcher that can watch multiple paths.
#[derive(Default)]
pub(crate) struct WatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub event_type: String, // "create", "modify", "delete"
    pub path: String,
    pub timestamp: u64,
}

// Directories/extensions to ignore when watching for file changes
pub(crate) fn should_ignore_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();

    // Ignore hidden dirs and common non-source dirs
    let ignore_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        "__pycache__",
        ".next",
        ".nuxt",
        ".svelte-kit",
        ".venv",
        "venv",
        ".tox",
        ".mypy_cache",
        ".pytest_cache",
        ".cargo",
    ];
    for dir in &ignore_dirs {
        if path_str.contains(&format!("{}{}", std::path::MAIN_SEPARATOR, dir))
            || path_str.contains(&format!("{}{}{}", dir, std::path::MAIN_SEPARATOR, ""))
        {
            return true;
        }
    }

    // Ignore common non-source extensions
    let ignore_ext = [
        "lock", "log", "tmp", "swp", "swo", "pyc", "pyo", "o", "obj", "exe", "dll", "so", "dylib",
        "class", "jar",
    ];
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if ignore_ext.contains(&ext) {
            return true;
        }
    }

    false
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
pub(crate) fn make_watcher(app_handle: tauri::AppHandle) -> Result<RecommendedWatcher, String> {
    let handle = app_handle.clone();
    RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if let Some(event_type) = event_kind_to_string(&event.kind) {
                    for event_path in &event.paths {
                        if should_ignore_path(event_path) {
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
        state.watcher = Some(make_watcher(app_handle.clone())?);
    }

    state
        .watcher
        .as_mut()
        .unwrap()
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    state.watched_paths.push(path.clone());
    Ok(format!("Watching: {}", path))
}

#[tauri::command]
pub(crate) fn stop_watching(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;

    state.watcher = None;
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
}
