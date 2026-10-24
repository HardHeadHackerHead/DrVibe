//! Self-hosted crash reports (`POST /api/v1/errors`, API.md §21.5). No
//! outside service.
//!
//! Two sources feed one small queue on disk (`error-reports.jsonl` in the app
//! data folder): a Rust panic hook (written synchronously, because release
//! builds abort right after the hook) and the `error_report` command used by
//! the JS reporter (`src/core/errorReporter.js`). The queue is flushed a little
//! after start and every 30 minutes: as the linked device when there is a
//! token, otherwise anonymously. On by default; the Privacy tab's switch
//! (`error_reports_set_enabled`) turns it off and empties the queue.
//!
//! Reports carry only the error text, a stack, the app version and the page:
//! home-folder paths are cut to `~` here and the server scrubs again.

use std::{
    fs,
    io::Write as _,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::account::get_token;
use crate::api::{send, Call, Ctx};

const QUEUE_FILE: &str = "error-reports.jsonl";
const SETTINGS_FILE: &str = "error-reports.json";
/// Most reports waiting on disk.
pub(crate) const MAX_QUEUE: usize = 20;
/// Most reports accepted from JS per app run.
pub(crate) const MAX_PER_RUN: u32 = 20;
const MAX_MESSAGE: usize = 1000;
const MAX_STACK: usize = 8000;
const FLUSH_DELAY: Duration = Duration::from_secs(20);
const FLUSH_EVERY: Duration = Duration::from_secs(30 * 60);

static ENABLED: AtomicBool = AtomicBool::new(true);
static DIR: OnceLock<PathBuf> = OnceLock::new();
static ACCEPTED: AtomicU32 = AtomicU32::new(0);
static FLUSHING: AtomicBool = AtomicBool::new(false);
/// Serialises queue file access between the panic hook, commands and flush.
static QUEUE_LOCK: Mutex<()> = Mutex::new(());

/// One report, in the shape `POST /errors` takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub source: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Prefs {
    enabled: bool,
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

/// Replaces the home folder (which names the person) with `~`.
pub(crate) fn scrub_home(s: &str, home: Option<&str>) -> String {
    let Some(home) = home.map(str::trim).filter(|h| h.len() > 3) else {
        return s.to_string();
    };
    let mut out = s.replace(home, "~");
    let alt = if home.contains('\\') {
        home.replace('\\', "/")
    } else {
        home.replace('/', "\\")
    };
    if alt != home {
        out = out.replace(&alt, "~");
    }
    out
}

fn home_dir() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
}

impl Report {
    /// Caps, scrubs, and stamps the app version when missing.
    fn cleaned(mut self) -> Self {
        let home = home_dir();
        self.message = truncate(
            &scrub_home(self.message.trim(), home.as_deref()),
            MAX_MESSAGE,
        );
        self.stack = self
            .stack
            .map(|s| truncate(&scrub_home(&s, home.as_deref()), MAX_STACK))
            .filter(|s| !s.trim().is_empty());
        self.route = self
            .route
            .map(|r| truncate(r.split(['?', '#']).next().unwrap_or(""), 200))
            .filter(|r| !r.is_empty());
        if self.release.is_none() {
            self.release = Some(env!("CARGO_PKG_VERSION").to_string());
        }
        self
    }

    fn same_error(&self, other: &Report) -> bool {
        self.source == other.source && self.message == other.message
    }
}

/// A report from a panic: payload, location and a short backtrace.
pub(crate) fn panic_report(
    payload: &str,
    location: Option<String>,
    backtrace: Option<String>,
) -> Report {
    let message = match &location {
        Some(loc) => format!("panicked at {loc}: {payload}"),
        None => format!("panicked: {payload}"),
    };
    Report {
        source: "desktop-rust".into(),
        message,
        stack: backtrace,
        release: None,
        route: None,
    }
    .cleaned()
}

