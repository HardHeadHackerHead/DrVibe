//! Local skin library: list/read/save, vibe ids, metadata, downloads and imports.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Resolve the default (bundled) skins directory: the Lab Originals shipped in
/// `bundle.resources` (`resource_dir()/assets/sprites/skins/<slug>.png`).
pub(crate) fn resolve_default_skins_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    default_skins_candidates(app_handle.path().resource_dir().ok())
        .into_iter()
        .find(|p| p.is_dir())
}

/// Where the bundled skins may live, in lookup order. The CWD-relative source
/// folders are dev-only, so a release build launched from the repo can't pass
/// by accident while the installed one has no skins.
pub(crate) fn default_skins_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Dev mode first: Tauri dev runs from src-tauri/, frontend is at ../src/.
    // Must come before resource_dir because the build output also exists in dev.
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from("../src/assets/sprites/skins"));
        candidates.push(PathBuf::from("src/assets/sprites/skins"));
    }

    if let Some(res) = resource_dir {
        candidates.push(res.join("assets").join("sprites").join("skins"));
    }

    candidates
}

/// Resolve the custom skins directory in OS app data (writable, survives updates).
/// Creates the directory if it doesn't exist.
pub(crate) fn resolve_custom_skins_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?
        .join("skins");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create custom skins dir: {}", e))?;
    Ok(dir)
}

// ── PICO-8-style LSB steganography ──────────────────────────────────────────
// The anim.json for each skin is embedded into the 2 least-significant bits of
// the R, G, B channels of the PNG pixel data. 6 bits per pixel → 4 px = 3 bytes.
// Header: magic "DRVB" (4 bytes) + payload length big-endian u32 (4 bytes).

pub(crate) const LSB_MAGIC: [u8; 4] = [0x44, 0x52, 0x56, 0x42]; // b"DRVB"

/// Read `byte_count` bytes from the 2-LSB stream of the RGB channels.
pub(crate) fn lsb_read_bytes(pixels: &[u8], stride: usize, byte_count: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(byte_count);
    let mut bits: u32 = 0;
    let mut bits_held: u32 = 0;
    let mut px = 0usize;
    while out.len() < byte_count {
        let base = px * stride;
        if base + 2 >= pixels.len() {
            break;
        }
        bits = (bits << 2) | ((pixels[base] & 3) as u32);
        bits = (bits << 2) | ((pixels[base + 1] & 3) as u32);
        bits = (bits << 2) | ((pixels[base + 2] & 3) as u32);
        bits_held += 6;
        px += 1;
        while bits_held >= 8 && out.len() < byte_count {
            bits_held -= 8;
            out.push(((bits >> bits_held) & 0xFF) as u8);
        }
    }
    out
}

/// Write `payload` bytes into the 2 LSBs of the RGB channels of `pixels`.
pub(crate) fn lsb_write_bytes(pixels: &mut [u8], stride: usize, payload: &[u8]) {
    let total_bits = payload.len() * 8;
    let mut bit_pos = 0usize;
    let mut px = 0usize;
    while bit_pos < total_bits {
        let base = px * stride;
        if base + 2 >= pixels.len() {
            break;
        }
        for ch in 0..3usize {
            if bit_pos >= total_bits {
                break;
            }
            let b1 = (payload[bit_pos / 8] >> (7 - bit_pos % 8)) & 1;
            bit_pos += 1;
            let b2 = if bit_pos < total_bits {
                let b = (payload[bit_pos / 8] >> (7 - bit_pos % 8)) & 1;
                bit_pos += 1;
                b
            } else {
                0
            };
            pixels[base + ch] = (pixels[base + ch] & 0xFC) | (b1 << 1) | b2;
        }
        px += 1;
    }
}

/// Decode a PNG to raw pixels. Returns (pixels, width, height, color_type, bit_depth).
pub(crate) fn decode_png_pixels(
    png_bytes: &[u8],
) -> Result<(Vec<u8>, u32, u32, png::ColorType, png::BitDepth), String> {
    let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut pixels = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut pixels).map_err(|e| e.to_string())?;
    pixels.truncate(info.buffer_size());
    Ok((
        pixels,
        info.width,
        info.height,
        info.color_type,
        info.bit_depth,
    ))
}

/// Embed an anim.json string into the LSBs of a PNG and return the new PNG bytes.
pub(crate) fn encode_anim_into_png(png_bytes: &[u8], anim_json: &str) -> Result<Vec<u8>, String> {
    let (mut pixels, width, height, color_type, bit_depth) = decode_png_pixels(png_bytes)?;
    let stride = match color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        _ => return Err("Unsupported PNG color type for LSB encoding".to_string()),
    };
    let json_bytes = anim_json.as_bytes();
    let mut payload = Vec::with_capacity(8 + json_bytes.len());
    payload.extend_from_slice(&LSB_MAGIC);
    payload.extend_from_slice(&(json_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(json_bytes);
    let capacity = (width * height) as usize * 6 / 8;
    if payload.len() > capacity {
        return Err(format!(
            "anim.json too large ({} bytes) for this sprite sheet ({} bytes LSB capacity)",
            payload.len(),
            capacity
        ));
    }
    lsb_write_bytes(&mut pixels, stride, &payload);
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(color_type);
        encoder.set_depth(bit_depth);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&pixels)
            .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Extract an embedded anim.json from a PNG's LSBs. Returns None if not present.
pub(crate) fn decode_anim_from_png(png_bytes: &[u8]) -> Option<String> {
    let (pixels, width, height, color_type, _) = decode_png_pixels(png_bytes).ok()?;
    let stride = match color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        _ => return None,
    };
    let header = lsb_read_bytes(&pixels, stride, 8);
    if header.len() < 8 {
        return None;
    }
    if header[0..4] != LSB_MAGIC {
        return None;
    }
    let len = u32::from_be_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len == 0 || len > 200_000 {
        return None;
    }
    let capacity = (width * height) as usize * 6 / 8;
    if 8 + len > capacity {
        return None;
    }
    let all = lsb_read_bytes(&pixels, stride, 8 + len);
    if all.len() < 8 + len {
        return None;
    }
    String::from_utf8(all[8..8 + len].to_vec()).ok()
}

