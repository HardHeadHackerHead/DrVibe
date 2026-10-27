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
    /// Default `true`. When `false` the desktop sends no hour-of-day
    /// histogram, commit dates or streak history, and the server neither
    /// stores nor shows them (achievement unlocks and session starts are
    /// kept as dates only). Economy events (`POST /desktop/events`) still
    /// carry their `occurredAt`, rounded to the minute, and `STREAK_DAY` its
    /// `day`: daily caps, cooldowns and streaks need them.
    #[serde(default = "default_true")]
    pub share_activity_times: bool,
    /// Default `true`. When `false` the server treats the player as never
    /// coding now and shows no last-active time anywhere.
    #[serde(default = "default_true")]
    pub share_coding_now: bool,
    /// Default `true`. When `false` the public profile is left out of the
    /// sitemap and served with `noindex`.
    #[serde(default = "default_true")]
    pub allow_search_indexing: bool,
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
            allow_search_indexing: true,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_activity_times: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_coding_now: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_search_indexing: Option<bool>,
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_from_an_older_server_default_the_new_fields_to_true() {
        let s: PrivacySettings = serde_json::from_str(
            r#"{"profileVisibility":"public","showProjectNames":false,"showOnVibeMap":false,
                "appearInLeaderboards":true,"whoCanVisit":"followers","updatedAt":null}"#,
        )
        .unwrap();
        assert!(s.share_activity_times && s.share_coding_now && s.allow_search_indexing);
        assert_eq!(s, PrivacySettings::default());
    }

    #[test]
    fn patch_round_trips_the_send_switches() {
        let p: PrivacySettingsPatch = serde_json::from_str(r#"{"shareActivityTimes":false}"#).unwrap();
        assert_eq!(p.share_activity_times, Some(false));
        assert_eq!(p.share_coding_now, None);
        assert_eq!(serde_json::to_string(&p).unwrap(), r#"{"shareActivityTimes":false}"#);
    }
}