/// Reads the queue (bad lines are skipped).
pub(crate) fn read_queue(dir: &Path) -> Vec<Report> {
    let Ok(text) = fs::read_to_string(dir.join(QUEUE_FILE)) else {
        return vec![];
    };
    text.lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn write_queue(dir: &Path, reports: &[Report]) -> std::io::Result<()> {
    let path = dir.join(QUEUE_FILE);
    if reports.is_empty() {
        return match fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    fs::create_dir_all(dir)?;
    let mut f = fs::File::create(path)?;
    for r in reports {
        writeln!(f, "{}", serde_json::to_string(r).unwrap_or_default())?;
    }
    Ok(())
}

/// Adds a report unless the same error is already waiting or the queue is
/// full. Returns whether it was added.
pub(crate) fn enqueue(dir: &Path, report: Report) -> bool {
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut queue = read_queue(dir);
    if queue.len() >= MAX_QUEUE || queue.iter().any(|r| r.same_error(&report)) {
        return false;
    }
    queue.push(report);
    write_queue(dir, &queue).is_ok()
}

pub(crate) fn clear_queue(dir: &Path) {
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _ = write_queue(dir, &[]);
}

/// Whether a response means "don't send this one again": accepted, or
/// refused for good. Network errors, 429 and 5xx stay queued.
pub(crate) fn done(status: u16) -> bool {
    status != 0 && status != 429 && status < 500
}

fn read_enabled(dir: &Path) -> bool {
    fs::read_to_string(dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Prefs>(&t).ok())
        .map(|p| p.enabled)
        .unwrap_or(true)
}

/// Sends what is queued. One flush at a time.
async fn flush(app: tauri::AppHandle) {
    let Some(dir) = DIR.get() else { return };
    if !ENABLED.load(Ordering::Relaxed) {
        clear_queue(dir);
        return;
    }
    if FLUSHING.swap(true, Ordering::AcqRel) {
        return;
    }
    let pending = {
        let _guard = QUEUE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        read_queue(dir)
    };
    let linked = matches!(get_token(), Ok(Some(_)));
    let mut keep = Vec::new();
    for report in pending.iter().cloned() {
        let ctx = if linked {
            Ctx::App(&app)
        } else {
            Ctx::Token(None)
        };
        let resp = send(
            ctx,
            Call::new(reqwest::Method::POST, "/errors").json(&report),
        )
        .await;
        if resp.status == 429 {
            keep.push(report);
            break;
        }
        if !done(resp.status) {
            keep.push(report);
        }
    }
    {
        let _guard = QUEUE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        // What failed stays, plus anything a panic or JS added while we were sending.
        let mut queue: Vec<Report> = keep;
        for r in read_queue(dir) {
            let new = !pending.iter().any(|p| p.same_error(&r));
            if new && !queue.iter().any(|q| q.same_error(&r)) && queue.len() < MAX_QUEUE {
                queue.push(r);
            }
        }
        let _ = write_queue(dir, &queue);
    }
    FLUSHING.store(false, Ordering::Release);
}

fn spawn_flush(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(flush(app));
}

/// Call once from `setup`: reads the switch, installs the panic hook and
/// schedules flushes.
pub(crate) fn init(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    ENABLED.store(read_enabled(&dir), Ordering::Relaxed);
    let _ = DIR.set(dir);

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if ENABLED.load(Ordering::Relaxed) {
            if let Some(dir) = DIR.get() {
                let payload = info
                    .payload()
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| info.payload().downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown panic".into());
                let location = info
                    .location()
                    .map(|l| format!("{}:{}", l.file(), l.line()));
                let backtrace = std::backtrace::Backtrace::force_capture().to_string();
                let backtrace = backtrace.lines().take(40).collect::<Vec<_>>().join("\n");
                enqueue(dir, panic_report(&payload, location, Some(backtrace)));
            }
        }
        previous(info);
    }));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FLUSH_DELAY).await;
        loop {
            flush(app.clone()).await;
            tokio::time::sleep(FLUSH_EVERY).await;
        }
    });
}

// ── Commands ─────────────────────────────────────────────────────────────

