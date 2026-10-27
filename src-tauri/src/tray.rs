//! System tray: menu, tooltip and the "My Companions" submenu.

use crate::account::web_base_url;
use crate::panels::open_panel;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// Tray menu state for dynamic show/hide toggle and the Pause tracking submenu
pub(crate) struct TrayMenuState {
    pub(crate) toggle_item: tauri::menu::MenuItem<tauri::Wry>,
    pub(crate) pause_menu: PauseMenu,
}

/// Whether tracking is paused (TrackingPause in the main window tells us).
static TRACKING_PAUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// "Pause tracking" items: (menu id, label, the mode sent to the main window).
pub(crate) const PAUSE_ITEMS: &[(&str, &str, &str)] = &[
    ("pause_1h", "For 1 hour", "1h"),
    ("pause_tomorrow", "Until tomorrow", "tomorrow"),
    ("pause_manual", "Until I resume", "manual"),
    ("pause_resume", "Resume tracking", "resume"),
];

/// The Pause tracking submenu and its Resume item, kept to relabel them.
#[derive(Clone)]
pub(crate) struct PauseMenu {
    submenu: tauri::menu::Submenu<tauri::Wry>,
    resume: tauri::menu::MenuItem<tauri::Wry>,
}

fn pause_title(paused: bool) -> &'static str {
    if paused {
        "Tracking paused"
    } else {
        "Pause tracking"
    }
}

fn pause_menu<M: Manager<tauri::Wry>>(manager: &M) -> tauri::Result<PauseMenu> {
    use tauri::menu::{MenuItem, Submenu};
    let paused = TRACKING_PAUSED.load(std::sync::atomic::Ordering::Relaxed);
    let items = PAUSE_ITEMS
        .iter()
        .map(|(id, label, _)| {
            let enabled = (*id == "pause_resume") == paused;
            MenuItem::with_id(manager, *id, *label, enabled, None::<&str>)
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let submenu = Submenu::with_items(manager, pause_title(paused), true, refs.as_slice())?;
    let resume = items.last().cloned().expect("resume item");
    Ok(PauseMenu { submenu, resume })
}

/// The main window's TrackingPause reports the state: relabel the submenu.
#[tauri::command]
pub(crate) fn set_tray_paused(app_handle: tauri::AppHandle, paused: bool) {
    TRACKING_PAUSED.store(paused, std::sync::atomic::Ordering::Relaxed);
    #[cfg(desktop)]
    if let Ok(guard) = app_handle.state::<Mutex<TrayMenuState>>().lock() {
        let _ = guard.pause_menu.submenu.set_text(pause_title(paused));
        let _ = guard.pause_menu.resume.set_enabled(paused);
        if let Ok(items) = guard.pause_menu.submenu.items() {
            for item in items {
                if let Some(mi) = item.as_menuitem() {
                    if mi.id().as_ref() != "pause_resume" {
                        let _ = mi.set_enabled(!paused);
                    }
                }
            }
        }
    }
}

/// Mode for a Pause tracking menu id.
pub(crate) fn pause_mode(id: &str) -> Option<&'static str> {
    PAUSE_ITEMS
        .iter()
        .find(|(i, _, _)| *i == id)
        .map(|(_, _, m)| *m)
}

// Holds the main tray icon handle so JS can call set_tray_tooltip.
// Desktop-only since system tray is a desktop feature.
#[cfg(desktop)]
pub(crate) struct MainTrayIcon(pub(crate) tauri::tray::TrayIcon);

// Companion tray state: the companion list and currently equipped ID,
// updated at runtime via update_companions_tray.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct CompanionTrayItem {
    id: String,
    name: String,
}

#[cfg(desktop)]
pub(crate) struct CompanionTrayState {
    pub(crate) companions: Mutex<Vec<CompanionTrayItem>>,
    pub(crate) equipped_id: Mutex<Option<String>>,
}

/// Update the system tray tooltip from JS (e.g. to show Socket.io connection status).
#[tauri::command]
pub(crate) fn set_tray_tooltip(app_handle: tauri::AppHandle, tooltip: String) {
    #[cfg(desktop)]
    {
        let state = app_handle.state::<MainTrayIcon>();
        let _ = state.0.set_tooltip(Some(&tooltip));
    }
}

