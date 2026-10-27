//! Claude Code integration: hook install and the JSONL event log.

use crate::system::dirs_home;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Read new JSONL events from the Claude Code integration log file.
/// Reads lines starting from `offset` (byte offset) and returns
/// the new events plus the updated offset for the next call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeEventsResult {
    pub events: Vec<serde_json::Value>,
    pub new_offset: u64,
}

#[tauri::command]
pub(crate) fn read_claude_code_events(offset: u64) -> Result<ClaudeCodeEventsResult, String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    read_events_from(
        &home.join(".dr-vibe").join("claude-code-events.jsonl"),
        offset,
    )
}

/// Read complete JSONL lines from `log_path` starting at byte `offset`.
/// A trailing line without its newline yet (the hook is mid-write) is left
/// for the next call, and offsets count raw bytes, so CRLF files and
/// multi-byte characters never drift. A file shorter than `offset` was
/// rotated: start again from 0.
pub(crate) fn read_events_from(
    log_path: &Path,
    offset: u64,
) -> Result<ClaudeCodeEventsResult, String> {
    if !log_path.exists() {
        return Ok(ClaudeCodeEventsResult {
            events: Vec::new(),
            new_offset: 0,
        });
    }

    let file_size = std::fs::metadata(log_path)
        .map_err(|e| format!("Cannot stat log file: {}", e))?
        .len();

    // If file is smaller than offset, it was rotated — reset
    if file_size < offset {
        return Ok(ClaudeCodeEventsResult {
            events: Vec::new(),
            new_offset: 0,
        });
    }
    // No new data
    if file_size == offset {
        return Ok(ClaudeCodeEventsResult {
            events: Vec::new(),
            new_offset: offset,
        });
    }

    use std::io::{BufRead, BufReader, Seek, SeekFrom};
    let mut file =
        std::fs::File::open(log_path).map_err(|e| format!("Cannot open log file: {}", e))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Cannot seek: {}", e))?;

    let mut reader = BufReader::new(file);
    let mut events = Vec::new();
    let mut consumed = offset;
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = reader
            .read_until(b'\n', &mut buf)
            .map_err(|e| format!("Cannot read log file: {}", e))?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break; // EOF, or a partial line still being written
        }
        consumed += n as u64;
        let text = String::from_utf8_lossy(&buf);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            events.push(parsed);
        }
    }

    Ok(ClaudeCodeEventsResult {
        events,
        new_offset: consumed,
    })
}

/// Find the Git Bash executable path (Windows only).
/// Returns the full path to bash.exe, or "bash" as fallback.
/// Reserved for future use — the current hook installer registers the .sh
/// path directly and lets Claude Code invoke it via its own bash.
#[allow(dead_code)]
pub(crate) fn find_bash_path() -> String {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        for c in &candidates {
            if Path::new(c).exists() {
                return c.to_string();
            }
        }
    }
    "bash".to_string()
}

