//! Self-hosted crash reports (`POST /api/v1/errors`, API.md §21.5). No
//! outside service.
//!
//! Two sources feed one small queue on disk (`error-reports.jsonl` in the app
//! data folder): a Rust panic hook (written synchronously, because release
//! builds abort right after the hook) and the `error_report` command used by
//! the JS reporter (`src/core/errorReporter.js`). The queue is flushed a little
//! after setup is finished and every 30 minutes: as the linked device when
//! there is a token, otherwise anonymously. Off until the player turns it on
//! (setup wizard or Settings → Privacy, `error_reports_set_enabled`); off
//! also empties the queue.
//!
//! Reports carry only the error text, a stack, the app version and the page,
//! and every path, URL and device token is cut out first ([`redact`]); the
//! server scrubs again. "View queued reports" shows what waits
//! (`error_reports_queue`).

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

static ENABLED: AtomicBool = AtomicBool::new(false);
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

// ── Redaction ────────────────────────────────────────────────────────────
//
// Error text can quote any path, URL or token it touched. Before a report is
// queued every absolute path (Windows drive, UNC, POSIX, `~`) is cut to
// `<path>/` plus its file name, every URL to its scheme and host, and `dvd_`
// device tokens are replaced. Dr. Vibe's own bundled pages
// (`http(s)://tauri.localhost/…`, `tauri://localhost/…`) keep their path, so
// a stack still says which of the app's files failed.

const REDACTED_TOKEN: &str = "dvd_[redacted]";
const PATH_PREFIX: &str = "<path>/";

fn is_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// Characters a folder or file name may hold in error text (spaces too).
fn seg_char(c: char) -> bool {
    !is_sep(c)
        && !matches!(
            c,
            ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\'' | '`' | '\n' | '\r' | '\t'
        )
}

/// Where a file name stops: whitespace and the punctuation that usually
/// follows a path in a message.
fn name_char(c: char) -> bool {
    seg_char(c) && !c.is_whitespace() && !matches!(c, ')' | ']' | ',' | ';')
}

fn word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `dvd_…` at `i`: its length.
fn token_at(chars: &[char], i: usize) -> Option<usize> {
    let prefix = ['d', 'v', 'd', '_'];
    if chars.len() < i + 5 || chars[i..i + 4] != prefix {
        return None;
    }
    let n = chars[i + 4..]
        .iter()
        .take_while(|c| c.is_ascii_alphanumeric() || **c == '_' || **c == '-')
        .count();
    (n > 0).then_some(4 + n)
}

/// A URL at `i`: its length and replacement.
fn url_at(chars: &[char], i: usize) -> Option<(usize, String)> {
    if !chars.get(i)?.is_ascii_alphabetic() {
        return None;
    }
    let mut k = i;
    while k < chars.len()
        && k - i < 32
        && (chars[k].is_ascii_alphanumeric() || matches!(chars[k], '+' | '.' | '-'))
    {
        k += 1;
    }
    if chars.get(k..k + 3)? != [':', '/', '/'] {
        return None;
    }
    let scheme: String = chars[i..k].iter().collect();
    let ends = |c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')' | ']' | '`');
    let auth_start = k + 3;
    let mut a = auth_start;
    while a < chars.len() && !ends(chars[a]) && !matches!(chars[a], '/' | '?' | '#' | ',') {
        a += 1;
    }
    let authority: String = chars[auth_start..a].iter().collect();
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = host_port.split(':').next().unwrap_or("");
    let mut e = a;
    while e < chars.len() && !ends(chars[e]) {
        e += 1;
    }
    let app_page = host.eq_ignore_ascii_case("tauri.localhost")
        || (scheme.eq_ignore_ascii_case("tauri") && host.eq_ignore_ascii_case("localhost"));
    let replacement = if app_page {
        let rest: String = chars[a..e].iter().collect();
        let path = rest.split(['?', '#']).next().unwrap_or("");
        format!("{scheme}://{host}{path}")
    } else {
        format!("{scheme}://{host}")
    };
    Some((e - i, replacement))
}

/// The folders and file name after a path's root, from `j` (a separator):
/// the end of the path and its file name.
fn path_rest(chars: &[char], j: usize) -> (usize, usize, String) {
    let mut k = j;
    let mut dirs = 0;
    loop {
        let sep_start = k;
        while k < chars.len() && is_sep(chars[k]) {
            k += 1;
        }
        if k == sep_start {
            return (k, dirs, String::new());
        }
        let seg_start = k;
        while k < chars.len() && seg_char(chars[k]) {
            k += 1;
        }
        if k > seg_start && k < chars.len() && is_sep(chars[k]) {
            dirs += 1;
            continue;
        }
        let mut e = seg_start;
        while e < k && name_char(chars[e]) {
            e += 1;
        }
        return (e, dirs, chars[seg_start..e].iter().collect());
    }
}

