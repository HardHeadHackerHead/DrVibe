//! Panel, toast and workshop windows.

use crate::generator::GenerationSlot;
use tauri::Manager;

/// Create a single toast popup window at the given logical-pixel position.
/// Called by the toast manager (toast-window.js) for each incoming notification.
/// MUST be async — synchronous WebviewWindowBuilder::build() deadlocks on Windows
/// due to a WebView2 issue (wry#583).
#[tauri::command]
pub(crate) async fn create_toast_window(
    app_handle: tauri::AppHandle,
    label: String,
    url_path: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(&app_handle, &label, tauri::WebviewUrl::App(url_path.into()))
        .title("Dr. Vibe Notification")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .position(x, y)
        .inner_size(width, height)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_settings_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_panel(
        app_handle,
        "settings".into(),
        "settings.html".into(),
        "Dr. Vibe Settings".into(),
        640.0,
        640.0,
        false,
        false,
    )
}

#[tauri::command]
pub(crate) async fn open_dashboard_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_panel(
        app_handle,
        "dashboard".into(),
        "dashboard.html".into(),
        "Dr. Vibe Dashboard".into(),
        520.0,
        680.0,
        true,
        false,
    )
}

/// True for the slugs skin files are saved under (letters, digits, `-`, `_`).
/// Slugs end up inside a `window.location.replace('…')` script, so anything
/// else is refused rather than escaped.
pub(crate) fn is_safe_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 128
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Page the sprite editor opens on. `mode` is `edit` (that skin), `template`
/// (a new design that starts from that skin) or `blank` (an empty sheet).
/// With no slug and no mode it opens on its built-in template.
pub(crate) fn sprite_editor_url(slug: &str, mode: &str) -> Result<String, String> {
    if mode == "blank" {
        return Ok("sprite-editor.html?new=blank".to_string());
    }
    if slug.is_empty() && mode != "template" {
        return Ok("sprite-editor.html".to_string());
    }
    if !is_safe_slug(slug) {
        return Err(format!("Invalid skin name: {slug}"));
    }
    Ok(match mode {
        "template" => format!("sprite-editor.html?from={slug}"),
        _ => format!("sprite-editor.html?skin={slug}"),
    })
}

/// The workshop only changes an existing character; new ones are made in
/// "Make your own Dr. Vibe".
pub(crate) fn workshop_url(slug: &str, agent: &str) -> Result<String, String> {
    if !is_safe_slug(slug) {
        return Err("Pick a Dr. Vibe to change first.".to_string());
    }
    let agent = if agent == "codex" { "codex" } else { "claude" };
    Ok(format!("character-workshop.html?skin={slug}&agent={agent}"))
}