/// Resolve a hook resource (filename relative to tools/) to a deployed path
/// under ~/.dr-vibe. Returns the canonical filesystem path of the deployed
/// copy. The .sh and .cmd hook files are both deployed this way.
///
/// Deploying to ~/.dr-vibe means the registered hook path never changes even
/// when the user moves the app, switches between dev and bundled builds, or
/// updates Dr. Vibe. The stable copy is refreshed on every install so it
/// always reflects the current version.
pub(crate) fn deploy_hook_resource(
    app_handle: &tauri::AppHandle,
    filename: &str,
    required: bool,
) -> Result<Option<PathBuf>, String> {
    let mut source_candidates: Vec<PathBuf> = Vec::new();
    // The source tree only in dev builds: an installed app never takes a
    // hook script from whatever folder it was launched in.
    #[cfg(debug_assertions)]
    {
        source_candidates.push(PathBuf::from("../tools").join(filename));
        source_candidates.push(PathBuf::from("tools").join(filename));
    }
    if let Ok(res) = app_handle.path().resource_dir() {
        source_candidates.push(res.join("tools").join(filename));
    }

    let source = source_candidates.into_iter().find(|p| p.exists());
    let source = match source {
        Some(s) => s,
        None if required => return Err(format!("{} not found in app resources", filename)),
        None => return Ok(None),
    };

    let home = dirs_home().ok_or("Cannot determine home directory")?;
    let stable_dir = home.join(".dr-vibe");
    std::fs::create_dir_all(&stable_dir).map_err(|e| format!("Cannot create ~/.dr-vibe: {}", e))?;
    let stable = stable_dir.join(filename);
    std::fs::copy(&source, &stable)
        .map_err(|e| format!("Cannot deploy {} to ~/.dr-vibe: {}", filename, e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&stable)
            .map_err(|e| format!("Cannot stat {}: {}", filename, e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&stable, perms)
            .map_err(|e| format!("Cannot chmod {}: {}", filename, e))?;
    }

    Ok(Some(stable))
}

/// Convert a deployed hook path to the form bash expects: native POSIX path
/// on Mac/Linux, MSYS-style `/c/Users/...` on Windows. Used by the hook
/// installer on every platform — Claude Code launches hooks through bash.
pub(crate) fn hook_path_for_bash(path: &Path) -> Result<String, String> {
    let abs = std::fs::canonicalize(path)
        .map_err(|e| format!("Cannot canonicalize {}: {}", path.display(), e))?;
    let s = abs.to_string_lossy().to_string();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s).replace('\\', "/");
    #[cfg(target_os = "windows")]
    {
        if s.len() >= 2 && s.as_bytes()[1] == b':' {
            let drive = s.as_bytes()[0].to_ascii_lowercase() as char;
            return Ok(format!("/{}{}", drive, &s[2..]));
        }
    }
    Ok(s)
}

/// True if a hook command string is a Dr. Vibe hook (current or legacy).
/// Used to dedup on install and to recognise broken pre-1.0.4 entries that
/// invoked bash.exe with a quoted script path — Claude Code v2.1+ on Windows
/// mis-tokenizes that form, leading to exit-126 "cannot execute binary file".
pub(crate) fn is_dr_vibe_hook_command(cmd: &str) -> bool {
    cmd.contains("claude-code-hook.sh") || cmd.contains("claude-code-hook.cmd")
}

/// Error `install_claude_code_hooks` returns when there is no `~/.claude`
/// folder: Claude Code isn't installed, so there is nothing to hook into.
pub(crate) const CLAUDE_CODE_NOT_FOUND: &str = "claude_code_not_found";

/// `~/.claude/settings.json`, but only when `~/.claude` exists. Dr. Vibe never
/// creates Claude Code's folder for someone who doesn't use it.
pub(crate) fn claude_settings_path(home: &Path) -> Result<PathBuf, String> {
    let claude_dir = home.join(".claude");
    if !claude_dir.is_dir() {
        return Err(CLAUDE_CODE_NOT_FOUND.to_string());
    }
    Ok(claude_dir.join("settings.json"))
}

/// The events Dr. Vibe hooks, with their tool matcher. No `Read`: the paths
/// of files Claude only looks at are never logged.
pub(crate) const HOOK_CONFIGS: [(&str, Option<&str>); 4] = [
    ("PostToolUse", Some("Write|Edit|NotebookEdit|Bash")),
    ("SessionStart", None),
    ("SessionEnd", None),
    ("Stop", None),
];

/// Files Dr. Vibe keeps in `~/.dr-vibe` for the hooks. All of them go when
/// the hooks are switched off, on "Delete all local data" and on uninstall.
pub(crate) const HOOK_FILES: [&str; 10] = [
    "claude-code-hook.sh",
    "claude-code-hook.cmd",
    "claude-code-events.jsonl",
    "claude-code-events.jsonl.old",
    "tracked.txt",
    "tracked.tmp",
    "install-marker",
    "install-marker.tmp",
    "paused-until",
    "paused-until.tmp",
];

/// True for a hook group Dr. Vibe added (current or legacy form).
fn is_dr_vibe_group(entry: &serde_json::Value) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .is_some_and(|hooks_arr| {
            hooks_arr.iter().any(|h| {
                h.get("_dr_vibe") == Some(&serde_json::json!(true))
                    || h.get("command")
                        .and_then(|c| c.as_str())
                        .is_some_and(is_dr_vibe_hook_command)
            })
        })
}