/// From the JS reporter. Returns whether the report was queued.
#[tauri::command]
pub(crate) fn error_report(app_handle: tauri::AppHandle, report: Report) -> bool {
    if !ENABLED.load(Ordering::Relaxed)
        || report.source != "desktop-js"
        || report.message.trim().is_empty()
    {
        return false;
    }
    if ACCEPTED.fetch_add(1, Ordering::Relaxed) >= MAX_PER_RUN {
        return false;
    }
    let Some(dir) = DIR.get() else { return false };
    let added = enqueue(dir, report.cleaned());
    if added {
        spawn_flush(&app_handle);
    }
    added
}

#[tauri::command]
pub(crate) fn error_reports_get_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// The Privacy tab's switch. Off also empties the queue.
#[tauri::command]
pub(crate) fn error_reports_set_enabled(enabled: bool) -> Result<bool, String> {
    ENABLED.store(enabled, Ordering::Relaxed);
    let Some(dir) = DIR.get() else {
        return Ok(enabled);
    };
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(
        dir.join(SETTINGS_FILE),
        serde_json::to_vec(&Prefs { enabled }).unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;
    if !enabled {
        clear_queue(dir);
    }
    Ok(enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "drvibe-err-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn js(message: &str) -> Report {
        Report {
            source: "desktop-js".into(),
            message: message.into(),
            stack: None,
            release: None,
            route: None,
        }
    }

    #[test]
    fn queue_dedupes_caps_and_clears() {
        let dir = tmp_dir("queue");
        assert!(enqueue(&dir, js("a")));
        assert!(!enqueue(&dir, js("a")), "the same error waits once");
        for i in 0..MAX_QUEUE * 2 {
            enqueue(&dir, js(&format!("e{i}")));
        }
        assert_eq!(read_queue(&dir).len(), MAX_QUEUE);
        clear_queue(&dir);
        assert!(read_queue(&dir).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn panic_reports_name_the_location_and_hide_home() {
        let r = panic_report(
            "called `Option::unwrap()` on a `None` value",
            Some("src\\sync.rs:42".into()),
            Some("at C:\\Users\\mara\\dr-vibe\\x.rs".into()),
        );
        assert_eq!(r.source, "desktop-rust");
        assert_eq!(
            r.message,
            "panicked at src\\sync.rs:42: called `Option::unwrap()` on a `None` value"
        );
        assert_eq!(r.release.as_deref(), Some(env!("CARGO_PKG_VERSION")));
        assert_eq!(
            scrub_home(
                "C:\\Users\\mara\\x and C:/Users/mara/y",
                Some("C:\\Users\\mara")
            ),
            "~\\x and ~/y"
        );
        assert_eq!(scrub_home("/home/mara/app", Some("/home/mara")), "~/app");
        assert_eq!(scrub_home("no home", None), "no home");
    }

    #[test]
    fn cleaned_caps_fields_and_drops_queries() {
        let mut r = js(&"x".repeat(5000));
        r.route = Some("/settings.html?tab=privacy#x".into());
        r.stack = Some("  ".into());
        let c = r.cleaned();
        assert_eq!(c.message.chars().count(), MAX_MESSAGE);
        assert_eq!(c.route.as_deref(), Some("/settings.html"));
        assert_eq!(c.stack, None);
    }

    #[test]
    fn retry_rules() {
        assert!(done(202));
        assert!(done(422), "a refused report is not retried");
        assert!(!done(0));
        assert!(!done(429));
        assert!(!done(503));
    }

    #[test]
    fn the_switch_defaults_on_and_persists() {
        let dir = tmp_dir("prefs");
        assert!(read_enabled(&dir));
        fs::write(dir.join(SETTINGS_FILE), br#"{"enabled":false}"#).unwrap();
        assert!(!read_enabled(&dir));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn wire_shape_matches_the_server() {
        let v = serde_json::to_value(js("boom").cleaned()).unwrap();
        assert_eq!(v["source"], "desktop-js");
        assert_eq!(v["message"], "boom");
        assert!(v.get("stack").is_none());
        assert!(v["release"].is_string());
    }
}
