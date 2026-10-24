//! `dr-vibe://` deep links: device linking (`auth/callback`) and one-click skin installs.
//!
//! Links arrive two ways — the deep-link plugin's `on_open_url` and, on
//! Windows, the argv of a second instance (forwarding between the two is
//! unreliable in dev builds) — and both are routed through `handle_url`.

use tauri::Emitter;

use crate::skins::download_and_save_skin;

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

/// dr-vibe://install-skin?slug=...&png=...&anim=...
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
        match download_and_save_skin(&app2, &slug, &png_url, anim_url.as_deref()).await {
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
