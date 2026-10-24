//! Desktop stats sync: `POST /api/v1/desktop/sync` (device auth, signed).
//!
//! Sync carries stats for profiles, leaderboards and the feed. It never pays
//! VP (that is the economy event batch). Privacy settings are not part of
//! sync; the desktop sends them to `PUT /api/v1/privacy` only when the
//! player changes them.

use serde::{Deserialize, Serialize};

/// Full sync body. Only `stats` is required.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skin: Option<SyncSkin>,
    pub stats: SyncStats,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence: Option<Presence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<CodingSession>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git: Option<GitStats>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub momentum: Option<Momentum>,
    /// Every achievement, including locked and in-progress ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub achievements: Option<Vec<Achievement>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mastery_tracks: Option<Vec<MasteryTrack>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_session_minutes: Option<i64>,
    /// Completed past streaks, oldest first, at most 20.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streak_history: Option<Vec<StreakHistoryEntry>>,
    /// 24 cumulative seconds-coded values, index 0 = midnight local time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coding_hour_of_day: Option<Vec<f64>>,
    /// Absent: leave the equipped pointer alone. `null`: a Lab Original or
    /// custom skin is active. A string: the owned companion now worn.
    #[serde(default, skip_serializing_if = "Option::is_none", with = "double_option")]
    pub equipped_companion_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStats {
    pub current_streak: i64,
    pub longest_streak: i64,
    /// none | starting | warming | hot | fire | legendary
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streak_level: Option<String>,
    /// Subset of [7, 14, 21, 30, 50, 100, 200, 365].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streak_milestones: Option<Vec<i64>>,
    pub total_coding_hours: f64,
    pub longest_session_minutes: f64,
    #[serde(default)]
    pub top_languages: Vec<LanguageHours>,
    /// 7 values in seconds; index 0 = six days ago, index 6 = today.
    #[serde(default)]
    pub last7_days: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageHours {
    pub name: String,
    pub hours: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSkin {
    /// Lab Original slug (`default`, `pirate`, ...), `companion-<edition>`
    /// or a custom slug.
    pub slug: String,
    pub name: String,
    /// built-in | community | custom | companion
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gallery_id: Option<String>,
    /// PNG sprite sheet (`data:image/png;base64,...` or raw base64) for a
    /// custom skin. At most 4 MB of base64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprite_base64: Option<String>,
    /// Palette swap key, e.g. `medium-dark`, `heart`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skin_tone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub is_currently_coding: bool,
    /// Shown on the profile only if the player enabled "show project names".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_project: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingSession {
    /// Unix milliseconds.
    pub session_start: i64,
    pub coding_seconds: i64,
    pub files_created: i64,
    pub files_modified: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_project: Option<SessionProject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProject {
    pub name: String,
    /// Rust | Node | Python | Go | ... (free text)
    #[serde(rename = "type")]
    pub project_type: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStats {
    pub total_commits: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_commits: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unique_repos: Option<i64>,
    /// `YYYY-MM-DD` (UTC) days with at least one commit, for the heatmap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_dates: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Momentum {
    /// 0-100.
    pub current: i64,
    pub peak_all_time: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peak_this_session: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub id: String,
    pub title: String,
    pub description: String,
    /// HTML entity such as `&#x1F525;`, at most 20 chars.
    pub icon: String,
    pub category: String,
    pub progress: f64,
    pub max_progress: f64,
    pub unlocked: bool,
    /// Unix milliseconds.
    pub unlocked_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub granted_by_server: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasteryTrack {
    /// timer_mastery | skills_mastery | git_mastery | wellness_mastery |
    /// community_mastery
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub level: i64,
    pub max_level: i64,
    pub progress: f64,
    pub max_progress: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakHistoryEntry {
    pub start: String,
    pub end: String,
    pub length: i64,
}

/// Response to a successful sync.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    /// Achievements granted by the server that the desktop did not send
    /// (e.g. `welcome_dr_vibe`). The desktop adds them locally.
    pub new_achievements: Vec<Achievement>,
    pub leaderboard: RankInfo,
    pub friends: FriendActivity,
    /// False while a custom skin waits for review; the profile then shows
    /// the default skin to other players.
    pub skin_approved: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankInfo {
    /// Coding-hours rank, 1 = top. 0 when the player is hidden from
    /// leaderboards.
    pub rank: i64,
    /// Previous rank minus new rank; positive means the player moved up.
    pub change: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendActivity {
    /// Followed players who synced in the last 15 minutes.
    pub active_friends: i64,
    /// Followed players coding right now (at most 20), for the tray
    /// tooltip and the dashboard Community tab.
    pub coding_now: Vec<FriendPresence>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendPresence {
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Only when that player shows project names.
    pub current_project: Option<String>,
    pub current_streak: i64,
}

/// Distinguishes an absent field from an explicit `null`.
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(value: &Option<Option<String>>, s: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
        Option::<String>::deserialize(d).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equipped_companion_absent_null_and_set() {
        let base =
            r#"{"stats":{"currentStreak":1,"longestStreak":2,"totalCodingHours":1.5,"longestSessionMinutes":30}}"#;
        let p: SyncPayload = serde_json::from_str(base).unwrap();
        assert_eq!(p.equipped_companion_id, None);

        let with_null = base.replace("{\"stats\"", "{\"equippedCompanionId\":null,\"stats\"");
        let p: SyncPayload = serde_json::from_str(&with_null).unwrap();
        assert_eq!(p.equipped_companion_id, Some(None));

        let with_id = base.replace("{\"stats\"", "{\"equippedCompanionId\":\"c1\",\"stats\"");
        let p: SyncPayload = serde_json::from_str(&with_id).unwrap();
        assert_eq!(p.equipped_companion_id, Some(Some("c1".into())));
    }
}
