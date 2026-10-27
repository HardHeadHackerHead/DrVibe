//! `dr-vibe://` deep links: device linking (`auth/callback`) and one-click skin installs.
//!
//! Links arrive two ways — the deep-link plugin's `on_open_url` and, on
//! Windows, the argv of a second instance (forwarding between the two is
//! unreliable in dev builds) — and both are routed through `handle_url`.

use tauri::Emitter;

use crate::skins::{
    fetch_linked_skin, linked_skin_exists, resolve_custom_skins_dir, save_linked_skin,
};

pub(crate) const SCHEME: &str = "dr-vibe";

/// Handle one `dr-vibe://...` URL. Anything else is ignored.
pub(crate) fn handle_url(app: &tauri::AppHandle, raw_url: &str) {
    if let Some(code) = link_code_from_url(raw_url) {
        handle_link_callback(app, code);
        return;
    }
    let u: url::Url = match raw_url.parse() {
        Ok(u) => u,
        Err(_) => return,
    };
    if u.scheme() != SCHEME {
        return;
    }
    let params: std::collections::HashMap<String, String> = u
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if u.host_str() == Some("install-skin") {
        handle_install_skin(app, &params);
    }
}

/// `code` of a `dr-vibe://auth/callback?code=...` URL, if it looks sane;
/// None for any other URL.
pub(crate) fn link_code_from_url(raw_url: &str) -> Option<String> {
    let u: url::Url = raw_url.parse().ok()?;
    if u.scheme() != SCHEME || (u.host_str(), u.path()) != (Some("auth"), "/callback") {
        return None;
    }
    u.query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .filter(|c| !c.is_empty() && c.len() <= 256)
}

/// dr-vibe://auth/callback?code=...
/// The site sends the player here after they approve "Connect this
/// computer"; the one-time code is exchanged for a device token (API.md §2).
fn handle_link_callback(app: &tauri::AppHandle, code: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::account::complete_device_link(app, code).await;
    });
}

/// The question asked before a linked skin is written.
pub(crate) fn install_question(name: &str, replaces: bool) -> (String, &'static str) {
    if replaces {
        (
            format!("A Dr. Vibe skin called \u{201c}{name}\u{201d} is already installed. Replace it with the one from drvibe.io?"),
            "Replace",
        )
    } else {
        (
            format!("Install the Dr. Vibe skin \u{201c}{name}\u{201d} from drvibe.io?"),
            "Install",
        )
    }
}

/// dr-vibe://install-skin?slug=...&png=...&anim=...
/// Any web page can open this link, so the download must come from
/// drvibe.io, pass the size and format checks (skins.rs fetch_linked_skin)
/// and the player confirms before anything is written or replaced.
fn handle_install_skin(app: &tauri::AppHandle, params: &std::collections::HashMap<String, String>) {
    let slug = match params.get("slug").filter(|s| !s.is_empty()) {
        Some(s) => s.clone(),
        None => return,
    };
    let png_url = match params.get("png").filter(|s| !s.is_empty()) {
        Some(s) => s.clone(),
        None => return,
    };
    let anim_url = params.get("anim").cloned().filter(|s| !s.is_empty());
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let skin = fetch_linked_skin(&slug, &png_url, anim_url.as_deref()).await?;
            let dir = resolve_custom_skins_dir(&app2)?;
            let (question, ok) = install_question(&skin.name, linked_skin_exists(&dir, &skin.slug));
            if !crate::system::confirm(&app2, "Install a Dr. Vibe skin", question, ok).await {
                return Err("cancelled".to_string());
            }
            let was_update = save_linked_skin(&dir, &skin)?;
            Ok::<_, String>((skin.slug, was_update))
        }
        .await;
        match result {
            Err(e) if e == "cancelled" => {}
            Ok((final_slug, was_update)) => {
                let _ = app2.emit(
                    "skin-installed",
                    serde_json::json!({
                        "slug": final_slug,
                        "updated": was_update,
                    }),
                );
            }
            Err(e) => {
                eprintln!("[dr-vibe] deep link install failed: {e}");
                let _ = app2.emit(
                    "skin-install-error",
                    serde_json::json!({
                        "slug": slug,
                        "error": e,
                    }),
                );
            }
        }
    });
}

