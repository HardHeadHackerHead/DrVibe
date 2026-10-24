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
    source_candidates.push(PathBuf::from("../tools").join(filename));
    source_candidates.push(PathBuf::from("tools").join(filename));
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

/// Install Dr. Vibe hooks into ~/.claude/settings.json.
/// Self-healing: while the Claude Code switch in Settings is on, every Dr. Vibe
/// startup re-runs this and replaces any prior Dr. Vibe hook entries with the
/// current platform-correct command form. Old entries from broken builds are
/// removed by fingerprint match. Fails with [`CLAUDE_CODE_NOT_FOUND`] when
/// Claude Code isn't installed.
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

    // Build the hook command. On every platform Claude Code launches hooks
    // through bash, which on Windows is /usr/bin/bash (Git Bash / MSYS).
    // bash interprets backslashes as escape characters, so a Windows-native
    // path mangles to "C:Usersyou..." (exit 127). Quoted bash.exe + arg
    // mis-tokenizes (exit 126). The form that survives both:
    //   /c/Users/you/.dr-vibe/claude-code-hook.sh
    // i.e. an MSYS-style POSIX path with no spaces and no backslashes,
    // executed via the script's #!/bin/bash shebang.
    let cmd = hook_path_for_bash(&sh_path)?;

    // Read existing settings or start fresh (the .claude folder exists).
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Cannot read settings.json: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Cannot parse settings.json: {}", e))?
    } else {
        serde_json::json!({})
    };

    // Ensure hooks object exists
    if settings.get("hooks").is_none() {
        settings["hooks"] = serde_json::json!({});
    }

    // Define the hooks Dr. Vibe needs (no extra fields — Claude Code
    // rejects hooks with unrecognized properties in newer versions)
    let dr_vibe_hook = serde_json::json!({
        "type": "command",
        "command": cmd,
        "timeout": 10
    });

    let hook_configs = vec![
        ("PostToolUse", Some("Write|Edit|NotebookEdit|Read|Bash")),
        ("SessionStart", None),
        ("SessionEnd", None),
        ("Stop", None),
    ];

    let hooks = settings["hooks"]
        .as_object_mut()
        .ok_or("hooks is not an object")?;

    for (event_name, matcher) in &hook_configs {
        // Get or create the array for this event
        if hooks.get(*event_name).is_none() {
            hooks.insert(event_name.to_string(), serde_json::json!([]));
        }

        let event_array = hooks
            .get_mut(*event_name)
            .unwrap()
            .as_array_mut()
            .ok_or(format!("{} is not an array", event_name))?;

        // Remove any existing Dr. Vibe entries from this event.
        // Matches both the current and legacy command fingerprints, plus the
        // ancient _dr_vibe marker, so any prior install (including broken
        // pre-1.0.4 Windows entries) is replaced by the new command.
        event_array.retain(|entry| {
            let inner = entry.get("hooks").and_then(|h| h.as_array());
            let has_marker = inner.as_ref().is_some_and(|hooks_arr| {
                hooks_arr
                    .iter()
                    .any(|h| h.get("_dr_vibe") == Some(&serde_json::json!(true)))
            });
            let has_fingerprint = inner.as_ref().is_some_and(|hooks_arr| {
                hooks_arr.iter().any(|h| {
                    h.get("command")
                        .and_then(|c| c.as_str())
                        .is_some_and(is_dr_vibe_hook_command)
                })
            });
            !has_marker && !has_fingerprint
        });

        // Build the new hook group entry
        let mut group = serde_json::json!({
            "hooks": [dr_vibe_hook.clone()]
        });
        if let Some(m) = matcher {
            group["matcher"] = serde_json::json!(m);
        }

        event_array.push(group);
    }

    // Write back
    let output = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Cannot serialize settings: {}", e))?;
    std::fs::write(&settings_path, output)
        .map_err(|e| format!("Cannot write settings.json: {}", e))?;

    Ok(format!("Installed hooks using: {}", cmd))
}

