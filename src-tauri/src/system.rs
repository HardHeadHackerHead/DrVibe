//! OS integration: active window, cursor, monitors, folder picker, quit/restart.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub process_id: u32,
}

// Get the current cursor position in screen coordinates
#[tauri::command]
pub(crate) fn get_cursor_position() -> Result<(i32, i32), String> {
    get_cursor_position_impl()
}

// Get information about the currently active window
#[tauri::command]
pub(crate) fn get_active_window() -> Result<WindowInfo, String> {
    get_active_window_impl()
}

/// Milliseconds since the last keyboard or mouse input anywhere on the
/// system, or None where the OS can't say (the webview then falls back to
/// cursor movement).
#[tauri::command]
pub(crate) fn last_input_age_ms() -> Option<u64> {
    last_input_age_ms_impl()
}

/// Editors and terminals by executable name (lowercase, no `.exe`). Exact
/// names, not substrings: "Cloudflare WARP" or "Hyper-V Manager" are not
/// coding apps, and their window titles must not feed project detection.
pub(crate) const CODING_EXES: &[&str] = &[
    "code",
    "code - insiders",
    "codium",
    "devenv",
    "cursor",
    "anti-gravity",
    "antigravity",
    "zed",
    "sublime_text",
    "idea",
    "idea64",
    "webstorm",
    "webstorm64",
    "pycharm",
    "pycharm64",
    "goland",
    "goland64",
    "rider",
    "rider64",
    "clion",
    "clion64",
    "datagrip",
    "datagrip64",
    "rustrover",
    "rustrover64",
    "vim",
    "gvim",
    "nvim",
    "nvim-qt",
    "neovide",
    "emacs",
    "runemacs",
    "terminal",
    "iterm2",
    "alacritty",
    "kitty",
    "wezterm-gui",
    "warp",
    "hyper",
    "windowsterminal",
    "wt",
    "powershell",
    "pwsh",
    "cmd",
    "claude",
];

// Check if the given app name is a coding application
#[tauri::command]
pub(crate) fn is_coding_app(app_name: String) -> bool {
    let lower = app_name.trim().to_lowercase();
    let exe = lower.strip_suffix(".exe").unwrap_or(&lower);
    CODING_EXES.contains(&exe)
}

/// A native question with a custom OK button and Cancel; false when
/// dismissed. Used before installing a linked skin or an update.
pub(crate) async fn confirm(
    app: &tauri::AppHandle,
    title: &str,
    message: String,
    ok: &str,
) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            ok.into(),
            "Cancel".into(),
        ))
        .show(move |yes| {
            let _ = tx.send(yes);
        });
    rx.await.unwrap_or(false)
}

pub(crate) fn dirs_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn get_cursor_position_impl() -> Result<(i32, i32), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    unsafe {
        let mut point = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut point).is_ok() {
            Ok((point.x, point.y))
        } else {
            Err("Failed to get cursor position".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn last_input_age_ms_impl() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        if !GetLastInputInfo(&mut info).as_bool() {
            return None;
        }
        // Both are tick counts that wrap every ~49.7 days
        Some(u64::from(GetTickCount().wrapping_sub(info.dwTime)))
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn last_input_age_ms_impl() -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
pub(crate) fn get_cursor_position_impl() -> Result<(i32, i32), String> {
    Err("macOS implementation pending".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn get_cursor_position_impl() -> Result<(i32, i32), String> {
    Err("Platform not supported".to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn get_active_window_impl() -> Result<WindowInfo, String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Err("No active window".to_string());
        }

        // Get window title
        let mut title_buffer = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buffer);
        let window_title = String::from_utf16_lossy(&title_buffer[..title_len as usize]);

        // Get process ID
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));

        // Get process name
        let mut app_name = String::from("Unknown");
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) {
            let mut name_buffer = [0u16; 512];
            let mut size = name_buffer.len() as u32;
            let pwstr = PWSTR::from_raw(name_buffer.as_mut_ptr());
            if QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), pwstr, &mut size).is_ok()
            {
                let full_path = String::from_utf16_lossy(&name_buffer[..size as usize]);
                if let Some(name) = full_path.split('\\').next_back() {
                    app_name = name.trim_end_matches(".exe").to_string();
                }
            }
        }

        Ok(WindowInfo {
            app_name,
            window_title,
            process_id,
        })
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn get_active_window_impl() -> Result<WindowInfo, String> {
    Err("macOS implementation pending".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn get_active_window_impl() -> Result<WindowInfo, String> {
    Err("Platform not supported".to_string())
}

#[tauri::command]
pub(crate) fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// Terminates (and in release, restarts) the app. Used by the Admin →
/// Dev Server panel after an admin changes which web server the app
/// should talk to — `web_base_url()` is seeded once at startup, so a
/// restart is required for the new URL to take effect.
///
/// Runs the exit on a background thread so the IPC response returns to
/// JS first and Chromium/WebView2 can begin its teardown before the
/// process dies. Without the delay, Windows throws
/// `Failed to unregister class Chrome_WidgetWin_0. Error = 1412` because
/// the new process races with the old one.
///
/// In debug builds we only exit, never `AppHandle::restart()`. `tauri dev`
/// is the parent process — calling restart() fights with its own child
/// management and reliably crashes on Windows. The developer re-runs
/// `npm run tauri dev` manually. Release builds restart normally.
#[tauri::command]
pub(crate) fn restart_app(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));

        #[cfg(debug_assertions)]
        {
            eprintln!("[restart_app] dev build — exiting. Re-run `npm run tauri dev` to relaunch.");
            app_handle.exit(0);
        }
        #[cfg(not(debug_assertions))]
        {
            app_handle.restart();
        }
    });
}