/// An absolute path at `i` (`prev` is the character before it): its length
/// and replacement.
fn path_at(chars: &[char], i: usize, prev: Option<char>) -> Option<(usize, String)> {
    let c = *chars.get(i)?;
    let next = chars.get(i + 1).copied();
    let root_end = if c.is_ascii_alphabetic()
        && next == Some(':')
        && chars.get(i + 2).is_some_and(|c| is_sep(*c))
    {
        // C:\… or C:/…
        Some(i + 2)
    } else if c == '\\' && next == Some('\\') {
        // \\server\share\…
        let mut k = i;
        while k < chars.len() && chars[k] == '\\' {
            k += 1;
        }
        let host_start = k;
        while k < chars.len() && name_char(chars[k]) {
            k += 1;
        }
        (k > host_start && chars.get(k).is_some_and(|c| is_sep(*c))).then_some(k)
    } else if c == '~' && next.is_some_and(is_sep) {
        Some(i + 1)
    } else {
        None
    };
    if let Some(j) = root_end {
        let (end, _, name) = path_rest(chars, j);
        return Some((end - i, format!("{PATH_PREFIX}{name}")));
    }
    // /a/b…: at least one folder, after a space, quote, bracket, `=` or `:`.
    let after_boundary = prev.is_none_or(|p| {
        p.is_whitespace() || matches!(p, '"' | '\'' | '(' | '[' | '=' | ',' | ':' | '`' | '<')
    });
    if c == '/' && after_boundary && next.is_some_and(|n| name_char(n)) {
        let (end, dirs, name) = path_rest(chars, i);
        if dirs >= 1 {
            return Some((end - i, format!("{PATH_PREFIX}{name}")));
        }
    }
    None
}