/// Rebuild the tray "My Companions" submenu from the JS-provided companion list.
/// Also updates TrayMenuState so the toggle label still works.
#[tauri::command]
pub(crate) fn update_companions_tray(
    companions: Vec<CompanionTrayItem>,
    equipped_id: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

        // Store companion state so the menu event handler can read it
        let ct = app_handle.state::<CompanionTrayState>();
        *ct.companions.lock().map_err(|e| e.to_string())? = companions.clone();
        *ct.equipped_id.lock().map_err(|e| e.to_string())? = equipped_id.clone();

        let tray_state = app_handle.state::<MainTrayIcon>();

        // Determine current window visibility for the toggle label
        let toggle_text = app_handle
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .map(|v| if v { "Hide" } else { "Show" })
            .unwrap_or("Hide");

        // Rebuild static menu items (same IDs → event handler still works)
        let toggle = MenuItem::with_id(
            &app_handle,
            "toggle_visibility",
            toggle_text,
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        let session_stats = MenuItem::with_id(
            &app_handle,
            "session_stats",
            "Session Stats",
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        let settings_item =
            MenuItem::with_id(&app_handle, "settings", "Settings", true, None::<&str>)
                .map_err(|e| e.to_string())?;
        let dashboard =
            MenuItem::with_id(&app_handle, "dashboard", "Dashboard", true, None::<&str>)
                .map_err(|e| e.to_string())?;
        let make = MenuItem::with_id(&app_handle, "make_drvibe", MAKE_LABEL, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let about = MenuItem::with_id(&app_handle, "about", "About", true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let pause = pause_menu(&app_handle).map_err(|e| e.to_string())?;
        let quit = MenuItem::with_id(&app_handle, "quit", "Quit Dr. Vibe", true, None::<&str>)
            .map_err(|e| e.to_string())?;

        // Build My Companions submenu items
        let collection = MenuItem::with_id(
            &app_handle,
            "companion_collection",
            "My Collection…",
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;

        let mut sub_items: Vec<MenuItem<tauri::Wry>> = if companions.is_empty() {
            vec![MenuItem::with_id(
                &app_handle,
                "companion_none",
                "No companions yet",
                false,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?]
        } else {
            companions
                .iter()
                .map(|c| {
                    let label = if equipped_id.as_deref() == Some(c.id.as_str()) {
                        format!("✓ {}", c.name)
                    } else {
                        c.name.clone()
                    };
                    MenuItem::with_id(
                        &app_handle,
                        format!("companion_equip_{}", c.id),
                        label,
                        true,
                        None::<&str>,
                    )
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        sub_items.push(collection);

        // Build the submenu from dynamic items via trait object refs
        let sub_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = sub_items
            .iter()
            .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
            .collect();
        let companions_submenu =
            Submenu::with_items(&app_handle, "My Companions", true, sub_refs.as_slice())
                .map_err(|e| e.to_string())?;

        // Website shortcut items (rebuilt alongside static items)
        let sep_links = PredefinedMenuItem::separator(&app_handle).map_err(|e| e.to_string())?;
        let links = web_link_items(&app_handle).map_err(|e| e.to_string())?;

        // Assemble the full menu. Use explicit trait-object casts so Rust can
        // unify MenuItem<Wry>, PredefinedMenuItem<Wry>, and Submenu<Wry> in the same slice.
        type TI = dyn tauri::menu::IsMenuItem<tauri::Wry>;

        #[cfg(debug_assertions)]
        let new_menu = {
            let devtools =
                MenuItem::with_id(&app_handle, "devtools", "Dev Tools", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
            let debug_menu =
                MenuItem::with_id(&app_handle, "debug_menu", "Debug Menu", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
            let items: &[&TI] = &[
                &toggle as &TI,
                &session_stats,
                &settings_item,
                &dashboard,
                &make,
                &about,
                &pause.submenu,
                &companions_submenu,
                &devtools,
                &debug_menu,
                &sep_links as &TI,
            ];
            let mut items: Vec<&TI> = items.to_vec();
            items.extend(links.iter().map(|i| i as &TI));
            items.push(&quit);
            Menu::with_items(&app_handle, &items).map_err(|e| e.to_string())?
        };
        #[cfg(not(debug_assertions))]
        let new_menu = {
            let items: &[&TI] = &[
                &toggle as &TI,
                &session_stats,
                &settings_item,
                &dashboard,
                &make,
                &about,
                &pause.submenu,
                &companions_submenu,
                &sep_links as &TI,
            ];
            let mut items: Vec<&TI> = items.to_vec();
            items.extend(links.iter().map(|i| i as &TI));
            items.push(&quit);
            Menu::with_items(&app_handle, &items).map_err(|e| e.to_string())?
        };

        // Apply the rebuilt menu to the tray icon
        tray_state
            .0
            .set_menu(Some(new_menu))
            .map_err(|e| e.to_string())?;

        // Keep TrayMenuState in sync so the toggle_visibility handler can update the label
        if let Ok(mut guard) = app_handle.state::<Mutex<TrayMenuState>>().lock() {
            guard.toggle_item = toggle;
            guard.pause_menu = pause;
        }
    }
    Ok(())
}

/// Build the tray icon and its menu.
#[cfg(desktop)]
pub(crate) fn build(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let toggle = MenuItem::with_id(app, "toggle_visibility", "Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Dr. Vibe", true, None::<&str>)?;
    let session_stats =
        MenuItem::with_id(app, "session_stats", "Session Stats", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
    let make = MenuItem::with_id(app, "make_drvibe", MAKE_LABEL, true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
    let pause = pause_menu(app)?;

    // Website shortcut items
    let sep_links = PredefinedMenuItem::separator(app)?;
    let links = web_link_items(app)?;

    #[cfg(debug_assertions)]
    let devtools = MenuItem::with_id(app, "devtools", "Dev Tools", true, None::<&str>)?;
    #[cfg(debug_assertions)]
    let debug_menu = MenuItem::with_id(app, "debug_menu", "Debug Menu", true, None::<&str>)?;

    app.manage(Mutex::new(TrayMenuState {
        toggle_item: toggle.clone(),
        pause_menu: pause.clone(),
    }));
    app.manage(CompanionTrayState {
        companions: Mutex::new(Vec::new()),
        equipped_id: Mutex::new(None),
    });

    type TI = dyn tauri::menu::IsMenuItem<tauri::Wry>;
    let mut items: Vec<&TI> = vec![
        &toggle,
        &session_stats,
        &settings,
        &dashboard,
        &make,
        &about,
        &pause.submenu,
    ];
    #[cfg(debug_assertions)]
    items.extend([&devtools as &TI, &debug_menu]);
    items.push(&sep_links);
    items.extend(links.iter().map(|i| i as &TI));
    items.push(&quit);
    let menu = Menu::with_items(app, &items)?;

    // macOS tints a black template silhouette for the menu bar; elsewhere the
    // coloured head (with its dark outline) reads on light and dark taskbars.
    #[cfg(target_os = "macos")]
    let (tray_png, as_template) = (&include_bytes!("../icons/tray-template.png")[..], true);
    #[cfg(not(target_os = "macos"))]
    let (tray_png, as_template) = (&include_bytes!("../icons/tray.png")[..], false);

    let tray_icon = TrayIconBuilder::new()
        .icon(tauri::image::Image::from_bytes(tray_png).expect("failed to load tray icon"))
        .icon_as_template(as_template)
        .menu(&menu)
        .tooltip("Dr. Vibe - Desktop Companion")
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "quit" => {
                    // Open Today's Wins window directly from Rust (like other panels)
                    // Opening from JS invoke can result in a blank white WebView
                    let _ = open_panel(
                        app.clone(),
                        "today-wins".into(),
                        "today-wins.html".into(),
                        "Today's Wins".into(),
                        360.0,
                        520.0,
                        true,
                        true,
                    );
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.emit("tray-quit", ());
                    } else {
                        app.exit(0);
                    }
                }
                "toggle_visibility" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(true);
                        if is_visible {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        // Update the toggle label for next time
                        let state = app.state::<Mutex<TrayMenuState>>();
                        let guard = state.lock();
                        if let Ok(guard) = guard {
                            let _ = guard.toggle_item.set_text(if is_visible {
                                "Show"
                            } else {
                                "Hide"
                            });
                        }
                    }
                }
                "session_stats" => {
                    let _ = open_panel(
                        app.clone(),
                        "session".into(),
                        "session.html".into(),
                        "Session Stats".into(),
                        350.0,
                        560.0,
                        false,
                        false,
                    );
                }
                "settings" => {
                    let _ = open_panel(
                        app.clone(),
                        "settings".into(),
                        "settings.html".into(),
                        "Dr. Vibe Settings".into(),
                        640.0,
                        640.0,
                        false,
                        false,
                    );
                }
                "dashboard" => {
                    let _ = open_panel(
                        app.clone(),
                        "dashboard".into(),
                        "dashboard.html".into(),
                        "Dr. Vibe Dashboard".into(),
                        520.0,
                        680.0,
                        true,
                        false,
                    );
                }
                "make_drvibe" => {
                    let _ = open_panel(
                        app.clone(),
                        "make".into(),
                        "make.html".into(),
                        MAKE_LABEL.trim_end_matches('…').into(),
                        980.0,
                        680.0,
                        true,
                        true,
                    );
                }
                "about" => {
                    let _ = open_panel(
                        app.clone(),
                        "about".into(),
                        "about.html".into(),
                        "About Dr. Vibe".into(),
                        320.0,
                        580.0,
                        false,
                        false,
                    );
                }
                "devtools" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                }
                "debug_menu" => {
                    let _ = open_panel(
                        app.clone(),
                        "debug".into(),
                        "debug.html".into(),
                        "Debug Menu".into(),
                        750.0,
                        600.0,
                        true,
                        true,
                    );
                }
                // "My Collection…" in the My Companions submenu
                "companion_collection" => open_web_link(app, "open_collection"),
                // Individual companion equip items: id = "companion_equip_{companionId}"
                id if id.starts_with("companion_equip_") => {
                    let companion_id = id["companion_equip_".len()..].to_string();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit(
                            "companion-tray-equip",
                            serde_json::json!({ "id": companion_id }),
                        );
                    }
                }
                // Pause tracking: the main window's TrackingPause does it
                id if pause_mode(id).is_some() => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit(
                            "pause-tracking",
                            serde_json::json!({ "mode": pause_mode(id) }),
                        );
                    }
                }
                // Website shortcuts
                id if id.starts_with("open_") => open_web_link(app, id),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // Update toggle label since window is now visible
                    let state = app.state::<Mutex<TrayMenuState>>();
                    let guard = state.lock();
                    if let Ok(guard) = guard {
                        let _ = guard.toggle_item.set_text("Hide");
                    }
                }
            }
        })
        .build(app)?;

    // Store the tray icon handle so set_tray_tooltip can update it from JS
    app.manage(MainTrayIcon(tray_icon));
    Ok(())
}

/// "Make your own Dr. Vibe" — open to every player (PLAN → Desktop app).
pub(crate) const MAKE_LABEL: &str = "Make your own Dr. Vibe…";

/// Website shortcuts shown at the bottom of the tray menu: (menu id, label).
/// `web_link_path` maps each id to its route on the site.
pub(crate) const WEB_LINKS: &[(&str, &str)] = &[
    ("open_machines", "Open the Machines"),
    ("open_collection", "My Collection"),
    ("open_trades", "Trades"),
    ("open_profile", "My Profile"),
    ("open_donate", "Support Dr. Vibe"),
];

fn web_link_items<M: Manager<tauri::Wry>>(
    manager: &M,
) -> tauri::Result<Vec<tauri::menu::MenuItem<tauri::Wry>>> {
    WEB_LINKS
        .iter()
        .map(|(id, label)| tauri::menu::MenuItem::with_id(manager, *id, *label, true, None::<&str>))
        .collect()
}

/// Route on the website for a tray link. `username` is the linked account's
/// handle, if any (the profile link falls back to `/me`, which signs in, when unlinked).
pub(crate) fn web_link_path(id: &str, username: Option<&str>) -> Option<String> {
    Some(match id {
        "open_machines" => "/machines".to_string(),
        "open_collection" => "/collection".to_string(),
        "open_trades" => "/trades".to_string(),
        "open_donate" => "/donate".to_string(),
        "open_profile" => match username.filter(|u| !u.is_empty()) {
            Some(u) => format!(
                "/u/{}",
                url::form_urlencoded::byte_serialize(u.as_bytes()).collect::<String>()
            ),
            None => "/me".to_string(),
        },
        _ => return None,
    })
}

fn open_web_link(app: &tauri::AppHandle, id: &str) {
    use tauri_plugin_opener::OpenerExt;
    use tauri_plugin_store::StoreExt;
    let username = app
        .store("dr-vibe-data.json")
        .ok()
        .and_then(|store| store.get("profile"))
        .and_then(|v| v.get("username").cloned())
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(path) = web_link_path(id, username.as_deref()) {
        let url = format!("{}{}", web_base_url(), path);
        if let Err(e) = app.opener().open_url(&url, None::<&str>) {
            eprintln!("[tray] failed to open {url}: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_links_have_no_marketplace() {
        assert!(WEB_LINKS
            .iter()
            .all(|(id, label)| !id.contains("marketplace") && !label.contains("Marketplace")));
        for want in ["My Collection", "Trades", "Support Dr. Vibe"] {
            assert!(WEB_LINKS.iter().any(|(_, l)| *l == want), "missing {want}");
        }
    }

    #[test]
    fn pause_items_map_to_modes() {
        assert_eq!(pause_mode("pause_1h"), Some("1h"));
        assert_eq!(pause_mode("pause_tomorrow"), Some("tomorrow"));
        assert_eq!(pause_mode("pause_manual"), Some("manual"));
        assert_eq!(pause_mode("pause_resume"), Some("resume"));
        assert_eq!(pause_mode("open_trades"), None);
    }

    #[test]
    fn tray_link_paths() {
        assert_eq!(
            web_link_path("open_collection", None).as_deref(),
            Some("/collection")
        );
        assert_eq!(
            web_link_path("open_trades", None).as_deref(),
            Some("/trades")
        );
        assert_eq!(
            web_link_path("open_donate", None).as_deref(),
            Some("/donate")
        );
        assert_eq!(
            web_link_path("open_profile", Some("ada")).as_deref(),
            Some("/u/ada")
        );
        assert_eq!(web_link_path("open_profile", None).as_deref(), Some("/me"));
        assert_eq!(web_link_path("open_marketplace", None), None);
        for (id, _) in WEB_LINKS {
            assert!(web_link_path(id, None).is_some(), "{id} has no route");
        }
    }
}
