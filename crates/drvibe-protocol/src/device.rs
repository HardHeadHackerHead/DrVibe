//! Desktop linking and device authentication.
//!
//! Flow (PKCE-style device link, see `server/API.md` "Desktop link"):
//!
//! 1. The desktop makes a random `codeVerifier` (43-128 chars of
//!    `[A-Za-z0-9-._~]`), keeps it in memory, and opens the browser at
//!    `{site}/connect?` + [`ConnectParams`] as query string.
//! 2. The player signs in with GitHub or Discord. The web page calls
//!    `POST /api/v1/desktop/link/authorize` with [`LinkAuthorizeRequest`] and
//!    navigates to the returned `redirectUrl`
//!    (`dr-vibe://auth/callback?code=...`).
//! 3. The desktop receives the deep link and calls
//!    `POST /api/v1/desktop/link/exchange` with [`LinkExchangeRequest`]. The
//!    response carries the device token, shown only this once.
//! 4. Every desktop call sends `Authorization: Bearer <token>`. Calls that
//!    change state also sign the request (see the `signing` module).

use serde::{Deserialize, Serialize};

use crate::UserSummary;

/// Deep link the server redirects to after the player approves a link.
pub const DEEP_LINK_CALLBACK: &str = "dr-vibe://auth/callback";

/// Device tokens start with this prefix so leaked tokens are easy to spot.
pub const DEVICE_TOKEN_PREFIX: &str = "dvd_";

/// Header carrying the request timestamp (unix seconds) on signed requests.
pub const HEADER_TIMESTAMP: &str = "x-drvibe-timestamp";
/// Header carrying the per-request random nonce on signed requests.
pub const HEADER_NONCE: &str = "x-drvibe-nonce";
/// Header carrying the hex HMAC-SHA256 signature on signed requests.
pub const HEADER_SIGNATURE: &str = "x-drvibe-signature";
/// Optional header with the player's IANA time zone (daily caps, quests).
pub const HEADER_TIMEZONE: &str = "x-client-timezone";

/// Allowed clock skew for signed requests, in seconds (either direction).
pub const SIGNATURE_MAX_SKEW_SECS: i64 = 300;

/// Desktop operating system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
    #[serde(other)]
    Other,
}

/// Query parameters of the `{site}/connect` page the desktop opens.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    /// base64url(SHA-256(codeVerifier)), no padding.
    pub code_challenge: String,
    /// Stable random id the desktop generates once per install. Re-linking
    /// with the same install id revokes that install's previous token.
    pub install_id: String,
    /// Shown under Settings -> Devices, e.g. "DESKTOP-4F2 (Windows)".
    pub device_name: String,
    pub platform: Platform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
}

/// `POST /api/v1/desktop/link/authorize` (session auth, called by the web
/// `/connect` page with the values it received in [`ConnectParams`]).
pub type LinkAuthorizeRequest = ConnectParams;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkAuthorizeResponse {
    /// One-time code, valid for 10 minutes.
    pub code: String,
    /// `dr-vibe://auth/callback?code=<code>`; the web page navigates here.
    pub redirect_url: String,
    pub expires_at: String,
}

/// `POST /api/v1/desktop/link/exchange` (public, rate limited).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkExchangeRequest {
    pub code: String,
    pub code_verifier: String,
    /// Must equal the install id given to `/connect`.
    pub install_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkExchangeResponse {
    /// `dvd_...` device token. Store it in the OS keychain; it is never
    /// shown again. The server keeps only its SHA-256.
    pub token: String,
    pub device: DeviceInfo,
    pub user: UserSummary,
    /// True the first time this account links any desktop. The desktop
    /// shows the "welcome to the lab" celebration (50 VP, Dr. Vibe
    /// Original and a free Starter pull are granted server-side).
    pub first_link: bool,
}

/// A linked desktop, as listed under Settings -> Devices.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub platform: Platform,
    pub app_version: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    /// True on the device making the request (desktop calls only).
    #[serde(default)]
    pub current: bool,
}
