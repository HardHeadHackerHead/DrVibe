//! "Make your own Dr. Vibe": local character generation via the claude / codex CLI.

use crate::skins::{
    decode_anim_from_png, decode_png_pixels, encode_anim_into_png, resolve_custom_skins_dir,
    resolve_default_skins_dir, slug_taken, unique_slug, write_skin_metadata,
};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{Emitter, Manager};

/// PID of the currently running AI generation subprocess (0 = none).
pub(crate) static GENERATION_PID: AtomicU32 = AtomicU32::new(0);

/// True while a generate, regenerate or patch run holds the [`GenerationSlot`].
static GENERATING: AtomicBool = AtomicBool::new(false);

/// Held for the whole of one AI run, so two runs can't overlap (they would
/// share GENERATION_PID and the progress events) and the workshop can't
/// navigate away mid-run. Dropping it clears the PID too, so a run that
/// fails early never leaves the app thinking it is still generating.
pub(crate) struct GenerationSlot;

impl GenerationSlot {
    pub(crate) fn acquire() -> Result<Self, String> {
        GENERATING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| GenerationSlot)
            .map_err(|_| {
                "A Dr. Vibe is already being generated. Wait for it to finish or cancel it first."
                    .to_string()
            })
    }

    pub(crate) fn busy() -> bool {
        GENERATING.load(Ordering::SeqCst)
    }
}

impl Drop for GenerationSlot {
    fn drop(&mut self) {
        GENERATION_PID.store(0, Ordering::SeqCst);
        GENERATING.store(false, Ordering::SeqCst);
    }
}

/// A fresh, empty folder the CLI writes a new character into. New
/// characters are moved into the skins folder under a free slug afterwards
/// ([`adopt_generated`]), so the slug the agent picks can never overwrite one
/// of the player's skins or shadow a Lab Original.
fn generation_staging_dir() -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir =
        std::env::temp_dir().join(format!("dr-vibe-generate-{}-{}", std::process::id(), stamp));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create a work folder: {e}"))?;
    Ok(dir)
}

/// Move `<slug>.png` and its sidecar from `staging` into `skins_dir` under
/// the first free slug (`slug`, `slug-2`, ...) and return that slug. The
/// staging folder is removed.
pub(crate) fn adopt_generated(
    staging: &std::path::Path,
    skins_dir: &std::path::Path,
    slug: &str,
    taken: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let final_slug = unique_slug(slug, taken)?;
    std::fs::create_dir_all(skins_dir)
        .map_err(|e| format!("Failed to create skins folder: {e}"))?;
    let png = staging.join(format!("{slug}.png"));
    std::fs::copy(&png, skins_dir.join(format!("{final_slug}.png")))
        .map_err(|e| format!("Failed to save the new Dr. Vibe: {e}"))?;
    let anim = staging.join(format!("{slug}.anim.json"));
    if anim.exists() {
        std::fs::copy(&anim, skins_dir.join(format!("{final_slug}.anim.json")))
            .map_err(|e| format!("Failed to save the new Dr. Vibe: {e}"))?;
    }
    let _ = std::fs::remove_dir_all(staging);
    Ok(final_slug)
}

/// Resolve the project root directory (the parent of src-tauri/).
/// In dev mode Tauri runs from src-tauri/, so we go one level up.
pub(crate) fn resolve_project_root() -> Result<PathBuf, String> {
    // Try current dir first (works in both dev and prod contexts)
    let candidates = [
        PathBuf::from(".."), // dev: running from src-tauri/
        PathBuf::from("."),  // prod or running from root
    ];
    for c in &candidates {
        if c.join("package.json").exists() {
            return std::fs::canonicalize(c).map_err(|e| e.to_string());
        }
    }
    Err("Could not locate project root (package.json not found)".to_string())
}

/// Resolve and read a skill file (e.g. "generate-character.md").
/// Dev mode: looks in the project source tree (tools/).
/// Production: falls back to Tauri's bundled resource directory (commands/).
pub(crate) fn resolve_skill_content(
    app_handle: &tauri::AppHandle,
    name: &str,
) -> Result<String, String> {
    // Dev mode: project source tree
    let dev_candidates = [
        PathBuf::from("../tools").join(name), // running from src-tauri/
        PathBuf::from("tools").join(name),    // running from project root
    ];
    for c in &dev_candidates {
        if c.exists() {
            return std::fs::read_to_string(c)
                .map_err(|e| format!("Failed to read skill file '{}': {}", name, e));
        }
    }

    // Production: bundled resources
    if let Ok(res) = app_handle.path().resource_dir() {
        let p = res.join("commands").join(name);
        if p.exists() {
            return std::fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read bundled skill file '{}': {}", name, e));
        }
    }

    Err(format!(
        "Skill file '{}' not found. In dev mode, ensure tools/ contains it. \
         In production, ensure it is bundled as a resource.",
        name
    ))
}

/// The 2.0 sheet rows, in order (src/features/make/spriteSpec.js ROW_SPEC).
pub(crate) const SHEET_ROWS: [&str; 17] = [
    "idle",
    "coding",
    "thinking",
    "tired",
    "excited",
    "alert",
    "walk",
    "stretching",
    "beaker",
    "libraryCard",
    "thumbsUp",
    "coverEyes",
    "celebrating",
    "focused",
    "concerned",
    "presenting",
    "levitating",
];
const SHEET_COLUMNS: usize = 4;

