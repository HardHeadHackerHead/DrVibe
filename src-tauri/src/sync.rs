//! Profile sync with the website: `POST /api/v1/desktop/sync` (device-signed,
//! API.md §3). The body is `drvibe_protocol::sync::SyncPayload`; there is no
//! shared app secret any more, the request is signed with the device token.
//! The server keeps the last body per device for "Show my last sync"
//! (`GET /api/v1/me/last-sync`).

use serde::Deserialize;

use drvibe_protocol::sync::{
    Achievement, GitStats, LanguageHours, MasteryTrack, Momentum, Presence, StreakHistoryEntry,
    SyncPayload, SyncResponse, SyncSkin, SyncStats,
};

use crate::api::{send, Call, Ctx};
use crate::skins::{read_skin, read_skin_anim};

/// Transient state passed from JS — volatile in-memory data that isn't
/// persisted in the Tauri store between save cycles.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransientSyncState {
    pub is_coding_now: bool,
    pub current_momentum: f64,
    pub peak_momentum_session: f64,
    pub current_session_minutes: u32,
    pub current_project: Option<String>,
    pub coding_hour_of_day: Vec<f64>,
    /// Every achievement, locked ones included (protocol `Achievement`).
    pub achievements: Vec<Achievement>,
    pub mastery_tracks: Vec<MasteryTrack>,
    pub session_commit_count: u32,
    /// Skin slug forwarded from JS (the JS database is the source of truth)
    #[serde(default)]
    pub selected_skin: Option<String>,
    /// Skin tone forwarded from JS (e.g. "medium-dark", "green", "dark")
    #[serde(default)]
    pub selected_skin_tone: Option<String>,
    /// "Send my project name" privacy setting. Off by default: the current
    /// project name is only sent when the player turned it on. JS passes
    /// only a name that resolved to a tracked git repo's folder.
    #[serde(default)]
    pub show_project_names: bool,
    /// "Send my activity times": off sends no hour-of-day profile, commit
    /// dates or streak history, and unlock times only to the UTC day.
    #[serde(default = "yes")]
    pub share_activity_times: bool,
    /// "Send when I'm coding right now": off always sends "not coding".
    #[serde(default = "yes")]
    pub share_coding_now: bool,
    /// The collected Dr. Vibe on the desktop; null = a local skin.
    #[serde(default)]
    pub equipped_companion_id: Option<String>,
}

fn yes() -> bool {
    true
}

const DAY_MS: i64 = 86_400_000;

/// Unix ms rounded down to 00:00 UTC of its day.
pub(crate) fn start_of_utc_day(ms: i64) -> i64 {
    ms.div_euclid(DAY_MS) * DAY_MS
}

/// Applies "Send my activity times" and "Send when I'm coding right now" to
/// a built body. The shape stays what the server expects: zeros and empty
/// lists, never missing fields.
pub(crate) fn apply_send_switches(
    payload: &mut SyncPayload,
    share_activity_times: bool,
    share_coding_now: bool,
) {
    if !share_coding_now {
        // Live session length and momentum would say "coding now" too.
        if let Some(p) = payload.presence.as_mut() {
            p.is_currently_coding = false;
        }
        payload.current_session_minutes = Some(0);
        if let Some(m) = payload.momentum.as_mut() {
            m.current = 0;
            m.peak_this_session = Some(0);
        }
    }
    if share_activity_times {
        return;
    }
    payload.coding_hour_of_day = Some(vec![0.0; 24]);
    if let Some(git) = payload.git.as_mut() {
        git.commit_dates = Some(Vec::new());
    }
    payload.streak_history = Some(Vec::new());
    for a in payload.achievements.iter_mut().flatten() {
        a.unlocked_at = a.unlocked_at.map(start_of_utc_day);
    }
}

