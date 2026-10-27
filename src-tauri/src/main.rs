// Dr. Vibe - Desktop Companion
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod api;
mod claude_hooks;
mod deeplink;
#[cfg(test)]
mod e2e_bridge;
mod error_reports;
mod generator;
mod gitignore;
mod panels;
mod presence;
mod projects;
mod repos;
mod skins;
mod sync;
mod system;
#[cfg(test)]
mod test_util;
mod tray;
mod updates;
mod visitors;
mod watcher;

use crate::account::seed_web_base_url_from_store;
use crate::skins::run_vibe_id_backfill;
use crate::watcher::WatcherState;
use std::sync::Mutex;
use tauri::Manager;

/// The uninstaller runs the app once with this flag before removing it
/// (nsis/hooks.nsh): Dr. Vibe's Claude Code hooks and ~/.dr-vibe go, then
/// it exits without starting the app.
const UNINSTALL_CLEANUP_FLAG: &str = "--privacy-uninstall-cleanup";

fn main() {
    if std::env::args().any(|a| a == UNINSTALL_CLEANUP_FLAG) {
        if let Some(home) = system::dirs_home() {
            if let Err(e) = claude_hooks::remove_everything(&home) {
                eprintln!("[uninstall] Claude Code hooks: {e}");
            }
        }
        return;
    }

    // Set the Windows AppUserModelId so notifications show "Dr. Vibe"
    // instead of the parent process name (e.g. "Windows PowerShell")
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

        unsafe {
            let id = HSTRING::from(account::APP_ID);
            let _ = SetCurrentProcessExplicitAppUserModelID(&id);
        }
    }

    tauri::Builder::default()
        .manage(Mutex::new(WatcherState::default()))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            eprintln!("[dr-vibe] single-instance argv: {:?}", argv);
            // The deep-link plugin's automatic forwarding from single-instance
            // is unreliable on Windows dev builds, so we handle it here directly.
            for arg in &argv {
                deeplink::handle_url(app, arg);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // ── Dev server override: admin-only setting that redirects the app
            // to a different Dr. Vibe web server (production / staging /
            // localhost / custom). Must run before ANY code path that calls
            // web_base_url() — the OnceLock is fixed on first read.
            seed_web_base_url_from_store(app.handle());

            // ── Crash reports: panic hook + queued sends (off until chosen in
            // setup or Settings → Privacy). After the base URL is fixed.
            error_reports::init(app.handle());

            // "Sync my stats" (Settings → Privacy) holds back sharing calls.
            api::init_sync_enabled(app.handle());

            // ── vibeId backfill: ensure every Dr. Vibe sidecar has a stable id.
            // One-shot, idempotent, never deletes. Runs on every boot but only
            // writes when an .anim.json is missing a vibeId. See `run_vibe_id_backfill`.
            run_vibe_id_backfill(app.handle());

            account::migrate_legacy_token(app.handle());

            #[cfg(desktop)]
            {
                tray::build(app)?;
                updates::spawn_update_checker(app);
                deeplink::init(app);
                presence::spawn_watcher(app.handle());
            }

            // Pre-declared panel windows must hide (not destroy) on close so
            // they can be re-shown later — WebviewWindowBuilder::build() deadlocks
            // when called from a command handler on Windows.
            for label in ["character-workshop", "sprite-editor"] {
                if let Some(win) = app.get_webview_window(label) {
                    let w = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = w.hide();
                        }
                    });
                }
            }

            // Auto-open devtools for the main window in dev builds
            #[cfg(debug_assertions)]
            {
                if let Some(main_win) = app.get_webview_window("main") {
                    main_win.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::get_active_window,
            system::is_coding_app,
            system::get_cursor_position,
            system::last_input_age_ms,
            projects::scan_project_markers,
            repos::resolve_repo,
            repos::find_folder_repos,
            repos::untracked_places,
            watcher::start_watching,
            watcher::stop_watching,
            watcher::get_watched_path,
            skins::list_skins,
            skins::read_skin,
            skins::read_skin_anim,
            skins::read_skin_vibe_id,
            skins::save_skin,
            skins::delete_skin,
            skins::copy_skin,
            skins::set_skin_source,
            skins::rename_skin,
            system::quit_app,
            system::restart_app,
            account::set_web_base_override,
            account::get_web_base_url,
            tray::set_tray_tooltip,
            tray::set_tray_paused,
            system::set_main_window_size,
            panels::open_settings_window,
            panels::open_dashboard_window,
            panels::open_sprite_editor,
            panels::open_character_workshop,
            panels::open_panel_window,
            claude_hooks::read_claude_code_events,
            claude_hooks::install_claude_code_hooks,
            claude_hooks::uninstall_claude_code_hooks,
            claude_hooks::check_claude_code_hooks,
            claude_hooks::claude_code_present,
            claude_hooks::set_hook_tracked_repos,
            claude_hooks::set_hook_paused,
            generator::check_claude_installed,
            generator::check_codex_installed,
            generator::cancel_generation,
            generator::generate_character,
            generator::regenerate_character,
            updates::check_for_updates,
            updates::check_whats_new,
            updates::dismiss_whats_new,
            projects::get_git_info,
            skins::install_skin_from_urls,
            skins::cache_companion_skin,
            tray::update_companions_tray,
            skins::import_skin,
            skins::export_skin,
            skins::save_sprite_template,
            account::get_profile,
            account::update_profile,
            account::disconnect_profile,
            account::start_device_link,
            api::api_request,
            api::api_poll,
            api::api_ack,
            api::api_send_events,
            api::api_send_visit,
            api::api_update_privacy,
            api::api_collection,
            api::api_set_equipped,
            api::api_send_recap,
            api::api_submit_design,
            sync::sync_profile,
            sync::get_last_sync,
            sync::preview_sync_payload,
            api::set_sync_enabled,
            presence::get_presenting_state,
            visitors::cache_visitor_sprite,
            panels::set_visitor_frame,
            generator::patch_character,
            generator::accept_character_patch,
            generator::discard_character_draft,
            panels::create_toast_window,
            system::get_monitor_work_areas,
            system::pick_folder,
            error_reports::error_report,
            error_reports::error_reports_get_enabled,
            error_reports::error_reports_set_enabled,
            error_reports::error_reports_queue,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