/// Analyze a sprite PNG and generate a reference script string.
/// This is used by "Generate From" to give Claude a starting point for a new character.
/// The output is a compact script with the color palette and the first frame of
/// each row, using p.hline() runs (the painter API of the generator template).
pub(crate) fn analyze_sprite_to_reference(png_bytes: &[u8]) -> Result<String, String> {
    let (pixels, width, height, color_type, _) = decode_png_pixels(png_bytes)?;
    let stride = match color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        _ => return Err("Unsupported PNG color type".to_string()),
    };
    let has_alpha = stride == 4;

    // (name, row, frames drawn): one entry per row of the 2.0 layout present in the sheet
    let rows = (height as usize / 32).min(SHEET_ROWS.len());
    let cols = (width as usize / 32).min(SHEET_COLUMNS);
    let anim_list: Vec<(String, usize, usize)> = SHEET_ROWS
        .iter()
        .take(rows)
        .enumerate()
        .map(|(r, name)| (name.to_string(), r, cols))
        .collect();

    let frame_size = 32usize;

    // Step 1: Extract all unique colors
    let mut color_set: std::collections::BTreeMap<[u8; 3], usize> =
        std::collections::BTreeMap::new();
    let w = width as usize;

    for (_, row, frame_count) in &anim_list {
        for frame in 0..*frame_count {
            let fx = frame * frame_size;
            let fy = row * frame_size;
            for py in 0..frame_size {
                for px_x in 0..frame_size {
                    let x = fx + px_x;
                    let y = fy + py;
                    if x >= w || y >= height as usize {
                        continue;
                    }
                    let idx = (y * w + x) * stride;
                    if idx + 2 >= pixels.len() {
                        continue;
                    }
                    let a = if has_alpha && idx + 3 < pixels.len() {
                        pixels[idx + 3]
                    } else {
                        255
                    };
                    if a < 128 {
                        continue;
                    } // transparent
                    let rgb = [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
                    *color_set.entry(rgb).or_insert(0) += 1;
                }
            }
        }
    }

    // Step 2: Assign color names (C0, C1, C2, ...)
    // Sort by frequency (most used first) for readability
    let mut colors: Vec<([u8; 3], usize)> = color_set.into_iter().collect();
    colors.sort_by_key(|c| std::cmp::Reverse(c.1));
    let color_names: std::collections::HashMap<[u8; 3], String> = colors
        .iter()
        .enumerate()
        .map(|(i, (rgb, _))| (*rgb, format!("C{}", i)))
        .collect();

    // Step 3: Try to identify swappable skin palette slots
    // The default skin colors are [253,216,176], [232,184,136], [212,168,120]
    // or close variants. We'll flag colors that match these.
    let default_skin = [[253u8, 216, 176], [232, 184, 136], [212, 168, 120]];
    let skin_slot_names = ["skin", "skinShade", "skinDark"];

    // Step 4: Build the reference script
    let mut out = String::with_capacity(64 * 1024);
    out.push_str("// === REFERENCE SPRITE ANALYSIS ===\n");
    out.push_str("// This is an auto-analyzed reference from an existing character.\n");
    out.push_str("// Use it to understand the character's proportions, palette, and style.\n");
    out.push_str("// Adapt and modify — do NOT copy verbatim.\n\n");

    // Palette
    out.push_str("// --- Color Palette ---\n");
    out.push_str("const REF = {\n");
    for (rgb, count) in &colors {
        let name = &color_names[rgb];
        let mut label = String::new();
        for (i, def) in default_skin.iter().enumerate() {
            if rgb == def {
                label = format!(" // swappable: {}", skin_slot_names[i]);
                break;
            }
        }
        if label.is_empty() {
            label = format!(" // used {} times", count);
        }
        out.push_str(&format!(
            "  {}: [{}, {}, {}],{}\n",
            name, rgb[0], rgb[1], rgb[2], label
        ));
    }
    out.push_str("};\n\n");

    // Row summary
    out.push_str("// --- Rows ---\n");
    for (name, row, _) in &anim_list {
        out.push_str(&format!("// Row {}: {}\n", row, name));
    }
    out.push('\n');

    // Per-frame pixel data (only frame 0 of each row to keep size manageable)
    out.push_str("// --- Frame Data (frame 0 of each row) ---\n");
    out.push_str("// Uses p.hline(x, y, width, color) for horizontal runs.\n");
    out.push_str("// Uses p.px(x, y, color) for single pixels.\n\n");

    for (name, row, _) in &anim_list {
        // Only include frame 0 for compactness
        let fx = 0;
        let fy = row * frame_size;

        out.push_str(&format!("function ref_{}(p) {{ // row {}\n", name, row));

        for py in 0..frame_size {
            let y = fy + py;
            if y >= height as usize {
                continue;
            }

            // Collect runs of same color on this scanline
            let mut runs: Vec<(usize, usize, String)> = Vec::new(); // (start_x, length, color_name)
            let mut run_start: Option<(usize, String)> = None;

            for px_x in 0..frame_size {
                let x = fx + px_x;
                if x >= w {
                    break;
                }
                let idx = (y * w + x) * stride;
                if idx + 2 >= pixels.len() {
                    continue;
                }
                let a = if has_alpha && idx + 3 < pixels.len() {
                    pixels[idx + 3]
                } else {
                    255
                };

                if a < 128 {
                    // Transparent — flush any active run
                    if let Some((start, cname)) = run_start.take() {
                        runs.push((start, px_x - start, cname));
                    }
                } else {
                    let rgb = [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
                    let cname = color_names
                        .get(&rgb)
                        .cloned()
                        .unwrap_or_else(|| format!("[{},{},{}]", rgb[0], rgb[1], rgb[2]));
                    match &run_start {
                        Some((_, current_color)) if *current_color == cname => {
                            // Continue the run
                        }
                        Some((start, current_color)) => {
                            // Different color — flush and start new
                            runs.push((*start, px_x - start, current_color.clone()));
                            run_start = Some((px_x, cname));
                        }
                        None => {
                            run_start = Some((px_x, cname));
                        }
                    }
                }
            }
            // Flush final run
            if let Some((start, cname)) = run_start {
                runs.push((start, frame_size - start, cname));
            }

            // Emit runs
            for (sx, len, cname) in &runs {
                if *len == 1 {
                    out.push_str(&format!("  p.px({}, {}, REF.{});\n", sx, py, cname));
                } else {
                    out.push_str(&format!(
                        "  p.hline({}, {}, {}, REF.{});\n",
                        sx, py, len, cname
                    ));
                }
            }
        }

        out.push_str("}\n\n");
    }

    Ok(out)
}

/// Build a Command that invokes the `claude` CLI correctly on each platform.
/// On Windows, `claude` is a `.cmd` script that must be invoked via `cmd /c`.
/// CREATE_NO_WINDOW prevents a console window from flashing on screen.
pub(crate) fn claude_command(args: &[&str]) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/c").arg("claude");
        for a in args {
            cmd.arg(a);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("claude");
        for a in args {
            cmd.arg(a);
        }
        cmd
    }
}

/// Build a Command that invokes the `codex` CLI correctly on each platform.
/// On Windows, `codex` is a `.cmd` script that must be invoked via `cmd /c`.
/// CREATE_NO_WINDOW prevents a console window from flashing on screen.
pub(crate) fn codex_command(args: &[&str]) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/c").arg("codex");
        for a in args {
            cmd.arg(a);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("codex");
        for a in args {
            cmd.arg(a);
        }
        cmd
    }
}

