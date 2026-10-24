//! Server base URL resolution and the account token (OS keyring) plus profile commands.

use tauri::Emitter;

// ── OS Credential Store helpers ─────────────────────────────────────────────
// Tokens are stored in Windows Credential Manager / macOS Keychain / Linux
// Secret Service instead of the plaintext Tauri Store JSON file.

/// The app identifier: `tauri.conf.json` for release builds, and the
/// `tauri.dev.conf.json` overlay `npm run dev` uses for debug builds, so a dev
/// build never shares the installed app's data, keyring token or notifications.
pub(crate) const APP_ID: &str = if cfg!(debug_assertions) {
    "com.drvibe.companion.dev"
} else {
    "com.drvibe.companion"
};
pub(crate) const KEYRING_SERVICE: &str = APP_ID;
pub(crate) const KEYRING_TOKEN_USER: &str = "device-token";
/// Pre-2.0 keyring entry (a Quads Lab token the 2.0 server never accepts).
const LEGACY_KEYRING_TOKEN_USER: &str = "discord-token";

/// Base URL for the Dr. Vibe web server.
/// Single source of truth for the Rust side — keep in sync with src/core/config.js.
///
/// Unlike a traditional OnceLock<&'static str>, this is mutable at runtime
/// so the Admin → Dev Server panel can hot-swap the server without a full
/// process restart. The lock is first initialized at the top of setup() by
/// `seed_web_base_url_from_store` (env var > persisted override > default),
/// and subsequently overwritten by the `set_web_base_override` command
/// when the admin clicks "Apply".
///
/// Resolution priority at STARTUP:
///   1. `DR_VIBE_WEB_BASE_URL` env var (debug builds only).
///   2. Persisted `devServerOverride` from dr-vibe-data.json.
///   3. Compiled-in default — the local website server for debug, drvibe.io for release.
pub(crate) static WEB_BASE_URL_LOCK: std::sync::OnceLock<std::sync::RwLock<String>> =
    std::sync::OnceLock::new();

pub(crate) fn default_web_base_url() -> String {
    #[cfg(not(debug_assertions))]
    {
        "https://drvibe.io".to_string()
    }
    #[cfg(debug_assertions)]
    {
        match std::env::var("DR_VIBE_WEB_BASE_URL") {
            Ok(url) if !url.is_empty() => url,
            _ => "http://localhost:8080".to_string(),
        }
    }
}

/// Resolves a developer-panel override value to a concrete URL. Server
/// switching exists only in debug builds: a release binary always talks to
/// production, whatever is persisted in the store.
pub(crate) fn resolve_override(override_value: &str) -> Option<String> {
    match override_value {
        "production" => Some("https://drvibe.io".to_string()),
        "auto" => Some(default_web_base_url()),
        #[cfg(debug_assertions)]
        "localhost" => Some("http://localhost:8080".to_string()),
        #[cfg(debug_assertions)]
        s if s.starts_with("custom:") => {
            let u = s["custom:".len()..].trim();
            if u.is_empty() {
                None
            } else {
                Some(u.to_string())
            }
        }
        _ => None,
    }
}

pub(crate) fn web_base_url() -> String {
    WEB_BASE_URL_LOCK
        .get_or_init(|| std::sync::RwLock::new(default_web_base_url()))
        .read()
        .unwrap()
        .clone()
}

pub(crate) fn seed_web_base_url_from_store(app: &tauri::AppHandle) {
    // Env var always wins in debug builds.
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var("DR_VIBE_WEB_BASE_URL") {
            if !url.is_empty() {
                let _ = WEB_BASE_URL_LOCK.set(std::sync::RwLock::new(url));
                return;
            }
        }
    }

    // Otherwise read the persisted override from the Tauri store.
    let initial: Option<String> = {
        use tauri_plugin_store::StoreExt;
        app.store("dr-vibe-data.json")
            .ok()
            .and_then(|store| store.get("settings"))
            .and_then(|settings| {
                settings
                    .get("devServerOverride")
                    .and_then(|v| v.as_str().map(String::from))
            })
            .and_then(|override_val| resolve_override(&override_val))
    };

    let url = initial.unwrap_or_else(default_web_base_url);
    // First-writer wins — if web_base_url() has already been called
    // elsewhere (shouldn't happen from setup()), overwrite in place.
    if WEB_BASE_URL_LOCK
        .set(std::sync::RwLock::new(url.clone()))
        .is_err()
    {
        if let Some(lock) = WEB_BASE_URL_LOCK.get() {
            *lock.write().unwrap() = url;
        }
    }
}

