//! Sprite cache for visitors: other players' Dr. Vibes that walk onto this
//! desktop. Kept apart from the skin library (they are not the player's
//! skins) in the app cache dir, and evicted oldest-first.

use serde::Serialize;
use tauri::Manager;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

/// Sprite sheet limit from the sprite spec (PLAN → Sprite format).
pub(crate) const MAX_SPRITE_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_ANIM_BYTES: usize = 256 * 1024;
const MAX_CACHED_VISITORS: usize = 30;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisitorSprite {
    pub png_base64: String,
    pub anim_json: Option<String>,
}

/// Cache file stem for a visitor sprite: only [a-z0-9-], at most 64 chars.
pub(crate) fn cache_key(slug: &str) -> Option<String> {
    let key: String = slug
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if key.is_empty() {
        None
    } else {
        Some(key.chars().take(64).collect())
    }
}

pub(crate) fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_SPRITE_BYTES {
        return Err(format!(
            "sprite is {} bytes, over the 2 MB limit",
            bytes.len()
        ));
    }
    if bytes.len() < PNG_SIGNATURE.len() || bytes[..8] != PNG_SIGNATURE {
        return Err("sprite is not a PNG".to_string());
    }
    Ok(())
}

async fn fetch(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    if !(url.starts_with("https://") || (cfg!(debug_assertions) && url.starts_with("http://"))) {
        return Err("visitor sprites must be served over https".to_string());
    }
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if bytes.len() > limit {
        return Err("download too large".to_string());
    }
    Ok(bytes.to_vec())
}

fn evict_oldest(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut pngs: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("png"))
        .filter_map(|p| {
            std::fs::metadata(&p)
                .and_then(|m| m.modified())
                .ok()
                .map(|t| (t, p))
        })
        .collect();
    if pngs.len() <= MAX_CACHED_VISITORS {
        return;
    }
    pngs.sort_by_key(|(t, _)| *t);
    for (_, png) in pngs.iter().take(pngs.len() - MAX_CACHED_VISITORS) {
        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_file(png.with_extension("anim.json"));
    }
}

/// Download (once) and return a visitor's sprite sheet and sidecar.
#[tauri::command]
pub(crate) async fn cache_visitor_sprite(
    slug: String,
    png_url: String,
    anim_url: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<VisitorSprite, String> {
    let key = cache_key(&slug).ok_or("invalid visitor sprite slug")?;
    let dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache dir: {e}"))?
        .join("visitors");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cache dir: {e}"))?;
    let png_path = dir.join(format!("{key}.png"));
    let anim_path = dir.join(format!("{key}.anim.json"));

    let png = match std::fs::read(&png_path) {
        Ok(bytes) if validate_png(&bytes).is_ok() => bytes,
        _ => {
            let bytes = fetch(&png_url, MAX_SPRITE_BYTES + 1).await?;
            validate_png(&bytes)?;
            std::fs::write(&png_path, &bytes).map_err(|e| format!("cache write: {e}"))?;
            if let Some(url) = anim_url.as_deref().filter(|u| !u.is_empty()) {
                match fetch(url, MAX_ANIM_BYTES).await {
                    Ok(anim) if serde_json::from_slice::<serde_json::Value>(&anim).is_ok() => {
                        let _ = std::fs::write(&anim_path, &anim);
                    }
                    _ => eprintln!("[visitors] sidecar for {key} unavailable; using defaults"),
                }
            }
            evict_oldest(&dir);
            bytes
        }
    };
    let anim_json = std::fs::read_to_string(&anim_path).ok();
    Ok(VisitorSprite {
        png_base64: BASE64.encode(png),
        anim_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_keys_are_filesystem_safe() {
        assert_eq!(cache_key("Neon Vibe!!").as_deref(), Some("neon-vibe"));
        assert_eq!(cache_key("../../etc/passwd").as_deref(), Some("etc-passwd"));
        assert_eq!(cache_key("---"), None);
        assert_eq!(cache_key(&"a".repeat(200)).map(|k| k.len()), Some(64));
    }

    #[test]
    fn png_validation() {
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend_from_slice(&[0; 16]);
        assert!(validate_png(&png).is_ok());
        assert!(validate_png(b"GIF89a....").is_err());
        let mut big = PNG_SIGNATURE.to_vec();
        big.resize(MAX_SPRITE_BYTES + 1, 0);
        assert!(validate_png(&big).is_err());
    }
}
