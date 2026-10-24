// Dr. Vibe — weekly recap: last week's WeeklySummary numbers, sent once to
// drvibe.io so the site can draw a share card and (Monday) a feed post.
//
// PLAN "Weekly recap" and API.md §18 `POST /me/recap`. What goes out is
// numbers only: coding time, active days, files created/modified, longest
// session, streak and the week's date label. Never project names; the Rust
// command (`api_send_recap`) drops any other field as well.
//
// Once per week: the week is the last complete Monday–Sunday (session
// history days are UTC dates, see SessionTracker.saveSession), and the
// Monday of the last week sent is stored here. Network errors and 429/5xx
// retry (short backoff, then the hourly check). Nothing is sent while
// unlinked, with a private profile, or with "Share my weekly recap" off.

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';
import { desktopApi } from '../../core/api/client.js';
import { accountState } from '../../core/AccountState.js';
import { privacySync } from '../privacy/PrivacySync.js';
import { aggregateDays } from './WeeklySummary.js';
import { localDay } from '../../core/localDay.js';

const SECTION = 'weeklyRecap';
const DAY_MS = 86_400_000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000];

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function keyMs(key) {
  return Date.parse(`${key}T00:00:00Z`);
}

/** The Monday (`YYYY-MM-DD`) of the week holding the day `key`. */
export function mondayOf(key) {
  const ms = keyMs(key);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return dayKey(ms - sinceMonday * DAY_MS);
}

/** The Monday of the last complete week before `now`. */
export function lastCompleteWeek(now = new Date()) {
  return dayKey(keyMs(mondayOf(localDay(now))) - 7 * DAY_MS);
}

/** The seven day keys of the week starting `monday`. */
export function weekDays(monday) {
  const start = keyMs(monday);
  return Array.from({ length: 7 }, (_, i) => dayKey(start + i * DAY_MS));
}

function weekLabel(days) {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const fmt = (key) => new Date(keyMs(key)).toLocaleDateString(undefined, opts);
  return `${fmt(days[0])} - ${fmt(days[6])}`;
}

const whole = (n) => Math.max(0, Math.round(Number(n) || 0));

/**
 * The `POST /me/recap` body for the week starting `monday`: the
 * WeeklySummary numbers over that week's history, no project names.
 */
export function buildRecapRequest(history, monday, streak) {
  const days = weekDays(monday);
  const byDate = new Map((history || []).map((h) => [h.date, h]));
  const totals = aggregateDays(days.map((date) => byDate.get(date) || { date }));
  return {
    weekStart: monday,
    share: true,
    summary: {
      weekLabel: weekLabel(days),
      totalSeconds: whole(totals.totalSeconds),
      activeDays: whole(totals.activeDays),
      totalFilesCreated: whole(totals.totalFilesCreated),
      totalFilesModified: whole(totals.totalFilesModified),
      longestSessionSeconds: whole(totals.longestSessionSeconds),
      streak: whole(streak),
    },
  };
}

export class WeeklyRecapSync {
  /**
   * @param {Object} deps
   * @param {() => Promise<any[]>|any[]} deps.getHistory  SessionTracker history
   * @param {() => number} deps.getStreak
   * @param {{get: (key: string) => any}} deps.settings
   * @param {(cardUrl: string, request: any) => void} [deps.onSent]  the "View card" toast
   * @param {typeof desktopApi} [deps.api]
   * @param {{linked: boolean, markTokenRejected?: Function}} [deps.account]
   * @param {{get: () => {profileVisibility: string}}} [deps.privacy]
   * @param {{load: () => any, save: (v: any) => void}} [deps.store]
   * @param {() => Date} [deps.now]
   */
  constructor({
    getHistory,
    getStreak,
    settings,
    onSent = () => {},
    api = desktopApi,
    account = accountState,
    privacy = privacySync,
    store = { load: () => db.getSection(SECTION), save: (v) => db.setSection(SECTION, v) },
    now = () => new Date(),
  }) {
    this._getHistory = getHistory;
    this._getStreak = getStreak;
    this._settings = settings;
    this._onSent = onSent;
    this._api = api;
    this._account = account;
    this._privacy = privacy;
    this._store = store;
    this._now = now;
    this._sending = null;
    this._retryTimer = null;
    this._retries = 0;
    this._interval = null;
    this._onLinked = () => { this.maybeSend(); };
  }

  init() {
    eventBus.on(Events.ACCOUNT_LINKED, this._onLinked);
    this._interval = setInterval(() => this.maybeSend(), CHECK_EVERY_MS);
    return this.maybeSend();
  }

  destroy() {
    eventBus.off?.(Events.ACCOUNT_LINKED, this._onLinked);
    clearInterval(this._interval);
    clearTimeout(this._retryTimer);
  }

  /** The Monday of the last week sent, or null. */
  get lastSentWeek() {
    return this._state().lastSentWeek ?? null;
  }

  /** False when the player hid their profile or turned the recap off. */
  sharingAllowed() {
    if (this._settings?.get?.('shareWeeklyRecap') === false) return false;
    return this._privacy?.get?.()?.profileVisibility !== 'private';
  }

  /**
   * Send last week's recap if it is due. Resolves to what happened:
   * `sent`, `already_sent`, `unlinked`, `opted_out`, `empty`, `retry` or `rejected`.
   */
  maybeSend() {
    if (this._sending) return this._sending;
    this._sending = this._send().finally(() => { this._sending = null; });
    return this._sending;
  }

  async _send() {
    const week = lastCompleteWeek(this._now());
    if (this.lastSentWeek === week) return 'already_sent';
    if (!this._account.linked) return 'unlinked';
    if (!this.sharingAllowed()) return 'opted_out';

    const request = buildRecapRequest(await this._getHistory(), week, this._getStreak());
    if (request.summary.totalSeconds === 0) return 'empty';

    const r = await this._api.sendRecap(request);
    if (r.unlinked) return 'unlinked';
    if (r.status === 401) this._account.markTokenRejected?.();
    if (r.ok) {
      this._retries = 0;
      const cardUrl = r.data?.cardUrl ?? null;
      this._store.save({ lastSentWeek: week, cardUrl });
      if (cardUrl) this._onSent(cardUrl, request);
      return 'sent';
    }
    if (r.status === 0 || r.status === 429 || r.status >= 500) {
      this._scheduleRetry(r.retryAfterSeconds);
      return 'retry';
    }
    if (r.status === 401) return 'unlinked';
    // Any other 4xx (e.g. 422 for a week the server no longer takes) will
    // not change on a retry: count the week as done.
    this._store.save({ lastSentWeek: week, cardUrl: null });
    return 'rejected';
  }

  _scheduleRetry(retryAfterSeconds) {
    if (this._retryTimer || this._retries >= RETRY_MS.length) return;
    const delay = Math.max(RETRY_MS[this._retries], (retryAfterSeconds || 0) * 1000);
    this._retries += 1;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.maybeSend();
    }, delay);
  }

  _state() {
    const s = this._store.load();
    return s && typeof s === 'object' ? s : {};
  }
}