pub(crate) fn compute_last_7_days(history: &[serde_json::Value]) -> Vec<f64> {
    use chrono::Local;
    let today = Local::now().date_naive();
    let mut result = Vec::with_capacity(7);
    for i in (0..7).rev() {
        let date = today - chrono::Duration::days(i);
        let date_str = date.format("%Y-%m-%d").to_string();
        let seconds = history
            .iter()
            .find(|entry| entry.get("date").and_then(|d| d.as_str()) == Some(&date_str))
            .and_then(|entry| entry.get("codingSeconds").and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        result.push(seconds);
    }
    result
}

pub(crate) fn compute_top_languages(skills: &serde_json::Value) -> Vec<LanguageHours> {
    let obj = match skills.as_object() {
        Some(o) => o,
        None => return Vec::new(),
    };
    let mut langs: Vec<LanguageHours> = obj
        .iter()
        .filter_map(|(name, data)| {
            let total_seconds = data
                .get("totalSeconds")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            if total_seconds == 0 {
                return None;
            }
            // Round to 1 decimal place (e.g. 0.5h, 2.3h)
            let hours = (total_seconds as f64 / 360.0).round() / 10.0;
            Some(LanguageHours {
                name: name.clone(),
                hours,
            })
        })
        .filter(|l| l.hours > 0.0)
        .collect();
    langs.sort_by(|a, b| {
        b.hours
            .partial_cmp(&a.hours)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    langs.truncate(5);
    langs
}

/// Validate spriteBase64 per security doc section 5:
/// - Size <= 4MB, valid base64 or data URI, no dangerous schemes.
pub(crate) fn validate_sprite_base64(b64: &str) -> bool {
    if b64.len() > 4_194_304 {
        return false;
    }
    let lower = b64.to_lowercase();
    if lower.starts_with("javascript:") || lower.starts_with("data:text/html") {
        return false;
    }
    if lower.starts_with("data:image/png;base64,") {
        return true;
    }
    b64.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

/// [`crate::skins::scrub_png`] on base64 PNG data. Data that isn't base64
/// comes back unchanged (`validate_sprite_base64` rejects it later).
pub(crate) fn scrub_png_base64(b64: &str) -> String {
    use base64::Engine as _;
    let engine = base64::engine::general_purpose::STANDARD;
    match engine.decode(b64.trim()) {
        Ok(bytes) => engine.encode(crate::skins::scrub_png(bytes)),
        Err(_) => b64.to_string(),
    }
}

/// Project name for the presence block, honouring "Show project names".
pub(crate) fn presence_project(transient: &TransientSyncState) -> Option<String> {
    if transient.show_project_names {
        transient.current_project.clone().filter(|p| !p.is_empty())
    } else {
        None
    }
}

/// Skin `source` for the server: built-in | community | custom | companion.
/// Only custom skins carry their sprite (the server shows it on the profile
/// once reviewed); everything else is known to the site by slug.
pub(crate) fn skin_source(slug: &str, meta: &serde_json::Value, is_bundled: bool) -> &'static str {
    if slug.starts_with("companion-") {
        "companion"
    } else if meta.get("galleryId").and_then(|v| v.as_str()).is_some() {
        "community"
    } else if is_bundled {
        "built-in"
    } else {
        "custom"
    }
}

/// Streak history entries the protocol accepts (complete start/end dates).
fn streak_history(raw: &[serde_json::Value]) -> Vec<StreakHistoryEntry> {
    raw.iter()
        .filter_map(|e| {
            Some(StreakHistoryEntry {
                start: e.get("start")?.as_str()?.to_string(),
                end: e.get("end")?.as_str()?.to_string(),
                length: e.get("length")?.as_i64()?,
            })
        })
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

/// Build the sync body from the store sections plus JS's transient state.
pub(crate) fn build_payload(
    transient: TransientSyncState,
    store: &dyn Fn(&str) -> serde_json::Value,
    skin_png_b64: Option<String>,
    skin_meta: serde_json::Value,
    skin_is_bundled: bool,
    app_version: Option<String>,
) -> SyncPayload {
    let settings = store("settings");
    let session = store("session");
    let streak = store("streak");
    let personal_best = store("personalBest");
    let skills = store("skills");
    let achievements_store = store("achievements");

    let skin_slug = transient.selected_skin.clone().unwrap_or_else(|| {
        settings
            .get("selectedSkin")
            .and_then(|v| v.as_str())
            .unwrap_or("dr-vibe-default")
            .to_string()
    });

    let history = session
        .get("history")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let total_coding_seconds: f64 = history
        .iter()
        .filter_map(|e| e.get("codingSeconds").and_then(|v| v.as_f64()))
        .sum();

    let longest_session_secs = personal_best
        .pointer("/bests/longestSession/value")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let peak_all_time = personal_best
        .pointer("/bests/bestMomentum/value")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    // A count only: the names were replaced by `seenRepoCount` (older
    // stores still have the `seenRepos` list).
    let seen_repos = achievements_store
        .get("seenRepoCount")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .or_else(|| {
            achievements_store
                .get("seenRepos")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
        })
        .unwrap_or(0);
    let commit_dates: Vec<String> = achievements_store
        .get("commitDays")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let source = skin_source(&skin_slug, &skin_meta, skin_is_bundled);
    let skin = SyncSkin {
        slug: skin_slug.clone(),
        name: skin_meta
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&skin_slug)
            .to_string(),
        source: source.to_string(),
        gallery_id: skin_meta
            .get("galleryId")
            .and_then(|v| v.as_str())
            .map(String::from),
        sprite_base64: if source == "custom" {
            skin_png_b64.filter(|b| validate_sprite_base64(b))
        } else {
            None
        },
        skin_tone: transient.selected_skin_tone.clone(),
    };

    let current_project = presence_project(&transient);
    let (share_activity_times, share_coding_now) =
        (transient.share_activity_times, transient.share_coding_now);
    let mut payload = SyncPayload {
        app_version,
        skin: Some(skin),
        stats: SyncStats {
            current_streak: streak.get("current").and_then(|v| v.as_i64()).unwrap_or(0),
            longest_streak: streak.get("max").and_then(|v| v.as_i64()).unwrap_or(0),
            streak_level: None,
            streak_milestones: streak
                .get("milestonesReached")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|m| m.as_i64()).collect()),
            total_coding_hours: (total_coding_seconds / 3600.0 * 100.0).round() / 100.0,
            longest_session_minutes: (longest_session_secs / 60.0).floor(),
            top_languages: compute_top_languages(&skills),
            last7_days: compute_last_7_days(&history),
        },
        presence: Some(Presence {
            is_currently_coding: transient.is_coding_now,
            current_project,
        }),
        session: None,
        git: Some(GitStats {
            total_commits: achievements_store
                .get("lifetimeCommitCount")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            session_commits: Some(transient.session_commit_count as i64),
            unique_repos: Some(seen_repos as i64),
            commit_dates: Some(commit_dates),
        }),
        momentum: Some(Momentum {
            current: transient.current_momentum.round().clamp(0.0, 100.0) as i64,
            peak_all_time: peak_all_time.round().clamp(0.0, 100.0) as i64,
            peak_this_session: Some(
                transient.peak_momentum_session.round().clamp(0.0, 100.0) as i64
            ),
        }),
        achievements: Some(transient.achievements),
        mastery_tracks: Some(transient.mastery_tracks),
        current_session_minutes: Some(transient.current_session_minutes as i64),
        streak_history: Some(streak_history(
            &streak
                .get("streakHistory")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default(),
        )),
        coding_hour_of_day: Some(transient.coding_hour_of_day),
        equipped_companion_id: Some(transient.equipped_companion_id),
    };
    apply_send_switches(&mut payload, share_activity_times, share_coding_now);
    payload
}

/// Sync profile stats to the Dr. Vibe website. Returns `{ success: true,
/// ...SyncResponse }` or an error string (`"unlinked"`, or the server's
/// error code such as `implausible_stats`).
#[tauri::command]
pub(crate) async fn sync_profile(
    transient: TransientSyncState,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let payload = payload_for(transient, &app_handle)?;
    send_sync(Ctx::App(&app_handle), &payload).await
}

/// The Outbox: the body the next sync would send, built locally by the same
/// code and never sent. The custom sprite is shortened for reading.
#[tauri::command]
pub(crate) fn preview_sync_payload(
    transient: TransientSyncState,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let payload = payload_for(transient, &app_handle)?;
    serde_json::to_value(payload).map_err(|e| e.to_string())
}

fn payload_for(
    transient: TransientSyncState,
    app_handle: &tauri::AppHandle,
) -> Result<SyncPayload, String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle
        .store("dr-vibe-data.json")
        .map_err(|e| format!("Store error: {e}"))?;
    let section = |k: &str| store.get(k).unwrap_or(serde_json::json!({}));

    let skin_slug = transient
        .selected_skin
        .clone()
        .unwrap_or_else(|| "dr-vibe-default".to_string());
    // Re-baked without personal provenance (see skins::scrub_png) before a
    // custom sheet is sent.
    let skin_png = read_skin(skin_slug.clone(), app_handle.clone())
        .ok()
        .map(|b64| scrub_png_base64(&b64));
    let skin_meta: serde_json::Value = read_skin_anim(skin_slug.clone(), app_handle.clone())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    let bundled = crate::skins::is_bundled_skin(app_handle, &skin_slug);

    Ok(build_payload(
        transient,
        &section,
        skin_png,
        skin_meta,
        bundled,
        Some(app_handle.package_info().version.to_string()),
    ))
}

