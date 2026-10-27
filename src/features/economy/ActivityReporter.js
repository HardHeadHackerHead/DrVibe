// Dr. Vibe — Activity Reporter
// Subscribes to local activity EventBus signals and forwards them to the
// EconomyClient, which handles persistence, retry, and server submission.
//
// Mapping:
//   TIMER_WORK_COMPLETE         → POMODORO_COMPLETE
//   FOCUS_MODE_ENDED            → FOCUS_SESSION_END            { durationMinutes }
//   GIT_COMMIT_MADE             → GIT_COMMIT
//   ACTIVITY_CODING_START       → CODING_SESSION_START
//   EYE_STRAIN_COMPLETE         → WELLNESS_CHECK               { kind: 'eyes' }
//   POSTURE_COMPLETE            → WELLNESS_CHECK               { kind: 'posture' }
//   HYDRATION_LOGGED            → WELLNESS_CHECK               { kind: 'hydration' }
//   BOUNDARY_REMINDER_SENT      → WELLNESS_CHECK               { kind: 'break' }
//   PERSONAL_BEST_SET           → PERSONAL_BEST                { record, value }
//   STREAK_DAY_COUNTED          → STREAK_DAY                   { streakLength, day } (id: streak-day-<day>)
//   SKILL_MILESTONE             → SKILL_MILESTONE              { skillId } (audit-only, 0 VP)
//
// Metadata follows drvibe-protocol `EconomyEventType` (server/API.md §7).
//   COMMUNITY_ACCOUNT_CONNECTED → COMMUNITY_ACCOUNT_CONNECTED  (audit-only, 0 VP)
//   COMMUNITY_GALLERY_SUBMITTED → COMMUNITY_GALLERY_SUBMITTED  (audit-only, 0 VP)
//   COMMUNITY_SKIN_INSTALLED    → COMMUNITY_SKIN_INSTALLED     (audit-only, 0 VP)

import { eventBus, Events } from '../../core/EventBus.js';
import { economyClient } from './EconomyClient.js';

export class ActivityReporter {
  constructor() {
    this._initialized = false;
  }

  /**
   * @param {Object} [opts]
   * @param {() => ({streakLength: number, day: string}|null)} [opts.streakToday]
   *   Today's counted streak day. The streak counts once a day, often before
   *   this reporter subscribes during startup, so it is re-reported here; the
   *   fixed id makes a repeat a no-op on the server.
   */
  init({ streakToday } = {}) {
    if (this._initialized) return;
    this._initialized = true;

    eventBus.on(Events.TIMER_WORK_COMPLETE, (data) => {
      economyClient.reportActivity('POMODORO_COMPLETE', {});
    });

    eventBus.on(Events.FOCUS_MODE_ENDED, (data) => {
      const durationMinutes = Number(
        data?.durationMinutes ?? data?.duration ?? 0
      ) || 0;
      economyClient.reportActivity('FOCUS_SESSION_END', { durationMinutes });
    });

    eventBus.on(Events.GIT_COMMIT_MADE, (data) => {
      // A keyed hash of the commit (projects.rs `event_id`) lets the server
      // de-duplicate without learning the commit; the git hash and the repo
      // name are never sent.
      economyClient.reportActivity('GIT_COMMIT', {
        sha: data?.commit?.event_id ?? null,
      });
    });

    eventBus.on(Events.ACTIVITY_CODING_START, (data) => {
      economyClient.reportActivity('CODING_SESSION_START', {});
    });

    eventBus.on(Events.EYE_STRAIN_COMPLETE, (data) => {
      economyClient.reportActivity('WELLNESS_CHECK', { kind: 'eyes' });
    });

    eventBus.on(Events.POSTURE_COMPLETE, (data) => {
      economyClient.reportActivity('WELLNESS_CHECK', { kind: 'posture' });
    });

    eventBus.on(Events.BOUNDARY_REMINDER_SENT, (data) => {
      economyClient.reportActivity('WELLNESS_CHECK', { kind: 'break' });
    });

    eventBus.on(Events.PERSONAL_BEST_SET, (data) => {
      economyClient.reportActivity('PERSONAL_BEST', {
        record: data?.metric ?? 'unknown',
        value: Number(data?.newBest ?? 0),
      });
    });

    eventBus.on(Events.HYDRATION_LOGGED, () => {
      economyClient.reportActivity('WELLNESS_CHECK', { kind: 'hydration' });
    });

    // One per local calendar day while the streak is alive. The fixed id
    // makes a repeat (restart, second machine) a server-side replay.
    const reportStreakDay = ({ streakLength, day } = {}) => {
      if (!day || !streakLength) return;
      economyClient.reportActivity('STREAK_DAY', { streakLength, day }, `streak-day-${day}`);
    };
    eventBus.on(Events.STREAK_DAY_COUNTED, reportStreakDay);
    try {
      const today = streakToday?.();
      if (today) reportStreakDay(today);
    } catch (e) {
      console.warn('[economy] streak re-report failed:', e);
    }

    // Skill milestones — crosses a language-time threshold (e.g. 1h, 5h, 10h).
    // Reported for server verification of skill achievements. No VP payout.
    eventBus.on(Events.SKILL_MILESTONE, (data) => {
      economyClient.reportActivity('SKILL_MILESTONE', {
        skillId: `${data?.language ?? 'unknown'}:${data?.milestone ?? data?.threshold ?? ''}`,
      });
    });

    // Community events — also audit-only. The server uses these to verify
    // gallery_debut / gallery_regular / skin_collector / community_connected.
    eventBus.on(Events.COMMUNITY_ACCOUNT_CONNECTED, (data) => {
      economyClient.reportActivity('COMMUNITY_ACCOUNT_CONNECTED', {
        username: data?.username ?? null,
      });
    });

    eventBus.on(Events.COMMUNITY_GALLERY_SUBMITTED, (data) => {
      economyClient.reportActivity('COMMUNITY_GALLERY_SUBMITTED', {
        slug: data?.slug ?? null,
      });
    });

    eventBus.on(Events.COMMUNITY_SKIN_INSTALLED, (data) => {
      economyClient.reportActivity('COMMUNITY_SKIN_INSTALLED', {
        skinId: data?.slug ?? null,
      });
    });
  }
}

export const activityReporter = new ActivityReporter();
