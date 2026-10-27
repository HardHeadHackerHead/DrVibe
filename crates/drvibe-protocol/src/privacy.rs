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
    /// "Send my activity times". Default `true`. When `false` the desktop
    /// sends an all-zero `codingHourOfDay`, empty `git.commitDates` and
    /// `streakHistory`, and achievement `unlockedAt` rounded to the UTC day.
    #[serde(default = "default_true")]
    pub share_activity_times: bool,
    /// "Send when I'm coding right now". Default `true`. When `false` the
    /// desktop always sends `presence.isCurrentlyCoding = false`.
    #[serde(default = "default_true")]
    pub share_coding_now: bool,
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
            share_activity_times: true,
            share_coding_now: true,
            updated_at: None,
        }
    }
}

fn default_true() -> bool {
    true
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_activity_times: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_coding_now: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_switches_default_on_when_absent() {
        let s: PrivacySettings = serde_json::from_value(serde_json::json!({
            "profileVisibility": "public", "showProjectNames": false, "showOnVibeMap": false,
            "appearInLeaderboards": true, "whoCanVisit": "followers", "updatedAt": null
        }))
        .unwrap();
        assert!(s.share_activity_times && s.share_coding_now);
        assert_eq!(s, PrivacySettings::default());
        let v = serde_json::to_value(PrivacySettings::default()).unwrap();
        assert_eq!(v["shareActivityTimes"], true);
        assert_eq!(v["shareCodingNow"], true);
    }

    #[test]
    fn patch_carries_only_what_changed() {
        let p = PrivacySettingsPatch { share_coding_now: Some(false), ..Default::default() };
        assert_eq!(serde_json::to_value(&p).unwrap(), serde_json::json!({ "shareCodingNow": false }));
        let back: PrivacySettingsPatch =
            serde_json::from_value(serde_json::json!({ "shareActivityTimes": false })).unwrap();
        assert_eq!(back.share_activity_times, Some(false));
        assert_eq!(back.share_coding_now, None);
    }
}
