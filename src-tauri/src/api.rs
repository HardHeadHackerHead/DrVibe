//! The desktop's one HTTP client for the Dr. Vibe API (`server/API.md`).
//!
//! Every call carries the per-device token (`Authorization: Bearer dvd_...`)
//! from the OS keyring; the token never reaches the webviews. Calls that
//! change state are signed (API.md §2): timestamp, nonce and an HMAC-SHA256
//! of the canonical request keyed by the token, via
//! `drvibe_protocol::signing::sign_request`.
//!
//! JS reaches the API through the typed commands at the bottom (payloads are
//! `drvibe_protocol` types, so a contract drift fails here, not in a
//! webview) and `api_request` for plain reads. Failures never throw: callers
//! get an [`ApiResponse`] with `status = 0` for network errors and
//! `unlinked = true` when there is no token.
//!
//! Each command is a thin wrapper over a function taking a [`Ctx`], so the
//! live end-to-end harness (`e2e_bridge.rs`) drives the same code with an
//! explicit token instead of the keyring.

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use drvibe_protocol::companion::EquipRequest;
use drvibe_protocol::device::{HEADER_NONCE, HEADER_SIGNATURE, HEADER_TIMESTAMP, HEADER_TIMEZONE};
use drvibe_protocol::economy::EconomyEventBatch;
use drvibe_protocol::poll::{AckRequest, PollResponse};
use drvibe_protocol::privacy::PrivacySettingsPatch;
use drvibe_protocol::visits::SendVisitRequest;
use drvibe_protocol::{ApiError, API_PREFIX};

use crate::account::{forget_device, get_token, web_base_url};

/// What every API command returns to JS.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiResponse {
    pub ok: bool,
    /// HTTP status; 0 when the request could not be sent.
    pub status: u16,
    pub not_modified: bool,
    pub etag: Option<String>,
    pub retry_after_seconds: Option<u64>,
    /// Parsed JSON body (`null` for 204 / 304 / empty).
    pub data: serde_json::Value,
    /// No device token: nothing was sent.
    pub unlinked: bool,
    /// `error` code of an [`ApiError`] body, if any.
    pub error: Option<String>,
}

/// How to send one request.
pub(crate) struct Call<'a> {
    pub method: reqwest::Method,
    /// Path below `/api/v1`, starting with `/`, query included.
    pub path: &'a str,
    pub json: Option<Vec<u8>>,
    pub multipart: Option<reqwest::multipart::Form>,
    pub signed: bool,
    pub etag: Option<&'a str>,
    pub timezone: Option<&'a str>,
}