/// `POST /desktop/sync` (signed). `{ success: true, ...SyncResponse }` or
/// an error code.
pub(crate) async fn send_sync(
    ctx: Ctx<'_>,
    payload: &SyncPayload,
) -> Result<serde_json::Value, String> {
    let r = send(
        ctx,
        Call::new(reqwest::Method::POST, "/desktop/sync")
            .json(payload)
            .signed(),
    )
    .await;
    if r.unlinked {
        return Err("unlinked".into());
    }
    if !r.ok {
        return Err(r.error.unwrap_or_else(|| {
            if r.status == 0 {
                "offline".into()
            } else {
                format!("http_{}", r.status)
            }
        }));
    }
    let resp: SyncResponse =
        serde_json::from_value(r.data).map_err(|e| format!("contract_mismatch: {e}"))?;
    let mut out = serde_json::to_value(resp).map_err(|e| e.to_string())?;
    out["success"] = serde_json::json!(true);
    Ok(out)
}

/// "Show my last sync": the newest body this device sent, as stored by the
/// server (`GET /me/last-sync`, a device sees only its own). Returns
/// `{ sentAt, endpoint, body }` with `body` as a JSON string, or null.
#[tauri::command]
pub(crate) async fn get_last_sync(app_handle: tauri::AppHandle) -> Option<serde_json::Value> {
    last_sync(Ctx::App(&app_handle)).await
}