/// Returns the web base URL Rust is currently using. JS calls this once
/// at boot so its `WEB_BASE` mirrors whatever Rust resolved (env-var
/// override `DR_VIBE_WEB_BASE_URL`, persisted store override, or compiled
/// default). Without this, a `npm run dev:prod` would point Rust at prod
/// while JS still defaulted to dev based on the live-server port check.
#[tauri::command]
pub(crate) fn get_web_base_url() -> String {
    web_base_url()
}

/// Debug builds only (see `resolve_override`): hot-swap the runtime web_base_url to match the given
/// override value. Called by the Admin → Dev Server panel so the user
/// can switch between production / dev / localhost without a process
/// restart. Returns the resolved URL so JS can update its own copy and
/// display it in the admin panel.
#[tauri::command]
pub(crate) fn set_web_base_override(override_value: String) -> Result<String, String> {
    let url = resolve_override(&override_value)
        .ok_or_else(|| format!("invalid dev server override: {override_value}"))?;

    let lock = WEB_BASE_URL_LOCK.get_or_init(|| std::sync::RwLock::new(url.clone()));
    *lock
        .write()
        .map_err(|e| format!("web_base_url lock poisoned: {e}"))? = url.clone();

    eprintln!("[set_web_base_override] switched to {url}");
    Ok(url)
}

pub(crate) fn store_token(token: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .map_err(|e| format!("Keyring entry error: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| format!("Keyring store error: {e}"))
}

pub(crate) fn get_token() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .map_err(|e| format!("Keyring entry error: {e}"))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring read error: {e}")),
    }
}

pub(crate) fn delete_token() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_TOKEN_USER)
        .map_err(|e| format!("Keyring entry error: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(format!("Keyring delete error: {e}")),
    }
}

/// The linked account as the webviews see it. The device token itself never
/// leaves Rust: `linked` says whether one is stored.
#[tauri::command]
pub(crate) fn get_profile(app_handle: tauri::AppHandle) -> serde_json::Value {
    use tauri_plugin_store::StoreExt;
    let profile = app_handle
        .store(STORE_FILE)
        .ok()
        .and_then(|store| store.get("profile"));
    let field = |k: &str| {
        profile
            .as_ref()
            .and_then(|v| v.get(k).and_then(|u| u.as_str().map(String::from)))
    };
    let linked = get_token().ok().flatten().is_some();
    serde_json::json!({
        "linked":      linked,
        "userId":      if linked { field("userId") } else { None },
        "username":    if linked { field("username") } else { None },
        "displayName": if linked { field("displayName") } else { None },
        "avatarUrl":   if linked { field("avatarUrl") } else { None },
    })
}

const STORE_FILE: &str = "dr-vibe-data.json";