/// Who a request is sent as.
#[derive(Clone, Copy)]
pub(crate) enum Ctx<'a> {
    /// The app: the token comes from the OS keyring, and a revoked token is
    /// forgotten (the UI gets `account-unlinked`).
    App(&'a tauri::AppHandle),
    /// An explicit token, or none (the link exchange). Nothing is stored.
    Token(Option<&'a str>),
}

impl<'a> Call<'a> {
    pub fn new(method: reqwest::Method, path: &'a str) -> Self {
        Self {
            method,
            path,
            json: None,
            multipart: None,
            signed: false,
            etag: None,
            timezone: None,
        }
    }
    pub fn json<T: Serialize>(mut self, body: &T) -> Self {
        self.json = Some(serde_json::to_vec(body).unwrap_or_else(|_| b"null".to_vec()));
        self
    }
    pub fn signed(mut self) -> Self {
        self.signed = true;
        self
    }
}

/// "Sync my stats" (Settings → Privacy). Off keeps the account linked but
/// stops everything that shares stats or presence: sync, events, poll, ack,
/// the weekly recap and privacy updates. Seeded from the store at start
/// ([`init_sync_enabled`]) and set by the main window ([`set_sync_enabled`]).
static SYNC_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Calls held back while "Sync my stats" is off.
pub(crate) fn is_sharing_call(method: &reqwest::Method, path: &str) -> bool {
    let route = path.split('?').next().unwrap_or(path);
    matches!(
        route,
        "/desktop/sync"
            | "/desktop/events"
            | "/desktop/poll"
            | "/desktop/ack"
            | "/me/recap"
            | "/me/streak"
    ) || (route == "/privacy" && method != reqwest::Method::GET)
}

/// Whether "Sync my stats" is on.
pub(crate) fn sync_enabled() -> bool {
    SYNC_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
}

/// Reads `settings.syncEnabled` from the store (default on).
pub(crate) fn init_sync_enabled(app: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;
    let enabled = app
        .store("dr-vibe-data.json")
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|s| s.get("syncEnabled").and_then(|v| v.as_bool()))
        .unwrap_or(true);
    SYNC_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub(crate) fn set_sync_enabled(enabled: bool) {
    SYNC_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent(concat!("DrVibe-Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("reqwest client")
    })
}

/// A fresh nonce: 32 hex chars (the server wants 16-64 of `[A-Za-z0-9_-]`).
pub(crate) fn new_nonce() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// The signature headers for one request, as (name, value) pairs.
pub(crate) fn signature_headers(
    token: &str,
    method: &str,
    full_path: &str,
    body: &[u8],
) -> [(&'static str, String); 3] {
    let timestamp = chrono::Utc::now().timestamp();
    let nonce = new_nonce();
    let signature =
        drvibe_protocol::signing::sign_request(token, method, full_path, timestamp, &nonce, body);
    [
        (HEADER_TIMESTAMP, timestamp.to_string()),
        (HEADER_NONCE, nonce),
        (HEADER_SIGNATURE, signature),
    ]
}

/// Send one request as `ctx`. Without a token only the link exchange goes
/// out; anything else answers `unlinked` without touching the network.
pub(crate) async fn send(ctx: Ctx<'_>, call: Call<'_>) -> ApiResponse {
    let token = match ctx {
        Ctx::App(_) => get_token().ok().flatten(),
        Ctx::Token(t) => t.map(String::from),
    };
    let anonymous = matches!(ctx, Ctx::Token(None));
    if !anonymous && token.is_none() {
        return ApiResponse {
            unlinked: true,
            data: serde_json::Value::Null,
            ..Default::default()
        };
    }
    if matches!(ctx, Ctx::App(_))
        && !SYNC_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
        && is_sharing_call(&call.method, call.path)
    {
        return ApiResponse {
            data: serde_json::Value::Null,
            error: Some("sync_off".into()),
            ..Default::default()
        };
    }

    let full_path = format!("{API_PREFIX}{}", call.path);
    let url = format!("{}{}", web_base_url(), full_path);
    let mut req = client().request(call.method.clone(), &url);
    if let Some(t) = &token {
        req = req.bearer_auth(t);
    }
    if let Some(tz) = call.timezone.filter(|t| !t.is_empty()) {
        req = req.header(HEADER_TIMEZONE, tz);
    }
    if let Some(e) = call.etag {
        req = req.header(reqwest::header::IF_NONE_MATCH, e);
    }
    let body = call.json.clone().unwrap_or_default();
    if call.signed {
        if let Some(t) = &token {
            for (name, value) in signature_headers(t, call.method.as_str(), &full_path, &body) {
                req = req.header(name, value);
            }
        }
    }
    if let Some(form) = call.multipart {
        req = req.multipart(form);
    } else if call.json.is_some() {
        req = req
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[api] {} {} failed: {e}", call.method, call.path);
            return ApiResponse {
                data: serde_json::Value::Null,
                ..Default::default()
            };
        }
    };

    let status = resp.status().as_u16();
    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let retry_after = resp
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let bytes = resp.bytes().await.unwrap_or_default();
    let data: serde_json::Value = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
    };
    let error = if (200..300).contains(&status) || status == 304 {
        None
    } else {
        serde_json::from_value::<ApiError>(data.clone())
            .ok()
            .map(|e| e.error)
    };

    // A revoked or unknown token will never work again: forget it so the
    // app falls back to unlinked and offers "Connect again" (API.md §2).
    if status == 401 && error.as_deref() == Some("invalid_device_token") {
        if let Ctx::App(app) = ctx {
            forget_device(app);
        }
    }

    ApiResponse {
        ok: (200..300).contains(&status),
        status,
        not_modified: status == 304,
        etag,
        retry_after_seconds: retry_after
            .or_else(|| data.pointer("/details/retryAfter").and_then(|v| v.as_u64())),
        data,
        unlinked: false,
        error,
    }
}