pub(crate) async fn last_sync(ctx: Ctx<'_>) -> Option<serde_json::Value> {
    let r = send(ctx, Call::new(reqwest::Method::GET, "/me/last-sync")).await;
    if !r.ok {
        return None;
    }
    let syncs = r.data.get("syncs")?.as_array()?;
    let latest = syncs
        .iter()
        .find(|s| s.get("current").and_then(|c| c.as_bool()) == Some(true))
        .or(syncs.first())?;
    Some(serde_json::json!({
        "sentAt": latest.get("receivedAt"),
        "endpoint": "POST /api/v1/desktop/sync",
        "body": serde_json::to_string_pretty(latest.get("payload")?).ok()?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transient(show: bool) -> TransientSyncState {
        serde_json::from_value(serde_json::json!({
            "isCodingNow": true,
            "currentMomentum": 10.4,
            "peakMomentumSession": 20.0,
            "currentSessionMinutes": 5,
            "currentProject": "secret-project",
            "codingHourOfDay": [0, 1],
            "achievements": [{
                "id": "hello_world", "title": "Hello World", "description": "d", "icon": "&#x1F44B;",
                "category": "milestone", "progress": 1, "maxProgress": 1, "unlocked": true, "unlockedAt": 1700000000000i64
            }],
            "masteryTracks": [{ "id": "git_mastery", "level": 1, "maxLevel": 5, "progress": 6, "maxProgress": 25 }],
            "sessionCommitCount": 2,
            "showProjectNames": show,
            "selectedSkin": "dr-vibe-pirate",
            "equippedCompanionId": null
        })).unwrap()
    }

    fn store(k: &str) -> serde_json::Value {
        match k {
            "streak" => serde_json::json!({ "current": 3, "max": 9, "milestonesReached": [7],
                "streakHistory": [{ "start": "2026-01-01", "end": "2026-01-09", "length": 9 }, { "start": null, "end": "x", "length": 1 }] }),
            "achievements" => {
                serde_json::json!({ "lifetimeCommitCount": 40, "seenRepos": ["a", "b"], "commitDays": ["2026-10-01"] })
            }
            "session" => {
                serde_json::json!({ "history": [{ "date": "2020-01-01", "codingSeconds": 7200 }] })
            }
            _ => serde_json::json!({}),
        }
    }

    #[test]
    fn project_name_is_withheld_unless_enabled() {
        assert_eq!(presence_project(&transient(false)), None);
        assert_eq!(
            presence_project(&transient(true)).as_deref(),
            Some("secret-project")
        );
    }

    #[test]
    fn payload_matches_the_protocol() {
        let p = build_payload(
            transient(false),
            &store,
            Some("QUJD".into()),
            serde_json::json!({ "name": "Pirate" }),
            true,
            Some("2.0.0".into()),
        );
        let json = serde_json::to_value(&p).unwrap();
        // Round trips through the shared type the server parses.
        let back: SyncPayload = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(back, p);
        assert_eq!(json["stats"]["currentStreak"], 3);
        assert_eq!(json["stats"]["totalCodingHours"], 2.0);
        assert_eq!(json["git"]["uniqueRepos"], 2);
        assert_eq!(json["skin"]["source"], "built-in");
        assert!(
            json["skin"].get("spriteBase64").is_none(),
            "built-in skins don't upload a sprite"
        );
        assert!(json["presence"].get("currentProject").is_none());
        assert_eq!(json["streakHistory"].as_array().unwrap().len(), 1);
        assert_eq!(json["momentum"]["current"], 10);
        // null clears the equipped pointer (a local skin is worn).
        assert!(json.get("equippedCompanionId").unwrap().is_null());
        assert!(json.get("privacyLevel").is_none());
    }

    fn transient_with(switches: serde_json::Value) -> TransientSyncState {
        let mut v = serde_json::to_value(transient_json()).unwrap();
        for (k, val) in switches.as_object().unwrap() {
            v[k] = val.clone();
        }
        serde_json::from_value(v).unwrap()
    }

    fn transient_json() -> serde_json::Value {
        serde_json::json!({
            "isCodingNow": true,
            "currentMomentum": 10.4,
            "peakMomentumSession": 20.0,
            "currentSessionMinutes": 5,
            "currentProject": null,
            "codingHourOfDay": [0, 1, 2],
            "achievements": [{
                "id": "night_owl", "title": "Night Owl", "description": "d", "icon": "&#x1F989;",
                "category": "time", "progress": 1, "maxProgress": 1, "unlocked": true, "unlockedAt": 1_700_003_723_456i64
            }],
            "masteryTracks": [],
            "sessionCommitCount": 0
        })
    }

    #[test]
    fn send_switches_default_on() {
        let t = transient_with(serde_json::json!({}));
        assert!(t.share_activity_times && t.share_coding_now);
        let json = serde_json::to_value(build_payload(
            t,
            &store,
            None,
            serde_json::json!({}),
            true,
            None,
        ))
        .unwrap();
        assert_eq!(json["presence"]["isCurrentlyCoding"], true);
        assert_eq!(json["codingHourOfDay"], serde_json::json!([0.0, 1.0, 2.0]));
        assert_eq!(
            json["git"]["commitDates"],
            serde_json::json!(["2026-10-01"])
        );
        assert_eq!(json["achievements"][0]["unlockedAt"], 1_700_003_723_456i64);
    }

    #[test]
    fn activity_times_off_keeps_the_shape_but_not_the_times() {
        let t = transient_with(serde_json::json!({ "shareActivityTimes": false }));
        let p = build_payload(t, &store, None, serde_json::json!({}), true, None);
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["codingHourOfDay"], serde_json::json!(vec![0.0; 24]));
        assert_eq!(json["git"]["commitDates"], serde_json::json!([]));
        assert_eq!(json["streakHistory"], serde_json::json!([]));
        // 2023-11-14T23:15:23.456Z → 2023-11-14T00:00:00Z
        assert_eq!(json["achievements"][0]["unlockedAt"], 1_699_920_000_000i64);
        assert_eq!(json["presence"]["isCurrentlyCoding"], true);
        // Still a body the current server parses.
        let back: SyncPayload = serde_json::from_value(json).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn coding_now_off_always_says_not_coding() {
        let t = transient_with(serde_json::json!({ "shareCodingNow": false }));
        let json = serde_json::to_value(build_payload(
            t,
            &store,
            None,
            serde_json::json!({}),
            true,
            None,
        ))
        .unwrap();
        assert_eq!(json["presence"]["isCurrentlyCoding"], false);
        assert_eq!(json["currentSessionMinutes"], 0);
        assert_eq!(json["momentum"]["current"], 0);
        assert_eq!(json["momentum"]["peakThisSession"], 0);
        assert_eq!(json["codingHourOfDay"], serde_json::json!([0.0, 1.0, 2.0]));
    }

    #[test]
    fn utc_day_rounding() {
        assert_eq!(start_of_utc_day(0), 0);
        assert_eq!(start_of_utc_day(86_399_999), 0);
        assert_eq!(start_of_utc_day(86_400_000), 86_400_000);
        assert_eq!(start_of_utc_day(-1), -86_400_000);
    }

    #[test]
    fn repo_count_prefers_the_count() {
        let store = |k: &str| match k {
            "achievements" => serde_json::json!({ "seenRepoCount": 7, "seenRepos": ["a"] }),
            _ => serde_json::json!({}),
        };
        let t = transient_with(serde_json::json!({}));
        let p = build_payload(t, &store, None, serde_json::json!({}), true, None);
        assert_eq!(p.git.unwrap().unique_repos, Some(7));
    }

    #[test]
    fn custom_skins_carry_their_sprite() {
        let p = build_payload(
            transient(false),
            &store,
            Some("QUJD".into()),
            serde_json::json!({}),
            false,
            None,
        );
        let skin = p.skin.unwrap();
        assert_eq!(skin.source, "custom");
        assert_eq!(skin.sprite_base64.as_deref(), Some("QUJD"));
        assert_eq!(
            skin_source("companion-neon", &serde_json::json!({}), false),
            "companion"
        );
        assert_eq!(
            skin_source("x", &serde_json::json!({ "galleryId": "g1" }), false),
            "community"
        );
    }

    #[test]
    fn last_7_days_is_oldest_first_and_zero_filled() {
        let today = chrono::Local::now()
            .date_naive()
            .format("%Y-%m-%d")
            .to_string();
        let history = vec![serde_json::json!({ "date": today, "codingSeconds": 120 })];
        let days = compute_last_7_days(&history);
        assert_eq!(days.len(), 7);
        assert_eq!(days[6], 120.0);
        assert!(days[..6].iter().all(|d| *d == 0.0));
    }

    #[test]
    fn top_languages_drop_zero_hours() {
        let langs = compute_top_languages(&serde_json::json!({
            "Rust": { "totalSeconds": 7200 },
            "Go": { "totalSeconds": 0 }
        }));
        assert_eq!(langs.len(), 1);
        assert_eq!(langs[0].name, "Rust");
        assert!((langs[0].hours - 2.0).abs() < f64::EPSILON);
    }
}