/// The stored profile with the server's current name and picture, or `None`
/// when nothing changed. Other keys (userId, deviceId) are kept. Only
/// http(s) picture URLs are stored.
pub(crate) fn merge_profile(
    stored: &serde_json::Value,
    username: &str,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Option<serde_json::Value> {
    let clean = |v: Option<&str>| v.filter(|s| !s.is_empty()).map(String::from);
    let avatar = clean(avatar_url).filter(|u| {
        let l = u.to_ascii_lowercase();
        l.starts_with("https://") || l.starts_with("http://")
    });
    let next = [
        ("username", clean(Some(username))),
        ("displayName", clean(display_name)),
        ("avatarUrl", avatar),
    ];
    let mut out = match stored {
        serde_json::Value::Object(m) => m.clone(),
        _ => serde_json::Map::new(),
    };
    let mut changed = false;
    for (key, value) in next {
        let current = out.get(key).and_then(|v| v.as_str()).map(String::from);
        if current != value {
            changed = true;
            out.insert(
                key.into(),
                value.map_or(serde_json::Value::Null, serde_json::Value::String),
            );
        }
    }
    changed.then_some(serde_json::Value::Object(out))
}

/// The poll saw the account's current name or picture: store it if it
/// changed and emit `account-profile-updated` `{ username, displayName,
/// avatarUrl }`. Returns whether anything changed. Ignored while unlinked.
#[tauri::command]
pub(crate) fn update_profile(
    app_handle: tauri::AppHandle,
    username: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<bool, String> {
    use tauri_plugin_store::StoreExt;
    if username.is_empty() || get_token().ok().flatten().is_none() {
        return Ok(false);
    }
    let store = app_handle
        .store(STORE_FILE)
        .map_err(|e| format!("Store error: {e}"))?;
    let stored = store.get("profile").unwrap_or(serde_json::json!({}));
    let Some(next) = merge_profile(
        &stored,
        &username,
        display_name.as_deref(),
        avatar_url.as_deref(),
    ) else {
        return Ok(false);
    };
    let payload = serde_json::json!({
        "username": next.get("username"),
        "displayName": next.get("displayName"),
        "avatarUrl": next.get("avatarUrl"),
    });
    store.set("profile", next);
    let _ = store.save();
    crate::api::emit_account(&app_handle, "account-profile-updated", payload);
    Ok(true)
}

/// Drop the device token and the cached profile, and tell every window.
/// Used on "Sign out" and when the server says the token is revoked.
pub(crate) fn forget_device(app: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Err(e) = delete_token() {
        eprintln!("[account] could not delete the device token: {e}");
    }
    if let Ok(store) = app.store(STORE_FILE) {
        store.set("profile", serde_json::json!({}));
        let _ = store.save();
    }
    // AccountState in the main window drops to unlinked: polling, VP and
    // community features pause.
    let _ = app.emit("account-unlinked", ());
}

/// Sign out: revoke this device's token on the server (best effort), then
/// forget it locally.
#[tauri::command]
pub(crate) async fn disconnect_profile(app_handle: tauri::AppHandle) -> Result<(), String> {
    if get_token().ok().flatten().is_some() {
        let r = crate::api::send(
            crate::api::Ctx::App(&app_handle),
            crate::api::Call::new(reqwest::Method::POST, "/desktop/unlink")
                .json(&serde_json::json!({})),
        )
        .await;
        if !r.ok {
            eprintln!(
                "[account] unlink on the server failed (status {}); forgetting locally",
                r.status
            );
        }
    }
    forget_device(&app_handle);
    Ok(())
}

/// Remove the pre-2.0 token (keyring entry or plaintext store field). It was
/// a Quads Lab token; the 2.0 server only accepts `dvd_` device tokens.
pub(crate) fn migrate_legacy_token(app: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, LEGACY_KEYRING_TOKEN_USER) {
        let _ = entry.delete_credential();
    }
    if let Ok(store) = app.store(STORE_FILE) {
        if let Some(profile) = store.get("profile") {
            if profile.get("discordToken").is_some() || profile.get("discordUsername").is_some() {
                store.set("profile", serde_json::json!({}));
                let _ = store.save();
            }
        }
    }
}

// ── Device linking (API.md §2) ───────────────────────────────────────────
//
// 1. `start_device_link` makes a PKCE verifier, keeps it in memory and
//    opens `{site}/connect?codeChallenge&installId&deviceName&platform&appVersion`.
// 2. The site signs the player in and redirects to
//    `dr-vibe://auth/callback?code=...` (handled in deeplink.rs).
// 3. `complete_device_link` posts `{ code, codeVerifier, installId }` to
//    `/desktop/link/exchange` and stores the `dvd_` token in the keyring.

struct PendingLink {
    verifier: String,
    started: std::time::Instant,
}

fn pending_link() -> &'static std::sync::Mutex<Option<PendingLink>> {
    static PENDING: std::sync::OnceLock<std::sync::Mutex<Option<PendingLink>>> =
        std::sync::OnceLock::new();
    PENDING.get_or_init(|| std::sync::Mutex::new(None))
}