/// Check whether the `claude` CLI is installed and accessible.
/// On Windows we invoke `cmd /c claude --version` — `cmd` always spawns
/// successfully even when `claude` doesn't exist, so we must check the
/// exit code, not just whether the process started.
#[tauri::command]
pub(crate) async fn check_claude_installed() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        claude_command(&["--version"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Check whether the `codex` CLI is installed and accessible.
/// Same exit-code check as above for Windows correctness.
#[tauri::command]
pub(crate) async fn check_codex_installed() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        codex_command(&["--version"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Cancel a running AI generation subprocess (if any).
#[tauri::command]
pub(crate) fn cancel_generation() -> Result<(), String> {
    let pid = GENERATION_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Err("No generation in progress".to_string());
    }
    // On all platforms, Command::kill sends SIGKILL / TerminateProcess.
    // We use a platform kill since we only stored the PID, not the Child handle.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Kill the process group so child processes (node, etc.) also die
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    Ok(())
}

/// First `max` characters of `s` (never splits a multi-byte character, which
/// byte slicing like `&s[..80]` would panic on).
pub(crate) fn clip(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

/// Run the Claude Code CLI to generate a new character sprite.
/// Format a tool name + input into a short human-readable line.
pub(crate) fn format_tool_call(name: &str, input: &serde_json::Value) -> String {
    match name {
        "Write" | "NotebookEdit" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("?");
            let f = path
                .split('/')
                .next_back()
                .unwrap_or(path)
                .split('\\')
                .next_back()
                .unwrap_or(path);
            format!("Writing {}", f)
        }
        "Edit" | "MultiEdit" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("?");
            let f = path
                .split('/')
                .next_back()
                .unwrap_or(path)
                .split('\\')
                .next_back()
                .unwrap_or(path);
            format!("Editing {}", f)
        }
        "Bash" => {
            let cmd = input.get("command").and_then(|c| c.as_str()).unwrap_or("?");
            let preview = clip(cmd, 80);
            format!("Running: {}", preview.replace('\n', " "))
        }
        "Read" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("?");
            let f = path
                .split('/')
                .next_back()
                .unwrap_or(path)
                .split('\\')
                .next_back()
                .unwrap_or(path);
            format!("Reading {}", f)
        }
        "Glob" | "Grep" => {
            let pat = input
                .get("pattern")
                .or_else(|| input.get("file_path"))
                .and_then(|p| p.as_str())
                .unwrap_or("?");
            format!("Searching {}", pat)
        }
        _ => format!("Using {}", name),
    }
}

/// Parse a stream-json line from Claude Code into zero or more human-readable messages.
/// Tool calls are nested inside assistant content blocks, so one event can yield several lines.
pub(crate) fn parse_claude_stream_line(line: &str) -> Vec<String> {
    let v: serde_json::Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "system" => {
            // Only emit on the first system event; skip duplicates silently
            if v.get("subtype").and_then(|s| s.as_str()) == Some("init") {
                vec!["Initializing…".to_string()]
            } else {
                vec![]
            }
        }

        "assistant" => {
            let content = match v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                Some(c) => c,
                None => return vec![],
            };

            let mut out: Vec<String> = vec![];
            for item in content {
                match item.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            // Emit every non-empty line of Claude's response (up to 5)
                            let mut count = 0;
                            for l in text.lines() {
                                let l = l.trim();
                                if l.is_empty() {
                                    continue;
                                }
                                let display = if l.chars().count() > 120 {
                                    format!("{}…", clip(l, 120))
                                } else {
                                    l.to_string()
                                };
                                out.push(format!("  {}", display));
                                count += 1;
                                if count >= 5 {
                                    break;
                                }
                            }
                        }
                    }
                    // Tool calls are content blocks inside the assistant message
                    Some("tool_use") => {
                        if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                            let input = item.get("input").cloned().unwrap_or(serde_json::json!({}));
                            out.push(format!("→ {}", format_tool_call(name, &input)));
                        }
                    }
                    _ => {}
                }
            }
            out
        }

        // Some Claude Code versions also emit top-level tool_use events — handle both
        "tool_use" => {
            if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                let input = v.get("input").cloned().unwrap_or(serde_json::json!({}));
                vec![format!("→ {}", format_tool_call(name, &input))]
            } else {
                vec![]
            }
        }

        "tool_result" => {
            let is_error = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
            if is_error {
                let content = v
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("unknown error");
                vec![format!("Error: {}", clip(content, 200))]
            } else {
                vec![]
            }
        }

        "result" => {
            let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
            if subtype == "error" {
                let msg = v
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown error");
                vec![format!("Failed: {}", msg)]
            } else {
                if let Some(result_text) = v.get("result").and_then(|r| r.as_str()) {
                    if !result_text.trim().is_empty() {
                        return result_text.trim().lines().map(|l| l.to_string()).collect();
                    }
                }
                vec!["Complete".to_string()]
            }
        }

        _ => vec![],
    }
}

/// Scan a stream-json line for a GENERATED_SKIN slug embedded in text content.
pub(crate) fn extract_slug_from_stream_line(line: &str) -> Option<String> {
    // First check the raw line itself (plain text output)
    for l in line.lines() {
        if let Some(slug) = l.trim().strip_prefix("GENERATED_SKIN:") {
            let s = slug.trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    // Also check inside JSON text/result fields
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
        let candidates = [
            v.get("result").and_then(|r| r.as_str()),
            v.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|i| {
                        if i.get("type").and_then(|t| t.as_str()) == Some("text") {
                            i.get("text").and_then(|t| t.as_str())
                        } else {
                            None
                        }
                    })
                }),
        ];
        for text in candidates.into_iter().flatten() {
            for l in text.lines() {
                if let Some(slug) = l.trim().strip_prefix("GENERATED_SKIN:") {
                    let s = slug.trim().to_string();
                    if !s.is_empty() {
                        return Some(s);
                    }
                }
            }
        }
    }
    None
}