/// `settings` with Dr. Vibe's hook groups for `cmd` (replacing older ones).
pub(crate) fn with_dr_vibe_hooks(
    mut settings: serde_json::Value,
    cmd: &str,
) -> Result<serde_json::Value, String> {
    if !settings.is_object() {
        return Err("settings.json is not an object".into());
    }
    if settings.get("hooks").is_none() {
        settings["hooks"] = serde_json::json!({});
    }
    // No extra fields: Claude Code rejects hooks with unrecognized properties.
    let dr_vibe_hook = serde_json::json!({
        "type": "command",
        "command": cmd,
        "timeout": 10
    });
    let hooks = settings["hooks"]
        .as_object_mut()
        .ok_or("hooks is not an object")?;
    for (event_name, matcher) in &HOOK_CONFIGS {
        let event_array = hooks
            .entry(event_name.to_string())
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .ok_or(format!("{} is not an array", event_name))?;
        // Any prior Dr. Vibe entry (including broken pre-1.0.4 Windows ones
        // and the old Read matcher) is replaced by the current command.
        event_array.retain(|entry| !is_dr_vibe_group(entry));
        let mut group = serde_json::json!({ "hooks": [dr_vibe_hook.clone()] });
        if let Some(m) = matcher {
            group["matcher"] = serde_json::json!(m);
        }
        event_array.push(group);
    }
    Ok(settings)
}

/// `settings` without any Dr. Vibe hook group; event lists and a `hooks`
/// object left empty by that are removed. Everything else is untouched.
pub(crate) fn without_dr_vibe_hooks(mut settings: serde_json::Value) -> serde_json::Value {
    let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return settings;
    };
    let mut emptied = Vec::new();
    for (name, value) in hooks.iter_mut() {
        if let Some(event_array) = value.as_array_mut() {
            let before = event_array.len();
            event_array.retain(|entry| !is_dr_vibe_group(entry));
            if event_array.is_empty() && before > 0 {
                emptied.push(name.clone());
            }
        }
    }
    for name in emptied {
        hooks.remove(&name);
    }
    if hooks.is_empty() {
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("hooks");
        }
    }
    settings
}

/// Write Claude Code's settings without ever leaving a half-written file:
/// the old file is kept as `settings.json.bak`, the new one is written to a
/// temp file next to it and renamed over the original.
pub(crate) fn write_settings_atomically(
    path: &Path,
    settings: &serde_json::Value,
) -> Result<(), String> {
    let output = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Cannot serialize settings: {}", e))?;
    let tmp = path.with_extension("json.dr-vibe-tmp");
    std::fs::write(&tmp, output).map_err(|e| format!("Cannot write settings.json: {}", e))?;
    if path.exists() {
        if let Err(e) = std::fs::copy(path, path.with_extension("json.bak")) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Cannot back up settings.json: {}", e));
        }
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Cannot replace settings.json: {}", e)
    })
}

fn read_settings(path: &Path) -> Result<Option<serde_json::Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Cannot read settings.json: {}", e))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("Cannot parse settings.json: {}", e))
}

/// Comparison form of a path, as `repoKey` in repoPaths.js and `normalize`
/// in the hook script: forward slashes, no trailing slash, lowercase for
/// Windows drive paths.
pub(crate) fn repo_key(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let trimmed = unified.trim_end_matches('/');
    let unified = if trimmed.is_empty() { "/" } else { trimmed };
    let b = unified.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        unified.to_lowercase()
    } else {
        unified.to_string()
    }
}

/// The body of `~/.dr-vibe/tracked.txt`: `#discover` first when a session
/// starting in an untracked repo may be noted, then one repo key per line.
pub(crate) fn tracked_list(roots: &[String], discover: bool) -> String {
    let mut keys: Vec<String> = roots
        .iter()
        .map(|r| r.trim())
        .filter(|r| !r.is_empty() && !r.contains(['\n', '\r']))
        .map(repo_key)
        .collect();
    keys.sort();
    keys.dedup();
    let mut out = String::new();
    if discover {
        out.push_str("#discover\n");
    }
    for k in keys {
        out.push_str(&k);
        out.push('\n');
    }
    out
}

fn dr_vibe_dir(home: &Path) -> PathBuf {
    home.join(".dr-vibe")
}

