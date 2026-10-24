//! The 60-second desktop poll: `GET /api/v1/desktop/poll` (device auth).
//!
//! The response carries an `ETag`. The desktop sends it back in
//! `If-None-Match`; when nothing changed the server answers `304 Not
//! Modified` with no body. Items stay in the poll until acknowledged with
//! `POST /api/v1/desktop/ack`.

use serde::{Deserialize, Serialize};

use crate::companion::EquippedDrVibe;
use crate::privacy::PrivacySettings;
use crate::visits::{IncomingVisit, VisitAck};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollResponse {
    pub account: PollAccount,
    /// Edition the player wears; null means the desktop's own Lab
    /// Original / custom skin.
    pub equipped: Option<EquippedDrVibe>,
    /// Undelivered desktop toasts, oldest first, at most 20.
    pub notifications: Vec<DesktopNotification>,
    /// Unread bell count on the website.
    pub unread_count: i64,
    /// Visits waiting to walk on, oldest first, at most 5.
    pub visits: Vec<IncomingVisit>,
    pub privacy: PrivacySettings,
    /// The Lab Original last chosen on the website ("Wear" on the site).
    /// Apply it once per `chosenAt` while `equipped` is null; a later pick
    /// on the desktop wins until the player chooses again on the site.
    /// Absent from servers before 2.0.x.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lab_original: Option<WornLabOriginal>,
}

/// A bundled Lab Original picked on the website.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WornLabOriginal {
    /// Bundled skin id without the `dr-vibe-` prefix: `pirate`, `default`, ...
    pub slug: String,
    /// When it was chosen (RFC 3339); a new value means "switch now".
    pub chosen_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollAccount {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub vibe_points: i64,
    pub supporter: SupporterStatus,
    /// Free pulls waiting in the Lab (Starter + streak pulls).
    pub free_pulls: i64,
    /// Streak freezes held and the days they covered. Absent from servers
    /// before 2.0.x (then: none held, nothing covered).
    #[serde(default)]
    pub streak_freeze: StreakFreeze,
}

/// Streak freezes (bought in the Store): each one covers one missed local
/// day, so the streak survives it without growing. The server spends them
/// automatically; the desktop keeps its streak alive across covered days
/// and across missed days it still holds freezes for.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakFreeze {
    /// Freezes waiting to be used (at most a small cap, 2 today).
    pub held: i64,
    /// Local days (`YYYY-MM-DD`, the player's pinned time zone) a freeze
    /// covered in the last 14 days, oldest first.
    #[serde(default)]
    pub covered_days: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupporterStatus {
    /// Any donation ever: permanent badge.
    pub is_supporter: bool,
    /// Active monthly support: animated badge.
    pub monthly_active: bool,
}

/// A toast for the desktop. Known `kind`s:
/// `donation_thanks` (celebrate), `design_graduated` (celebrate),
/// `visit_missed`, `follow`, `trade_proposed`, `trade_accepted`,
/// `achievement_granted`, `free_pull`, `system`. Unknown kinds should be
/// shown as a plain toast.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotification {
    pub id: String,
    pub kind: String,
    pub message: String,
    /// Site-relative link, opened in the browser on click.
    pub cta_url: Option<String>,
    /// Play Dr. Vibe's celebrate animation with the toast.
    pub celebrate: bool,
    pub created_at: String,
}

/// `POST /api/v1/desktop/ack` body (device auth, signed).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckRequest {
    #[serde(default)]
    pub notification_ids: Vec<String>,
    #[serde(default)]
    pub visits: Vec<VisitAck>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::EquipRequest as EquipRequestAlias;

    #[test]
    fn older_poll_bodies_still_parse() {
        let old = serde_json::json!({
            "account": { "userId": "u1", "username": "mara", "displayName": null, "avatarUrl": null,
                         "vibePoints": 10, "supporter": { "isSupporter": false, "monthlyActive": false }, "freePulls": 0 },
            "equipped": null, "notifications": [], "unreadCount": 0, "visits": [],
            "privacy": { "profileVisibility": "public", "showProjectNames": false, "showOnVibeMap": false,
                         "appearInLeaderboards": true, "whoCanVisit": "followers", "updatedAt": null }
        });
        let p: PollResponse = serde_json::from_value(old).unwrap();
        assert_eq!(p.account.streak_freeze, StreakFreeze::default());
        assert_eq!(p.lab_original, None);
        // No labOriginal key when there is none, so old desktops see the same body.
        assert!(serde_json::to_value(&p).unwrap().get("labOriginal").is_none());
    }

    #[test]
    fn equip_request_lab_original_is_optional() {
        let r: EquipRequestAlias = serde_json::from_str(r#"{"companionId":null}"#).unwrap();
        assert_eq!(r.lab_original, None);
        let r: EquipRequestAlias = serde_json::from_str(r#"{"companionId":null,"labOriginal":"pirate"}"#).unwrap();
        assert_eq!(r.lab_original.as_deref(), Some("pirate"));
        assert_eq!(
            serde_json::to_string(&EquipRequestAlias { companion_id: None, lab_original: None }).unwrap(),
            r#"{"companionId":null}"#
        );
    }
}