/// Parse a Codex JSONL stream line into zero or more human-readable progress messages.
pub(crate) fn parse_codex_stream_line(line: &str) -> Vec<String> {
    let v: serde_json::Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    match event_type {
        "thread.started" => vec!["Codex session started".to_string()],

        "turn.started" => vec!["Thinking...".to_string()],

        "item.started" => {
            let item_type = v
                .get("item")
                .and_then(|i| i.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if item_type == "command_execution" {
                vec!["Running command...".to_string()]
            } else {
                vec![]
            }
        }

        "item.completed" => {
            let item = match v.get("item") {
                Some(i) => i,
                None => return vec![],
            };
            let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");

            match item_type {
                "agent_message" => {
                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    let mut out = Vec::new();
                    let mut count = 0;
                    for l in text.lines() {
                        let l = l.trim();
                        if l.is_empty() {
                            continue;
                        }
                        let display = if l.chars().count() > 120 {
                            format!("{}...", clip(l, 120))
                        } else {
                            l.to_string()
                        };
                        out.push(format!("  {}", display));
                        count += 1;
                        if count >= 5 {
                            break;
                        }
                    }
                    out
                }
                "command_execution" => {
                    let mut out = Vec::new();
                    let command = item.get("command").and_then(|c| c.as_str()).unwrap_or("?");
                    let cmd_display = if command.chars().count() > 80 {
                        format!("{}...", clip(command, 80))
                    } else {
                        command.to_string()
                    };
                    out.push(format!("\u{2192} Ran: {}", cmd_display));

                    let exit_code = item.get("exit_code").and_then(|e| e.as_i64()).unwrap_or(0);
                    if exit_code != 0 {
                        let agg_output = item
                            .get("aggregated_output")
                            .and_then(|o| o.as_str())
                            .unwrap_or("");
                        if !agg_output.is_empty() {
                            let err_preview = clip(agg_output, 200);
                            out.push(format!(
                                "  Error (exit {}): {}",
                                exit_code,
                                err_preview.replace('\n', " ")
                            ));
                        }
                    }
                    out
                }
                "file_change" => {
                    let mut out = Vec::new();
                    if let Some(changes) = item.get("changes").and_then(|c| c.as_array()) {
                        for change in changes {
                            let kind = change
                                .get("kind")
                                .and_then(|k| k.as_str())
                                .unwrap_or("changed");
                            let filename = change
                                .get("filename")
                                .and_then(|f| f.as_str())
                                .unwrap_or("?");
                            out.push(format!("\u{2192} {} {}", kind, filename));
                        }
                    }
                    out
                }
                _ => vec![],
            }
        }

        "turn.completed" => vec!["Complete".to_string()],

        "turn.failed" => {
            let msg = v
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error");
            vec![format!("Failed: {}", msg)]
        }

        _ => vec![],
    }
}

/// Scan a Codex JSONL stream line for a GENERATED_SKIN slug.
pub(crate) fn extract_slug_from_codex_line(line: &str) -> Option<String> {
    // First check the raw line itself (plain text output)
    for l in line.lines() {
        if let Some(slug) = l.trim().strip_prefix("GENERATED_SKIN:") {
            let s = slug.trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    // Also check inside JSON item.text (agent_message) and item.aggregated_output (command execution)
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
        let candidates = [
            v.get("item")
                .and_then(|i| i.get("text"))
                .and_then(|t| t.as_str()),
            v.get("item")
                .and_then(|i| i.get("aggregated_output"))
                .and_then(|t| t.as_str()),
        ];
        for text in candidates.into_iter().flatten() {
            for l in text.lines() {
                if let Some(slug) = l.trim().strip_prefix("GENERATED_SKIN:") {
                    let s = slug.trim().to_string();
                    if !s.is_empty() {
                        return Some(s);
                    }
                }
            }
        }
    }
    None
}

/// Blocking inner implementation — runs on a threadpool thread via spawn_blocking.
pub(crate) fn generate_character_blocking(
    description: String,
    agent: String,
    window: tauri::WebviewWindow,
    skins_dir: PathBuf,
    app_handle: &tauri::AppHandle,
    reference_script: Option<String>,
    reference_slug: Option<String>,
) -> Result<String, String> {
    let agent = if agent.is_empty() {
        "claude".to_string()
    } else {
        agent
    };

    // Load the skill file (works in both dev and production)
    let skill_content = resolve_skill_content(app_handle, "generate-character.md")?;

    // Replace placeholders
    let reference_section = match &reference_script {
        Some(script) => format!(
            "\n## Reference Character\n\n\
             The user wants to generate a new character **based on** an existing one.\n\
             Below is an auto-analyzed reference script showing the source character's palette and pixel layout.\n\
             Use it to understand proportions, style, and color usage — then adapt and modify for the new character.\n\
             Do NOT copy it verbatim. Create a fresh character inspired by it.\n\n\
             ```javascript\n{}\n```\n",
            script
        ),
        None => String::new(),
    };
    // Resolve generation metadata for template substitution
    let model_name = match agent.as_str() {
        "codex" => "codex-cli",
        _ => "claude-code",
    };
    let based_on = reference_slug.as_deref().unwrap_or("none");

    let full_prompt = fill_prompt(
        &skill_content,
        &PromptVars {
            arguments: description.trim(),
            skins_dir: &skins_dir,
            scripts_dir: &generator_scripts_dir()?,
            reference_section: &reference_section,
            model_name,
            agent: &agent,
            based_on,
        },
    );

    // Working directory for the CLI agent — project root in dev, temp dir in production
    let work_dir = resolve_project_root().unwrap_or_else(|_| std::env::temp_dir());

    // Snapshot existing skins so we can detect new ones after generation
    let skins_before: std::collections::HashSet<String> = if skins_dir.is_dir() {
        std::fs::read_dir(&skins_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if name.ends_with(".png") {
                    Some(name[..name.len() - 4].to_string())
                } else {
                    None
                }
            })
            .collect()
    } else {
        std::collections::HashSet::new()
    };

    // Write the full instructions to a temp file to stay under Windows's
    // 8191-char command-line limit, then pass a short argument that tells
    // the agent to read and follow that file.
    let temp_path = std::env::temp_dir().join("dr-vibe-char-prompt.txt");
    std::fs::write(&temp_path, &full_prompt)
        .map_err(|e| format!("Failed to write prompt file: {}", e))?;
    let temp_path_str = temp_path.to_string_lossy().replace('\\', "/");

    let mut child = if agent == "codex" {
        let short_prompt = format!(
            "Read the file '{}', then immediately follow its instructions: write the script and run it. Do not read any other files first.",
            temp_path_str
        );
        let work_dir_str = work_dir.to_string_lossy().to_string();
        codex_command(&[
            "exec",
            "--full-auto",
            "--sandbox",
            "danger-full-access",
            "--skip-git-repo-check",
            "--json",
            "-C",
            &work_dir_str,
            &short_prompt,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Codex CLI: {}. Is it installed?", e))?
    } else {
        let short_prompt = format!(
            "Read '{}', then immediately write the script and run it. Do not read any other files first.",
            temp_path_str
        );
        claude_command(&[
            "--dangerously-skip-permissions",
            "--verbose",
            "--output-format",
            "stream-json",
            "-p",
            &short_prompt,
        ])
        .current_dir(&work_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Claude CLI: {}. Is it installed?", e))?
    };

    // Store PID so cancel_generation can kill it
    GENERATION_PID.store(child.id(), Ordering::SeqCst);

    let started_msg = if agent == "codex" {
        "Codex started"
    } else {
        "Claude Code started"
    };
    let _ = window.emit("claude-progress", started_msg);

    // Drain stderr on a background thread — this is where auth errors, unknown flags,
    // and other fatal messages appear even when using --output-format stream-json.
    if let Some(stderr) = child.stderr.take() {
        let win = window.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = win.emit("claude-progress", format!("[stderr] {}", line));
                }
            }
        });
    }

    let stdout = child.stdout.take().ok_or("Could not capture stdout")?;
    let mut found_slug: Option<String> = None;

    for line in BufReader::new(stdout).lines() {
        let text = match line {
            Ok(t) => t,
            Err(_) => break,
        };

        // Always scan for the GENERATED_SKIN marker
        if found_slug.is_none() {
            found_slug = if agent == "codex" {
                extract_slug_from_codex_line(&text)
            } else {
                extract_slug_from_stream_line(&text)
            };
        }

        // Parse into zero or more human-readable messages.
        // Fall back to the raw line for non-JSON output (e.g. plain node output).
        let msgs = if agent == "codex" {
            parse_codex_stream_line(&text)
        } else {
            parse_claude_stream_line(&text)
        };
        if msgs.is_empty() {
            let t = text.trim();
            if !t.is_empty() && !t.starts_with('{') {
                let _ = window.emit("claude-progress", t.to_string());
            }
        } else {
            for msg in msgs {
                let _ = window.emit("claude-progress", msg);
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    GENERATION_PID.store(0, Ordering::SeqCst);
    if !status.success() {
        let agent_name = if agent == "codex" { "Codex" } else { "Claude" };
        return Err(format!("{} exited with status {}.", agent_name, status));
    }

    // Use parsed slug if found; fall back to diffing the skins directory
    let slug = found_slug.or_else(|| {
        std::fs::read_dir(&skins_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let slug = name.strip_suffix(".png")?.to_string();
                (!skins_before.contains(&slug)).then_some(slug)
            })
            .next()
    });
    let Some(slug) = slug else {
        return Err("No new skin file was created. Claude may have encountered an error writing the files — see the log above.".to_string());
    };
    let png_path = skins_dir.join(format!("{}.png", slug));
    if let Err(e) = check_sheet_file(&png_path) {
        // Don't leave a sheet the app can't wear or submit in the designs list
        let _ = std::fs::remove_file(&png_path);
        let _ = std::fs::remove_file(skins_dir.join(format!("{}.anim.json", slug)));
        return Err(e);
    }
    write_skin_metadata(
        &skins_dir,
        &slug,
        "ai_generated",
        Some(&description),
        Some(&agent),
        Some(&description),
        reference_slug.as_deref(),
    );
    Ok(slug)
}

/// Values substituted into tools/generate-character.md.
pub(crate) struct PromptVars<'a> {
    pub arguments: &'a str,
    pub skins_dir: &'a std::path::Path,
    pub scripts_dir: &'a std::path::Path,
    pub reference_section: &'a str,
    pub model_name: &'a str,
    pub agent: &'a str,
    pub based_on: &'a str,
}

/// Where the CLI writes its generate-/patch- scripts: a temp folder, never
/// the app's own tree or the (possibly read-only) bundled skins folder.
pub(crate) fn generator_scripts_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("dr-vibe-generator");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create the generator scripts folder: {}", e))?;
    Ok(dir)
}