/// Check a 2xx body against the protocol type and pass it on. A body that
/// does not match the contract is reported as status 0 so callers retry
/// later instead of acting on half-understood data.
fn typed<T: serde::de::DeserializeOwned + Serialize>(mut r: ApiResponse) -> ApiResponse {
    if r.ok && !r.not_modified {
        match serde_json::from_value::<T>(r.data.clone()) {
            Ok(v) => r.data = serde_json::to_value(v).unwrap_or(serde_json::Value::Null),
            Err(e) => {
                eprintln!("[api] response did not match the contract: {e}");
                r.ok = false;
                r.status = 0;
                r.error = Some("contract_mismatch".into());
            }
        }
    }
    r
}

fn parse_method(m: &str) -> Result<reqwest::Method, String> {
    match m.to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "DELETE" => Ok(reqwest::Method::DELETE),
        other => Err(format!("unsupported method {other}")),
    }
}

// ── Calls ────────────────────────────────────────────────────────────────

/// Plain API call for endpoints without a typed function (balance, quests,
/// claim...). `path` is below `/api/v1`. Mutations pass `signed: true`
/// where API.md says device-signed.
pub(crate) async fn request(
    ctx: Ctx<'_>,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
    signed: bool,
    etag: Option<&str>,
    timezone: Option<&str>,
) -> Result<ApiResponse, String> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains("..") {
        return Err("path must be an /api/v1 relative path".into());
    }
    let mut call = Call::new(parse_method(method)?, path);
    if let Some(b) = body {
        call = call.json(b);
    }
    call.signed = signed;
    call.etag = etag;
    call.timezone = timezone;
    Ok(send(ctx, call).await)
}

/// `GET /desktop/poll` with `If-None-Match`.
pub(crate) async fn poll(ctx: Ctx<'_>, etag: Option<&str>) -> ApiResponse {
    let mut call = Call::new(reqwest::Method::GET, "/desktop/poll");
    call.etag = etag;
    let r = send(ctx, call).await;
    let raw_privacy = r.data.get("privacy").cloned();
    let mut r = typed::<PollResponse>(r);
    drop_unsent_privacy_fields(raw_privacy.as_ref(), &mut r.data);
    r
}

/// The send switches the server did not return (a server older than them)
/// are removed again after parsing, so the desktop keeps its own value
/// instead of reading the protocol default as the player's choice.
pub(crate) fn drop_unsent_privacy_fields(
    raw: Option<&serde_json::Value>,
    data: &mut serde_json::Value,
) {
    let Some(parsed) = data.get_mut("privacy").and_then(|p| p.as_object_mut()) else {
        return;
    };
    for key in [
        "shareActivityTimes",
        "shareCodingNow",
        "allowSearchIndexing",
    ] {
        if raw.and_then(|r| r.get(key)).is_none() {
            parsed.remove(key);
        }
    }
}

/// `POST /desktop/ack` (signed).
pub(crate) async fn ack(ctx: Ctx<'_>, ack: &AckRequest) -> ApiResponse {
    send(
        ctx,
        Call::new(reqwest::Method::POST, "/desktop/ack")
            .json(ack)
            .signed(),
    )
    .await
}

/// `POST /desktop/events` (signed), with `X-Client-Timezone`.
pub(crate) async fn send_events(
    ctx: Ctx<'_>,
    batch: &EconomyEventBatch,
    timezone: Option<&str>,
) -> ApiResponse {
    let mut call = Call::new(reqwest::Method::POST, "/desktop/events")
        .json(batch)
        .signed();
    call.timezone = timezone;
    typed::<drvibe_protocol::economy::EventBatchResponse>(send(ctx, call).await)
}

