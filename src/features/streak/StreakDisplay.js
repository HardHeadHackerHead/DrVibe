// Dr. Vibe - the streak the app shows.
//
// The website owns the "builder streak" (API.md §3): a day counts when the
// player used Dr. Vibe or made a GitHub contribution. Every sync answers
// with it and `GET /me/streak` reads it between syncs. While linked and the
// server's number is fresh, the app shows that one; otherwise it shows the
// local DailyStreakTracker, which keeps running either way (it feeds
// STREAK_DAY and the sync payload; VP never depends on what is shown).
//
// Milestone celebrations follow the shown number, so a player never gets a
// local "7 days!" next to a server 20, or the same milestone twice when the
// shown number switches source.

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';
import { parseBuilderStreak, parseMeStreak } from '../../core/api/contract.js';
import { MILESTONES, MILESTONE_MESSAGES } from './DailyStreakTracker.js';

const SECTION = 'serverStreak';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A server streak older than this is not shown. The app syncs every 15
 * minutes while running, so an older value means it has been offline or
 * closed: the server's number may have broken or grown since, while the
 * local tracker still knows about today. 48 h covers the tracker's 36 h
 * grace period plus a missed day, so one offline evening does not flip the
 * display back and forth.
 */
export const SERVER_STREAK_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * The streak to show: the server's when linked, computed by the server
 * (`source === 'server'`) and fetched within SERVER_STREAK_MAX_AGE_MS;
 * the local tracker's otherwise.
 * @param {{ current?: number, max?: number }} local  DailyStreakTracker data
 * @param {{ streak: import('../../core/api/contract.js').BuilderStreak|null, fetchedAt: number|null }|null} cache
 * @returns {{ current: number, longest: number, includesGithub: boolean, source: 'server'|'local' }}
 */
export function chooseStreak(local, cache, { linked, now = Date.now() } = {}) {
  const s = cache?.streak;
  const age = now - (cache?.fetchedAt ?? -Infinity);
  if (linked && s && s.source === 'server' && age >= 0 && age <= SERVER_STREAK_MAX_AGE_MS) {
    return { current: s.current, longest: s.longest, includesGithub: s.includesGithub, source: 'server' };
  }
  const current = local?.current || 0;
  return { current, longest: Math.max(current, local?.max || 0), includesGithub: false, source: 'local' };
}

export class StreakDisplay {
  /**
   * @param {{ tracker: import('./DailyStreakTracker.js').DailyStreakTracker|null,
   *   isLinked: () => boolean, fetchStreak?: () => Promise<{ ok: boolean, data: any }> }} deps
   */
  constructor({ tracker, isLinked, fetchStreak = null }) {
    this.tracker = tracker;
    this.isLinked = isLinked;
    this.fetchStreak = fetchStreak;
    this.state = {
      streak: null,        // BuilderStreak from the last sync or GET /me/streak
      fetchedAt: null,     // Unix ms
      githubLinked: null,  // from GET /me/streak; null = not known
      hintDismissed: false,
      celebratedAt: {},    // { [milestone]: Unix ms } shared with the local tracker
    };
    this._unsubscribers = [];
  }

  init() {
    const saved = db.getSection(SECTION);
    if (saved) this.state = { ...this.state, ...saved, celebratedAt: { ...(saved.celebratedAt || {}) } };
    if (this.tracker) {
      this.tracker.shownByServer = () => {
        const shown = this.get();
        return shown.source === 'server' ? shown.current : null;
      };
      this.tracker.claimMilestone = (m) => this._claim(m, Date.now());
    }
    this._unsubscribers.push(
      eventBus.on(Events.ACCOUNT_UNLINKED, () => {
        this.state.streak = null;
        this.state.fetchedAt = null;
        this.state.githubLinked = null;
        this._save();
      }),
      eventBus.on(Events.ACCOUNT_LINKED, () => { this.refresh().catch(() => {}); }),
    );
  }

  /** What to show now (see chooseStreak), plus the "connect GitHub" hint. */
  get(now = Date.now()) {
    const local = this.tracker?.getData() ?? {};
    const linked = !!this.isLinked();
    return {
      ...chooseStreak(local, this.state, { linked, now }),
      githubHint: linked && this.state.githubLinked === false && !this.state.hintDismissed,
    };
  }

  /** `SyncResponse.streak` (absent from older servers: the cache stays as it was). */
  applySync(raw, now = Date.now()) {
    const streak = parseBuilderStreak(raw);
    if (streak) this._update(streak, now);
  }

  /** `GET /me/streak`, on launch and on linking. */
  async refresh() {
    if (!this.fetchStreak || !this.isLinked()) return;
    const r = await this.fetchStreak();
    if (!r?.ok) return;
    const { streak, githubLinked } = parseMeStreak(r.data);
    if (githubLinked !== null) this.state.githubLinked = githubLinked;
    if (streak) this._update(streak, Date.now());
    else this._save();
  }

  dismissGithubHint() {
    this.state.hintDismissed = true;
    this._save();
  }

  _update(streak, now) {
    const before = this.get(now).current;
    this.state.streak = streak;
    this.state.fetchedAt = now;
    this._save();
    const shown = this.get(now);
    if (shown.source !== 'server') return;
    // Claim every milestone the shown number just passed; cheer only the
    // highest new one (a first sync can jump from 3 to 120).
    const fresh = MILESTONES.filter((m) => before < m && shown.current >= m).filter((m) => this._claim(m, now));
    const milestone = fresh.at(-1);
    const message = milestone && MILESTONE_MESSAGES[milestone];
    if (message) {
      eventBus.emit(Events.STREAK_MILESTONE, {
        milestone,
        streak: shown.current,
        text: message.text,
        tip: shown.includesGithub ? `${message.tip} (GitHub days count too.)` : message.tip,
      });
    }
  }

  /**
   * True if `m` may be celebrated now, and records it. A streak that broke
   * needs at least `m` more days to reach `m` again, so a second claim
   * within `m` days is the same streak seen through the other source.
   */
  _claim(m, now) {
    const last = this.state.celebratedAt[m];
    if (Number.isFinite(last) && now - last < m * DAY_MS) return false;
    this.state.celebratedAt[m] = now;
    this._save();
    return true;
  }

  _save() {
    db.setSection(SECTION, this.state);
  }

  destroy() {
    for (const unsub of this._unsubscribers) unsub();
  }
}
