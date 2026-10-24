//! Economy event batch: `POST /api/v1/desktop/events` (device auth, signed),
//! plus the quest views the desktop shows.
//!
//! The desktop queues events on disk while offline (with a size cap) and
//! sends them in batches of at most 100. `clientEventId` makes every event
//! idempotent, so a batch can be retried safely after a crash or timeout.

use serde::{Deserialize, Serialize};

/// Largest batch the server accepts.
pub const MAX_EVENTS_PER_BATCH: usize = 100;

/// Events the desktop reports. Rates and caps live on the server
/// (`GET /api/v1/economy/rules`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EconomyEventType {
    /// metadata: `{}`
    PomodoroComplete,
    /// metadata: `{ "durationMinutes": number }`
    FocusSessionEnd,
    /// metadata: `{ "repo"?: string }` (repo name is never shown publicly)
    GitCommit,
    /// metadata: `{}`
    CodingSessionStart,
    /// metadata: `{ "kind": "hydration" | "eyes" | "posture" | "break" }`
    WellnessCheck,
    /// metadata: `{ "record": string, "value": number }`
    PersonalBest,
    /// Audit only, pays nothing. metadata: `{ "skillId": string }`
    SkillMilestone,
    /// Audit only. metadata: `{}`
    CommunityAccountConnected,
    /// Audit only. metadata: `{}`
    CommunityGallerySubmitted,
    /// Audit only. metadata: `{ "skinId": string }`
    CommunitySkinInstalled,
    /// One-shot per achievement. metadata: `{ "achievementId": string, "title"?: string }`
    AchievementUnlocked,
    /// One-shot per track level. metadata: `{ "trackId": string, "level": 1..5, "trackName"?: string }`
    MasteryLevelUp,
    /// Once per local calendar day while a streak is alive; also drives
    /// streak milestones and the free pull every 7 days.
    /// metadata: `{ "streakLength": number, "day": "YYYY-MM-DD" }`
    StreakDay,
    /// Any type this build does not know; reported back as `unknown_event_type`.
    #[serde(other)]
    Unknown,
}

/// One activity event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EconomyEvent {
    /// 1-64 chars, unique per account forever (a UUID is ideal).
    pub client_event_id: String,
    pub event_type: EconomyEventType,
    /// When it happened. Accepted if within the last 24 hours; otherwise
    /// the server uses its own clock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurred_at: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EconomyEventBatch {
    pub events: Vec<EconomyEvent>,
}

/// Result for one event, in request order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventResult {
    pub client_event_id: String,
    /// VP credited for this event (0 if capped, on cooldown or audit-only).
    pub awarded: i64,
    pub cap_hit: bool,
    /// e.g. `pomodoro_complete`, `git_commit_cap`, `git_commit_cooldown`,
    /// `achievement_unlock`, `already_claimed`, `unknown_event_type`,
    /// `underqualified:<TYPE>`.
    pub reason_code: String,
    /// True when this clientEventId was already processed; the stored
    /// result is returned and nothing is credited again.
    #[serde(default)]
    pub replay: bool,
    /// Set when the event was rejected (`invalid_event`, `rate_limited`).
    /// Rejected events may be retried later with the same clientEventId.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatchResponse {
    pub results: Vec<EventResult>,
    /// VP balance after the whole batch.
    pub balance: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QuestPeriod {
    Daily,
    Weekly,
}

/// A quest assigned to the player for the current day or week.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestView {
    pub user_quest_id: String,
    pub template_key: String,
    pub period: QuestPeriod,
    pub title: String,
    pub description: String,
    pub goal_type: String,
    pub goal_target: i64,
    pub progress: i64,
    pub reward_vp: i64,
    pub completed: bool,
    pub claimed: bool,
    pub starts_at: String,
    pub ends_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestListResponse {
    pub quests: Vec<QuestView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestClaimResponse {
    pub awarded: i64,
    pub balance: i64,
    pub already_claimed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_event_type_does_not_fail_the_batch() {
        let batch: EconomyEventBatch = serde_json::from_str(
            r#"{"events":[{"clientEventId":"a","eventType":"GIT_COMMIT"},{"clientEventId":"b","eventType":"FUTURE_THING","metadata":{"x":1}}]}"#,
        )
        .unwrap();
        assert_eq!(batch.events[0].event_type, EconomyEventType::GitCommit);
        assert_eq!(batch.events[1].event_type, EconomyEventType::Unknown);
    }
}
