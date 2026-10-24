//! Payload types shared by the Dr. Vibe server and the desktop app.
//!
//! **Canonical copy:** the desktop repo (`drvibe-desktop`), at
//! `crates/drvibe-protocol`. The website repo keeps a byte-identical mirror at
//! `server/crates/drvibe-protocol` so its Docker build needs only that repo.
//! Edit the desktop copy, then run `sh scripts/sync-protocol.sh` in the website
//! repo; its `scripts/check.sh server` fails while the two differ.
//!
//! Everything here is plain serde data so the Tauri app can depend on it
//! without pulling in the server stack. JSON field names are camelCase.
//! Timestamps are RFC 3339 strings in UTC (for example
//! `2026-10-22T14:03:00.000Z`).
//!
//! The `signing` feature adds the request-signing and PKCE helpers both
//! sides need for the desktop link flow and signed desktop requests.

pub mod companion;
pub mod device;
pub mod economy;
pub mod poll;
pub mod privacy;
#[cfg(feature = "signing")]
pub mod signing;
pub mod sync;
pub mod visits;

use serde::{Deserialize, Serialize};

/// Prefix of every versioned API route.
pub const API_PREFIX: &str = "/api/v1";

/// Rarity of an edition. Companions inherit their edition's rarity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
    Mythic,
}

impl Rarity {
    pub const ALL: [Rarity; 6] =
        [Rarity::Common, Rarity::Uncommon, Rarity::Rare, Rarity::Epic, Rarity::Legendary, Rarity::Mythic];

    /// The database enum label (`"COMMON"` ...).
    pub fn as_db_str(self) -> &'static str {
        match self {
            Rarity::Common => "COMMON",
            Rarity::Uncommon => "UNCOMMON",
            Rarity::Rare => "RARE",
            Rarity::Epic => "EPIC",
            Rarity::Legendary => "LEGENDARY",
            Rarity::Mythic => "MYTHIC",
        }
    }
}

/// Body of every non-2xx JSON response from the API.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiError {
    /// Stable machine-readable code, e.g. `unauthorized`, `rate_limited`.
    pub error: String,
    /// Human-readable message, safe to show to the player.
    pub message: String,
    /// Optional structured details (validation fields, retryAfter, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

/// Minimal public identity of a player, used across payloads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}