/// Provenance keys that would name the person or machine a design came
/// from. Older builds wrote the OS login name into `generation.generatedBy`;
/// it is stripped wherever animation data is read, baked or uploaded.
const PERSONAL_GENERATION_KEYS: [&str; 1] = ["generatedBy"];

/// Remove [`PERSONAL_GENERATION_KEYS`] from an anim.json value. True if anything changed.
pub(crate) fn scrub_anim_value(anim: &mut serde_json::Value) -> bool {
    let Some(generation) = anim.get_mut("generation").and_then(|g| g.as_object_mut()) else {
        return false;
    };
    let mut changed = false;
    for key in PERSONAL_GENERATION_KEYS {
        changed |= generation.remove(key).is_some();
    }
    changed
}

/// [`scrub_anim_value`] on an anim.json string. Text that isn't JSON, or
/// needs no change, comes back as it was.
pub(crate) fn scrub_anim_json(json: &str) -> String {
    let Ok(mut anim) = serde_json::from_str::<serde_json::Value>(json) else {
        return json.to_string();
    };
    if !scrub_anim_value(&mut anim) {
        return json.to_string();
    }
    serde_json::to_string(&anim).unwrap_or_else(|_| json.to_string())
}

/// A PNG whose baked anim.json carries personal provenance, re-baked without
/// it. Any other PNG comes back unchanged.
pub(crate) fn scrub_png(png_bytes: Vec<u8>) -> Vec<u8> {
    let Some(json) = decode_anim_from_png(&png_bytes) else {
        return png_bytes;
    };
    let clean = scrub_anim_json(&json);
    if clean == json {
        return png_bytes;
    }
    encode_anim_into_png(&png_bytes, &clean).unwrap_or(png_bytes)
}

/// List available skin PNG files from both the default (bundled) and custom (app data) dirs.
/// Returns [{ "slug": "...", "isDefault": bool }, ...] — defaults first, then custom.
#[tauri::command]
pub(crate) fn list_skins(app_handle: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let default_dir = resolve_default_skins_dir(&app_handle);
    let custom_dir = resolve_custom_skins_dir(&app_handle)?;

    let read_slugs = |dir: &PathBuf| -> Vec<String> {
        let mut slugs: Vec<String> = std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.to_lowercase().ends_with(".png") {
                            let slug = name[..name.len() - 4].to_string();
                            if slug.ends_with("--draft") {
                                return None;
                            }
                            Some(slug)
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        slugs.sort();
        slugs
    };

    // Read metadata (name + galleryId) from anim.json sidecar or embedded PNG LSBs
    let read_meta = |dir: &PathBuf, slug: &str| -> (Option<String>, Option<String>) {
        let png_path = dir.join(format!("{slug}.png"));
        // Try PNG LSBs first
        if let Ok(png_bytes) = std::fs::read(&png_path) {
            if let Some(json) = decode_anim_from_png(&png_bytes) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    let name = v["name"].as_str().map(String::from);
                    let gid = v["galleryId"].as_str().map(String::from);
                    if name.is_some() || gid.is_some() {
                        return (name, gid);
                    }
                }
            }
        }
        // Fall back to .anim.json sidecar
        let anim_path = dir.join(format!("{slug}.anim.json"));
        if let Ok(content) = std::fs::read_to_string(&anim_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                return (
                    v["name"].as_str().map(String::from),
                    v["galleryId"].as_str().map(String::from),
                );
            }
        }
        (None, None)
    };

    // Bundled Lab Originals are always listed; a custom skin with the same
    // slug replaces its bundled entry.
    let mut defaults: Vec<serde_json::Value> = Vec::new();
    if let Some(ref dir) = default_dir {
        for slug in read_slugs(dir) {
            let (name, gallery_id) = read_meta(dir, &slug);
            defaults.push(serde_json::json!({
                "slug": slug,
                "isDefault": true,
                "name": name,
                "galleryId": gallery_id,
            }));
        }
    }
    let mut custom: Vec<serde_json::Value> = Vec::new();
    for slug in read_slugs(&custom_dir) {
        let (name, gallery_id) = read_meta(&custom_dir, &slug);
        custom.push(serde_json::json!({
            "slug": slug,
            "isDefault": false,
            "name": name,
            "galleryId": gallery_id,
        }));
    }

    let result = merge_skin_lists(defaults, custom);
    Ok(result)
}

/// Bundled entries first, then custom ones; on a slug collision the custom
/// entry wins and the bundled one is dropped.
pub(crate) fn merge_skin_lists(
    defaults: Vec<serde_json::Value>,
    custom: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let custom_slugs: std::collections::HashSet<String> = custom
        .iter()
        .filter_map(|v| v["slug"].as_str().map(String::from))
        .collect();
    defaults
        .into_iter()
        .filter(|v| {
            v["slug"]
                .as_str()
                .map(|s| !custom_slugs.contains(s))
                .unwrap_or(false)
        })
        .chain(custom)
        .collect()
}

/// Read a skin PNG file and return its contents as base64.
/// Checks custom dir (app data) first, then the default (bundled) dir.
#[tauri::command]
pub(crate) fn read_skin(name: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let mut dirs = vec![resolve_custom_skins_dir(&app_handle)?];
    if let Some(d) = resolve_default_skins_dir(&app_handle) {
        dirs.push(d);
    }
    for dir in dirs {
        let path = dir.join(format!("{}.png", name));
        if path.exists() {
            let data =
                std::fs::read(&path).map_err(|e| format!("Failed to read skin file: {}", e))?;
            return Ok(BASE64.encode(&data));
        }
    }
    Err(format!("Skin not found: {}", name))
}

