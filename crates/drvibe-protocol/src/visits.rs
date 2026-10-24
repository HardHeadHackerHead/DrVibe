//! Visits: your Dr. Vibe walks onto a friend's desktop and waves.
//!
//! Send with `POST /api/v1/visits` (session or device auth). Pending visits
//! reach the receiver through the desktop poll; the desktop reports what it
//! did with each one through `POST /api/v1/desktop/ack`.

use serde::{Deserialize, Serialize};

use crate::companion::EquippedDrVibe;

/// Optional preset line in the speech bubble. Presets only, no free text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisitPreset {
    /// "Nice streak!"
    NiceStreak,
    /// "Keep shipping!"
    KeepShipping,
    /// "Take a break!"
    TakeABreak,
}

impl VisitPreset {
    pub fn text(self) -> &'static str {
        match self {
            VisitPreset::NiceStreak => "Nice streak!",
            VisitPreset::KeepShipping => "Keep shipping!",
            VisitPreset::TakeABreak => "Take a break!",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendVisitRequest {
    pub to_username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<VisitPreset>,
    /// Set when this is "Wave back" on a received visit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to_visit_id: Option<String>,
}

/// How the visit will be shown to the receiver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisitDelivery {
    /// Queued for a walk-on at the receiver's next poll (or next break).
    WalkOn,
    /// Receiver is over the 5 walk-ons per hour limit or offline; it shows
    /// up as a notification instead.
    Notification,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendVisitResponse {
    pub visit_id: String,
    pub delivery: VisitDelivery,
}

/// What the visitor looks like on the receiver's screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisitorAppearance {
    /// The sender's equipped edition, if any.
    pub equipped: Option<EquippedDrVibe>,
    /// Lab Original slug to use when `equipped` is null (e.g. `pirate`).
    pub fallback_skin_slug: String,
    pub skin_tone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Visitor {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub appearance: VisitorAppearance,
}

/// A visit waiting to walk onto this desktop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingVisit {
    pub id: String,
    pub from: Visitor,
    pub preset: Option<VisitPreset>,
    pub is_wave_back: bool,
    pub created_at: String,
}

/// What the desktop did with a visit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisitOutcome {
    /// The walk-on played.
    Played,
    /// Not shown (expired while in focus / screen share); the server turns
    /// it into a "@sender visited while you were away" notification.
    Missed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisitAck {
    pub id: String,
    pub outcome: VisitOutcome,
}
