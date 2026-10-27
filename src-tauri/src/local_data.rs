//! Settings → Privacy: "Export my local data" and "Delete all local data".
//!
//! The export is one JSON file, saved where the player picks (dialog
//! plugin): the app's data store, the Claude Code files Dr. Vibe keeps in
//! `~/.dr-vibe` and the queued crash reports. The device token is never in
//! it.
//!
//! The wipe removes everything Dr. Vibe keeps on this computer except the
//! player's own skins: the data store (the main window clears its
//! localStorage mirror first, see Database.wipe), the Claude Code hooks and
//! `~/.dr-vibe`, the crash report queue and switch, the visitor sprite
//! cache, the generator's temp files and the device token (revoked on the
//! server first, like signing out). The app then restarts into first-run
//! setup.

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::system::dirs_home;

const STORE_FILE: &str = "dr-vibe-data.json";

/// Text files from `~/.dr-vibe` that go into the export, with the most
/// bytes read from each.
const EXPORTED_HOOK_FILES: [(&str, u64); 4] = [
    ("tracked.txt", 1 << 20),
    ("paused-until", 1 << 10),
    ("claude-code-events.jsonl", 16 << 20),
    ("claude-code-events.jsonl.old", 16 << 20),
];

/// The export document.
pub(crate) fn export_document(
    store: Vec<(String, serde_json::Value)>,
    home: Option<&Path>,
    crash_reports: Vec<crate::error_reports::Report>,
) -> serde_json::Value {
    let mut data = serde_json::Map::new();
    for (k, v) in store {
        data.insert(k, v);
    }
    let mut hook_files = serde_json::Map::new();
    if let Some(home) = home {
        let dir = home.join(".dr-vibe");
        for (name, max) in EXPORTED_HOOK_FILES {
            let path = dir.join(name);
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            let text = if meta.len() <= max {
                std::fs::read_to_string(&path).unwrap_or_default()
            } else {
                format!("({} bytes, too large to include)", meta.len())
            };
            hook_files.insert(name.to_string(), serde_json::Value::String(text));
        }
    }
    serde_json::json!({
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "app": format!("Dr. Vibe {}", env!("CARGO_PKG_VERSION")),
        "note": "Everything Dr. Vibe keeps on this computer, except your skins (in the skins folder) and the device token (in the OS keyring, never exported).",
        "dataStore": data,
        "claudeCodeFiles": hook_files,
        "queuedCrashReports": crash_reports,
    })
}

/// "Export my local data": asks where to save, writes the JSON. Returns the
/// path written, or None when the player cancelled.
#[tauri::command]
pub(crate) async fn export_local_data(
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_store::StoreExt;
    let store = app_handle
        .store(STORE_FILE)
        .map_err(|e| format!("Store error: {e}"))?;
    let doc = export_document(
        store.entries(),
        dirs_home().as_deref(),
        crate::error_reports::error_reports_queue(),
    );
    let name = format!(
        "dr-vibe-local-data-{}.json",
        chrono::Local::now().format("%Y-%m-%d")
    );
    let dialog = app_handle.dialog().clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name(name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Could not save the file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Temp files and folders the generator may have left: prompt files, the
/// shared scripts folder and work folders.
pub(crate) fn generator_leftovers(temp: &Path) -> Vec<PathBuf> {
    let fixed = [
        "dr-vibe-char-prompt.txt",
        "dr-vibe-patch-prompt.txt",
        "dr-vibe-generator",
    ];
    let mut out: Vec<PathBuf> = fixed
        .iter()
        .map(|n| temp.join(n))
        .filter(|p| p.exists())
        .collect();
    if let Ok(entries) = std::fs::read_dir(temp) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with("dr-vibe-generate-") || name.starts_with("dr-vibe-agent-") {
                out.push(e.path());
            }
        }
    }
    out
}

fn remove_path(p: &Path) {
    let _ = if p.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };
}

/// "Delete all local data". The main window has already stopped writing and
/// cleared its localStorage mirror; it restarts the app afterwards.
#[tauri::command]
pub(crate) async fn wipe_local_data(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    // The token: revoked on the server (best effort) and removed here.
    let _ = crate::account::disconnect_profile(app_handle.clone()).await;

    let mut problems = Vec::new();
    if let Some(home) = dirs_home() {
        if let Err(e) = crate::claude_hooks::remove_everything(&home) {
            problems.push(format!("Claude Code hooks: {e}"));
        }
    }
    crate::error_reports::forget_all();
    if let Ok(cache) = app_handle.path().app_cache_dir() {
        remove_path(&cache.join("visitors"));
    }
    for p in generator_leftovers(&std::env::temp_dir()) {
        remove_path(&p);
    }
    match app_handle.store(STORE_FILE) {
        Ok(store) => {
            store.clear();
            if let Err(e) = store.save() {
                problems.push(format!("data store: {e}"));
            }
        }
        Err(e) => problems.push(format!("data store: {e}")),
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TempDir;

    #[test]
    fn export_holds_the_store_and_hook_files_but_never_a_token() {
        let dir = TempDir::new("export-home");
        let home = dir.path();
        std::fs::create_dir_all(home.join(".dr-vibe")).unwrap();
        std::fs::write(home.join(".dr-vibe/tracked.txt"), "c:/work/app\n").unwrap();
        std::fs::write(
            home.join(".dr-vibe/claude-code-events.jsonl"),
            "{\"event\":\"session_start\"}\n",
        )
        .unwrap();
        let doc = export_document(
            vec![
                (
                    "settings".into(),
                    serde_json::json!({ "syncEnabled": true }),
                ),
                ("installId".into(), serde_json::json!("abc12345")),
            ],
            Some(home),
            vec![],
        );
        assert_eq!(doc["dataStore"]["settings"]["syncEnabled"], true);
        assert_eq!(doc["claudeCodeFiles"]["tracked.txt"], "c:/work/app\n");
        assert!(doc["claudeCodeFiles"]["claude-code-events.jsonl"]
            .as_str()
            .unwrap()
            .contains("session_start"));
        assert!(doc["claudeCodeFiles"].get("claude-code-hook.sh").is_none());
        assert!(!doc.to_string().contains("dvd_"));
        assert_eq!(doc["queuedCrashReports"], serde_json::json!([]));
    }

    #[test]
    fn finds_the_generator_leftovers_only() {
        let dir = TempDir::new("gen-leftovers");
        let t = dir.path();
        for f in [
            "dr-vibe-char-prompt.txt",
            "dr-vibe-patch-prompt.txt",
            "other.txt",
        ] {
            std::fs::write(t.join(f), "x").unwrap();
        }
        for d in [
            "dr-vibe-generator",
            "dr-vibe-generate-1-2",
            "dr-vibe-agent-ab12",
            "dr-vibe-keep",
        ] {
            std::fs::create_dir_all(t.join(d)).unwrap();
        }
        let mut found: Vec<String> = generator_leftovers(t)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        found.sort();
        assert_eq!(
            found,
            [
                "dr-vibe-agent-ab12",
                "dr-vibe-char-prompt.txt",
                "dr-vibe-generate-1-2",
                "dr-vibe-generator",
                "dr-vibe-patch-prompt.txt"
            ]
        );
    }
}