/// Write a small file in ~/.dr-vibe through a temp file and a rename, so the
/// hook never reads half of it.
fn write_small_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// True while the hooks are installed (the script's install marker is there).
fn hooks_deployed(home: &Path) -> bool {
    dr_vibe_dir(home).join("install-marker").exists()
}

/// Delete every file Dr. Vibe keeps for the hooks, and the folder if that
/// leaves it empty.
pub(crate) fn remove_hook_files(home: &Path) {
    let dir = dr_vibe_dir(home);
    for name in HOOK_FILES {
        let _ = std::fs::remove_file(dir.join(name));
    }
    let _ = std::fs::remove_dir(&dir); // only succeeds when empty
}

/// Remove Dr. Vibe's hooks from `~/.claude/settings.json` (if any) and its
/// files in `~/.dr-vibe`. Used by the switch, "Delete all local data" and
/// the uninstaller (`--privacy-uninstall-cleanup`, main.rs).
pub(crate) fn remove_everything(home: &Path) -> Result<(), String> {
    let settings_path = home.join(".claude").join("settings.json");
    let result = match read_settings(&settings_path) {
        Ok(Some(settings)) => {
            let cleaned = without_dr_vibe_hooks(settings.clone());
            if cleaned != settings {
                write_settings_atomically(&settings_path, &cleaned)
            } else {
                Ok(())
            }
        }
        Ok(None) => Ok(()),
        Err(e) => Err(e),
    };
    remove_hook_files(home);
    result
}

/// Install Dr. Vibe hooks into ~/.claude/settings.json.
/// Self-healing: while the Claude Code switch is on, every Dr. Vibe startup
/// (after setup) re-runs this and replaces any prior Dr. Vibe hook entries
/// with the current platform-correct command form. Fails with
/// [`CLAUDE_CODE_NOT_FOUND`] when Claude Code isn't installed. The script
/// logs only inside the repos in `~/.dr-vibe/tracked.txt`
/// ([`set_hook_tracked_repos`]).
#[tauri::command]
pub(crate) fn install_claude_code_hooks(app_handle: tauri::AppHandle) -> Result<String, String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    let settings_path = claude_settings_path(&home)?;

    // Deploy both hook files to ~/.dr-vibe. The .cmd is shipped as a fallback
    // for future Claude Code versions that may invoke hooks via cmd.exe; the
    // current registered command always points at the .sh.
    let sh_path = deploy_hook_resource(&app_handle, "claude-code-hook.sh", true)?
        .ok_or("claude-code-hook.sh missing")?;
    let _ = deploy_hook_resource(&app_handle, "claude-code-hook.cmd", false)?;

    // The script stays silent once this app is gone (removed without the
    // uninstaller's cleanup).
    let dir = dr_vibe_dir(&home);
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find the app: {}", e))?;
    write_small_atomically(
        &dir.join("install-marker"),
        &format!("{}\n", hook_path_for_bash(&exe)?),
    )
    .map_err(|e| format!("Cannot write the install marker: {}", e))?;
    // Nothing is logged until the main window lists the tracked repos.
    if !dir.join("tracked.txt").exists() {
        write_small_atomically(&dir.join("tracked.txt"), "")
            .map_err(|e| format!("Cannot write tracked.txt: {}", e))?;
    }

    // Build the hook command. On every platform Claude Code launches hooks
    // through bash, which on Windows is /usr/bin/bash (Git Bash / MSYS).
    // bash interprets backslashes as escape characters, so a Windows-native
    // path mangles to "C:Usersyou..." (exit 127). Quoted bash.exe + arg
    // mis-tokenizes (exit 126). The form that survives both:
    //   /c/Users/you/.dr-vibe/claude-code-hook.sh
    // i.e. an MSYS-style POSIX path with no spaces and no backslashes,
    // executed via the script's #!/bin/bash shebang.
    let cmd = hook_path_for_bash(&sh_path)?;

    let settings = read_settings(&settings_path)?.unwrap_or_else(|| serde_json::json!({}));
    let settings = with_dr_vibe_hooks(settings, &cmd)?;
    write_settings_atomically(&settings_path, &settings)?;

    Ok(format!("Installed hooks using: {}", cmd))
}