#[tauri::command]
pub(crate) fn open_sprite_editor(
    slug: String,
    mode: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let url = sprite_editor_url(&slug, mode.as_deref().unwrap_or("edit"))?;
    let window = app_handle
        .get_webview_window("sprite-editor")
        .ok_or_else(|| "sprite-editor window not found".to_string())?;
    window
        .eval(format!("window.location.replace('{}')", url))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn open_character_workshop(
    app_handle: tauri::AppHandle,
    slug: String,
    agent: String,
) -> Result<(), String> {
    // Block navigation while AI generation is running
    if GenerationSlot::busy() {
        return Err("Cannot navigate while character generation is in progress. Cancel the generation first.".to_string());
    }
    let nav_url = workshop_url(&slug, &agent)?;

    let window = app_handle
        .get_webview_window("character-workshop")
        .ok_or_else(|| "character-workshop window not found".to_string())?;

    let nav_js = format!("window.location.replace('{}')", nav_url);
    window.eval(&nav_js).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// Each argument is a named key of the JS `invoke('open_panel_window', {...})`
// call, so they can't be folded into a struct without changing every caller.
/// Opens (or focuses) a panel window. Rust callers (tray menu, other
/// commands) use this directly; the frontend goes through
/// the `open_panel_window` command.
#[allow(clippy::too_many_arguments)]
pub(crate) fn open_panel(
    app_handle: tauri::AppHandle,
    label: String,
    url: String,
    title: String,
    width: f64,
    height: f64,
    resizable: bool,
    decorations: bool,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        // If the window is still visible and functional, just focus it
        if window.is_visible().unwrap_or(false) {
            let _ = window.set_focus();
            return Ok(());
        }
        // Window exists but is not visible (stale/closed state) - destroy it
        // so we can create a fresh one below
        let _ = window.destroy();
        // Brief pause to let WebView2 finish cleanup before reusing the label
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // The first-run wizard is the one panel that should come up centered and
    // in front: the user just installed the app and is waiting for it.
    let first_run = label == "setup-wizard";
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app_handle, &label, tauri::WebviewUrl::App(url.into()))
            .title(&title)
            .inner_size(width, height)
            .resizable(resizable)
            .decorations(decorations)
            // Do not steal focus when opening a panel window programmatically.
            // On Windows the default is to activate (focus) a newly created window,
            // which yanks keyboard focus away from the user's editor.
            .focused(first_run);
    if first_run {
        builder = builder.center();
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    if first_run {
        let _ = window.set_focus();
    }

    Ok(())
}

/// `invoke('open_panel_window', ...)` from the frontend. Async so it runs off
/// the main thread: building a webview inside a synchronous command can
/// deadlock on Windows (the window stays about:blank). `decorations` is
/// optional because `TauriBridge.openPanelWindow` never sent it, which made
/// every panel it opened fail; it defaults to a framed window.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn open_panel_window(
    app_handle: tauri::AppHandle,
    label: String,
    url: String,
    title: String,
    width: f64,
    height: f64,
    resizable: bool,
    decorations: Option<bool>,
) -> Result<(), String> {
    open_panel(
        app_handle,
        label,
        url,
        title,
        width,
        height,
        resizable,
        decorations.unwrap_or(true),
    )
}

/// Place and size the visitor window in physical pixels (it matches the
/// main window's size so both Dr. Vibes render at the same scale).
#[tauri::command]
pub(crate) fn set_visitor_frame(
    app_handle: tauri::AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let win = app_handle
        .get_webview_window("visitor")
        .ok_or("visitor window missing")?;
    win.set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprite_editor_urls() {
        assert_eq!(
            sprite_editor_url("my-vibe", "edit").unwrap(),
            "sprite-editor.html?skin=my-vibe"
        );
        assert_eq!(
            sprite_editor_url("dr-vibe-pirate", "template").unwrap(),
            "sprite-editor.html?from=dr-vibe-pirate"
        );
        assert_eq!(
            sprite_editor_url("", "blank").unwrap(),
            "sprite-editor.html?new=blank"
        );
        assert_eq!(sprite_editor_url("", "edit").unwrap(), "sprite-editor.html");
        assert!(sprite_editor_url("", "template").is_err());
        assert!(sprite_editor_url("x');alert(1);//", "edit").is_err());
    }

    #[test]
    fn workshop_needs_a_character() {
        assert_eq!(
            workshop_url("grumpy-wizard", "codex").unwrap(),
            "character-workshop.html?skin=grumpy-wizard&agent=codex"
        );
        assert_eq!(
            workshop_url("grumpy-wizard", "").unwrap(),
            "character-workshop.html?skin=grumpy-wizard&agent=claude"
        );
        assert!(workshop_url("", "claude").is_err());
        assert!(workshop_url("../x", "claude").is_err());
    }

    #[test]
    fn safe_slugs() {
        assert!(is_safe_slug("dr-vibe-default"));
        assert!(is_safe_slug("my_vibe2"));
        assert!(!is_safe_slug(""));
        assert!(!is_safe_slug("a b"));
        assert!(!is_safe_slug("a'b"));
        assert!(!is_safe_slug("caf\u{e9}"));
    }
}