/// Codes are valid for 10 minutes server-side; keep the verifier as long.
const LINK_TTL: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Stable random id for this install (re-linking it rotates the token).
pub(crate) fn install_id(app: &tauri::AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    let store = app.store(STORE_FILE).ok();
    if let Some(id) = store
        .as_ref()
        .and_then(|s| s.get("installId"))
        .and_then(|v| v.as_str().map(String::from))
    {
        if is_valid_install_id(&id) {
            return id;
        }
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    if let Some(s) = store {
        s.set("installId", serde_json::json!(id));
        let _ = s.save();
    }
    id
}

/// 8-64 chars of `[A-Za-z0-9_-]` (the server's rule).
pub(crate) fn is_valid_install_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// PKCE verifier: 64 chars of `[0-9a-f]` (RFC 7636 allows 43-128 unreserved).
pub(crate) fn new_code_verifier() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn platform() -> drvibe_protocol::device::Platform {
    use drvibe_protocol::device::Platform;
    if cfg!(target_os = "windows") {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::Macos
    } else if cfg!(target_os = "linux") {
        Platform::Linux
    } else {
        Platform::Other
    }
}

/// The name this device gets on the website ("Dr. Vibe on Windows"). It
/// deliberately leaves out the computer's own name, which often contains the
/// owner's real name.
fn device_name() -> String {
    device_name_for(platform())
}

fn device_name_for(platform: drvibe_protocol::device::Platform) -> String {
    let os = match platform {
        drvibe_protocol::device::Platform::Windows => "Windows",
        drvibe_protocol::device::Platform::Macos => "macOS",
        drvibe_protocol::device::Platform::Linux => "Linux",
        drvibe_protocol::device::Platform::Other => "desktop",
    };
    format!("Dr. Vibe on {os}")
}

/// The `/connect` URL for a link attempt.
pub(crate) fn connect_url(
    base: &str,
    params: &drvibe_protocol::device::ConnectParams,
    provider: Option<&str>,
) -> String {
    let mut url = url::Url::parse(&format!("{base}/connect")).expect("site base URL is valid");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("codeChallenge", &params.code_challenge);
        q.append_pair("installId", &params.install_id);
        q.append_pair("deviceName", &params.device_name);
        let platform = serde_json::to_value(params.platform)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        q.append_pair("platform", &platform);
        if let Some(v) = &params.app_version {
            q.append_pair("appVersion", v);
        }
        // Not part of ConnectParams: a hint for which sign-in button the
        // page should put first. Pages that don't know it ignore it.
        if let Some(p) = provider.filter(|p| *p == "github" || *p == "discord") {
            q.append_pair("provider", p);
        }
    }
    url.to_string()
}

/// A fresh PKCE verifier and the `/connect` URL carrying its challenge.
pub(crate) fn new_link(
    base: &str,
    install_id: String,
    app_version: String,
    provider: Option<&str>,
) -> (String, String) {
    let verifier = new_code_verifier();
    let params = drvibe_protocol::device::ConnectParams {
        code_challenge: drvibe_protocol::signing::pkce_challenge(&verifier),
        install_id,
        device_name: device_name(),
        platform: platform(),
        app_version: Some(app_version),
    };
    let url = connect_url(base, &params, provider);
    (verifier, url)
}

