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
    /// The finish on this one copy, if any. Always sent (`null` when there
    /// is none); absent from servers before finishes, which reads as none.
    #[serde(default)]
    pub finish: Option<Finish>,
}

/// A finish on one owned Dr. Vibe: the same sprite sheet drawn with an
/// effect on top. Each edition numbers its copies of each finish ("Foil Ember Sage #3").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finish {
    pub tier: FinishTier,
    /// Season it was granted in; 0 is the Launch pre-season.
    pub season_number: i64,
    /// Its number among that season's finishes of this tier (`Foil · #3`).
    pub serial: i64,
}

/// How a finish looks, from least to most rare. `crowned` is the season's
/// #1 grant. A tier this build doesn't know reads as `Unknown`, which the
/// desktop draws as no finish, so a new tier never breaks the payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FinishTier {
    Shimmer,
    Foil,
    Prismatic,
    Crowned,
    #[serde(other)]
    Unknown,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(finish: Option<serde_json::Value>) -> serde_json::Value {
        let mut v = serde_json::json!({
            "companionId": "c1", "editionId": "e1", "editionSlug": "tv-bob", "name": "TV Bob",
            "editionName": "TV Bob", "serialNumber": 7, "rarity": "RARE",
            "spriteSheetUrl": "https://cdn.example/tv-bob.png", "thumbnailUrl": null, "animJson": null,
            "skinTone": null, "holo": false, "retired": false,
            "equipped": true, "acquiredAt": "2026-10-20T10:00:00.000Z"
        });
        if let Some(f) = finish {
            v["finish"] = f;
        }
        v
    }

    #[test]
    fn finish_absent_from_older_servers_reads_as_none() {
        let e: CollectionEntry = serde_json::from_value(entry(None)).unwrap();
        assert_eq!(e.dr_vibe.finish, None);
        // Sent back as an explicit null, so every companion object carries it.
        let out = serde_json::to_value(&e).unwrap();
        assert_eq!(out["finish"], serde_json::Value::Null);
    }

    #[test]
    fn finish_round_trips() {
        let json = serde_json::json!({ "tier": "foil", "seasonNumber": 1, "serial": 3 });
        let e: CollectionEntry = serde_json::from_value(entry(Some(json.clone()))).unwrap();
        assert_eq!(e.dr_vibe.finish, Some(Finish { tier: FinishTier::Foil, season_number: 1, serial: 3 }));
        assert_eq!(serde_json::to_value(&e).unwrap()["finish"], json);

        for (name, tier) in [
            ("shimmer", FinishTier::Shimmer),
            ("foil", FinishTier::Foil),
            ("prismatic", FinishTier::Prismatic),
            ("crowned", FinishTier::Crowned),
        ] {
            let f: Finish =
                serde_json::from_value(serde_json::json!({ "tier": name, "seasonNumber": 0, "serial": 1 })).unwrap();
            assert_eq!(f.tier, tier);
        }
    }

    #[test]
    fn null_and_unknown_finish_tiers_do_not_break_the_payload() {
        let e: CollectionEntry = serde_json::from_value(entry(Some(serde_json::Value::Null))).unwrap();
        assert_eq!(e.dr_vibe.finish, None);
        let f = serde_json::json!({ "tier": "galaxy", "seasonNumber": 4, "serial": 1 });
        let e: CollectionEntry = serde_json::from_value(entry(Some(f))).unwrap();
        assert_eq!(e.dr_vibe.finish.unwrap().tier, FinishTier::Unknown);
    }
}
