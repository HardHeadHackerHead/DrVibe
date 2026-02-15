// Dr. Vibe - Desktop Companion
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

// Tray menu state for dynamic show/hide toggle
struct TrayMenuState {
    toggle_item: tauri::menu::MenuItem<tauri::Wry>,
}

// Global file watcher state
struct WatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<String>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watcher: None,
            watched_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub process_id: u32,
}

// Get the current cursor position in screen coordinates
#[tauri::command]
fn get_cursor_position() -> Result<(i32, i32), String> {
    get_cursor_position_impl()
}

// Get information about the currently active window
#[tauri::command]
fn get_active_window() -> Result<WindowInfo, String> {
    get_active_window_impl()
}

// Check if the given app name is a coding application
#[tauri::command]
fn is_coding_app(app_name: String) -> bool {
    let coding_apps = [
        "code",
        "visual studio",
        "cursor",
        "zed",
        "sublime",
        "intellij",
        "webstorm",
        "pycharm",
        "goland",
        "rider",
        "clion",
        "datagrip",
        "rustrover",
        "vim",
        "nvim",
        "neovim",
        "emacs",
        "terminal",
        "iterm",
        "alacritty",
        "kitty",
        "warp",
        "hyper",
        "windowsterminal",
        "powershell",
        "cmd",
    ];

    let lower_name = app_name.to_lowercase();

    for app in coding_apps.iter() {
        if lower_name.contains(app) {
            return true;
        }
    }

    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMarkers {
    pub project_name: String,
    pub project_type: String,
    pub markers_found: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
}

// Scan a directory for project marker files (.git, package.json, Cargo.toml, etc.)
#[tauri::command]
fn scan_project_markers(dir_path: String) -> Result<ProjectMarkers, String> {
    let dir = Path::new(&dir_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    // Order matters: first non-git match sets the project_type.
    // .git is checked last so specific types take precedence.
    let marker_checks: Vec<(&str, &str)> = vec![
        ("Cargo.toml", "rust"),
        ("package.json", "node"),
        ("pyproject.toml", "python"),
        ("setup.py", "python"),
        ("requirements.txt", "python"),
        ("go.mod", "go"),
        ("pubspec.yaml", "flutter"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("*.sln", "dotnet"),
        ("*.csproj", "dotnet"),
        ("Gemfile", "ruby"),
        ("composer.json", "php"),
        ("CMakeLists.txt", "cmake"),
        ("Makefile", "make"),
        ("*.ipynb", "datascience"),
        ("index.html", "web"),
        (".git", "git"),
    ];

    let mut markers_found = Vec::new();
    let mut project_type = String::from("unknown");

    for (marker, ptype) in &marker_checks {
        if marker.starts_with('*') {
            // Glob-style check: look for any file matching the extension
            let ext = &marker[1..]; // e.g. ".sln"
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(ext) {
                            markers_found.push(name.to_string());
                            if project_type == "unknown" {
                                project_type = ptype.to_string();
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            let marker_path = dir.join(marker);
            if marker_path.exists() {
                markers_found.push(marker.to_string());
                if project_type == "unknown" {
                    project_type = ptype.to_string();
                }
            }
        }
    }

    if markers_found.is_empty() {
        return Err("No project markers found".to_string());
    }

    // Derive project name from directory name
    let project_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(ProjectMarkers {
        project_name,
        project_type,
        markers_found,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProject {
    pub name: String,
    pub path: String,
    pub project_type: String,
    pub markers_found: Vec<String>,
}

// Recursively scan directories for coding projects up to a depth limit.
// Skips common build artifact and dependency directories for speed.
#[tauri::command]
fn scan_directories_for_projects(search_paths: Vec<String>, max_depth: u32) -> Vec<DiscoveredProject> {
    let home = dirs_home();
    let mut projects = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    let ignore_dirs: std::collections::HashSet<&str> = [
        "node_modules", ".node_modules", "venv", ".venv", "env",
        "target", "build", "dist", "out", ".output", ".next", ".nuxt",
        "__pycache__", ".cache", ".gradle", ".m2", ".cargo",
        ".git", ".svn", ".hg",
        "$Recycle.Bin", "System Volume Information",
        "AppData", "Library", ".Trash",
        ".idea", ".vs", ".vscode",
    ].iter().copied().collect();

    let marker_checks: Vec<(&str, &str)> = vec![
        ("Cargo.toml", "rust"),
        ("package.json", "node"),
        ("pyproject.toml", "python"),
        ("setup.py", "python"),
        ("requirements.txt", "python"),
        ("go.mod", "go"),
        ("pubspec.yaml", "flutter"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("Gemfile", "ruby"),
        ("composer.json", "php"),
        ("CMakeLists.txt", "cmake"),
        ("Makefile", "make"),
        ("index.html", "web"),
        (".git", "git"),
    ];

    for search in &search_paths {
        let resolved = if search.starts_with("~/") || search.starts_with("~\\") {
            match &home {
                Some(h) => h.join(&search[2..]),
                None => continue,
            }
        } else if search == "~" {
            match &home {
                Some(h) => h.clone(),
                None => continue,
            }
        } else {
            PathBuf::from(search)
        };

        if !resolved.is_dir() {
            continue;
        }

        // Iterative stack-based depth-limited traversal
        let mut stack: Vec<(PathBuf, u32)> = vec![(resolved, 0)];

        while let Some((dir, depth)) = stack.pop() {
            if depth > max_depth {
                continue;
            }

            let dir_str = dir.to_string_lossy().to_string();
            if seen_paths.contains(&dir_str) {
                continue;
            }
            seen_paths.insert(dir_str);

            // Check this directory for project markers
            let mut markers_found = Vec::new();
            let mut project_type = String::new();

            for (marker, ptype) in &marker_checks {
                let marker_path = dir.join(marker);
                if marker_path.exists() {
                    markers_found.push(marker.to_string());
                    if project_type.is_empty() {
                        project_type = ptype.to_string();
                    }
                }
            }

            // Also check for glob-style markers (*.sln, *.csproj, *.ipynb)
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(".sln") || name.ends_with(".csproj") {
                            markers_found.push(name.to_string());
                            if project_type.is_empty() {
                                project_type = "dotnet".to_string();
                            }
                        } else if name.ends_with(".ipynb") {
                            markers_found.push(name.to_string());
                            if project_type.is_empty() {
                                project_type = "datascience".to_string();
                            }
                        }
                    }
                }
            }

            if !markers_found.is_empty() {
                let name = dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                projects.push(DiscoveredProject {
                    name,
                    path: dir.to_string_lossy().to_string(),
                    project_type,
                    markers_found,
                });

                // Don't recurse into discovered projects (they are leaf nodes)
                continue;
            }

            // If not a project, recurse into subdirectories
            if depth < max_depth {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                                if !ignore_dirs.contains(dir_name) && !dir_name.starts_with('.') {
                                    stack.push((path, depth + 1));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    projects
}

// Scan common directories for git repositories with recent activity
#[tauri::command]
fn get_recent_git_repos(search_paths: Vec<String>) -> Vec<RepoInfo> {
    let mut repos = Vec::new();
    let home = dirs_home();

    for search in &search_paths {
        let resolved = if search.starts_with("~/") {
            match &home {
                Some(h) => h.join(&search[2..]),
                None => continue,
            }
        } else {
            PathBuf::from(search)
        };

        if !resolved.is_dir() {
            continue;
        }

        // Scan one level deep for directories containing .git
        if let Ok(entries) = std::fs::read_dir(&resolved) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && path.join(".git").exists() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        repos.push(RepoInfo {
                            name: name.to_string(),
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    repos
}

/// Read new JSONL events from the Claude Code integration log file.
/// Reads lines starting from `offset` (byte offset) and returns
/// the new events plus the updated offset for the next call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeEventsResult {
    pub events: Vec<serde_json::Value>,
    pub new_offset: u64,
}

#[tauri::command]
fn read_claude_code_events(offset: u64) -> Result<ClaudeCodeEventsResult, String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    let log_path = home.join(".dr-vibe").join("claude-code-events.jsonl");

    if !log_path.exists() {
        return Ok(ClaudeCodeEventsResult {
            events: Vec::new(),
            new_offset: 0,
        });
    }

    let metadata = std::fs::metadata(&log_path)
        .map_err(|e| format!("Cannot stat log file: {}", e))?;
    let file_size = metadata.len();

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

    use std::io::{Seek, SeekFrom, BufRead, BufReader};
    let mut file = std::fs::File::open(&log_path)
        .map_err(|e| format!("Cannot open log file: {}", e))?;

    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Cannot seek: {}", e))?;

    let reader = BufReader::new(&file);
    let mut events = Vec::new();
    let mut bytes_read = offset;

    for line in reader.lines() {
        match line {
            Ok(text) => {
                bytes_read += text.len() as u64 + 1; // +1 for newline
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    events.push(parsed);
                }
            }
            Err(_) => break,
        }
    }

    Ok(ClaudeCodeEventsResult {
        events,
        new_offset: bytes_read,
    })
}

/// Find the Git Bash executable path (Windows only).
/// Returns the full path to bash.exe, or "bash" as fallback.
fn find_bash_path() -> String {
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

/// Resolve the path to the claude-code-hook.sh script.
/// Tries dev paths first, then production resource path.
fn resolve_hook_script(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Dev mode: Tauri dev runs from src-tauri/
    candidates.push(PathBuf::from("../tools/claude-code-hook.sh"));
    candidates.push(PathBuf::from("tools/claude-code-hook.sh"));

    // Production: resource directory
    if let Ok(res) = app_handle.path().resource_dir() {
        candidates.push(res.join("tools").join("claude-code-hook.sh"));
    }

    for p in &candidates {
        if p.exists() {
            // Canonicalize and convert to forward-slash path for bash
            if let Ok(abs) = std::fs::canonicalize(p) {
                let s = abs.to_string_lossy().to_string();
                // Convert Windows \\?\ prefix and backslashes
                let s = s.strip_prefix(r"\\?\").unwrap_or(&s).replace('\\', "/");
                // Convert drive letter for Git Bash: C:/... -> /c/...
                #[cfg(target_os = "windows")]
                {
                    if s.len() >= 2 && s.as_bytes()[1] == b':' {
                        let drive = s.as_bytes()[0].to_ascii_lowercase() as char;
                        return Ok(format!("/{}{}", drive, &s[2..]));
                    }
                }
                return Ok(s);
            }
        }
    }

    Err("claude-code-hook.sh not found".to_string())
}

/// Install Dr. Vibe hooks into ~/.claude/settings.json.
/// Tags each hook entry with "_dr_vibe": true so we can cleanly remove them later.
/// Removes any existing _dr_vibe hooks first to avoid duplicates.
#[tauri::command]
fn install_claude_code_hooks(app_handle: tauri::AppHandle) -> Result<String, String> {
    let bash = find_bash_path();
    let script = resolve_hook_script(&app_handle)?;

    // Build the command string
    let cmd = if bash == "bash" {
        format!("bash \"{}\"", script)
    } else {
        format!("\"{}\" \"{}\"", bash.replace('\\', "/"), script)
    };

    let home = dirs_home().ok_or("Cannot determine home directory")?;
    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    // Read existing settings or start fresh
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Cannot read settings.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Cannot parse settings.json: {}", e))?
    } else {
        // Ensure .claude directory exists
        std::fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("Cannot create .claude dir: {}", e))?;
        serde_json::json!({})
    };

    // Ensure hooks object exists
    if settings.get("hooks").is_none() {
        settings["hooks"] = serde_json::json!({});
    }

    // Define the hooks Dr. Vibe needs
    let dr_vibe_hook = serde_json::json!({
        "type": "command",
        "command": cmd,
        "timeout": 5,
        "_dr_vibe": true
    });

    let hook_configs = vec![
        ("PostToolUse", Some("Write|Edit|NotebookEdit|Read|Bash")),
        ("SessionStart", None),
        ("SessionEnd", None),
        ("Stop", None),
    ];

    let hooks = settings["hooks"].as_object_mut()
        .ok_or("hooks is not an object")?;

    for (event_name, matcher) in &hook_configs {
        // Get or create the array for this event
        if hooks.get(*event_name).is_none() {
            hooks.insert(event_name.to_string(), serde_json::json!([]));
        }

        let event_array = hooks.get_mut(*event_name).unwrap().as_array_mut()
            .ok_or(format!("{} is not an array", event_name))?;

        // Remove any existing _dr_vibe entries from this event
        event_array.retain(|entry| {
            !entry.get("hooks").and_then(|h| h.as_array()).map_or(false, |hooks_arr| {
                hooks_arr.iter().any(|h| h.get("_dr_vibe") == Some(&serde_json::json!(true)))
            })
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
/// Only removes entries tagged with "_dr_vibe": true, leaving user hooks intact.
#[tauri::command]
fn uninstall_claude_code_hooks() -> Result<String, String> {
    let home = dirs_home().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    if !settings_path.exists() {
        return Ok("No settings.json found — nothing to uninstall".to_string());
    }

    let content = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Cannot read settings.json: {}", e))?;
    let mut settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse settings.json: {}", e))?;

    let hooks = match settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        Some(h) => h,
        None => return Ok("No hooks section — nothing to uninstall".to_string()),
    };

    let event_names: Vec<String> = hooks.keys().cloned().collect();

    for event_name in &event_names {
        if let Some(event_array) = hooks.get_mut(event_name).and_then(|v| v.as_array_mut()) {
            // Remove hook groups that contain _dr_vibe entries
            event_array.retain(|entry| {
                !entry.get("hooks").and_then(|h| h.as_array()).map_or(false, |hooks_arr| {
                    hooks_arr.iter().any(|h| h.get("_dr_vibe") == Some(&serde_json::json!(true)))
                })
            });
        }
    }

    // Clean up empty event arrays
    let empty_events: Vec<String> = hooks.iter()
        .filter(|(_, v)| v.as_array().map_or(false, |a| a.is_empty()))
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

fn dirs_home() -> Option<PathBuf> {
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
fn get_cursor_position_impl() -> Result<(i32, i32), String> {
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

#[cfg(target_os = "macos")]
fn get_cursor_position_impl() -> Result<(i32, i32), String> {
    Err("macOS implementation pending".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_cursor_position_impl() -> Result<(i32, i32), String> {
    Err("Platform not supported".to_string())
}

#[cfg(target_os = "windows")]
fn get_active_window_impl() -> Result<WindowInfo, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::PWSTR;

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
            if QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), pwstr, &mut size).is_ok() {
                let full_path = String::from_utf16_lossy(&name_buffer[..size as usize]);
                if let Some(name) = full_path.split('\\').last() {
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
fn get_active_window_impl() -> Result<WindowInfo, String> {
    Err("macOS implementation pending".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_active_window_impl() -> Result<WindowInfo, String> {
    Err("Platform not supported".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeEvent {
    pub event_type: String, // "create", "modify", "delete"
    pub path: String,
    pub timestamp: u64,
}

// Directories/extensions to ignore when watching for file changes
fn should_ignore_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy();

    // Ignore hidden dirs and common non-source dirs
    let ignore_dirs = [
        "node_modules", ".git", "target", "dist", "build", "__pycache__",
        ".next", ".nuxt", ".svelte-kit", ".venv", "venv", ".tox",
        ".mypy_cache", ".pytest_cache", ".cargo",
    ];
    for dir in &ignore_dirs {
        if path_str.contains(&format!("{}{}", std::path::MAIN_SEPARATOR, dir))
            || path_str.contains(&format!("{}{}{}",dir, std::path::MAIN_SEPARATOR, ""))
        {
            return true;
        }
    }

    // Ignore common non-source extensions
    let ignore_ext = [
        "lock", "log", "tmp", "swp", "swo", "pyc", "pyo", "o", "obj", "exe", "dll", "so",
        "dylib", "class", "jar",
    ];
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if ignore_ext.contains(&ext) {
            return true;
        }
    }

    false
}

fn event_kind_to_string(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(_) => Some("modify"),
        EventKind::Remove(_) => Some("delete"),
        _ => None,
    }
}

/// Resolve the skins directory, trying production and dev paths.
fn resolve_skins_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Production: resource directory
    if let Ok(res) = app_handle.path().resource_dir() {
        candidates.push(res.join("assets").join("sprites").join("skins"));
    }

    // Dev mode: Tauri dev runs from src-tauri/, frontend is at ../src/
    candidates.push(PathBuf::from("../src/assets/sprites/skins"));
    candidates.push(PathBuf::from("src/assets/sprites/skins"));

    candidates
        .into_iter()
        .find(|p| p.is_dir())
        .ok_or_else(|| "Skins directory not found".to_string())
}

/// List available skin PNG files from the skins directory.
#[tauri::command]
fn list_skins(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let skins_dir = resolve_skins_dir(&app_handle)?;

    let mut skins = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&skins_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.to_lowercase().ends_with(".png") {
                    skins.push(name[..name.len() - 4].to_string());
                }
            }
        }
    }

    skins.sort();
    Ok(skins)
}

/// Read a skin PNG file and return its contents as base64.
#[tauri::command]
fn read_skin(name: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let skins_dir = resolve_skins_dir(&app_handle)?;
    let file_path = skins_dir.join(format!("{}.png", name));

    if !file_path.exists() {
        return Err(format!("Skin not found: {}", name));
    }

    let data = std::fs::read(&file_path)
        .map_err(|e| format!("Failed to read skin file: {}", e))?;

    Ok(BASE64.encode(&data))
}

/// Save a skin PNG file from base64 data.
#[tauri::command]
fn save_skin(name: String, data: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    // Validate the name (no path traversal)
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid skin name".to_string());
    }

    // Protect built-in skins from being overwritten
    const PROTECTED: &[&str] = &[
        "dr-vibe-default", "dr-vibe-classic", "dr-vibe-tuxedo",
        "dr-vibe-cyberpunk", "dr-vibe-alien", "dr-vibe-pirate",
        "dr-vibe-firefighter", "dr-vibe-wizard", "dr-vibe-arctic",
        "dr-vibe-retro80s", "dr-vibe-bridgemind",
    ];
    if PROTECTED.contains(&name.as_str()) {
        return Err(format!("\"{}\" is a built-in skin and cannot be overwritten. Save with a different name.", name));
    }

    let skins_dir = resolve_skins_dir(&app_handle)?;
    let file_path = skins_dir.join(format!("{}.png", name));

    let bytes = BASE64.decode(&data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("Failed to write skin file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
fn open_settings_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_panel_window(app_handle, "settings".into(), "settings.html".into(), "Dr. Vibe Settings".into(), 320.0, 560.0, false)
}

#[tauri::command]
fn open_dashboard_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_panel_window(app_handle, "dashboard".into(), "dashboard.html".into(), "Dr. Vibe Dashboard".into(), 520.0, 680.0, true)
}

#[tauri::command]
fn open_panel_window(app_handle: tauri::AppHandle, label: String, url: String, title: String, width: f64, height: f64, resizable: bool) -> Result<(), String> {
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

    tauri::WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(&title)
    .inner_size(width, height)
    .resizable(resizable)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn start_watching(path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // Stop existing watcher if any
    state.watcher = None;
    state.watched_path = None;

    let watch_path = Path::new(&path);
    if !watch_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let handle = app_handle.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if let Some(event_type) = event_kind_to_string(&event.kind) {
                    for event_path in &event.paths {
                        if should_ignore_path(event_path) {
                            continue;
                        }
                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;

                        let payload = FileChangeEvent {
                            event_type: event_type.to_string(),
                            path: event_path.to_string_lossy().to_string(),
                            timestamp,
                        };

                        let _ = handle.emit("file-changed", &payload);
                    }
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    let result = format!("Watching: {}", path);
    state.watcher = Some(watcher);
    state.watched_path = Some(path);

    Ok(result)
}

#[tauri::command]
fn stop_watching(app_handle: tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let mut state = state.lock().map_err(|e| e.to_string())?;

    state.watcher = None;
    let prev = state.watched_path.take();

    Ok(format!("Stopped watching: {}", prev.unwrap_or_default()))
}

#[tauri::command]
fn get_watched_path(app_handle: tauri::AppHandle) -> Option<String> {
    let state = app_handle.state::<Mutex<WatcherState>>();
    let state = state.lock().ok()?;
    state.watched_path.clone()
}

fn main() {
    // Set the Windows AppUserModelId so notifications show "Dr. Vibe"
    // instead of the parent process name (e.g. "Windows PowerShell")
    #[cfg(target_os = "windows")]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

        unsafe {
            let id = HSTRING::from("com.drvibe.companion");
            let _ = SetCurrentProcessExplicitAppUserModelID(&id);
        }
    }

    tauri::Builder::default()
        .manage(Mutex::new(WatcherState::default()))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
                use tauri::menu::{Menu, MenuItem};

                let toggle = MenuItem::with_id(app, "toggle_visibility", "Hide", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit Dr. Vibe", true, None::<&str>)?;
                let session_stats = MenuItem::with_id(app, "session_stats", "Session Stats", true, None::<&str>)?;
                let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
                let dashboard = MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
                let about = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
                let sprite_editor = MenuItem::with_id(app, "sprite_editor", "Sprite Editor", true, None::<&str>)?;
                let devtools = MenuItem::with_id(app, "devtools", "Dev Tools", true, None::<&str>)?;
                let debug_menu = MenuItem::with_id(app, "debug_menu", "Debug Menu", true, None::<&str>)?;

                app.manage(Mutex::new(TrayMenuState { toggle_item: toggle.clone() }));

                let menu = Menu::with_items(app, &[&toggle, &session_stats, &settings, &dashboard, &sprite_editor, &about, &devtools, &debug_menu, &quit])?;

                let _tray = TrayIconBuilder::new()
                    .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).expect("failed to load tray icon"))
                    .icon_as_template(true)
                    .menu(&menu)
                    .tooltip("Dr. Vibe - Desktop Companion")
                    .on_menu_event(move |app, event| {
                        match event.id.as_ref() {
                            "quit" => {
                                // Open Today's Wins window directly from Rust (like other panels)
                                // Opening from JS invoke can result in a blank white WebView
                                let _ = open_panel_window(
                                    app.clone(),
                                    "today-wins".into(),
                                    "today-wins.html".into(),
                                    "Today's Wins".into(),
                                    360.0, 400.0, true,
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
                                        let _ = guard.toggle_item.set_text(if is_visible { "Show" } else { "Hide" });
                                    }
                                }
                            }
                            "session_stats" => {
                                let _ = open_panel_window(
                                    app.clone(),
                                    "session".into(),
                                    "session.html".into(),
                                    "Session Stats".into(),
                                    350.0, 400.0, true,
                                );
                            }
                            "settings" => {
                                let _ = open_panel_window(
                                    app.clone(),
                                    "settings".into(),
                                    "settings.html".into(),
                                    "Dr. Vibe Settings".into(),
                                    320.0, 560.0, false,
                                );
                            }
                            "dashboard" => {
                                let _ = open_panel_window(
                                    app.clone(),
                                    "dashboard".into(),
                                    "dashboard.html".into(),
                                    "Dr. Vibe Dashboard".into(),
                                    520.0, 680.0, true,
                                );
                            }
                            "sprite_editor" => {
                                let _ = open_panel_window(
                                    app.clone(),
                                    "sprite-editor".into(),
                                    "sprite-editor.html".into(),
                                    "Dr. Vibe Sprite Editor".into(),
                                    950.0, 680.0, true,
                                );
                            }
                            "about" => {
                                let _ = open_panel_window(
                                    app.clone(),
                                    "about".into(),
                                    "about.html".into(),
                                    "About Dr. Vibe".into(),
                                    320.0, 540.0, false,
                                );
                            }
                            "devtools" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.open_devtools();
                                }
                            }
                            "debug_menu" => {
                                let _ = open_panel_window(
                                    app.clone(),
                                    "debug".into(),
                                    "debug.html".into(),
                                    "Debug Menu".into(),
                                    750.0, 600.0, true,
                                );
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
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
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_active_window, is_coding_app, get_cursor_position, scan_project_markers, scan_directories_for_projects, get_recent_git_repos, start_watching, stop_watching, get_watched_path, list_skins, read_skin, save_skin, quit_app, open_settings_window, open_dashboard_window, open_panel_window, read_claude_code_events, install_claude_code_hooks, uninstall_claude_code_hooks])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
