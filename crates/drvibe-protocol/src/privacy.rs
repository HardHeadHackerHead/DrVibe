//! The one privacy model shared by both apps.
//!
//! `GET /api/v1/privacy` returns [`PrivacySettings`]; `PUT /api/v1/privacy`
//! takes a [`PrivacySettingsPatch`] (session or device auth). The desktop
//! sends a patch only when the player changes a setting locally.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileVisibility {
    Public,
    Followers,
    Private,
}

/// Who may send this player a visit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VisitPolicy {
    Everyone,
    Followers,
    Nobody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySettings {
    /// Default `public`.
    pub profile_visibility: ProfileVisibility,
    /// Default `false`.
    pub show_project_names: bool,
    /// Default `false`. The raw IP is never stored; only a jittered city.
    pub show_on_vibe_map: bool,
    /// Default `true`.
    pub appear_in_leaderboards: bool,
    /// Default `followers`.
    pub who_can_visit: VisitPolicy,
    /// Last change, RFC 3339. The desktop compares it with its local copy.
    pub updated_at: Option<String>,
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            profile_visibility: ProfileVisibility::Public,
            show_project_names: false,
            show_on_vibe_map: false,
            appear_in_leaderboards: true,
            who_can_visit: VisitPolicy::Followers,
            updated_at: None,
        }
    }
}

/// Partial update; absent fields are left unchanged.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_visibility: Option<ProfileVisibility>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_project_names: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_on_vibe_map: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appear_in_leaderboards: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who_can_visit: Option<VisitPolicy>,
}
