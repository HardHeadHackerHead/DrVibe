//! Screen share and fullscreen detection.
//!
//! While the player is sharing their screen (Zoom, Teams, Meet, Discord,
//! OBS) or running a fullscreen app, Dr. Vibe hides and visits and toasts
//! wait (PLAN → Privacy and trust). A background thread checks every few
//! seconds and emits `presenting-changed` to the webviews only when the
//! state changes; JS (PresenceGuard.js) decides what to hide.
//!
//! Screen sharing has no OS-wide API, so it is inferred from the windows
//! the sharing apps open while a share is live. The rules are a pure
//! function over a window snapshot (`match_screen_share`) so they can be
//! tested and extended without touching Win32 code.

use serde::Serialize;
use tauri::Emitter;

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresentingState {
    pub presenting: bool,
    /// "screen_share" | "fullscreen"
    pub reason: Option<&'static str>,
    /// Human-readable app name, e.g. "Zoom"
    pub app: Option<String>,
}

impl PresentingState {
    fn idle() -> Self {
        Self {
            presenting: false,
            reason: None,
            app: None,
        }
    }
}

/// One visible top-level window: its title and the exe name of its process
/// (lower case, without `.exe`).
#[derive(Debug, Clone)]
pub(crate) struct WindowSnapshot {
    pub title: String,
    pub process: String,
}

/// (app label, process names, title fragments). A rule matches when a
/// visible window belongs to one of the processes (any process if empty)
/// and its title contains one of the fragments (any title if empty).
/// All comparisons are lower case.
const SHARE_RULES: &[(&str, &[&str], &[&str])] = &[
    // Chromium / Edge / Firefox show a "… is sharing your screen" bar (Google Meet and others).
    (
        "Browser screen share",
        &[],
        &[
            "is sharing your screen",
            "is sharing a window",
            "is sharing this tab",
            "is sharing a tab",
        ],
    ),
    (
        "Zoom",
        &["zoom"],
        &[
            "sharing toolbar",
            "zoom share",
            "you are screen sharing",
            "screen share",
        ],
    ),
    (
        "Microsoft Teams",
        &["ms-teams", "teams", "msteams"],
        &[
            "sharing control bar",
            "sharing toolbar",
            "you're presenting",
            "you are presenting",
        ],
    ),
    (
        "Discord",
        &["discord"],
        &["screen share", "go live", "| streaming"],
    ),
    // OBS: any visible OBS window means recording or streaming may be live.
    ("OBS", &["obs64", "obs32", "obs"], &[]),
];

/// Returns the app label if any window indicates a live screen share.
pub(crate) fn match_screen_share(windows: &[WindowSnapshot]) -> Option<&'static str> {
    for (label, processes, fragments) in SHARE_RULES {
        let hit = windows.iter().any(|w| {
            let process_ok = processes.is_empty() || processes.iter().any(|p| w.process == *p);
            let title = w.title.to_lowercase();
            let title_ok = fragments.is_empty() || fragments.iter().any(|f| title.contains(f));
            process_ok && title_ok && !w.title.trim().is_empty()
        });
        if hit {
            return Some(label);
        }
    }
    None
}

/// Current state from the OS.
pub(crate) fn detect() -> PresentingState {
    let windows = platform::visible_windows();
    if let Some(app) = match_screen_share(&windows) {
        return PresentingState {
            presenting: true,
            reason: Some("screen_share"),
            app: Some(app.to_string()),
        };
    }
    if let Some(app) = platform::fullscreen_app() {
        return PresentingState {
            presenting: true,
            reason: Some("fullscreen"),
            app: Some(app),
        };
    }
    PresentingState::idle()
}

#[tauri::command]
pub(crate) fn get_presenting_state() -> PresentingState {
    detect()
}

/// Start the background watcher. Emits `presenting-changed` with a
/// `PresentingState` whenever it changes (and once at start).
pub(crate) fn spawn_watcher(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("presence-watcher".into())
        .spawn(move || {
            let mut last: Option<PresentingState> = None;
            loop {
                let now = detect();
                if last.as_ref() != Some(&now) {
                    let _ = app.emit("presenting-changed", &now);
                    last = Some(now);
                }
                std::thread::sleep(POLL_INTERVAL);
            }
        })
        .map(|_| ())
        .unwrap_or_else(|e| eprintln!("[presence] failed to start watcher: {e}"));
}