/// Cuts paths, URLs and device tokens out of error text (see above).
pub(crate) fn redact(text: &str) -> String {
    let text = text.replace(r"\\?\", "");
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let prev = i.checked_sub(1).map(|p| chars[p]);
        if prev.is_none_or(|p| !word_char(p)) {
            if let Some(n) = token_at(&chars, i) {
                out.push_str(REDACTED_TOKEN);
                i += n;
                continue;
            }
            if let Some((n, rep)) = url_at(&chars, i) {
                out.push_str(&rep);
                i += n;
                continue;
            }
            if let Some((n, rep)) = path_at(&chars, i, prev) {
                out.push_str(&rep);
                i += n;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

impl Report {
    /// Caps, redacts, and stamps the app version when missing.
    fn cleaned(mut self) -> Self {
        self.message = truncate(&redact(self.message.trim()), MAX_MESSAGE);
        self.stack = self
            .stack
            .map(|s| truncate(&redact(&s), MAX_STACK))
            .filter(|s| !s.trim().is_empty());
        self.route = self
            .route
            .map(|r| truncate(&redact(r.split(['?', '#']).next().unwrap_or("")), 200))
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
        .unwrap_or(false)
}

/// Nothing is sent before the first-run setup is finished or skipped.
fn setup_done(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    app.store("dr-vibe-data.json")
        .ok()
        .and_then(|s| s.get("setupWizard"))
        .and_then(|v| v.get("completed").and_then(|c| c.as_bool()))
        .unwrap_or(false)
}

/// Sends what is queued. One flush at a time.
async fn flush(app: tauri::AppHandle) {
    let Some(dir) = DIR.get() else { return };
    if !ENABLED.load(Ordering::Relaxed) {
        clear_queue(dir);
        return;
    }
    if !setup_done(&app) || FLUSHING.swap(true, Ordering::AcqRel) {
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

/// "View queued reports" in Settings → Privacy: exactly what waits to be sent.
#[tauri::command]
pub(crate) fn error_reports_queue() -> Vec<Report> {
    let Some(dir) = DIR.get() else { return vec![] };
    let _guard = QUEUE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read_queue(dir)
}

/// "Delete all local data": the queue and the switch go (back to off).
pub(crate) fn forget_all() {
    ENABLED.store(false, Ordering::Relaxed);
    if let Some(dir) = DIR.get() {
        clear_queue(dir);
        let _ = fs::remove_file(dir.join(SETTINGS_FILE));
    }
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
    use crate::test_util::TempDir;

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
        let tmp = TempDir::new("err-queue");
        let dir = tmp.path().to_path_buf();
        assert!(enqueue(&dir, js("a")));
        assert!(!enqueue(&dir, js("a")), "the same error waits once");
        for i in 0..MAX_QUEUE * 2 {
            enqueue(&dir, js(&format!("e{i}")));
        }
        assert_eq!(read_queue(&dir).len(), MAX_QUEUE);
        clear_queue(&dir);
        assert!(read_queue(&dir).is_empty());
    }

    #[test]
    fn panic_reports_name_the_location_and_hide_paths() {
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
        assert_eq!(r.stack.as_deref(), Some("at <path>/x.rs"));
        assert_eq!(r.release.as_deref(), Some(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn redacts_every_kind_of_path_to_its_file_name() {
        let cases = [
            (
                "Cannot canonicalize C:\\Users\\Mara Smith\\clients\\acme\\main.rs: not found",
                "Cannot canonicalize <path>/main.rs: not found",
            ),
            (
                "open D:/Work/Acme Corp/secret plan/notes.md failed",
                "open <path>/notes.md failed",
            ),
            (
                "\\\\fileserver\\clients\\acme\\q3.xlsx is locked",
                "<path>/q3.xlsx is locked",
            ),
            ("\\\\?\\C:\\Users\\mara\\x.json", "<path>/x.json"),
            (
                "read '/home/mara/acme/app/.env': EACCES",
                "read '<path>/.env': EACCES",
            ),
            (
                "at /Users/mara/Projects/acme/src/index.js:12:3",
                "at <path>/index.js:12:3",
            ),
            ("cd ~/acme/payroll && ls", "cd <path>/payroll && ls"),
            (
                "json \"C:\\\\Users\\\\mara\\\\a.txt\"",
                "json \"<path>/a.txt\"",
            ),
            ("(E:\\repos\\acme\\)", "(<path>/)"),
            ("route /settings.html stays", "route /settings.html stays"),
            ("ratio 3/4 stays", "ratio 3/4 stays"),
            // Folder names may hold spaces, so text after a path can go too:
            // more is cut rather than less.
            ("/home/mara/a.rs then x/y", "<path>/y"),
            (
                "src\\sync.rs:42 stays relative",
                "src\\sync.rs:42 stays relative",
            ),
        ];
        for (input, want) in cases {
            assert_eq!(redact(input), want, "{input}");
        }
    }

    #[test]
    fn redacts_urls_to_their_host_and_tokens() {
        assert_eq!(
            redact("Download failed: https://user:pw@cdn.example.com:8443/acme/secret.png?sig=abc (timeout)"),
            "Download failed: https://cdn.example.com (timeout)"
        );
        assert_eq!(
            redact("GET http://192.168.1.20/admin/x"),
            "GET http://192.168.1.20"
        );
        assert_eq!(
            redact("at render (http://tauri.localhost/settings-page.js?v=2:1801:12)"),
            "at render (http://tauri.localhost/settings-page.js)",
        );
        assert_eq!(
            redact("tauri://localhost/app.js:3:1"),
            "tauri://localhost/app.js:3:1"
        );
        assert_eq!(
            redact("dr-vibe://install-skin?png=https://x.io/a.png"),
            "dr-vibe://install-skin"
        );
        assert_eq!(
            redact("Bearer dvd_AbC123_xyz-9 rejected; not my_dvd_x"),
            "Bearer dvd_[redacted] rejected; not my_dvd_x"
        );
    }

    #[test]
    fn reports_are_redacted_before_they_are_queued() {
        let mut r = js("TypeError: C:\\Users\\mara\\acme\\x.js is broken");
        r.stack = Some("at f (https://evil.example/p/q.js:1:1)".into());
        r.route = Some("/settings.html?tab=privacy".into());
        let c = r.cleaned();
        assert_eq!(c.message, "TypeError: <path>/x.js is broken");
        assert_eq!(c.stack.as_deref(), Some("at f (https://evil.example)"));
        assert_eq!(c.route.as_deref(), Some("/settings.html"));
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
    fn the_switch_defaults_off_and_persists() {
        let tmp = TempDir::new("err-prefs");
        let dir = tmp.path().to_path_buf();
        assert!(!read_enabled(&dir));
        fs::write(dir.join(SETTINGS_FILE), br#"{"enabled":true}"#).unwrap();
        assert!(read_enabled(&dir));
        fs::write(dir.join(SETTINGS_FILE), br#"{"enabled":false}"#).unwrap();
        assert!(!read_enabled(&dir));
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