/// Register the URL handler (and, in dev builds, the scheme itself).
pub(crate) fn init(app: &tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;
    // In dev mode, register the protocol so the OS knows to route it here.
    #[cfg(debug_assertions)]
    {
        let _ = app.deep_link().register(SCHEME);
    }
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for raw_url in event.urls() {
            handle_url(&handle, raw_url.as_str());
        }
    });
}

#[cfg(test)]
mod tests {
    use crate::skins::{check_link_slug, check_linked_anim, check_linked_png, check_skin_link_url};

    #[test]
    fn skin_links_download_only_from_drvibe() {
        for ok in [
            "https://drvibe.io/api/v1/gallery/x/sprite.png",
            "https://cdn.drvibe.io/skins/x.png?v=2",
            "https://CDN.drvibe.io/a.png",
        ] {
            assert!(check_skin_link_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://drvibe.io/a.png",
            "https://drvibe.io.evil.com/a.png",
            "https://evil.com/drvibe.io/a.png",
            "https://img.drvibe.io/a.png",
            "https://drvibe.io:8443/a.png",
            "https://user@drvibe.io/a.png",
            "https://localhost/a.png",
            "https://192.168.1.10/a.png",
            "file:///C:/a.png",
            "not a url",
        ] {
            assert!(check_skin_link_url(bad).is_err(), "{bad}");
        }
        assert!(check_link_slug("santa-claus_2").is_ok());
        for bad in ["", "../x", "a/b", "a b", &"x".repeat(81)] {
            assert!(check_link_slug(bad).is_err(), "{bad:?}");
        }
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()
            .unwrap()
            .write_image_data(&vec![0u8; (width * height * 4) as usize])
            .unwrap();
        out
    }

    #[test]
    fn linked_files_are_checked_before_anything_is_written() {
        assert!(check_linked_png(&png(128, 544)).is_ok());
        assert!(check_linked_png(&png(128, 512)).is_ok());
        assert!(
            check_linked_png(&png(64, 64)).is_err(),
            "not a Dr. Vibe sheet size"
        );
        assert!(check_linked_png(b"GIF89a....").is_err());
        let mut big = png(128, 544);
        big.resize(crate::visitors::MAX_SPRITE_BYTES + 1, 0);
        assert!(check_linked_png(&big).is_err(), "over the size cap");
        assert!(check_linked_anim(br#"{"name":"Santa"}"#).is_ok());
        assert!(check_linked_anim(b"[1,2]").is_err());
        assert!(check_linked_anim(b"<html>").is_err());
        assert!(check_linked_anim(&vec![b' '; crate::visitors::MAX_ANIM_BYTES + 1]).is_err());
    }

    #[test]
    fn asks_before_installing_and_before_replacing() {
        let (q, ok) = super::install_question("Santa", false);
        assert!(q.contains("Install") && q.contains("Santa") && q.contains("drvibe.io"));
        assert_eq!(ok, "Install");
        let (q, ok) = super::install_question("Santa", true);
        assert!(q.contains("already installed") && q.contains("Replace"));
        assert_eq!(ok, "Replace");
    }

    #[test]
    fn link_callback_url_shape() {
        let u: url::Url = "dr-vibe://auth/callback?code=abc123".parse().unwrap();
        assert_eq!(u.scheme(), super::SCHEME);
        assert_eq!((u.host_str(), u.path()), (Some("auth"), "/callback"));
        let code = u
            .query_pairs()
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.into_owned());
        assert_eq!(code.as_deref(), Some("abc123"));
        assert!(drvibe_protocol::device::DEEP_LINK_CALLBACK.starts_with("dr-vibe://auth/callback"));
        assert_eq!(
            super::link_code_from_url("dr-vibe://auth/callback?code=abc123").as_deref(),
            Some("abc123")
        );
        assert_eq!(
            super::link_code_from_url("dr-vibe://install-skin?code=abc123"),
            None
        );
        assert_eq!(
            super::link_code_from_url("https://auth/callback?code=abc123"),
            None
        );
    }
}