#[cfg(target_os = "windows")]
mod platform {
    use super::WindowSnapshot;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    fn process_name(pid: u32) -> String {
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return String::new();
            };
            let mut buf = [0u16; 512];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR::from_raw(buf.as_mut_ptr()),
                &mut size,
            )
            .is_ok();
            let _ = CloseHandle(handle);
            if !ok {
                return String::new();
            }
            let full = String::from_utf16_lossy(&buf[..size as usize]);
            full.rsplit('\\')
                .next()
                .unwrap_or("")
                .trim_end_matches(".exe")
                .trim_end_matches(".EXE")
                .to_lowercase()
        }
    }

    fn window_title(hwnd: HWND) -> String {
        unsafe {
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return String::new();
            }
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..n as usize])
        }
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<WindowSnapshot>);
        if IsWindowVisible(hwnd).as_bool() {
            let title = window_title(hwnd);
            if !title.is_empty() {
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                out.push(WindowSnapshot {
                    title,
                    process: process_name(pid),
                });
            }
        }
        BOOL(1)
    }

    pub(super) fn visible_windows() -> Vec<WindowSnapshot> {
        let mut out: Vec<WindowSnapshot> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut out as *mut _ as isize));
        }
        out
    }

    /// Name of the foreground app if it covers its whole monitor (or Windows
    /// reports a fullscreen / presentation state). Desktop and our own
    /// windows don't count.
    pub(super) fn fullscreen_app() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() || IsIconic(hwnd).as_bool() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == GetCurrentProcessId() {
                return None;
            }
            let mut class = [0u16; 64];
            let n = GetClassNameW(hwnd, &mut class);
            let class = String::from_utf16_lossy(&class[..n as usize]);
            if matches!(
                class.as_str(),
                "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
            ) {
                return None;
            }

            let name = || {
                let p = process_name(pid);
                Some(if p.is_empty() {
                    "Fullscreen app".to_string()
                } else {
                    p
                })
            };

            if let Ok(state) = SHQueryUserNotificationState() {
                if state == QUNS_RUNNING_D3D_FULL_SCREEN
                    || state == QUNS_PRESENTATION_MODE
                    || state == QUNS_BUSY
                {
                    return name();
                }
            }

            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                return None;
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return None;
            }
            let m = info.rcMonitor;
            let covers = rect.left <= m.left
                && rect.top <= m.top
                && rect.right >= m.right
                && rect.bottom >= m.bottom;
            if covers {
                name()
            } else {
                None
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::WindowSnapshot;

    pub(super) fn visible_windows() -> Vec<WindowSnapshot> {
        Vec::new()
    }

    pub(super) fn fullscreen_app() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(title: &str, process: &str) -> WindowSnapshot {
        WindowSnapshot {
            title: title.into(),
            process: process.into(),
        }
    }

    #[test]
    fn idle_desktop_is_not_sharing() {
        let windows = vec![
            w("main.rs - Visual Studio Code", "code"),
            w("Zoom Workplace", "zoom"),
            w("Discord", "discord"),
        ];
        assert_eq!(match_screen_share(&windows), None);
    }

    #[test]
    fn browser_share_bar_is_detected() {
        let windows = vec![w("meet.google.com is sharing your screen.", "chrome")];
        assert_eq!(match_screen_share(&windows), Some("Browser screen share"));
    }

    #[test]
    fn zoom_and_teams_share_toolbars_are_detected() {
        assert_eq!(
            match_screen_share(&[w("Zoom Sharing Toolbar", "zoom")]),
            Some("Zoom")
        );
        assert_eq!(
            match_screen_share(&[w("Sharing control bar | Microsoft Teams", "ms-teams")]),
            Some("Microsoft Teams")
        );
    }

    #[test]
    fn title_fragment_needs_the_right_process() {
        // A doc titled "screen share notes" in an editor is not a share.
        assert_eq!(
            match_screen_share(&[w("screen share notes.md", "code")]),
            None
        );
    }

    #[test]
    fn obs_counts_while_open() {
        assert_eq!(
            match_screen_share(&[w("OBS 30.2.0 - Profile: Untitled", "obs64")]),
            Some("OBS")
        );
    }

    #[test]
    fn idle_state_serialises_for_js() {
        let json = serde_json::to_value(PresentingState::idle()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "presenting": false, "reason": null, "app": null })
        );
    }
}