/// Read a skin's animation metadata.
/// Priority: 1) .anim.json sidecar, 2) embedded in PNG LSBs, 3) empty string.
/// Sidecar wins because every local tool — vibeId mint, rename, uploadedAt
/// stamp, workshop edits — writes there. PNG LSBs are static once encoded
/// and serve as a fallback for skins shared as bare PNGs (no sidecar).
/// Checks custom dir (app data) first, then the default (bundled) dir if present.
#[tauri::command]
pub(crate) fn read_skin_anim(name: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let mut dirs = vec![resolve_custom_skins_dir(&app_handle)?];
    if let Some(d) = resolve_default_skins_dir(&app_handle) {
        dirs.push(d);
    }
    for dir in dirs {
        let png_path = dir.join(format!("{}.png", name));
        if !png_path.exists() {
            continue;
        }

        // 1. Sidecar is authoritative for locally-installed skins.
        let anim_path = dir.join(format!("{}.anim.json", name));
        if anim_path.exists() {
            if let Ok(s) = std::fs::read_to_string(&anim_path) {
                if !s.trim().is_empty() {
                    return Ok(scrub_anim_json(&s));
                }
            }
        }

        // 2. Fall back to PNG-embedded JSON for sidecar-less imports.
        if let Ok(png_bytes) = std::fs::read(&png_path) {
            if let Some(json) = decode_anim_from_png(&png_bytes) {
                return Ok(scrub_anim_json(&json));
            }
        }

        return Ok(String::new());
    }
    Ok(String::new())
}

/// Save a skin PNG file from base64 data to the custom skins directory.
#[tauri::command]
pub(crate) fn save_skin(
    name: String,
    data: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let skins_dir = resolve_custom_skins_dir(&app_handle)?;
    let file_path = skins_dir.join(format!("{}.png", name));
    let bytes = BASE64
        .decode(&data)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;
    std::fs::write(&file_path, &bytes).map_err(|e| format!("Failed to write skin file: {}", e))?;
    Ok(())
}

/// Delete a user-installed skin (PNG + optional .anim.json sidecar) from the custom dir.
/// Default (bundled) skins cannot be deleted — they live in a separate read-only directory.
#[tauri::command]
pub(crate) fn delete_skin(name: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let skins_dir = resolve_custom_skins_dir(&app_handle)?;
    let png_path = skins_dir.join(format!("{name}.png"));
    if !png_path.exists() {
        return Err(format!("Skin not found: {name}"));
    }
    std::fs::remove_file(&png_path).map_err(|e| format!("Failed to delete: {e}"))?;
    let anim_path = skins_dir.join(format!("{name}.anim.json"));
    if anim_path.exists() {
        let _ = std::fs::remove_file(&anim_path);
    }
    Ok(())
}

/// Mint a fresh vibeId (UUID v4, lowercase hyphenated).
/// Every Dr. Vibe gets one at generation/import time. The slug is the
/// human-readable handle and may change; the vibeId is the stable identity
/// the website matches on for overwrite-on-upload.
pub(crate) fn mint_vibe_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Ensure the given anim.json value (must be a JSON object) contains a `vibeId`.
/// Returns true if a new id was minted (caller should persist), false if one
/// was already present. Non-object values are upgraded to an object.
pub(crate) fn ensure_vibe_id_in_anim_value(value: &mut serde_json::Value) -> bool {
    if !value.is_object() {
        *value = serde_json::json!({});
    }
    let obj = value.as_object_mut().expect("ensured object above");
    let has_valid = obj
        .get("vibeId")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if has_valid {
        return false;
    }
    obj.insert("vibeId".to_string(), serde_json::json!(mint_vibe_id()));
    true
}

/// Atomic write: write to a temp file in the same directory then rename.
/// Avoids leaving a half-written sidecar on crash mid-write.
pub(crate) fn atomic_write_string(path: &Path, contents: &str) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name")
    })?;
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(file_name);
    tmp_name.push(".tmp");
    let tmp_path = dir.join(tmp_name);
    std::fs::write(&tmp_path, contents)?;
    // On Windows, rename will fail if target exists for non-replacing rename.
    // std::fs::rename is documented to replace on both Unix and Windows,
    // but be defensive: remove the target first if rename trips.
    if let Err(e) = std::fs::rename(&tmp_path, path) {
        // Fallback: explicit replace
        let _ = std::fs::remove_file(path);
        std::fs::rename(&tmp_path, path).map_err(|_| e)?;
    }
    Ok(())
}