/// Remove Dr. Vibe hooks from ~/.claude/settings.json and delete the hook
/// files and the Claude Code log in ~/.dr-vibe.
#[tauri::command]
pub(crate) fn uninstall_claude_code_hooks() -> Result<String, String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    remove_everything(&home)?;
    Ok("Uninstalled Dr. Vibe hooks and deleted the log".to_string())
}

/// Whether Claude Code is installed here (`~/.claude` exists). The setup
/// wizard shows the Claude Code card only then; asking never installs.
#[tauri::command]
pub(crate) fn claude_code_present() -> bool {
    dirs_home().is_some_and(|home| claude_settings_path(&home).is_ok())
}

/// The repos the hook may log in (TrackedRepos in the main window), and
/// whether a session starting elsewhere may be noted ("Also track the repos
/// Claude Code works in"). Written only while the hooks are installed.
#[tauri::command]
pub(crate) fn set_hook_tracked_repos(roots: Vec<String>, discover: bool) -> Result<(), String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    if !hooks_deployed(&home) {
        return Ok(());
    }
    write_small_atomically(
        &dr_vibe_dir(&home).join("tracked.txt"),
        &tracked_list(&roots, discover),
    )
}

/// Pause tracking for the hook too: `until_secs` in unix seconds, 0 for
/// "until I resume", None to resume. Only while the hooks are installed.
#[tauri::command]
pub(crate) fn set_hook_paused(until_secs: Option<u64>) -> Result<(), String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    if !hooks_deployed(&home) {
        return Ok(());
    }
    let path = dr_vibe_dir(&home).join("paused-until");
    match until_secs {
        Some(s) => write_small_atomically(&path, &format!("{s}\n")),
        None => match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
    }
}