/// `POST /visits` (signed): send a visit, or wave back with `replyToVisitId`.
pub(crate) async fn send_visit(ctx: Ctx<'_>, request: &SendVisitRequest) -> ApiResponse {
    typed::<drvibe_protocol::visits::SendVisitResponse>(
        send(
            ctx,
            Call::new(reqwest::Method::POST, "/visits")
                .json(request)
                .signed(),
        )
        .await,
    )
}

/// `PUT /privacy` with a patch (signed; the server also accepts it unsigned).
pub(crate) async fn update_privacy(ctx: Ctx<'_>, patch: &PrivacySettingsPatch) -> ApiResponse {
    typed::<drvibe_protocol::privacy::PrivacySettings>(
        send(
            ctx,
            Call::new(reqwest::Method::PUT, "/privacy")
                .json(patch)
                .signed(),
        )
        .await,
    )
}

/// `GET /desktop/collection` for "My Collection".
pub(crate) async fn collection(ctx: Ctx<'_>) -> ApiResponse {
    typed::<drvibe_protocol::companion::CollectionResponse>(
        send(ctx, Call::new(reqwest::Method::GET, "/desktop/collection")).await,
    )
}

/// `{ equipped }` from `PUT /desktop/equipped` (API.md §12).
#[derive(serde::Deserialize, Serialize)]
struct EquipResponse {
    equipped: Option<drvibe_protocol::companion::EquippedDrVibe>,
}

/// `PUT /desktop/equipped` (signed). `companionId: null` = back to a local skin.
pub(crate) async fn set_equipped(ctx: Ctx<'_>, request: &EquipRequest) -> ApiResponse {
    typed::<EquipResponse>(
        send(
            ctx,
            Call::new(reqwest::Method::PUT, "/desktop/equipped")
                .json(request)
                .signed(),
        )
        .await,
    )
}

/// The numbers of the desktop's `WeeklySummary` that `POST /me/recap` keeps
/// (API.md §18). Typed so that project names and the daily breakdown can
/// never leave the app: any other field JS passes is dropped here.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct RecapSummary {
    pub week_label: String,
    pub total_seconds: u64,
    pub active_days: u8,
    pub total_files_created: u64,
    pub total_files_modified: u64,
    pub longest_session_seconds: u64,
    pub streak: u64,
}

/// `POST /me/recap` body: `weekStart` is the week's Monday (`YYYY-MM-DD`),
/// `share` opts in to the Monday feed post.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecapRequest {
    pub week_start: String,
    pub summary: RecapSummary,
    pub share: bool,
}

/// `{ cardUrl }` from `POST /me/recap`.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecapResponse {
    card_url: String,
}