/// Read a sidecar JSON (or return an empty object). Used by helpers that
/// need to inspect/mutate then write back.
pub(crate) fn read_anim_sidecar(anim_path: &Path) -> serde_json::Value {
    if anim_path.exists() {
        std::fs::read_to_string(anim_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    }
}

/// Read the vibeId for a skin. Returns None if no sidecar or no vibeId set.
/// Does NOT mint one — read-only.
pub(crate) fn read_vibe_id_for_slug(skins_dir: &Path, slug: &str) -> Option<String> {
    let anim_path = skins_dir.join(format!("{}.anim.json", slug));
    let value = read_anim_sidecar(&anim_path);
    value
        .get("vibeId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Tauri command: return the vibeId for a slug, searching custom dir then default.
/// Empty string if none found.
#[tauri::command]
pub(crate) fn read_skin_vibe_id(
    slug: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid skin slug".to_string());
    }
    let custom = resolve_custom_skins_dir(&app_handle)?;
    if let Some(id) = read_vibe_id_for_slug(&custom, &slug) {
        return Ok(id);
    }
    if let Some(default) = resolve_default_skins_dir(&app_handle) {
        if let Some(id) = read_vibe_id_for_slug(&default, &slug) {
            return Ok(id);
        }
    }
    Ok(String::new())
}

/// Walk a skins directory, mint a vibeId for any sidecar missing one.
/// Returns (sidecars_examined, ids_minted, errors). Best-effort; errors are
/// logged to stderr and counted but never abort the walk. Never deletes files.
pub(crate) fn backfill_vibe_ids_in_dir(dir: &Path) -> (usize, usize, usize) {
    let mut examined = 0;
    let mut minted = 0;
    let mut errors = 0;
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return (0, 0, 0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !file_name.ends_with(".anim.json") {
            continue;
        }
        examined += 1;
        let mut value = read_anim_sidecar(&path);
        if ensure_vibe_id_in_anim_value(&mut value) {
            match serde_json::to_string_pretty(&value) {
                Ok(s) => match atomic_write_string(&path, &s) {
                    Ok(()) => {
                        minted += 1;
                    }
                    Err(e) => {
                        eprintln!(
                            "[dr-vibe] vibeId backfill: write failed for {:?}: {}",
                            path, e
                        );
                        errors += 1;
                    }
                },
                Err(e) => {
                    eprintln!(
                        "[dr-vibe] vibeId backfill: serialize failed for {:?}: {}",
                        path, e
                    );
                    errors += 1;
                }
            }
        }
    }
    (examined, minted, errors)
}

/// One-shot startup migration: ensure every .anim.json in both bundled and
/// custom skin dirs has a vibeId. Called from `.setup`. Idempotent.
pub(crate) fn run_vibe_id_backfill(app_handle: &tauri::AppHandle) {
    let mut total_examined = 0;
    let mut total_minted = 0;
    let mut total_errors = 0;
    if let Ok(custom) = resolve_custom_skins_dir(app_handle) {
        let (e, m, err) = backfill_vibe_ids_in_dir(&custom);
        total_examined += e;
        total_minted += m;
        total_errors += err;
    }
    if let Some(default) = resolve_default_skins_dir(app_handle) {
        let (e, m, err) = backfill_vibe_ids_in_dir(&default);
        total_examined += e;
        total_minted += m;
        total_errors += err;
    }
    if total_minted > 0 || total_errors > 0 {
        eprintln!(
            "[dr-vibe] vibeId backfill: examined={} minted={} errors={}",
            total_examined, total_minted, total_errors
        );
    }
}

/// Write the `source` field into a skin's .anim.json sidecar.
/// Silently ignores I/O errors (best-effort).
pub(crate) fn write_skin_source(skins_dir: &Path, slug: &str, source: &str) {
    let anim_path = skins_dir.join(format!("{}.anim.json", slug));
    let mut anim: serde_json::Value = if anim_path.exists() {
        std::fs::read_to_string(&anim_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(obj) = anim.as_object_mut() {
        obj.insert("source".to_string(), serde_json::json!(source));
    }
    if let Ok(content) = serde_json::to_string_pretty(&anim) {
        let _ = std::fs::write(&anim_path, content);
    }
}

/// Write both `source` and `generatorDescription` fields into a skin's .anim.json sidecar.
/// Silently ignores I/O errors (best-effort). Also ensures the sidecar has a vibeId.
pub(crate) fn write_skin_metadata(
    skins_dir: &Path,
    slug: &str,
    source: &str,
    description: Option<&str>,
    agent: Option<&str>,
    prompt: Option<&str>,
    based_on: Option<&str>,
) {
    let anim_path = skins_dir.join(format!("{}.anim.json", slug));
    let mut anim: serde_json::Value = if anim_path.exists() {
        std::fs::read_to_string(&anim_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    ensure_vibe_id_in_anim_value(&mut anim);
    if let Some(obj) = anim.as_object_mut() {
        obj.insert("source".to_string(), serde_json::json!(source));
        if let Some(desc) = description {
            obj.insert("generatorDescription".to_string(), serde_json::json!(desc));
        }

        // Build generation metadata block
        let model_name = match agent.unwrap_or("claude") {
            "codex" => "codex-cli",
            _ => "claude-code",
        };
        let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

        // No `generatedBy`: the design must not carry the OS login name.
        let mut generation = serde_json::Map::new();
        generation.insert("model".to_string(), serde_json::json!(model_name));
        generation.insert(
            "agent".to_string(),
            serde_json::json!(agent.unwrap_or("claude")),
        );
        generation.insert("generatedAt".to_string(), serde_json::json!(timestamp));
        if let Some(p) = prompt {
            generation.insert("prompt".to_string(), serde_json::json!(p));
        }
        generation.insert(
            "scriptFile".to_string(),
            serde_json::json!(format!("generate-{}.cjs", slug)),
        );
        if let Some(ref_slug) = based_on {
            generation.insert("basedOn".to_string(), serde_json::json!(ref_slug));
        }

        obj.insert(
            "generation".to_string(),
            serde_json::Value::Object(generation),
        );
    }
    if let Ok(content) = serde_json::to_string_pretty(&anim) {
        let _ = std::fs::write(&anim_path, content);
    }
}

/// Set the `source` field on a skin's .anim.json sidecar.
/// Creates the sidecar if it doesn't exist.
#[tauri::command]
pub(crate) fn set_skin_source(
    name: String,
    source: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let valid_sources = ["ai_generated", "sprite_editor", "imported"];
    if !valid_sources.contains(&source.as_str()) {
        return Err(format!("Invalid source: {}", source));
    }
    let skins_dir = resolve_custom_skins_dir(&app_handle)?;
    write_skin_source(&skins_dir, &name, &source);
    Ok(())
}

/// Set the display name for a skin in its .anim.json sidecar.
#[tauri::command]
pub(crate) fn rename_skin(
    slug: String,
    display_name: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid skin slug".to_string());
    }
    let skins_dir = resolve_custom_skins_dir(&app_handle)?;
    let anim_path = skins_dir.join(format!("{}.anim.json", slug));
    let mut anim: serde_json::Value = if anim_path.exists() {
        std::fs::read_to_string(&anim_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(obj) = anim.as_object_mut() {
        let trimmed = display_name.trim();
        if trimmed.is_empty() {
            obj.remove("name");
        } else {
            obj.insert("name".to_string(), serde_json::json!(trimmed));
        }
    }
    serde_json::to_string_pretty(&anim)
        .map_err(|e| e.to_string())
        .and_then(|content| std::fs::write(&anim_path, content).map_err(|e| e.to_string()))
}

/// Shared async logic: download PNG (+ optional anim.json) into the skins dir.
/// Returns (final_slug, was_update) where was_update is true if the file already existed.
/// Always uses the gallery ID (slug param) as the filename for uniqueness —
/// the display name is read from metadata by the UI.
pub(crate) async fn download_and_save_skin(
    app: &tauri::AppHandle,
    slug: &str,
    png_url: &str,
    anim_url: Option<&str>,
) -> Result<(String, bool), String> {
    if slug.is_empty() || slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid skin slug".to_string());
    }
    let skins_dir = resolve_custom_skins_dir(app)?;
    let client = reqwest::Client::new();

    let png_bytes = client
        .get(png_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {e}"))?;

    if png_bytes.len() < 8 || png_bytes[0..8] != *b"\x89PNG\r\n\x1a\n" {
        return Err("Downloaded file is not a valid PNG".to_string());
    }

    // Always use the gallery ID (slug param) as the filename — guarantees uniqueness
    // even when multiple skins share the same display name (e.g. ten "Santa Claus" skins).
    // The display name is read from embedded metadata / .anim.json by the UI.
    let final_slug = slug.to_string();

    let was_update = skins_dir.join(format!("{final_slug}.png")).exists();
    std::fs::write(skins_dir.join(format!("{final_slug}.png")), &png_bytes)
        .map_err(|e| format!("Save failed: {e}"))?;

    // Download anim.json sidecar if provided
    if let Some(url) = anim_url {
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(bytes) = resp.bytes().await {
                let _ = std::fs::write(skins_dir.join(format!("{final_slug}.anim.json")), &bytes);
            }
        }
    }

    // Ensure galleryId is stored in the sidecar metadata so sync can report it
    let anim_path = skins_dir.join(format!("{final_slug}.anim.json"));
    let mut meta: serde_json::Value = if anim_path.exists() {
        std::fs::read_to_string(&anim_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        // Try to read from embedded PNG LSBs
        decode_anim_from_png(&png_bytes)
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or(serde_json::json!({}))
    };
    if let Some(obj) = meta.as_object_mut() {
        obj.insert("galleryId".to_string(), serde_json::json!(slug));
        if let Ok(content) = serde_json::to_string_pretty(&meta) {
            let _ = std::fs::write(&anim_path, content);
        }
    }

    Ok((final_slug, was_update))
}

/// Install a skin by downloading it from gallery URLs (invokable from JS or deep link).
#[tauri::command]
pub(crate) async fn install_skin_from_urls(
    slug: String,
    png_url: String,
    anim_url: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (final_slug, _) =
        download_and_save_skin(&app_handle, &slug, &png_url, anim_url.as_deref()).await?;
    Ok(final_slug)
}

// ── Companion sprite cache (LRU, max 20) ─────────────────────────────────────

/// Download + cache a companion's sprite sheet with LRU eviction (max 20 companions).
/// Keeps companion skins in the same custom skins directory as community skins but
/// tracks them separately in `companion-cache.json` so user-created skins are never evicted.
/// Returns the final slug (filename without extension).
#[tauri::command]
pub(crate) async fn cache_companion_skin(
    id: String,
    slug: String,
    name: String,
    png_url: String,
    anim_url: Option<String>,
    anim_json: Option<serde_json::Value>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    if slug.is_empty() || slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid companion slug".to_string());
    }

    // Prefix companion slugs to separate them from user-created skins
    let companion_slug = format!("companion-{slug}");

    // The poll and collection carry the sidecar inline (`animJson`); write it
    // first so the download below keeps it and adds the gallery id.
    if let Some(anim) = anim_json.filter(|a| a.is_object()) {
        let dir = resolve_custom_skins_dir(&app_handle)?;
        let _ = std::fs::write(
            dir.join(format!("{companion_slug}.anim.json")),
            anim.to_string(),
        );
    }

    // Download and save the skin (reuses existing helper)
    let (final_slug, _) =
        download_and_save_skin(&app_handle, &companion_slug, &png_url, anim_url.as_deref()).await?;

    // Update companion-cache.json for LRU tracking
    let cache_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("companion-cache.json");

    #[derive(serde::Serialize, serde::Deserialize, Default)]
    struct CacheEntry {
        id: String,
        slug: String,
        name: String,
        last_used: String,
    }
    #[derive(serde::Serialize, serde::Deserialize, Default)]
    struct CacheFile {
        entries: Vec<CacheEntry>,
    }

    let mut cache: CacheFile = std::fs::read_to_string(&cache_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let now = chrono::Utc::now().to_rfc3339();

    // Update existing entry or insert new one
    if let Some(entry) = cache.entries.iter_mut().find(|e| e.id == id) {
        entry.slug = final_slug.clone();
        entry.name = name.clone();
        entry.last_used = now.clone();
    } else {
        cache.entries.push(CacheEntry {
            id: id.clone(),
            slug: final_slug.clone(),
            name,
            last_used: now,
        });
    }

    // LRU eviction: keep at most 20 companions
    const MAX_COMPANIONS: usize = 20;
    if cache.entries.len() > MAX_COMPANIONS {
        // Sort oldest-first
        cache.entries.sort_by(|a, b| a.last_used.cmp(&b.last_used));
        let skins_dir = resolve_custom_skins_dir(&app_handle)?;
        while cache.entries.len() > MAX_COMPANIONS {
            let evicted = cache.entries.remove(0);
            let png = skins_dir.join(format!("{}.png", evicted.slug));
            let anim = skins_dir.join(format!("{}.anim.json", evicted.slug));
            let _ = std::fs::remove_file(&png);
            let _ = std::fs::remove_file(&anim);
            eprintln!(
                "[companion-cache] evicted: {} ({})",
                evicted.slug, evicted.id
            );
        }
    }

    // Persist updated cache
    if let Ok(json) = serde_json::to_string_pretty(&cache) {
        let _ = std::fs::write(&cache_path, json);
    }

    Ok(final_slug)
}

/// Import a skin from raw file bytes provided by the frontend file picker.
/// Accepts the PNG as base64 and the anim.json as a raw JSON string (optional).
#[tauri::command]
pub(crate) async fn import_skin(
    name: String,
    png_b64: String,
    anim_json: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Sanitise name → slug
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if slug.is_empty() {
        return Err("Invalid skin name".to_string());
    }
    let skins_dir = resolve_custom_skins_dir(&app_handle)?;
    // A new design never replaces one of the player's skins or a Lab Original.
    let slug = unique_slug(&slug, |s| slug_taken(&app_handle, s))?;

    let png_bytes = BASE64
        .decode(png_b64.trim())
        .map_err(|e| format!("Failed to decode PNG: {e}"))?;
    if png_bytes.len() < 8 || png_bytes[0..8] != *b"\x89PNG\r\n\x1a\n" {
        return Err("File is not a valid PNG".to_string());
    }
    std::fs::write(skins_dir.join(format!("{slug}.png")), &png_bytes)
        .map_err(|e| format!("Failed to save PNG: {e}"))?;

    let anim_path = skins_dir.join(format!("{slug}.anim.json"));
    let mut anim_value: serde_json::Value = if let Some(anim) = anim_json {
        // Validate it parses as JSON before saving
        serde_json::from_str(&anim).map_err(|_| "anim.json is not valid JSON".to_string())?
    } else {
        serde_json::json!({})
    };
    // Imported skins always get a fresh vibeId if the file didn't already
    // carry one — they're a "new" Dr. Vibe to this device.
    ensure_vibe_id_in_anim_value(&mut anim_value);
    let serialized = serde_json::to_string_pretty(&anim_value)
        .map_err(|e| format!("Failed to serialize anim.json: {e}"))?;
    atomic_write_string(&anim_path, &serialized)
        .map_err(|e| format!("Failed to save anim.json: {e}"))?;
    Ok(slug)
}

/// Duplicate an existing skin under a new slug, minting a brand-new vibeId.
/// The copy is a fully independent Dr. Vibe — uploading it creates a new
/// Edition on the website rather than overwriting the source.
///
/// `source_slug`: the skin to copy (searched in custom dir then bundled).
/// `new_slug`: optional explicit slug for the copy. If absent, derives from
///             `source_slug-copy`, `source_slug-copy-2`, etc.
/// Returns the slug of the new copy.
#[tauri::command]
pub(crate) fn copy_skin(
    source_slug: String,
    new_slug: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    if source_slug.contains('/') || source_slug.contains('\\') || source_slug.contains("..") {
        return Err("Invalid source slug".to_string());
    }

    // Locate the source PNG (custom first, then bundled)
    let custom_dir = resolve_custom_skins_dir(&app_handle)?;
    let source_png = {
        let custom_path = custom_dir.join(format!("{}.png", source_slug));
        if custom_path.exists() {
            custom_path
        } else if let Some(default) = resolve_default_skins_dir(&app_handle) {
            let p = default.join(format!("{}.png", source_slug));
            if !p.exists() {
                return Err(format!("Source skin not found: {}", source_slug));
            }
            p
        } else {
            return Err(format!("Source skin not found: {}", source_slug));
        }
    };
    let source_dir = source_png
        .parent()
        .ok_or("invalid source path")?
        .to_path_buf();
    let source_anim = source_dir.join(format!("{}.anim.json", source_slug));

    // Determine the destination slug — copies always land in custom dir.
    let candidate = match &new_slug {
        Some(s) => {
            let s = s.trim().to_lowercase();
            if s.is_empty() || s.contains('/') || s.contains('\\') || s.contains("..") {
                return Err("Invalid new slug".to_string());
            }
            // Sanitize same as import_skin
            s.chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '-' {
                        c
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
                .trim_matches('-')
                .to_string()
        }
        None => format!("{}-copy", source_slug),
    };
    if candidate.is_empty() {
        return Err("Could not derive destination slug".to_string());
    }

    let mut dest_slug = candidate.clone();
    let mut suffix = 2;
    while custom_dir.join(format!("{}.png", dest_slug)).exists() {
        dest_slug = format!("{}-{}", candidate, suffix);
        suffix += 1;
        if suffix > 999 {
            return Err("Too many copies; pick a unique name".to_string());
        }
    }

    // Copy the PNG.
    let dest_png = custom_dir.join(format!("{}.png", dest_slug));
    std::fs::copy(&source_png, &dest_png).map_err(|e| format!("Failed to copy PNG: {}", e))?;

    // Build the copy's sidecar: start from source sidecar (if any), strip
    // anything that would tie it to the original record, mint a fresh vibeId.
    let mut anim = read_anim_sidecar(&source_anim);
    if let Some(obj) = anim.as_object_mut() {
        // The source's vibeId must NOT carry over — that's the whole point.
        obj.remove("vibeId");
        // Default display name: "Copy of <original name>" if we can derive one.
        let original_name = obj.get("name").and_then(|v| v.as_str()).map(String::from);
        if let Some(n) = original_name {
            obj.insert(
                "name".to_string(),
                serde_json::json!(format!("Copy of {}", n)),
            );
        }
        // Generation block: keep prompt/agent/etc but blank scriptFile + add `copiedFrom`.
        if let Some(gen) = obj.get_mut("generation").and_then(|v| v.as_object_mut()) {
            gen.remove("scriptFile");
            gen.insert("copiedFrom".to_string(), serde_json::json!(source_slug));
            gen.insert(
                "copiedAt".to_string(),
                serde_json::json!(
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
                ),
            );
        }
    }
    // Mint the new vibeId AFTER scrubbing the old one.
    ensure_vibe_id_in_anim_value(&mut anim);

    let dest_anim = custom_dir.join(format!("{}.anim.json", dest_slug));
    let serialized = serde_json::to_string_pretty(&anim)
        .map_err(|e| format!("Failed to serialize copy sidecar: {}", e))?;
    if let Err(e) = atomic_write_string(&dest_anim, &serialized) {
        // Roll back the PNG so we don't leave a half-copied skin.
        let _ = std::fs::remove_file(&dest_png);
        return Err(format!("Failed to write copy sidecar: {}", e));
    }

    Ok(dest_slug)
}

/// "Make your own Dr. Vibe" → Download the template: write the template PNG
/// (built in JS from the default sheet) and its row guide to the Downloads
/// folder. Returns the PNG path so the UI can reveal it.
#[tauri::command]
pub(crate) fn save_sprite_template(
    png_base64: String,
    guide: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let png = BASE64
        .decode(png_base64.trim())
        .map_err(|e| format!("Bad template data: {e}"))?;
    if png.len() < 8 || png[0..8] != *b"\x89PNG\r\n\x1a\n" {
        return Err("Template is not a PNG".to_string());
    }
    let dir = app_handle
        .path()
        .download_dir()
        .or_else(|_| app_handle.path().desktop_dir())
        .or_else(|_| app_handle.path().home_dir())
        .map_err(|e| format!("No folder to save into: {e}"))?;
    let png_path = dir.join("Dr Vibe sprite template.png");
    std::fs::write(&png_path, &png).map_err(|e| format!("Failed to save template: {e}"))?;
    std::fs::write(dir.join("Dr Vibe sprite template.txt"), guide)
        .map_err(|e| format!("Failed to save template guide: {e}"))?;
    Ok(png_path.to_string_lossy().into_owned())
}

/// `base`, or the first of `base-2`, `base-3`, ... that `taken` says is free.
pub(crate) fn unique_slug(base: &str, taken: impl Fn(&str) -> bool) -> Result<String, String> {
    if !taken(base) {
        return Ok(base.to_string());
    }
    (2..1000)
        .map(|n| format!("{base}-{n}"))
        .find(|s| !taken(s))
        .ok_or_else(|| "Too many Dr. Vibes with that name; pick another one".to_string())
}

/// True if a skin called `slug` exists, in the player's folder or bundled.
pub(crate) fn slug_taken(app_handle: &tauri::AppHandle, slug: &str) -> bool {
    resolve_custom_skins_dir(app_handle)
        .map(|d| d.join(format!("{slug}.png")).exists())
        .unwrap_or(false)
        || is_bundled_skin(app_handle, slug)
}

/// Copy `<slug>.png` and its sidecar from `from` into `to` as
/// `<slug>.png` (or `<slug> (2).png`, ... when that name is in use) and
/// return the PNG's path.
pub(crate) fn export_skin_files(from: &Path, to: &Path, slug: &str) -> Result<PathBuf, String> {
    let png = from.join(format!("{slug}.png"));
    if !png.exists() {
        return Err(format!("Skin not found: {slug}"));
    }
    let stem = (1..1000)
        .map(|n| {
            if n == 1 {
                slug.to_string()
            } else {
                format!("{slug} ({n})")
            }
        })
        .find(|stem| !to.join(format!("{stem}.png")).exists())
        .ok_or("Too many exports with that name")?;
    let out = to.join(format!("{stem}.png"));
    std::fs::copy(&png, &out).map_err(|e| format!("Failed to export: {e}"))?;
    let anim = from.join(format!("{slug}.anim.json"));
    if anim.exists() {
        std::fs::copy(&anim, to.join(format!("{stem}.anim.json")))
            .map_err(|e| format!("Failed to export the sidecar: {e}"))?;
    }
    Ok(out)
}

/// "Make your own Dr. Vibe" → Export: copy a skin's sheet (and sidecar) to
/// the Downloads folder and return the PNG path so the UI can reveal it.
#[tauri::command]
pub(crate) fn export_skin(slug: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") {
        return Err("Invalid skin name".to_string());
    }
    let custom = resolve_custom_skins_dir(&app_handle)?;
    let from = if custom.join(format!("{slug}.png")).exists() {
        custom
    } else {
        resolve_default_skins_dir(&app_handle).ok_or_else(|| format!("Skin not found: {slug}"))?
    };
    let to = app_handle
        .path()
        .download_dir()
        .or_else(|_| app_handle.path().desktop_dir())
        .or_else(|_| app_handle.path().home_dir())
        .map_err(|e| format!("No folder to save into: {e}"))?;
    export_skin_files(&from, &to, &slug).map(|p| p.to_string_lossy().into_owned())
}

/// True if `slug` is one of the bundled Lab Originals.
pub(crate) fn is_bundled_skin(app_handle: &tauri::AppHandle, slug: &str) -> bool {
    resolve_default_skins_dir(app_handle)
        .map(|d| d.join(format!("{slug}.png")).exists())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TempDir;

    fn blank_sheet(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&vec![120u8; (width * height * 4) as usize])
                .unwrap();
        }
        out
    }

    #[test]
    fn personal_provenance_is_scrubbed_from_json_and_pngs() {
        let anim = r#"{"vibeId":"abc","generation":{"agent":"claude","generatedBy":"jdoe","model":"claude-code"}}"#;
        let clean: serde_json::Value = serde_json::from_str(&scrub_anim_json(anim)).unwrap();
        assert!(clean["generation"].get("generatedBy").is_none());
        assert_eq!(clean["generation"]["agent"], "claude");
        assert_eq!(clean["vibeId"], "abc");

        // Nothing to remove, or not JSON: unchanged.
        let plain = r#"{"vibeId":"abc","generation":{"agent":"claude"}}"#;
        assert_eq!(scrub_anim_json(plain), plain);
        assert_eq!(scrub_anim_json("not json"), "not json");

        let baked = encode_anim_into_png(&blank_sheet(128, 544), anim).unwrap();
        let rebaked = scrub_png(baked);
        let json = decode_anim_from_png(&rebaked).unwrap();
        assert!(!json.contains("generatedBy") && !json.contains("jdoe"));
        assert!(json.contains("\"vibeId\":\"abc\""));

        let untouched = blank_sheet(128, 544);
        assert_eq!(scrub_png(untouched.clone()), untouched);
    }

    #[test]
    fn generated_metadata_never_names_the_user() {
        let tmp = TempDir::new("meta");
        let dir = tmp.path().to_path_buf();
        std::fs::write(
            dir.join("neon.anim.json"),
            r#"{"generation":{"generatedBy":"jdoe"}}"#,
        )
        .unwrap();
        write_skin_metadata(
            &dir,
            "neon",
            "generated",
            None,
            Some("codex"),
            Some("a neon coat"),
            None,
        );
        let anim: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("neon.anim.json")).unwrap())
                .unwrap();
        assert!(anim["generation"].get("generatedBy").is_none());
        assert_eq!(anim["generation"]["agent"], "codex");
        assert_eq!(anim["generation"]["prompt"], "a neon coat");
    }

    #[test]
    fn anim_json_round_trips_through_the_png() {
        let png = blank_sheet(128, 544);
        let anim =
            r#"{"vibeId":"abc","name":"Neon Vibe ✨","animations":{"idle":{"frameCount":3}}}"#;
        let baked = encode_anim_into_png(&png, anim).unwrap();
        assert_eq!(decode_anim_from_png(&baked).as_deref(), Some(anim));
    }

    #[test]
    fn plain_png_has_no_embedded_config() {
        assert_eq!(decode_anim_from_png(&blank_sheet(128, 544)), None);
    }

    #[test]
    fn oversized_config_is_refused() {
        let png = blank_sheet(4, 4);
        assert!(encode_anim_into_png(&png, &"x".repeat(1000)).is_err());
    }

    #[test]
    fn lsb_bytes_round_trip() {
        let mut pixels = vec![200u8; 64 * 4];
        lsb_write_bytes(&mut pixels, 4, b"DRVB hi");
        assert_eq!(lsb_read_bytes(&pixels, 4, 7), b"DRVB hi");
    }

    #[test]
    fn vibe_ids_are_added_once() {
        let mut v = serde_json::json!({ "name": "x" });
        assert!(ensure_vibe_id_in_anim_value(&mut v));
        let id = v["vibeId"].as_str().unwrap().to_string();
        assert!(!ensure_vibe_id_in_anim_value(&mut v));
        assert_eq!(v["vibeId"], id.as_str());
    }

    #[test]
    fn bundled_skins_resolve_from_the_resource_dir() {
        let res = PathBuf::from("res");
        let candidates = default_skins_candidates(Some(res.clone()));
        assert_eq!(
            candidates.last(),
            Some(&res.join("assets").join("sprites").join("skins"))
        );
        // Only debug builds look at the source tree.
        let cwd_relative = candidates
            .iter()
            .filter(|p| p.is_relative() && !p.starts_with("res"));
        assert_eq!(cwd_relative.count() > 0, cfg!(debug_assertions));
        assert!(default_skins_candidates(None)
            .iter()
            .all(|p| !p.starts_with("res")));
    }

    #[test]
    fn bundled_skins_stay_listed_next_to_custom_ones() {
        let entry = |slug: &str, d: bool| serde_json::json!({ "slug": slug, "isDefault": d });
        let merged = merge_skin_lists(
            vec![entry("dr-vibe-alien", true), entry("dr-vibe-default", true)],
            vec![entry("dr-vibe-alien", false), entry("my-vibe", false)],
        );
        let slugs: Vec<(&str, bool)> = merged
            .iter()
            .map(|v| {
                (
                    v["slug"].as_str().unwrap(),
                    v["isDefault"].as_bool().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            slugs,
            vec![
                ("dr-vibe-default", true),
                ("dr-vibe-alien", false),
                ("my-vibe", false)
            ]
        );
    }

    #[test]
    fn unique_slugs_skip_taken_names() {
        let taken = ["my-vibe", "my-vibe-2", "dr-vibe-default"];
        let is_taken = |s: &str| taken.contains(&s);
        assert_eq!(unique_slug("fresh", is_taken).unwrap(), "fresh");
        assert_eq!(unique_slug("my-vibe", is_taken).unwrap(), "my-vibe-3");
        assert_eq!(
            unique_slug("dr-vibe-default", is_taken).unwrap(),
            "dr-vibe-default-2"
        );
        assert!(unique_slug("x", |_| true).is_err());
    }

    #[test]
    fn exports_keep_earlier_downloads() {
        let tmp = TempDir::new("export");
        let root = tmp.path().to_path_buf();
        let (skins, downloads) = (root.join("skins"), root.join("downloads"));
        std::fs::create_dir_all(&skins).unwrap();
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::write(skins.join("neon.png"), b"png").unwrap();
        std::fs::write(skins.join("neon.anim.json"), b"{}").unwrap();

        let first = export_skin_files(&skins, &downloads, "neon").unwrap();
        let second = export_skin_files(&skins, &downloads, "neon").unwrap();
        assert_eq!(first, downloads.join("neon.png"));
        assert_eq!(second, downloads.join("neon (2).png"));
        assert!(downloads.join("neon (2).anim.json").exists());
        assert!(export_skin_files(&skins, &downloads, "missing").is_err());
    }
}