/// Check whether Dr. Vibe hooks are present in ~/.claude/settings.json.
/// Returns true if at least one hook with the "claude-code-hook.sh" fingerprint
/// or legacy "_dr_vibe" marker is found.
#[tauri::command]
pub(crate) fn check_claude_code_hooks() -> bool {
    let home = match dirs_home() {
        Some(h) => h,
        None => return false,
    };
    let settings_path = home.join(".claude").join("settings.json");
    if !settings_path.exists() {
        return false;
    }

    let content = match std::fs::read_to_string(&settings_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let hooks = match settings.get("hooks").and_then(|h| h.as_object()) {
        Some(h) => h,
        None => return false,
    };

    for (_, event_array) in hooks {
        if let Some(entries) = event_array.as_array() {
            for entry in entries {
                if let Some(hook_list) = entry.get("hooks").and_then(|h| h.as_array()) {
                    for hook in hook_list {
                        // Check command fingerprint (current scheme — .sh or .cmd)
                        if hook
                            .get("command")
                            .and_then(|c| c.as_str())
                            .is_some_and(is_dr_vibe_hook_command)
                        {
                            return true;
                        }
                        // Check legacy _dr_vibe marker
                        if hook.get("_dr_vibe") == Some(&serde_json::json!(true)) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TempDir;
    use std::io::Write;

    #[test]
    fn never_creates_claude_folder_for_non_users() {
        let dir = TempDir::new("home");
        let home = dir.path();
        assert_eq!(
            claude_settings_path(home).unwrap_err(),
            CLAUDE_CODE_NOT_FOUND
        );
        assert!(!home.join(".claude").exists());
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        assert_eq!(
            claude_settings_path(home).unwrap(),
            home.join(".claude").join("settings.json")
        );
    }

    /// The log path, and the folder holding it (removed when dropped).
    fn temp_log(name: &str, contents: &[u8]) -> (PathBuf, TempDir) {
        let dir = TempDir::new(name);
        let path = dir.join("events.jsonl");
        std::fs::write(&path, contents).unwrap();
        (path, dir)
    }

    fn append(path: &Path, bytes: &[u8]) {
        let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn missing_log_reads_nothing() {
        let r = read_events_from(Path::new("Z:/definitely/not/here.jsonl"), 0).unwrap();
        assert!(r.events.is_empty());
        assert_eq!(r.new_offset, 0);
    }

    #[test]
    fn reads_new_events_from_offset() {
        let (path, _dir) = temp_log("offset", b"{\"type\":\"a\"}\n{\"type\":\"b\"}\n");
        let first = read_events_from(&path, 0).unwrap();
        assert_eq!(first.events.len(), 2);
        assert!(read_events_from(&path, first.new_offset)
            .unwrap()
            .events
            .is_empty());

        append(&path, b"{\"type\":\"c\"}\n");
        let next = read_events_from(&path, first.new_offset).unwrap();
        assert_eq!(next.events.len(), 1);
        assert_eq!(next.events[0]["type"], "c");
    }

    #[test]
    fn partial_line_waits_for_the_writer() {
        let (path, _dir) = temp_log("partial", b"{\"type\":\"a\"}\n{\"type\":");
        let r = read_events_from(&path, 0).unwrap();
        assert_eq!(r.events.len(), 1);
        append(&path, b"\"b\"}\n");
        let r2 = read_events_from(&path, r.new_offset).unwrap();
        assert_eq!(r2.events.len(), 1, "the completed line is read, not lost");
        assert_eq!(r2.events[0]["type"], "b");
    }

    #[test]
    fn crlf_and_unicode_keep_offsets_exact() {
        let body = "{\"path\":\"café.rs\"}\r\n{\"path\":\"x\"}\r\n"
            .as_bytes()
            .to_vec();
        let (path, _dir) = temp_log("crlf", &body);
        let r = read_events_from(&path, 0).unwrap();
        assert_eq!(r.events.len(), 2);
        assert_eq!(r.new_offset, body.len() as u64);
    }

    #[test]
    fn skips_garbage_lines() {
        let (path, _dir) = temp_log("garbage", b"not json\n\n{\"ok\":true}\n");
        let r = read_events_from(&path, 0).unwrap();
        assert_eq!(r.events.len(), 1);
    }

    #[test]
    fn rotated_log_starts_over() {
        let (path, _dir) = temp_log("rotate", b"{}\n");
        assert_eq!(read_events_from(&path, 10_000).unwrap().new_offset, 0);
    }

    #[test]
    fn recognises_dr_vibe_hook_commands() {
        assert!(is_dr_vibe_hook_command(
            "bash \"C:/Users/x/.dr-vibe/claude-code-hook.sh\" PostToolUse"
        ));
        assert!(!is_dr_vibe_hook_command("prettier --write"));
    }
    fn other_tool_settings() -> serde_json::Value {
        serde_json::json!({
            "model": "opus",
            "hooks": {
                "PostToolUse": [
                    { "matcher": "Write", "hooks": [{ "type": "command", "command": "prettier --write" }] },
                    { "matcher": "Write|Edit|NotebookEdit|Read|Bash", "hooks": [{ "type": "command", "command": "/c/Users/x/.dr-vibe/claude-code-hook.sh" }] }
                ],
                "Stop": [{ "hooks": [{ "type": "command", "command": "bash \"C:/Users/x/.dr-vibe/claude-code-hook.sh\" Stop" }] }]
            }
        })
    }

    #[test]
    fn install_replaces_old_entries_and_drops_the_read_matcher() {
        let s = with_dr_vibe_hooks(
            other_tool_settings(),
            "/c/Users/x/.dr-vibe/claude-code-hook.sh",
        )
        .unwrap();
        let post = s["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(
            post.len(),
            2,
            "the other tool's hook stays, ours is replaced once"
        );
        assert_eq!(post[0]["hooks"][0]["command"], "prettier --write");
        assert_eq!(post[1]["matcher"], "Write|Edit|NotebookEdit|Bash");
        assert!(!post[1]["matcher"].as_str().unwrap().contains("Read"));
        for (event, _) in HOOK_CONFIGS {
            let ours = s["hooks"][event]
                .as_array()
                .unwrap()
                .iter()
                .filter(|g| is_dr_vibe_group(g))
                .count();
            assert_eq!(ours, 1, "{event}");
        }
        assert_eq!(s["model"], "opus");
        assert!(with_dr_vibe_hooks(serde_json::json!([]), "x").is_err());
    }

    #[test]
    fn uninstall_leaves_only_other_tools() {
        let s = without_dr_vibe_hooks(
            with_dr_vibe_hooks(other_tool_settings(), "/x/claude-code-hook.sh").unwrap(),
        );
        assert_eq!(
            s,
            serde_json::json!({
                "model": "opus",
                "hooks": { "PostToolUse": [{ "matcher": "Write", "hooks": [{ "type": "command", "command": "prettier --write" }] }] }
            })
        );
        let mine_only =
            with_dr_vibe_hooks(serde_json::json!({}), "/x/claude-code-hook.sh").unwrap();
        assert_eq!(without_dr_vibe_hooks(mine_only), serde_json::json!({}));
        // Someone else's empty list is not ours to remove.
        let theirs = serde_json::json!({ "hooks": { "Stop": [] } });
        assert_eq!(without_dr_vibe_hooks(theirs.clone()), theirs);
    }

    #[test]
    fn settings_are_written_atomically_with_a_backup() {
        let dir = TempDir::new("claude-settings");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{\"model\":\"old\"}").unwrap();
        write_settings_atomically(&path, &serde_json::json!({ "model": "new" })).unwrap();
        let now: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(now["model"], "new");
        assert_eq!(
            std::fs::read_to_string(path.with_extension("json.bak")).unwrap(),
            "{\"model\":\"old\"}"
        );
        assert!(!path.with_extension("json.dr-vibe-tmp").exists());
    }

    #[test]
    fn removing_everything_cleans_settings_and_dr_vibe_folder() {
        let dir = TempDir::new("hooks-home");
        let home = dir.path();
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(home.join(".dr-vibe")).unwrap();
        let settings = with_dr_vibe_hooks(other_tool_settings(), "/x/claude-code-hook.sh").unwrap();
        std::fs::write(home.join(".claude/settings.json"), settings.to_string()).unwrap();
        for f in HOOK_FILES {
            std::fs::write(home.join(".dr-vibe").join(f), "x").unwrap();
        }
        remove_everything(home).unwrap();
        assert!(
            !home.join(".dr-vibe").exists(),
            "log, scripts and lists are gone"
        );
        let left: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(home.join(".claude/settings.json")).unwrap(),
        )
        .unwrap();
        assert!(!left.to_string().contains("claude-code-hook"));
        assert_eq!(left["model"], "opus");
        // Nothing to do is fine too.
        remove_everything(home).unwrap();
    }

    #[test]
    fn a_folder_with_other_files_is_kept() {
        let dir = TempDir::new("hooks-keep");
        let home = dir.path();
        std::fs::create_dir_all(home.join(".dr-vibe")).unwrap();
        std::fs::write(home.join(".dr-vibe/claude-code-events.jsonl"), "{}\n").unwrap();
        std::fs::write(home.join(".dr-vibe/notes.txt"), "mine").unwrap();
        remove_hook_files(home);
        assert!(!home.join(".dr-vibe/claude-code-events.jsonl").exists());
        assert!(home.join(".dr-vibe/notes.txt").exists());
    }

    #[test]
    fn tracked_list_uses_the_js_repo_keys() {
        assert_eq!(
            repo_key("C:\\Users\\Ada\\Code\\App\\"),
            "c:/users/ada/code/app"
        );
        assert_eq!(repo_key("/home/ada/App/"), "/home/ada/App");
        assert_eq!(repo_key("/"), "/");
        assert_eq!(
            tracked_list(
                &[
                    "C:\\A".into(),
                    "c:/a/".into(),
                    " ".into(),
                    "/x/y".into(),
                    "bad\npath".into()
                ],
                true
            ),
            "#discover\n/x/y\nc:/a\n"
        );
        assert_eq!(tracked_list(&[], false), "");
    }

    /// Git Bash on Windows (never WSL's bash), plain bash elsewhere.
    fn test_bash() -> Option<PathBuf> {
        #[cfg(windows)]
        {
            [
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files (x86)\Git\bin\bash.exe",
            ]
            .iter()
            .map(PathBuf::from)
            .find(|p| p.exists())
        }
        #[cfg(not(windows))]
        {
            Some(PathBuf::from("/bin/bash"))
        }
    }

    /// Runs tools/claude-code-hook.sh with `home` as $HOME and `input` on stdin.
    fn run_hook(bash: &Path, home: &Path, input: &serde_json::Value) {
        use std::process::{Command, Stdio};
        let script = std::fs::canonicalize("../tools/claude-code-hook.sh").unwrap();
        let mut child = Command::new(bash)
            .arg(hook_path_for_bash(&script).unwrap())
            .env("HOME", home.to_string_lossy().replace('\\', "/"))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success());
    }

    fn logged(home: &Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(home.join(".dr-vibe/claude-code-events.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).expect("every line is valid JSON"))
            .collect()
    }

    #[test]
    fn hook_script_logs_only_inside_tracked_repos() {
        let Some(bash) = test_bash() else {
            eprintln!("no bash here; skipping the hook script test");
            return;
        };
        let dir = TempDir::new("hook-gate");
        let home = dir.join("home");
        let repo = dir.join("work").join("App");
        let elsewhere = dir.join("work").join("Client Secret");
        for d in [&home.join(".dr-vibe"), &repo, &elsewhere] {
            std::fs::create_dir_all(d).unwrap();
        }
        let marker = hook_path_for_bash(&dir.join("work")).unwrap();
        std::fs::write(home.join(".dr-vibe/install-marker"), format!("{marker}\n")).unwrap();
        std::fs::write(
            home.join(".dr-vibe/tracked.txt"),
            tracked_list(&[repo.to_string_lossy().into_owned()], false),
        )
        .unwrap();
        let path_in =
            |root: &Path, name: &str| root.join("src").join(name).to_string_lossy().into_owned();
        let edit = |cwd: &Path, file: String| {
            serde_json::json!({
                "hook_event_name": "PostToolUse", "tool_name": "Edit", "session_id": "s1",
                "cwd": cwd.to_string_lossy(), "tool_input": { "file_path": file }
            })
        };

        // A crafted name cannot add fields: quotes and backslashes stay escaped.
        let tricky = path_in(&repo, "a\",\"injected\":\"1.rs");
        run_hook(&bash, &home, &edit(&repo, tricky.clone()));
        run_hook(
            &bash,
            &home,
            &edit(&repo.join("src"), path_in(&repo, "b.rs")),
        );
        run_hook(
            &bash,
            &home,
            &edit(&elsewhere, path_in(&elsewhere, "secret.rs")),
        );
        run_hook(
            &bash,
            &home,
            &serde_json::json!({ "hook_event_name": "SessionStart", "session_id": "s2", "cwd": elsewhere.to_string_lossy() }),
        );
        let lines = logged(&home);
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert_eq!(lines[0]["event"], "file_changed");
        assert_eq!(lines[0]["file"], tricky);
        assert!(lines[0].get("injected").is_none());
        assert!(lines.iter().all(|l| !l.to_string().contains("Secret")));

        // "#discover": a session starting elsewhere notes only its folder.
        std::fs::write(
            home.join(".dr-vibe/tracked.txt"),
            tracked_list(&[repo.to_string_lossy().into_owned()], true),
        )
        .unwrap();
        run_hook(
            &bash,
            &home,
            &edit(&elsewhere, path_in(&elsewhere, "secret.rs")),
        );
        run_hook(
            &bash,
            &home,
            &serde_json::json!({ "hook_event_name": "SessionStart", "session_id": "s3", "cwd": elsewhere.to_string_lossy() }),
        );
        let lines = logged(&home);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[2]["event"], "session_start");
        assert!(!lines.iter().any(|l| l.to_string().contains("secret.rs")));

        // Paused: nothing at all.
        std::fs::write(home.join(".dr-vibe/paused-until"), "0\n").unwrap();
        run_hook(&bash, &home, &edit(&repo, path_in(&repo, "c.rs")));
        assert_eq!(logged(&home).len(), 3);
        std::fs::remove_file(home.join(".dr-vibe/paused-until")).unwrap();

        // App gone (marker points nowhere, or no marker): silent.
        std::fs::write(
            home.join(".dr-vibe/install-marker"),
            "/nowhere/DrVibe.exe\n",
        )
        .unwrap();
        run_hook(&bash, &home, &edit(&repo, path_in(&repo, "d.rs")));
        std::fs::remove_file(home.join(".dr-vibe/install-marker")).unwrap();
        run_hook(&bash, &home, &edit(&repo, path_in(&repo, "e.rs")));
        assert_eq!(logged(&home).len(), 3);
    }
}
