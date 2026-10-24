//! What's New and the auto-updater.

use tauri::Emitter;

/// Returns the current app version string if "What's New" should be shown
/// (first launch after an update, and user hasn't disabled the feature).
/// Marks the version as seen so it only fires once per update. A fresh
/// install has no previous version: it records the current one silently.
#[tauri::command]
pub(crate) fn check_whats_new(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_store::StoreExt;
    let current_version = env!("CARGO_PKG_VERSION");
    if let Ok(store) = app.store("dr-vibe-data.json") {
        let disabled = store
            .get("whatsNewDisabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let last_version = store
            .get("lastWhatsNewVersion")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        if last_version.as_deref() != Some(current_version) {
            store.set("lastWhatsNewVersion", serde_json::json!(current_version));
            let _ = store.save();
        }
        if !disabled && is_upgrade(last_version.as_deref(), current_version) {
            return Some(current_version.to_string());
        }
    }
    None
}

/// True when this launch follows an upgrade from a version that already
/// recorded itself; a fresh profile (no previous version) is not an upgrade.
pub(crate) fn is_upgrade(last_version: Option<&str>, current_version: &str) -> bool {
    matches!(last_version, Some(v) if !v.is_empty() && v != current_version)
}

/// Called from the "What's New" panel when the user dismisses it.
/// If `disable_forever` is true, sets a store flag to never show it again.
#[tauri::command]
pub(crate) fn dismiss_whats_new(
    app: tauri::AppHandle,
    disable_forever: bool,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    if disable_forever {
        if let Ok(store) = app.store("dr-vibe-data.json") {
            store.set("whatsNewDisabled", serde_json::json!(true));
            let _ = store.save();
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn check_for_updates(app: tauri::AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;
        let _ = app_handle.emit(
            "update-check-status",
            serde_json::json!({"status": "checking"}),
        );
        match app_handle.updater() {
            Ok(updater) => {
                match updater.check().await {
                    Ok(Some(update)) => {
                        let version = update.version.clone();
                        let _ = app_handle.emit(
                            "update-check-status",
                            serde_json::json!({"status": "update_available", "version": version}),
                        );
                        let _ = app_handle.emit("update-download-start", &version);
                        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                            let _ = app_handle.emit(
                                "update-check-status",
                                serde_json::json!({"status": "restarting"}),
                            );
                            app_handle.restart();
                        } else {
                            let _ = app_handle.emit("update-check-status", serde_json::json!({"status": "error", "message": "Download failed"}));
                        }
                    }
                    Ok(None) => {
                        let _ = app_handle.emit(
                            "update-check-status",
                            serde_json::json!({"status": "up_to_date"}),
                        );
                    }
                    Err(e) => {
                        let _ = app_handle.emit(
                            "update-check-status",
                            serde_json::json!({"status": "error", "message": e.to_string()}),
                        );
                    }
                }
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "update-check-status",
                    serde_json::json!({"status": "error", "message": e.to_string()}),
                );
            }
        }
    });
    Ok(())
}

/// Auto-check for updates: initial check after 30s, then every 4 hours.
pub(crate) fn spawn_update_checker(app: &tauri::App) {
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;
        // Wait before first check so the app finishes initializing
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        loop {
            if let Ok(updater) = app_handle.updater() {
                if let Ok(Some(update)) = updater.check().await {
                    let _ = app_handle.emit("update-available", &update.version);
                }
            }
            // Re-check every 4 hours
            tokio::time::sleep(std::time::Duration::from_secs(4 * 60 * 60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_upgrade;

    #[test]
    fn whats_new_shows_only_after_an_upgrade() {
        assert!(!is_upgrade(None, "2.0.0"), "fresh install");
        assert!(!is_upgrade(Some(""), "2.0.0"));
        assert!(!is_upgrade(Some("2.0.0"), "2.0.0"), "already seen");
        assert!(is_upgrade(Some("1.9.3"), "2.0.0"));
    }
}