/// Start linking: open the browser at `/connect`. `provider` ("github" /
/// "discord") is only a hint for the page.
#[tauri::command]
pub(crate) fn start_device_link(
    app_handle: tauri::AppHandle,
    provider: Option<String>,
) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let (verifier, url) = new_link(
        &web_base_url(),
        install_id(&app_handle),
        app_handle.package_info().version.to_string(),
        provider.as_deref(),
    );
    *pending_link().lock().map_err(|e| e.to_string())? = Some(PendingLink {
        verifier,
        started: std::time::Instant::now(),
    });
    app_handle
        .opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))?;
    Ok(url)
}

/// Exchange the deep-link code for a device token and store it. Emits
/// `account-linked` `{ username, displayName, avatarUrl, firstLink }`, or
/// `account-link-error` `{ message }`.
pub(crate) async fn complete_device_link(app: tauri::AppHandle, code: String) {
    let verifier = {
        let mut guard = match pending_link().lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        match guard.take() {
            Some(p) if p.started.elapsed() < LINK_TTL => Some(p.verifier),
            _ => None,
        }
    };
    let Some(verifier) = verifier else {
        crate::api::emit_account(
            &app,
            "account-link-error",
            serde_json::json!({
                "message": "That link expired. Click Join the community again."
            }),
        );
        return;
    };
    match exchange_link_code(&app, &code, &verifier).await {
        Ok(resp) => {
            crate::api::emit_account(
                &app,
                "account-linked",
                serde_json::json!({
                    "username": resp.user.username,
                    "displayName": resp.user.display_name,
                    "avatarUrl": resp.user.avatar_url,
                    "firstLink": resp.first_link,
                }),
            );
        }
        Err(message) => {
            eprintln!("[account] link exchange failed: {message}");
            crate::api::emit_account(
                &app,
                "account-link-error",
                serde_json::json!({ "message": message }),
            );
        }
    }
}

/// Exchange the code, then store the token and profile.
pub(crate) async fn exchange_link_code(
    app: &tauri::AppHandle,
    code: &str,
    verifier: &str,
) -> Result<drvibe_protocol::device::LinkExchangeResponse, String> {
    use tauri_plugin_store::StoreExt;
    let resp = exchange(code, verifier, &install_id(app)).await?;
    store_token(&resp.token)?;
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(
            "profile",
            serde_json::json!({
                "userId": resp.user.id,
                "username": resp.user.username,
                "displayName": resp.user.display_name,
                "avatarUrl": resp.user.avatar_url,
                "deviceId": resp.device.id,
            }),
        );
        let _ = store.save();
    }
    Ok(resp)
}