/// Fill the generator prompt's placeholders.
pub(crate) fn fill_prompt(template: &str, vars: &PromptVars) -> String {
    let slashes = |p: &std::path::Path| p.to_string_lossy().replace('\\', "/");
    // $ARGUMENTS goes last so a description can't inject the other placeholders.
    template
        .replace("$SKINS_DIR", &slashes(vars.skins_dir))
        .replace("$SCRIPTS_DIR", &slashes(vars.scripts_dir))
        .replace("$REFERENCE_SECTION", vars.reference_section)
        .replace("$MODEL_NAME", vars.model_name)
        .replace("$AGENT_NAME", vars.agent)
        .replace("$BASED_ON", vars.based_on)
        .replace("$ARGUMENTS", vars.arguments)
}

/// The sheet sizes the app and the website accept (spriteSpec.js): 4 columns
/// of 32 px, 16 rows or 17 with the optional levitating row.
pub(crate) fn check_sheet_size(width: u32, height: u32) -> Result<(), String> {
    if width == 128 && (height == 512 || height == 544) {
        Ok(())
    } else {
        Err(format!(
            "The generated sheet is {} × {} px; Dr. Vibe sheets must be 128 × 512 (16 rows) or 128 × 544 (with the levitating row). Try generating again.",
            width, height
        ))
    }
}

/// Read a generated PNG's header and check its size.
pub(crate) fn check_sheet_file(path: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Could not open the generated sheet: {}", e))?;
    let reader = png::Decoder::new(std::io::BufReader::new(file))
        .read_info()
        .map_err(|e| format!("The generated sheet is not a valid PNG: {}", e))?;
    let info = reader.info();
    check_sheet_size(info.width, info.height)
}