#[tauri::command]
pub(crate) async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.ok().flatten()
}

#[tauri::command]
pub(crate) fn set_main_window_size(
    app_handle: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window
            .set_size(tauri::LogicalSize { width, height })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Returns monitor bounds and work areas (work area excludes taskbar on Windows).
/// On non-Windows platforms returns an empty list; the JS side falls back to
/// using the full screen bounds so Dr. Vibe stops at the screen bottom.
#[derive(serde::Serialize, Clone)]
pub(crate) struct MonitorWorkArea {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    work_x: i32,
    work_y: i32,
    work_width: i32,
    work_height: i32,
}

#[tauri::command]
pub(crate) fn get_monitor_work_areas() -> Vec<MonitorWorkArea> {
    get_monitor_work_areas_impl()
}

#[cfg(target_os = "windows")]
pub(crate) fn get_monitor_work_areas_impl() -> Vec<MonitorWorkArea> {
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };

    let mut result: Vec<MonitorWorkArea> = Vec::new();
    let ptr = &mut result as *mut Vec<MonitorWorkArea> as isize;

    unsafe extern "system" fn callback(
        hmon: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(data.0 as *mut Vec<MonitorWorkArea>);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(hmon, &mut info).as_bool() {
            monitors.push(MonitorWorkArea {
                x: info.rcMonitor.left,
                y: info.rcMonitor.top,
                width: info.rcMonitor.right - info.rcMonitor.left,
                height: info.rcMonitor.bottom - info.rcMonitor.top,
                work_x: info.rcWork.left,
                work_y: info.rcWork.top,
                work_width: info.rcWork.right - info.rcWork.left,
                work_height: info.rcWork.bottom - info.rcWork.top,
            });
        }
        BOOL(1)
    }

    unsafe {
        let _ = EnumDisplayMonitors(HDC::default(), None, Some(callback), LPARAM(ptr));
    }

    result
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn get_monitor_work_areas_impl() -> Vec<MonitorWorkArea> {
    vec![] // macOS/Linux: JS falls back to full screen bounds
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn last_input_age_is_known_on_windows() {
        // Some value, and well under the ~49.7-day tick wrap
        let age = last_input_age_ms().expect("GetLastInputInfo");
        assert!(age < 50 * 24 * 3600 * 1000);
    }

    #[test]
    fn detects_editors_and_terminals() {
        for app in [
            "Code",
            "Cursor",
            "WindowsTerminal",
            "pycharm64",
            "nvim",
            "Zed",
            "RustRover64",
            "Code.exe",
            "pwsh",
        ] {
            assert!(
                is_coding_app(app.to_string()),
                "{app} should count as coding"
            );
        }
    }

    #[test]
    fn ignores_everyday_apps() {
        for app in [
            "chrome",
            "Spotify",
            "Slack",
            "explorer",
            "Discord",
            "Cloudflare WARP",
            "Hyper-V Manager",
            "lxcmdagent",
            "VSCodeSetup",
            "unicode-viewer",
        ] {
            assert!(
                !is_coding_app(app.to_string()),
                "{app} should not count as coding"
            );
        }
    }
}