/// `POST /desktop/link/exchange` (no token yet). Errors are player-facing.
pub(crate) async fn exchange(
    code: &str,
    verifier: &str,
    install_id: &str,
) -> Result<drvibe_protocol::device::LinkExchangeResponse, String> {
    let body = drvibe_protocol::device::LinkExchangeRequest {
        code: code.to_string(),
        code_verifier: verifier.to_string(),
        install_id: install_id.to_string(),
    };
    let call = crate::api::Call::new(reqwest::Method::POST, "/desktop/link/exchange").json(&body);
    let r = crate::api::send(crate::api::Ctx::Token(None), call).await;
    if !r.ok {
        return Err(match (r.status, r.error.as_deref()) {
            (0, _) => "Could not reach drvibe.io. Check your connection and try again.".to_string(),
            (_, Some("invalid_link_code")) => {
                "That link code was already used or expired. Try again.".to_string()
            }
            (_, Some("rate_limited")) => {
                "Too many tries. Wait a few minutes and try again.".to_string()
            }
            (s, e) => format!("Linking failed ({s} {}).", e.unwrap_or("error")),
        });
    }
    let resp: drvibe_protocol::device::LinkExchangeResponse =
        serde_json::from_value(r.data).map_err(|e| format!("Unexpected link response: {e}"))?;
    if !resp
        .token
        .starts_with(drvibe_protocol::device::DEVICE_TOKEN_PREFIX)
    {
        return Err("The server sent an unexpected token.".to_string());
    }
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_id_matches_the_tauri_configs() {
        let id = |json: &str| {
            serde_json::from_str::<serde_json::Value>(json).unwrap()["identifier"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let release = id(include_str!("../tauri.conf.json"));
        let dev = id(include_str!("../tauri.dev.conf.json"));
        assert_eq!(release, "com.drvibe.companion");
        assert_ne!(dev, release);
        // Tests are debug builds, which use the dev overlay's identifier.
        assert_eq!(APP_ID, dev);
    }

    #[test]
    fn device_name_never_includes_the_computer_name() {
        use drvibe_protocol::device::Platform;
        assert_eq!(device_name_for(Platform::Windows), "Dr. Vibe on Windows");
        assert_eq!(device_name_for(Platform::Macos), "Dr. Vibe on macOS");
        if let Ok(host) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
            assert!(!device_name().contains(&host));
        }
    }

    #[test]
    fn profile_merge_only_reports_real_changes() {
        let stored = serde_json::json!({
            "userId": "u1", "deviceId": "d1", "username": "dhack",
            "displayName": "DHack", "avatarUrl": "https://cdn.discordapp.com/avatars/1/old.png",
        });
        assert_eq!(
            merge_profile(
                &stored,
                "dhack",
                Some("DHack"),
                Some("https://cdn.discordapp.com/avatars/1/old.png")
            ),
            None
        );
        let next = merge_profile(
            &stored,
            "dhack",
            Some("DHack"),
            Some("https://avatars.githubusercontent.com/u/2?v=4"),
        )
        .unwrap();
        assert_eq!(
            next["avatarUrl"],
            "https://avatars.githubusercontent.com/u/2?v=4"
        );
        assert_eq!(next["userId"], "u1");
        assert_eq!(next["deviceId"], "d1");
        // The Dr. Vibe sprite was chosen: the picture clears.
        let next = merge_profile(&stored, "dhack", None, None).unwrap();
        assert!(next["avatarUrl"].is_null());
        assert!(next["displayName"].is_null());
        // Non-http pictures are never stored.
        let next =
            merge_profile(&stored, "dhack", Some("DHack"), Some("javascript:alert(1)")).unwrap();
        assert!(next["avatarUrl"].is_null());
    }
    #[test]
    fn production_override_always_resolves() {
        assert_eq!(
            resolve_override("production").as_deref(),
            Some("https://drvibe.io")
        );
        assert!(resolve_override("nonsense").is_none());
    }

    #[test]
    fn connect_url_carries_the_pkce_params() {
        let verifier = new_code_verifier();
        assert!((43..=128).contains(&verifier.len()));
        let challenge = drvibe_protocol::signing::pkce_challenge(&verifier);
        assert_eq!(challenge.len(), 43);
        let params = drvibe_protocol::device::ConnectParams {
            code_challenge: challenge.clone(),
            install_id: "abcdef1234567890".into(),
            device_name: "PC (Windows)".into(),
            platform: drvibe_protocol::device::Platform::Windows,
            app_version: Some("2.0.0".into()),
        };
        let url = url::Url::parse(&connect_url(
            "http://localhost:8080",
            &params,
            Some("github"),
        ))
        .unwrap();
        assert_eq!(url.path(), "/connect");
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["codeChallenge"], challenge);
        assert_eq!(q["installId"], "abcdef1234567890");
        assert_eq!(q["deviceName"], "PC (Windows)");
        assert_eq!(q["platform"], "windows");
        assert_eq!(q["appVersion"], "2.0.0");
        assert_eq!(q["provider"], "github");
        let plain = connect_url("http://localhost:8080", &params, Some("evil"));
        assert!(!plain.contains("provider="));
    }

    #[test]
    fn install_ids_follow_the_server_rule() {
        assert!(is_valid_install_id(
            &uuid::Uuid::new_v4().simple().to_string()
        ));
        assert!(!is_valid_install_id("short"));
        assert!(!is_valid_install_id("has spaces in it!"));
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_builds_cannot_switch_servers() {
        assert!(resolve_override("dev").is_none());
        assert!(resolve_override("localhost").is_none());
        assert!(resolve_override("custom:https://evil.example").is_none());
    }
}