fn is_week_start(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// `POST /me/recap` (signed): store last week's recap, answer its card URL.
pub(crate) async fn send_recap(
    ctx: Ctx<'_>,
    request: &RecapRequest,
) -> Result<ApiResponse, String> {
    if !is_week_start(&request.week_start) {
        return Err("weekStart must be YYYY-MM-DD".into());
    }
    Ok(typed::<RecapResponse>(
        send(
            ctx,
            Call::new(reqwest::Method::POST, "/me/recap")
                .json(request)
                .signed(),
        )
        .await,
    ))
}

/// `POST /designs`: multipart upload of a player-made Dr. Vibe to the
/// Incubator (bearer auth; API.md §13 accepts multipart unsigned).
pub(crate) async fn submit_design(
    ctx: Ctx<'_>,
    png_base64: &str,
    anim_json: Option<String>,
    name: String,
    description: Option<String>,
    vibe_id: Option<String>,
) -> Result<ApiResponse, String> {
    use base64::Engine as _;
    let png = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim())
        .map_err(|e| format!("bad sprite data: {e}"))?;
    // Designs from older builds carry the OS login name in their baked
    // animation data; it never leaves this computer.
    let png = crate::skins::scrub_png(png);
    let anim_json = anim_json.map(|a| crate::skins::scrub_anim_json(&a));
    let sprite = reqwest::multipart::Part::bytes(png)
        .file_name("sprite.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("sprite", sprite)
        .text("name", name)
        .text("licenseAccepted", "true")
        .text("ownWorkConfirmed", "true");
    if let Some(a) = anim_json.filter(|a| !a.trim().is_empty()) {
        form = form.text("animJson", a);
    }
    if let Some(d) = description.filter(|d| !d.trim().is_empty()) {
        form = form.text("description", d);
    }
    if let Some(v) = vibe_id.filter(|v| uuid::Uuid::parse_str(v).is_ok()) {
        form = form.text("vibeId", v);
    }
    let mut call = Call::new(reqwest::Method::POST, "/designs");
    call.multipart = Some(form);
    Ok(send(ctx, call).await)
}

// ── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) async fn api_request(
    app_handle: tauri::AppHandle,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    signed: Option<bool>,
    etag: Option<String>,
    timezone: Option<String>,
) -> Result<ApiResponse, String> {
    let ctx = Ctx::App(&app_handle);
    request(
        ctx,
        &method,
        &path,
        body.as_ref(),
        signed.unwrap_or(false),
        etag.as_deref(),
        timezone.as_deref(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn api_poll(app_handle: tauri::AppHandle, etag: Option<String>) -> ApiResponse {
    poll(Ctx::App(&app_handle), etag.as_deref()).await
}

#[tauri::command]
pub(crate) async fn api_ack(app_handle: tauri::AppHandle, ack: AckRequest) -> ApiResponse {
    self::ack(Ctx::App(&app_handle), &ack).await
}

#[tauri::command]
pub(crate) async fn api_send_events(
    app_handle: tauri::AppHandle,
    batch: EconomyEventBatch,
    timezone: Option<String>,
) -> ApiResponse {
    send_events(Ctx::App(&app_handle), &batch, timezone.as_deref()).await
}

#[tauri::command]
pub(crate) async fn api_send_visit(
    app_handle: tauri::AppHandle,
    request: SendVisitRequest,
) -> ApiResponse {
    send_visit(Ctx::App(&app_handle), &request).await
}

#[tauri::command]
pub(crate) async fn api_update_privacy(
    app_handle: tauri::AppHandle,
    patch: PrivacySettingsPatch,
) -> ApiResponse {
    update_privacy(Ctx::App(&app_handle), &patch).await
}

#[tauri::command]
pub(crate) async fn api_collection(app_handle: tauri::AppHandle) -> ApiResponse {
    collection(Ctx::App(&app_handle)).await
}

#[tauri::command]
pub(crate) async fn api_set_equipped(
    app_handle: tauri::AppHandle,
    request: EquipRequest,
) -> ApiResponse {
    set_equipped(Ctx::App(&app_handle), &request).await
}

#[tauri::command]
pub(crate) async fn api_send_recap(
    app_handle: tauri::AppHandle,
    request: RecapRequest,
) -> Result<ApiResponse, String> {
    send_recap(Ctx::App(&app_handle), &request).await
}

#[tauri::command]
pub(crate) async fn api_submit_design(
    app_handle: tauri::AppHandle,
    png_base64: String,
    anim_json: Option<String>,
    name: String,
    description: Option<String>,
    vibe_id: Option<String>,
) -> Result<ApiResponse, String> {
    submit_design(
        Ctx::App(&app_handle),
        &png_base64,
        anim_json,
        name,
        description,
        vibe_id,
    )
    .await
}

/// Tell the UI the account changed (linked / unlinked).
pub(crate) fn emit_account(app: &tauri::AppHandle, event: &str, payload: serde_json::Value) {
    let _ = app.emit(event, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_off_holds_back_only_sharing_calls() {
        use reqwest::Method;
        for (m, p) in [
            (Method::POST, "/desktop/sync"),
            (Method::POST, "/desktop/events"),
            (Method::GET, "/desktop/poll"),
            (Method::POST, "/desktop/ack"),
            (Method::POST, "/me/recap"),
            (Method::GET, "/me/streak"),
            (Method::PUT, "/privacy"),
        ] {
            assert!(is_sharing_call(&m, p), "{m} {p}");
        }
        for (m, p) in [
            (Method::GET, "/privacy"),
            (Method::GET, "/economy/balance"),
            (Method::POST, "/visits"),
            (Method::POST, "/errors"),
            (Method::GET, "/me/last-sync"),
        ] {
            assert!(!is_sharing_call(&m, p), "{m} {p}");
        }
    }

    #[test]
    fn missing_send_switches_stay_missing_after_parsing() {
        let mut data = serde_json::json!({ "privacy": { "profileVisibility": "public", "shareActivityTimes": true, "shareCodingNow": true } });
        let raw = serde_json::json!({ "profileVisibility": "public", "shareCodingNow": false });
        drop_unsent_privacy_fields(Some(&raw), &mut data);
        assert!(data["privacy"].get("shareActivityTimes").is_none());
        assert_eq!(
            data["privacy"]["shareCodingNow"], true,
            "present fields are left as parsed"
        );
    }

    #[test]
    fn nonces_are_well_formed_and_unique() {
        let a = new_nonce();
        assert!(drvibe_protocol::signing::nonce_is_well_formed(&a));
        assert_ne!(a, new_nonce());
    }

    #[test]
    fn signature_headers_verify_on_the_server_side() {
        let token = "dvd_test";
        let body = br#"{"events":[]}"#;
        let headers = signature_headers(token, "POST", "/api/v1/desktop/events", body);
        let ts: i64 = headers[0].1.parse().unwrap();
        assert!(drvibe_protocol::signing::verify_request(
            token,
            "POST",
            "/api/v1/desktop/events",
            ts,
            &headers[1].1,
            body,
            &headers[2].1
        ));
        assert_eq!(headers[0].0, HEADER_TIMESTAMP);
    }

    #[test]
    fn recap_body_carries_numbers_only() {
        // What JS hands over is the whole WeeklySummary, project names included.
        let from_js = serde_json::json!({
            "weekStart": "2026-10-12",
            "share": true,
            "summary": {
                "weekLabel": "Oct 12 - Oct 18", "totalSeconds": 7200, "activeDays": 3,
                "totalFilesCreated": 4, "totalFilesModified": 9, "longestSessionSeconds": 3600, "streak": 5,
                "projects": ["secret-client-work"], "dailyBreakdown": [{ "projects": ["secret-client-work"] }],
                "encouragement": "Nice", "totalHours": 2.0
            }
        });
        let request: RecapRequest = serde_json::from_value(from_js).unwrap();
        let body = serde_json::to_value(&request).unwrap();
        assert!(!body.to_string().contains("secret"));
        assert_eq!(
            body,
            serde_json::json!({
                "weekStart": "2026-10-12",
                "share": true,
                "summary": {
                    "weekLabel": "Oct 12 - Oct 18", "totalSeconds": 7200, "activeDays": 3,
                    "totalFilesCreated": 4, "totalFilesModified": 9, "longestSessionSeconds": 3600, "streak": 5
                }
            })
        );
    }

    #[test]
    fn recap_week_start_is_a_date() {
        assert!(is_week_start("2026-10-12"));
        assert!(!is_week_start("last week"));
        assert!(!is_week_start("2026-W42"));
    }

    #[test]
    fn recap_response_must_carry_a_card_url() {
        let ok = ApiResponse {
            ok: true,
            status: 200,
            data: serde_json::json!({ "cardUrl": "http://x/api/v1/recaps/a/card.png" }),
            ..Default::default()
        };
        assert!(typed::<RecapResponse>(ok).ok);
        let bad = ApiResponse {
            ok: true,
            status: 200,
            data: serde_json::json!({}),
            ..Default::default()
        };
        assert!(!typed::<RecapResponse>(bad).ok);
    }

    #[test]
    fn contract_mismatch_is_not_ok() {
        let r = ApiResponse {
            ok: true,
            status: 200,
            data: serde_json::json!({ "nope": 1 }),
            ..Default::default()
        };
        let checked = typed::<drvibe_protocol::visits::SendVisitResponse>(r);
        assert!(!checked.ok);
        assert_eq!(checked.error.as_deref(), Some("contract_mismatch"));
    }
}
