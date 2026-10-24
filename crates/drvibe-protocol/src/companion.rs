//! The Dr. Vibe a linked player wears, and their collection.

use serde::{Deserialize, Serialize};

use crate::Rarity;

/// A collected Dr. Vibe (a companion) as the desktop renders it. Sprite
/// sheets follow the shared format: 128 x 512 PNG, 4 columns x 16 rows of
/// 32 x 32 frames, or 128 x 544 with the optional 17th (levitating) row;
/// fall back to idle when it is missing. `spriteSheetUrl` changes whenever the art changes, so it
/// is a safe cache key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquippedDrVibe {
    pub companion_id: String,
    pub edition_id: String,
    pub edition_slug: String,
    /// Player's custom name for the companion, else the edition name.
    pub name: String,
    pub edition_name: String,
    pub serial_number: i64,
    pub rarity: Rarity,
    /// Absolute URL (R2 / CDN).
    pub sprite_sheet_url: String,
    pub thumbnail_url: Option<String>,
    /// The `.anim.json` sidecar (vibeId, idle flourishes, micro-motion, walk).
    pub anim_json: Option<serde_json::Value>,
    /// Palette swap applied on top, e.g. `medium-dark` or `heart`.
    pub skin_tone: Option<String>,
    /// Mythic holo variant: render with the holo shader effect.
    pub holo: bool,
    /// The design was removed after a report or takedown; the copy is kept.
    pub retired: bool,
}

/// One entry of "My Collection" on the desktop:
/// `GET /api/v1/desktop/collection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionEntry {
    #[serde(flatten)]
    pub dr_vibe: EquippedDrVibe,
    pub equipped: bool,
    pub acquired_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionResponse {
    pub equipped_id: Option<String>,
    pub companions: Vec<CollectionEntry>,
}

/// `PUT /api/v1/desktop/equipped` body. `companionId: null` returns to the
/// Lab Original / custom skin chosen on the desktop. The website's
/// `PUT /api/v1/me/equipped` also takes `labOriginal` (with a null
/// `companionId`) to wear a bundled Lab Original from the site.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipRequest {
    pub companion_id: Option<String>,
    /// Bundled skin id (`pirate`, `default`, ...) to wear instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lab_original: Option<String>,
}