/// Streams each output line back to the settings window via "claude-progress" events.
/// Returns the slug of the generated skin on success.
/// Runs the blocking subprocess work on a threadpool so the UI stays responsive.
#[tauri::command]
pub(crate) async fn generate_character(
    description: String,
    agent: String,
    reference_slug: Option<String>,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let _slot = GenerationSlot::acquire()?;
    let skins_dir = resolve_custom_skins_dir(&app_handle)?;
    let staging = generation_staging_dir()?;

    // If a reference slug is provided, analyze that sprite to generate a reference script
    let reference_script = if let Some(ref slug) = reference_slug {
        let _ = window.emit(
            "claude-progress",
            format!("Analyzing reference character '{}'...", slug),
        );
        // Find and read the reference skin PNG
        let png_bytes = {
            let custom = resolve_custom_skins_dir(&app_handle)?;
            let custom_path = custom.join(format!("{}.png", slug));
            if custom_path.exists() {
                std::fs::read(&custom_path)
                    .map_err(|e| format!("Failed to read reference skin: {}", e))?
            } else if let Some(default) = resolve_default_skins_dir(&app_handle) {
                let default_path = default.join(format!("{}.png", slug));
                if default_path.exists() {
                    std::fs::read(&default_path)
                        .map_err(|e| format!("Failed to read reference skin: {}", e))?
                } else {
                    return Err(format!("Reference skin not found: {}", slug));
                }
            } else {
                return Err(format!("Reference skin not found: {}", slug));
            }
        };

        let script = analyze_sprite_to_reference(&png_bytes)?;
        let _ = window.emit("claude-progress", "Reference analysis complete.");
        Some(script)
    } else {
        None
    };

    let app_handle_clone = app_handle.clone();
    let work = staging.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let slug = generate_character_blocking(
            description,
            agent,
            window,
            work.clone(),
            &app_handle_clone,
            reference_script,
            reference_slug,
        )?;
        adopt_generated(&work, &skins_dir, &slug, |s| {
            slug_taken(&app_handle_clone, s)
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&staging);
    result
}

/// Regenerate an entire character: run generate_character_blocking to create a fresh skin,
/// then copy the result as a draft of the original slug for before/after comparison.
pub(crate) fn regenerate_character_blocking(
    slug: String,
    description: String,
    agent: String,
    window: tauri::WebviewWindow,
    skins_dir: std::path::PathBuf,
    custom_skins_dir: std::path::PathBuf,
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    // Verify original skin exists
    let orig_path = skins_dir.join(format!("{}.png", slug));
    if !orig_path.exists() {
        return Err(format!("Skin not found: {}", slug));
    }

    // Generate a brand new character using the same mechanism (always into custom dir)
    let new_slug = generate_character_blocking(
        description.clone(),
        agent,
        window,
        custom_skins_dir.clone(),
        app_handle,
        None,
        Some(slug.clone()),
    )?;

    // The new skin was generated into custom_skins_dir; copy it as a draft
    // alongside the original skin (which may be in default or custom dir).
    let new_png = custom_skins_dir.join(format!("{}.png", new_slug));
    let draft_slug = format!("{}--draft", slug);
    let draft_png = skins_dir.join(format!("{}.png", draft_slug));
    std::fs::copy(&new_png, &draft_png).map_err(|e| format!("Failed to create draft: {}", e))?;

    // Also copy the anim.json sidecar to draft
    let new_anim = custom_skins_dir.join(format!("{}.anim.json", new_slug));
    let draft_anim = skins_dir.join(format!("{}.anim.json", draft_slug));
    if new_anim.exists() {
        let _ = std::fs::copy(&new_anim, &draft_anim);
    }

    // Clean up the temporary new skin files
    let _ = std::fs::remove_file(&new_png);
    if new_anim.exists() {
        let _ = std::fs::remove_file(&new_anim);
    }

    Ok(draft_slug)
}

#[tauri::command]
pub(crate) async fn regenerate_character(
    slug: String,
    description: String,
    agent: String,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let _slot = GenerationSlot::acquire()?;
    let skins_dir = editable_skins_dir(&app_handle, &slug)?;
    // The fresh character is drawn in a staging folder; only its draft copy
    // lands next to the original.
    let staging = generation_staging_dir()?;
    let app_handle_clone = app_handle.clone();
    let work = staging.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        regenerate_character_blocking(
            slug,
            description,
            agent,
            window,
            skins_dir,
            work,
            &app_handle_clone,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&staging);
    result
}

/// The folder to edit `slug` in. Bundled skins live in the install's
/// resource folder, which updates overwrite (and may not be writable), so a
/// bundled skin is first copied into the user's custom skins folder; the
/// custom copy then shadows the bundled one in `list_skins`.
fn editable_skins_dir(app_handle: &tauri::AppHandle, slug: &str) -> Result<PathBuf, String> {
    let custom = resolve_custom_skins_dir(app_handle)?;
    if custom.join(format!("{}.png", slug)).exists() {
        return Ok(custom);
    }
    let bundled =
        resolve_default_skins_dir(app_handle).ok_or_else(|| format!("Skin not found: {}", slug))?;
    copy_skin_files(&bundled, &custom, slug)?;
    Ok(custom)
}

/// Copies `<slug>.png` (required) and `<slug>.anim.json` (if present) from `from` to `to`.
fn copy_skin_files(from: &std::path::Path, to: &std::path::Path, slug: &str) -> Result<(), String> {
    let png = from.join(format!("{}.png", slug));
    if !png.exists() {
        return Err(format!("Skin not found: {}", slug));
    }
    std::fs::create_dir_all(to).map_err(|e| format!("Failed to create skins folder: {}", e))?;
    std::fs::copy(&png, to.join(format!("{}.png", slug)))
        .map_err(|e| format!("Failed to copy skin: {}", e))?;
    let anim = from.join(format!("{}.anim.json", slug));
    if anim.exists() {
        std::fs::copy(&anim, to.join(format!("{}.anim.json", slug)))
            .map_err(|e| format!("Failed to copy skin animation: {}", e))?;
    }
    Ok(())
}

/// Blocking implementation for patch_character.
pub(crate) fn patch_character_blocking(
    slug: String,
    animation_name: String,
    description: String,
    agent: String,
    window: tauri::WebviewWindow,
    skins_dir: PathBuf,
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    let agent = if agent.is_empty() {
        "claude".to_string()
    } else {
        agent
    };
    let skill_content = resolve_skill_content(app_handle, "generate-character.md")?;

    let png_input = skins_dir.join(format!("{}.png", slug));
    let draft_slug = format!("{}--draft", slug);
    let png_output = skins_dir.join(format!("{}.png", draft_slug));

    if !png_input.exists() {
        return Err(format!("Skin not found: {}", slug));
    }

    let png_input_str = png_input.to_string_lossy().replace('\\', "/");
    let png_output_str = png_output.to_string_lossy().replace('\\', "/");

    let arguments = format!(
        "patch {slug}: fix the {anim} animation. {desc}\n[PATHS] PNG_INPUT={inp} PNG_OUTPUT={out}",
        slug = slug,
        anim = animation_name,
        desc = description,
        inp = png_input_str,
        out = png_output_str,
    );
    let full_prompt = fill_prompt(
        &skill_content,
        &PromptVars {
            arguments: &arguments,
            skins_dir: &skins_dir,
            scripts_dir: &generator_scripts_dir()?,
            reference_section: "",
            model_name: if agent == "codex" {
                "codex-cli"
            } else {
                "claude-code"
            },
            agent: &agent,
            based_on: &slug,
        },
    );

    let temp_path = std::env::temp_dir().join("dr-vibe-patch-prompt.txt");
    std::fs::write(&temp_path, &full_prompt)
        .map_err(|e| format!("Failed to write prompt file: {}", e))?;
    let temp_path_str = temp_path.to_string_lossy().replace('\\', "/");

    // Working directory for the CLI agent — project root in dev, temp dir in production
    let work_dir = resolve_project_root().unwrap_or_else(|_| std::env::temp_dir());

    let mut child = if agent == "codex" {
        let short_prompt = format!(
            "Read the file '{}', then immediately follow its instructions: write the patch script and run it. Do not read any other files first.",
            temp_path_str
        );
        let work_dir_str = work_dir.to_string_lossy().to_string();
        codex_command(&[
            "exec",
            "--full-auto",
            "--sandbox",
            "danger-full-access",
            "--skip-git-repo-check",
            "--json",
            "-C",
            &work_dir_str,
            &short_prompt,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Codex CLI: {}. Is it installed?", e))?
    } else {
        let short_prompt = format!(
            "Read '{}', then immediately write the patch script and run it. Do not read any other files first.",
            temp_path_str
        );
        claude_command(&[
            "--dangerously-skip-permissions",
            "--verbose",
            "--output-format",
            "stream-json",
            "-p",
            &short_prompt,
        ])
        .current_dir(&work_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Claude CLI: {}. Is it installed?", e))?
    };

    GENERATION_PID.store(child.id(), Ordering::SeqCst);

    let started_msg = if agent == "codex" {
        "Codex started"
    } else {
        "Claude Code started"
    };
    let _ = window.emit("claude-progress", started_msg);

    if let Some(stderr) = child.stderr.take() {
        let win = window.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = win.emit("claude-progress", format!("[stderr] {}", line));
                }
            }
        });
    }

    let stdout = child.stdout.take().ok_or("Could not capture stdout")?;
    for line in BufReader::new(stdout).lines() {
        let text = match line {
            Ok(t) => t,
            Err(_) => break,
        };
        let msgs = if agent == "codex" {
            parse_codex_stream_line(&text)
        } else {
            parse_claude_stream_line(&text)
        };
        if msgs.is_empty() {
            let t = text.trim();
            if !t.is_empty() && !t.starts_with('{') {
                let _ = window.emit("claude-progress", t.to_string());
            }
        } else {
            for msg in msgs {
                let _ = window.emit("claude-progress", msg);
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    GENERATION_PID.store(0, Ordering::SeqCst);
    if !status.success() {
        let agent_name = if agent == "codex" { "Codex" } else { "Claude" };
        return Err(format!("{} exited with status {}.", agent_name, status));
    }

    if !png_output.exists() {
        let agent_name = if agent == "codex" { "Codex" } else { "Claude" };
        return Err(format!(
            "Draft was not created. {} may have encountered an error — check the log above. \
             (Requires Node.js.)",
            agent_name
        ));
    }
    if let Err(e) = check_sheet_file(&png_output) {
        let _ = std::fs::remove_file(&png_output);
        return Err(e);
    }

    Ok(draft_slug)
}

/// Run Claude Code to patch a specific animation on an existing skin.
/// Writes the result to {slug}--draft.png for review before committing.
#[tauri::command]
pub(crate) async fn patch_character(
    slug: String,
    animation_name: String,
    description: String,
    agent: String,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let _slot = GenerationSlot::acquire()?;
    let skins_dir = editable_skins_dir(&app_handle, &slug)?;
    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        patch_character_blocking(
            slug,
            animation_name,
            description,
            agent,
            window,
            skins_dir,
            &app_handle_clone,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Accept a draft patch: overwrite the original skin PNG with the draft (re-baking
/// the anim config from the original if the draft doesn't have its own).
#[tauri::command]
pub(crate) fn accept_character_patch(
    slug: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let custom = resolve_custom_skins_dir(&app_handle)?;
    let skins_dir = if custom.join(format!("{}--draft.png", slug)).exists() {
        custom
    } else {
        resolve_default_skins_dir(&app_handle)
            .ok_or_else(|| format!("No draft found for '{}'", slug))?
    };
    let draft_path = skins_dir.join(format!("{}--draft.png", slug));

    if !draft_path.exists() {
        return Err(format!("No draft found for '{}'", slug));
    }

    // Read draft PNG bytes
    let draft_bytes =
        std::fs::read(&draft_path).map_err(|e| format!("Failed to read draft: {}", e))?;

    // Try to decode anim config from draft LSBs first
    let anim_json = if let Some(json) = decode_anim_from_png(&draft_bytes) {
        Some(json)
    } else {
        // Fall back to original skin's embedded or sidecar anim config
        let orig_path = skins_dir.join(format!("{}.png", slug));
        let orig_lsb = orig_path
            .exists()
            .then(|| std::fs::read(&orig_path).ok())
            .flatten()
            .and_then(|b| decode_anim_from_png(&b));

        if orig_lsb.is_some() {
            orig_lsb
        } else {
            // Try sidecar .anim.json
            let json_path = skins_dir.join(format!("{}.anim.json", slug));
            json_path
                .exists()
                .then(|| std::fs::read_to_string(&json_path).ok())
                .flatten()
        }
    };

    // Re-bake anim config into draft PNG if we have one
    let final_bytes = if let Some(ref json) = anim_json {
        encode_anim_into_png(&draft_bytes, &crate::skins::scrub_anim_json(json))
            .unwrap_or(draft_bytes)
    } else {
        draft_bytes
    };

    // Overwrite the original skin file
    let orig_path = skins_dir.join(format!("{}.png", slug));
    std::fs::write(&orig_path, &final_bytes).map_err(|e| format!("Failed to write skin: {}", e))?;

    // Delete the draft
    std::fs::remove_file(&draft_path).map_err(|e| format!("Failed to delete draft: {}", e))?;

    // Also handle draft anim.json sidecar (created by full regeneration)
    let draft_anim_path = skins_dir.join(format!("{}--draft.anim.json", slug));
    if draft_anim_path.exists() {
        // Copy the draft's anim config as the new original sidecar
        let orig_anim_path = skins_dir.join(format!("{}.anim.json", slug));
        let _ = std::fs::copy(&draft_anim_path, &orig_anim_path);
        let _ = std::fs::remove_file(&draft_anim_path);
    }

    Ok(())
}

/// Discard a pending draft for the given skin slug.
#[tauri::command]
pub(crate) fn discard_character_draft(
    slug: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let custom = resolve_custom_skins_dir(&app_handle)?;
    let skins_dir = if custom.join(format!("{}--draft.png", slug)).exists() {
        custom
    } else {
        resolve_default_skins_dir(&app_handle).ok_or_else(|| format!("Skin not found: {}", slug))?
    };
    let draft_path = skins_dir.join(format!("{}--draft.png", slug));
    if draft_path.exists() {
        std::fs::remove_file(&draft_path).map_err(|e| format!("Failed to delete draft: {}", e))?;
    }

    // Also clean up draft anim.json sidecar if present
    let draft_anim_path = skins_dir.join(format!("{}--draft.anim.json", slug));
    if draft_anim_path.exists() {
        let _ = std::fs::remove_file(&draft_anim_path);
    }

    Ok(())
}

// ── Skin import / install helpers ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TempDir;

    #[test]
    fn one_generation_at_a_time() {
        let slot = GenerationSlot::acquire().unwrap();
        assert!(GenerationSlot::busy());
        assert!(GenerationSlot::acquire().is_err());
        GENERATION_PID.store(4242, Ordering::SeqCst);
        drop(slot);
        assert!(!GenerationSlot::busy());
        assert_eq!(GENERATION_PID.load(Ordering::SeqCst), 0);
        drop(GenerationSlot::acquire().unwrap());
    }

    #[test]
    fn generated_characters_never_overwrite_existing_skins() {
        let tmp = TempDir::new("adopt");
        let root = tmp.path().to_path_buf();
        let (staging, skins) = (root.join("staging"), root.join("skins"));
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::create_dir_all(&skins).unwrap();
        std::fs::write(skins.join("grumpy-wizard.png"), b"mine").unwrap();
        std::fs::write(staging.join("grumpy-wizard.png"), b"new").unwrap();
        std::fs::write(staging.join("grumpy-wizard.anim.json"), b"{}").unwrap();

        let existing = skins.clone();
        let slug = adopt_generated(&staging, &skins, "grumpy-wizard", |s| {
            existing.join(format!("{s}.png")).exists()
        })
        .unwrap();
        assert_eq!(slug, "grumpy-wizard-2");
        assert_eq!(
            std::fs::read(skins.join("grumpy-wizard.png")).unwrap(),
            b"mine"
        );
        assert_eq!(
            std::fs::read(skins.join("grumpy-wizard-2.png")).unwrap(),
            b"new"
        );
        assert!(skins.join("grumpy-wizard-2.anim.json").exists());
        assert!(!staging.exists());
    }

    #[test]
    fn copy_skin_files_copies_png_and_anim_sidecar() {
        let tmp = TempDir::new("copy-skin");
        let root = tmp.path().to_path_buf();
        let (from, to) = (root.join("bundled"), root.join("custom"));
        std::fs::create_dir_all(&from).unwrap();
        std::fs::write(from.join("dr-vibe-pirate.png"), b"png").unwrap();
        std::fs::write(from.join("dr-vibe-pirate.anim.json"), b"{}").unwrap();

        copy_skin_files(&from, &to, "dr-vibe-pirate").unwrap();
        assert_eq!(
            std::fs::read(to.join("dr-vibe-pirate.png")).unwrap(),
            b"png"
        );
        assert_eq!(
            std::fs::read(to.join("dr-vibe-pirate.anim.json")).unwrap(),
            b"{}"
        );
        assert!(copy_skin_files(&from, &to, "missing").is_err());
    }

    #[test]
    fn clip_never_splits_characters() {
        assert_eq!(clip("héllo wörld", 5), "héllo");
        assert_eq!(clip("short", 80), "short");
        let long_emoji = "🧪".repeat(150);
        assert_eq!(clip(&long_emoji, 120).chars().count(), 120);
    }

    #[test]
    fn claude_stream_text_and_tools() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Drawing the goggles\n\nDone"},{"type":"tool_use","name":"Write","input":{"file_path":"/tmp/neon.png"}}]}}"#;
        let out = parse_claude_stream_line(line);
        assert_eq!(out[0], "  Drawing the goggles");
        assert_eq!(out[1], "  Done");
        assert!(out[2].starts_with("→ "));
    }

    #[test]
    fn claude_stream_long_unicode_line_does_not_panic() {
        let text = "é".repeat(300);
        let line = serde_json::json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": text }] } }).to_string();
        let out = parse_claude_stream_line(&line);
        assert!(out[0].ends_with('…'));
    }

    #[test]
    fn claude_stream_errors_and_results() {
        assert_eq!(
            parse_claude_stream_line(r#"{"type":"result","subtype":"error","error":"quota"}"#),
            vec!["Failed: quota"]
        );
        assert_eq!(
            parse_claude_stream_line(r#"{"type":"result","subtype":"success"}"#),
            vec!["Complete"]
        );
        assert_eq!(
            parse_claude_stream_line(r#"{"type":"system","subtype":"init"}"#),
            vec!["Initializing…"]
        );
        assert!(parse_claude_stream_line("not json").is_empty());
    }

    #[test]
    fn finds_the_generated_slug() {
        assert_eq!(
            extract_slug_from_stream_line("GENERATED_SKIN: neon-vibe").as_deref(),
            Some("neon-vibe")
        );
        let json = r#"{"type":"result","result":"All done\nGENERATED_SKIN:pirate-vibe"}"#;
        assert_eq!(
            extract_slug_from_stream_line(json).as_deref(),
            Some("pirate-vibe")
        );
        assert_eq!(
            extract_slug_from_stream_line(r#"{"type":"result","result":"nothing"}"#),
            None
        );
    }

    fn placeholders(text: &str) -> Vec<String> {
        let mut out: Vec<String> = text
            .match_indices('$')
            .map(|(i, _)| {
                text[i + 1..]
                    .chars()
                    .take_while(|c| c.is_ascii_uppercase() || *c == '_')
                    .collect::<String>()
            })
            .filter(|name| !name.is_empty())
            .collect();
        out.sort();
        out.dedup();
        out
    }

    #[test]
    fn fills_every_placeholder_in_the_bundled_prompt() {
        let template = include_str!("../../tools/generate-character.md");
        assert_eq!(
            placeholders(template),
            [
                "AGENT_NAME",
                "ARGUMENTS",
                "BASED_ON",
                "MODEL_NAME",
                "REFERENCE_SECTION",
                "SCRIPTS_DIR",
                "SKINS_DIR"
            ]
        );
        let skins = std::path::Path::new(r"C:\Users\o'neil\AppData\skins");
        let scripts = std::path::Path::new(r"C:\Temp\dr-vibe-generator");
        let filled = fill_prompt(
            template,
            &PromptVars {
                arguments: "a frog in a $SKINS_DIR hat",
                skins_dir: skins,
                scripts_dir: scripts,
                reference_section: "",
                model_name: "claude-code",
                agent: "claude",
                based_on: "none",
            },
        );
        // Only the description's own text is left.
        assert_eq!(placeholders(&filled), ["SKINS_DIR"]);
        assert!(filled.contains("a frog in a $SKINS_DIR hat"));
        assert!(filled.contains("String.raw`C:/Users/o'neil/AppData/skins`"));
        assert!(filled.contains("C:/Temp/dr-vibe-generator/generate-{slug}.cjs"));
        assert!(filled.contains("GENERATED_SKIN: {slug}"));
    }

    #[test]
    fn only_2_0_sheet_sizes_pass() {
        assert!(check_sheet_size(128, 512).is_ok());
        assert!(check_sheet_size(128, 544).is_ok());
        let err = check_sheet_size(192, 672).unwrap_err();
        assert!(
            err.contains("192 × 672") && err.contains("128 × 544"),
            "{}",
            err
        );
        assert!(check_sheet_size(128, 576).is_err());
    }

    fn sheet_png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let mut data = vec![0u8; (width * height * 4) as usize];
            // One red pixel at (3, 2) in the first frame of every row
            for row in 0..height / 32 {
                let i = (((row * 32 + 2) * width + 3) * 4) as usize;
                data[i..i + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
            writer.write_image_data(&data).unwrap();
        }
        out
    }

    #[test]
    fn reference_uses_the_2_0_rows_and_painter_api() {
        let script = analyze_sprite_to_reference(&sheet_png(128, 544)).unwrap();
        assert!(script.contains("// Row 6: walk\n"));
        assert!(script.contains("// Row 16: levitating\n"));
        assert!(script.contains("function ref_levitating(p) {"));
        assert!(script.contains("const REF = {\n  C0: [255, 0, 0],"));
        assert!(script.contains("  p.px(3, 2, REF.C0);\n"));
        assert!(!script.contains("walkLeft"));
        let short = analyze_sprite_to_reference(&sheet_png(128, 512)).unwrap();
        assert!(short.contains("// Row 15: presenting\n") && !short.contains("levitating"));
    }

    #[test]
    fn checks_the_generated_file() {
        let tmp = TempDir::new("gen-test");
        let dir = tmp.path().to_path_buf();
        let good = dir.join("good.png");
        let bad = dir.join("bad.png");
        std::fs::write(&good, sheet_png(128, 544)).unwrap();
        std::fs::write(&bad, sheet_png(192, 672)).unwrap();
        assert!(check_sheet_file(&good).is_ok());
        assert!(check_sheet_file(&bad).is_err());
        assert!(check_sheet_file(&dir.join("missing.png")).is_err());
    }

    /// One real generation through the player's `claude` CLI: the bundled
    /// prompt, the same CLI arguments, slug parsing, staging and the sheet
    /// check (everything but the window's progress events). Spends real AI
    /// usage, so it only runs on request:
    /// `cargo test real_claude_generation -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_claude_generation() {
        let tmp = TempDir::new("real-gen");
        let root = tmp.path().to_path_buf();
        let skins = root.join("skins");
        let staging = root.join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let prompt = fill_prompt(
            include_str!("../../tools/generate-character.md"),
            &PromptVars {
                arguments: "a cheerful lighthouse keeper with a yellow raincoat and a lantern",
                skins_dir: &staging,
                scripts_dir: &root.join("scripts"),
                reference_section: "",
                model_name: "claude-code",
                agent: "claude",
                based_on: "none",
            },
        );
        let prompt_path = root.join("prompt.txt");
        std::fs::write(&prompt_path, prompt).unwrap();
        let short = format!(
            "Read '{}', then immediately write the script and run it. Do not read any other files first.",
            prompt_path.to_string_lossy().replace('\\', "/")
        );
        let out = claude_command(&[
            "--dangerously-skip-permissions",
            "--verbose",
            "--output-format",
            "stream-json",
            "-p",
            &short,
        ])
        .current_dir(&root)
        .env_remove("CLAUDECODE")
        .stdin(std::process::Stdio::null())
        .output()
        .expect("claude runs");
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            for msg in parse_claude_stream_line(line) {
                println!("{msg}");
            }
        }
        assert!(
            out.status.success(),
            "claude failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let slug = stdout
            .lines()
            .find_map(extract_slug_from_stream_line)
            .expect("GENERATED_SKIN line");
        let adopted = adopt_generated(&staging, &skins, &slug, |_| false).unwrap();
        let png = skins.join(format!("{adopted}.png"));
        check_sheet_file(&png).unwrap();
        println!("generated {} at {}", adopted, png.display());
    }
}