/// Remove Dr. Vibe hooks from ~/.claude/settings.json.
/// Identifies entries by the "claude-code-hook.sh" fingerprint or legacy "_dr_vibe" marker.
#[tauri::command]
pub(crate) fn uninstall_claude_code_hooks() -> Result<String, String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    if !settings_path.exists() {
        return Ok("No settings.json found — nothing to uninstall".to_string());
    }

    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Cannot read settings.json: {}", e))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Cannot parse settings.json: {}", e))?;

    let hooks = match settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        Some(h) => h,
        None => return Ok("No hooks section — nothing to uninstall".to_string()),
    };

    let event_names: Vec<String> = hooks.keys().cloned().collect();

    for event_name in &event_names {
        if let Some(event_array) = hooks.get_mut(event_name).and_then(|v| v.as_array_mut()) {
            // Remove hook groups that contain the fingerprint or legacy _dr_vibe marker.
            event_array.retain(|entry| {
                let inner = entry.get("hooks").and_then(|h| h.as_array());
                let has_marker = inner.as_ref().is_some_and(|hooks_arr| {
                    hooks_arr
                        .iter()
                        .any(|h| h.get("_dr_vibe") == Some(&serde_json::json!(true)))
                });
                let has_fingerprint = inner.as_ref().is_some_and(|hooks_arr| {
                    hooks_arr.iter().any(|h| {
                        h.get("command")
                            .and_then(|c| c.as_str())
                            .is_some_and(is_dr_vibe_hook_command)
                    })
                });
                !has_marker && !has_fingerprint
            });
        }
    }

    // Clean up empty event arrays
    let empty_events: Vec<String> = hooks
        .iter()
        .filter(|(_, v)| v.as_array().is_some_and(|a| a.is_empty()))
        .map(|(k, _)| k.clone())
        .collect();
    for key in &empty_events {
        hooks.remove(key);
    }

    // Clean up empty hooks object
    if hooks.is_empty() {
        settings.as_object_mut().unwrap().remove("hooks");
    }

    let output = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Cannot serialize settings: {}", e))?;
    std::fs::write(&settings_path, output)
        .map_err(|e| format!("Cannot write settings.json: {}", e))?;

    Ok("Uninstalled Dr. Vibe hooks".to_string())
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
    use std::io::Write;

    #[test]
    fn never_creates_claude_folder_for_non_users() {
        let home = std::env::temp_dir().join(format!("drvibe-test-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        assert_eq!(
            claude_settings_path(&home).unwrap_err(),
            CLAUDE_CODE_NOT_FOUND
        );
        assert!(!home.join(".claude").exists());
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        assert_eq!(
            claude_settings_path(&home).unwrap(),
            home.join(".claude").join("settings.json")
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    fn temp_log(name: &str, contents: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("drvibe-test-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("events.jsonl");
        std::fs::write(&path, contents).unwrap();
        path
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
        let path = temp_log("offset", b"{\"type\":\"a\"}\n{\"type\":\"b\"}\n");
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
        let path = temp_log("partial", b"{\"type\":\"a\"}\n{\"type\":");
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
        let path = temp_log("crlf", &body);
        let r = read_events_from(&path, 0).unwrap();
        assert_eq!(r.events.len(), 2);
        assert_eq!(r.new_offset, body.len() as u64);
    }

    #[test]
    fn skips_garbage_lines() {
        let path = temp_log("garbage", b"not json\n\n{\"ok\":true}\n");
        let r = read_events_from(&path, 0).unwrap();
        assert_eq!(r.events.len(), 1);
    }

    #[test]
    fn rotated_log_starts_over() {
        let path = temp_log("rotate", b"{}\n");
        assert_eq!(read_events_from(&path, 10_000).unwrap().new_offset, 0);
    }

    #[test]
    fn recognises_dr_vibe_hook_commands() {
        assert!(is_dr_vibe_hook_command(
            "bash \"C:/Users/x/.dr-vibe/claude-code-hook.sh\" PostToolUse"
        ));
        assert!(!is_dr_vibe_hook_command("prettier --write"));
    }
}
