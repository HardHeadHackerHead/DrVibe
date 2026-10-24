// Dr. Vibe — Economy Client
// Outbound activity reporter with a persistent retry queue.
//
// Runs only while the app is linked to a community account: unlinked
// players earn nothing, so their activity is not queued at all. While
// linked but offline, events queue on disk up to MAX_QUEUE (oldest dropped).
//
// Responsibilities:
//  - Mint a UUID clientEventId per activity event (retries reuse it → server
//    idempotency absorbs duplicates).
//  - Persist the pending queue to Database.js (section `economy`, key
//    `pendingEvents`) so nothing is lost on crash/restart.
//  - POST events in batches through desktopApi.reportEvents (api/client.js).
//  - On 2xx: remove from queue, emit Events.ECONOMY_EARNED locally.
//  - On 4xx (non-429): drop the item — retrying a client error is pointless.
//  - On 401: pause the queue and tell AccountState the token was rejected;
//    resume() runs on the next ACCOUNT_LINKED.
//  - On 429 / 5xx / network error: exponential backoff (1s → 60s), keep item.
//  - Flushes the persisted queue on app start.
//  - Throttles earn toasts: 1 per 10 seconds, sums amount totals; suppresses
//    toasts when awarded === 0 (cap hit).

import { eventBus, Events } from '../../core/EventBus.js';
import { db } from '../../core/Database.js';
import { desktopApi } from '../../core/api/client.js';
import { accountState } from '../../core/AccountState.js';

const DB_SECTION = 'economy';
const DB_KEY_QUEUE = 'pendingEvents';
const DB_KEY_DEFERRED = 'deferredEvents';

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const TOAST_THROTTLE_MS = 10_000;
// Max events sent per POST. The server caps batches at 100; we stay below
// that so a queue dump is a single request even after long offline periods.
// Each batch costs one rate-limit slot (60/min request cap), so 50 means a
// 3000-event backlog drains in 60 requests = 1 minute of steady traffic.
const MAX_BATCH = 50;
// Size cap for the on-disk queue (pending + deferred). A week offline at a
// busy pace is a few hundred events; past this the oldest are dropped.
export const MAX_QUEUE = 2000;

// Retry schedule for server-rejected claims (achievement/mastery "underqualified"
// outcomes). The activity queue drains FIFO, so a claim that arrives before its
// backing events is expected — we just need to keep retrying until the event
// count catches up. Total window: ~16 minutes. After MAX_RETRIES we give up with
// a visible toast and drop the claim.
const CLAIM_RETRY_BACKOFFS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
const MAX_CLAIM_RETRIES = CLAIM_RETRY_BACKOFFS_MS.length;
const DEFERRED_CHECK_INTERVAL_MS = 30_000;

// Reason codes from the server that indicate a claim was rejected because the
// user hasn't (yet) met the underlying criteria. These are retryable — the
// activity queue may still be draining. Anything else (cap hits, already-claimed,
// validation errors) is terminal.
const RETRYABLE_REJECTION_PREFIXES = [
  'underqualified',
  'mastery_underqualified',
  'streak_underqualified',
  'no_qualifying_event',
];

function isRetryableRejection(reasonCode) {
  if (!reasonCode || typeof reasonCode !== 'string') return false;
  return RETRYABLE_REJECTION_PREFIXES.some((p) => reasonCode.startsWith(p) || reasonCode.includes(p));
}

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* ignore */ }
  // RFC4122-ish fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class EconomyClient {
  /**
   * @param {Object} [deps]
   * @param {typeof desktopApi} [deps.api]
   * @param {{linked: boolean, markTokenRejected?: Function}} [deps.account]
   */
  constructor({ api = desktopApi, account = accountState } = {}) {
    this._api = api;
    this._account = account;
    this._queue = [];
    this._flushing = false;
    this._paused = false; // paused on 401 until resume()
    this._backoffMs = BACKOFF_START_MS;
    this._backoffTimer = null;
    this._initialized = false;

    // Toast throttle state
    this._toastPendingAmount = 0;
    this._toastPendingReason = null;
    this._toastTimer = null;
    this._toastLastSentAt = 0;

    // Deferred (rejected-but-retryable) claims. Persisted separately so they
    // survive app restart. Each entry has { ...originalItem, retryCount,
    // nextRetryAt, lastReason }.
    this._deferred = [];
    this._deferredCheckTimer = null;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // Merge any events added pre-init with the persisted queue. Persisted
    // items go first (they're older), then any pre-init reports.
    let persisted = [];
    try {
      const saved = db.get(DB_SECTION, DB_KEY_QUEUE);
      if (Array.isArray(saved)) {
        persisted = saved.filter((e) => e && typeof e === 'object');
      }
    } catch (e) {
      console.warn('[economy] failed to load pending queue:', e);
    }

    this._queue = [...persisted, ...this._queue];
    this._enforceCap();
    this._persistQueue();

    // Load deferred claims that survived app restart. We DON'T auto-retry them
    // on init — the normal activity queue needs to drain first so the server
    // sees the up-to-date counts. The periodic check picks them up once the
    // retry time has elapsed.
    try {
      const savedDeferred = db.get(DB_SECTION, DB_KEY_DEFERRED);
      if (Array.isArray(savedDeferred)) {
        this._deferred = savedDeferred.filter((e) => e && typeof e === 'object');
      }
    } catch (e) {
      console.warn('[economy] failed to load deferred queue:', e);
    }

    if (this._queue.length > 0) {
      console.log(`[economy] flushing ${this._queue.length} pending event(s)`);
      this._scheduleFlush(0);
    }
    if (this._deferred.length > 0) {
      console.log(`[economy] ${this._deferred.length} deferred claim(s) awaiting retry`);
    }
    this._startDeferredCheckLoop();

    // Linking (or re-linking after a rejected token) restarts the queue.
    eventBus.on(Events.ACCOUNT_LINKED, () => this.resume());
  }

  /**
   * Report an activity event. Ignored while unlinked. Mints a clientEventId, enqueues, and starts
   * a flush pass. Returns quickly; network work is async.
   */
  reportActivity(eventType, metadata = {}, clientEventId = null) {
    if (!eventType) return;
    if (!this._account.linked) return;
    // A fixed id (e.g. one per streak day) makes repeats idempotent server-side.
    if (clientEventId && this._queue.some((it) => it.clientEventId === clientEventId)) return;

    const item = {
      eventType,
      clientEventId: clientEventId || uuid(),
      occurredAt: new Date().toISOString(),
      metadata: metadata || {},
      attempts: 0,
    };

    this._queue.push(item);
    this._enforceCap();
    this._persistQueue();
    this._scheduleFlush(0);
  }

  /** Resume a paused queue (call after auth refresh). */
  resume() {
    this._paused = false;
    if (this._queue.length > 0) this._scheduleFlush(0);
  }

  get queueLength() {
    return this._queue.length;
  }

  // --- Internal ---

  /** Drop the oldest events once the queue (plus deferred claims) passes MAX_QUEUE. */
  _enforceCap() {
    const room = MAX_QUEUE - this._deferred.length;
    if (this._queue.length > room) {
      const dropped = this._queue.length - Math.max(0, room);
      this._queue.splice(0, dropped);
      console.warn(`[economy] offline queue full — dropped ${dropped} oldest event(s)`);
    }
  }

  _persistQueue() {
    try {
      db.set(DB_SECTION, DB_KEY_QUEUE, this._queue);
    } catch (e) {
      console.warn('[economy] failed to persist queue:', e);
    }
  }

  _scheduleFlush(delayMs) {
    if (this._backoffTimer) {
      clearTimeout(this._backoffTimer);
      this._backoffTimer = null;
    }
    this._backoffTimer = setTimeout(() => {
      this._backoffTimer = null;
      this._flush().catch((e) => console.warn('[economy] flush error:', e));
    }, Math.max(0, delayMs || 0));
  }

  async _flush() {
    if (this._flushing || this._paused) return;
    if (this._queue.length === 0) return;
    // Unlinked: hold the queue until ACCOUNT_LINKED calls resume().
    if (!this._account.linked) return;

    this._flushing = true;
    try {
      while (this._queue.length > 0 && !this._paused) {
        // Take the head of the queue as a batch — leave items in place until
        // we know their per-event outcomes. Server preserves order in the
        // results array, so we apply outcomes positionally.
        const batch = this._queue.slice(0, MAX_BATCH);
        const send = await this._sendBatch(batch);

        if (send.httpOutcome === 'pause') {
          // 401 on the whole request — stop processing, keep items in queue.
          this._paused = true;
          break;
        }
        if (send.httpOutcome === 'retry') {
          // 429 / 5xx / network — keep all items, schedule backoff, stop loop.
          for (const it of batch) it.attempts = (it.attempts || 0) + 1;
          this._persistQueue();
          this._scheduleFlush(this._nextBackoff());
          break;
        }

        // httpOutcome === 'ok' — apply per-result handling. Results are in
        // batch order; items marked 'retry' stay queued (moved to the back
        // so the rest of the queue is not blocked behind them).
        const retry = [];
        for (let i = 0; i < batch.length; i++) {
          const item = batch[i];
          const outcome = send.results[i];
          if (outcome === 'defer') this._moveToDeferred(item);
          else if (outcome === 'retry') retry.push(item);
        }
        const sent = new Set(batch.map((it) => it.clientEventId));
        this._queue = this._queue.filter((it) => !sent.has(it.clientEventId)).concat(retry);
        this._persistQueue();
        this._resetBackoff();
        if (retry.length === batch.length) {
          // Nothing got through (every event rate limited): back off.
          this._scheduleFlush(this._nextBackoff());
          break;
        }
        // Loop continues — next slice of the queue gets sent. If queue is
        // now drained, the while exits naturally.
      }
    } finally {
      this._flushing = false;
    }
  }

  // ─── Deferred claim retry ──────────────────────────────────────────────
  //
  // Claims that the server rejected as "underqualified" go here instead of
  // being silently dropped. The normal activity queue keeps flushing, so the
  // events that BACK the claim will eventually land. We retry on an escalating
  // schedule (30s → 60s → 120s → 300s → 600s) and give up after 5 attempts.

  _moveToDeferred(item) {
    const retryCount = (item.retryCount ?? 0) + 1;

    if (retryCount > MAX_CLAIM_RETRIES) {
      // Ran out of retries. Surface a visible toast so the user knows.
      console.warn(
        `[economy] claim dropped after ${MAX_CLAIM_RETRIES} retries:`,
        item.eventType, item.metadata, 'last reason:', item.lastReason,
      );
      this._fireClaimFailureToast(item);
      this._persistDeferred();
      return;
    }

    const backoffMs = CLAIM_RETRY_BACKOFFS_MS[retryCount - 1];
    const entry = {
      ...item,
      retryCount,
      nextRetryAt: Date.now() + backoffMs,
    };
    this._deferred.push(entry);
    this._persistDeferred();
    console.log(
      `[economy] deferred claim (attempt ${retryCount}/${MAX_CLAIM_RETRIES}):`,
      item.eventType, '— retry in', Math.round(backoffMs / 1000), 's',
    );
    this._startDeferredCheckLoop();
  }

  _startDeferredCheckLoop() {
    if (this._deferredCheckTimer) return;
    if (this._deferred.length === 0) return;
    this._deferredCheckTimer = setInterval(
      () => this._promoteReadyDeferred(),
      DEFERRED_CHECK_INTERVAL_MS,
    );
  }

  _stopDeferredCheckLoop() {
    if (this._deferredCheckTimer) {
      clearInterval(this._deferredCheckTimer);
      this._deferredCheckTimer = null;
    }
  }

  _promoteReadyDeferred() {
    if (this._deferred.length === 0) {
      this._stopDeferredCheckLoop();
      return;
    }
    const now = Date.now();
    const ready = [];
    const still = [];
    for (const item of this._deferred) {
      if ((item.nextRetryAt ?? 0) <= now) ready.push(item);
      else still.push(item);
    }
    if (ready.length === 0) return;
    this._deferred = still;
    for (const item of ready) {
      this._queue.push(item);
    }
    this._persistQueue();
    this._persistDeferred();
    this._scheduleFlush(0);
    if (this._deferred.length === 0) {
      this._stopDeferredCheckLoop();
    }
  }

  _persistDeferred() {
    try {
      db.set(DB_SECTION, DB_KEY_DEFERRED, this._deferred);
    } catch (e) {
      console.warn('[economy] failed to persist deferred queue:', e);
    }
  }

  _fireClaimFailureToast(item) {
    // Inform the user that a claim ultimately couldn't be synced. Notifier
    // listens for ECONOMY_CLAIM_FAILED and renders a toast in the 'economy'
    // category (respects the "VP Earned" notification toggle).
    const label = this._claimLabel(item);
    eventBus.emit(Events.ECONOMY_CLAIM_FAILED, {
      label,
      lastReason: item.lastReason ?? 'unknown',
    });
  }

  _claimLabel(item) {
    const meta = item.metadata || {};
    if (item.eventType === 'ACHIEVEMENT_UNLOCKED' && typeof meta.achievementId === 'string') {
      return `Achievement "${meta.achievementId}"`;
    }
    if (item.eventType === 'MASTERY_LEVEL_UP' && meta.trackId) {
      return `Mastery ${meta.trackId} L${meta.level}`;
    }
    return item.eventType;
  }

  /**
   * Send a batch of queued events in one POST. Returns:
   *   { httpOutcome: 'pause' }              — 401, queue stays paused
   *   { httpOutcome: 'retry' }              — 429 / 5xx / network failure
   *   { httpOutcome: 'ok', results: [...] } — per-event outcomes ('ok'/'drop'/'defer')
   *
   * Server response shape for batches:
   *   { results: [ {clientEventId, awarded, newBalance, capHit, reasonCode, replay?, error?}, ... ] }
   *
   * Per-event toasts are queued here (the existing _queueToast already coalesces
   * within a 10s window, so a 50-event batch surfaces as one combined toast).
   * Balance push fires once per batch with the LAST result's newBalance.
   */
  async _sendBatch(items) {
    if (items.length === 0) return { httpOutcome: 'ok', results: [] };

    const resp = await this._api.reportEvents(items.map(item => ({
      eventType: item.eventType,
      clientEventId: item.clientEventId,
      occurredAt: item.occurredAt,
      metadata: item.metadata || {},
    })));

    if (resp.unlinked) return { httpOutcome: 'pause' };
    if (resp.status === 0) {
      console.warn('[economy] network error — will retry batch');
      return { httpOutcome: 'retry' };
    }
    if (resp.status === 401) {
      this._account.markTokenRejected?.();
      if (resp.error === 'invalid_device_token') {
        console.warn('[economy] device token revoked — pausing until the account is linked again');
        return { httpOutcome: 'pause' };
      }
      console.warn(`[economy] 401 ${resp.error} — will retry batch`);
      return { httpOutcome: 'retry' };
    }
    if (resp.status === 429) {
      console.warn('[economy] 429 — backing off batch');
      return { httpOutcome: 'retry' };
    }
    if (resp.status >= 500) {
      console.warn(`[economy] ${resp.status} server error — will retry batch`);
      return { httpOutcome: 'retry' };
    }
    if (!resp.ok) {
      // Other 4xx — the batch shape is invalid. Don't retry; drop it.
      console.warn(`[economy] ${resp.status} ${resp.error} — dropping batch (${items.length} events)`);
      return { httpOutcome: 'ok', results: items.map(() => 'drop') };
    }

    // EventBatchResponse { results: EventResult[], balance }
    const data = resp.data || {};
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length !== items.length) {
      // Server returned a different count than we sent — protocol mismatch.
      // Treat the whole batch as retryable so nothing is lost.
      console.warn('[economy] batch result count mismatch:',
        results.length, 'vs', items.length, '— retrying');
      return { httpOutcome: 'retry' };
    }

    const outcomes = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const r = results[i] || {};

      // A rejected event is not stored and may be retried with the same
      // clientEventId: `rate_limited` later, `invalid_event` never.
      if (r.error) {
        if (r.error === 'rate_limited') {
          outcomes.push('retry');
        } else {
          console.warn(`[economy] event ${item.eventType} dropped:`, r.error);
          outcomes.push('drop');
        }
        continue;
      }

      const amount = Number(r.awarded ?? 0);
      const reasonCode = r.reasonCode ?? 'activity_event';

      if (amount === 0 && isRetryableRejection(reasonCode)) {
        item.lastReason = reasonCode;
        outcomes.push('defer');
        continue;
      }

      if (amount > 0) {
        this._queueToast(amount, reasonCode);
      }
      outcomes.push('ok');
    }

    // One balance push per batch: the balance after the whole batch.
    if (Number.isFinite(Number(data.balance))) {
      eventBus.emit(Events.ECONOMY_BALANCE_PUSH, { newBalance: Number(data.balance) });
    }

    return { httpOutcome: 'ok', results: outcomes };
  }

  _nextBackoff() {
    const ms = this._backoffMs;
    this._backoffMs = Math.min(BACKOFF_MAX_MS, this._backoffMs * 2);
    return ms;
  }

  _resetBackoff() {
    this._backoffMs = BACKOFF_START_MS;
  }

  // --- Toast throttle (1 per 10s, summed; suppress cap hits) ---

  _queueToast(amount, reasonCode) {
    // Keep the most recent reasonCode for the combined toast — simple and
    // "good enough" for mixed bursts; cap hits are already filtered above.
    this._toastPendingAmount += Number(amount) || 0;
    this._toastPendingReason = reasonCode || this._toastPendingReason;

    const now = Date.now();
    const elapsed = now - this._toastLastSentAt;

    if (elapsed >= TOAST_THROTTLE_MS) {
      this._flushToast();
      return;
    }
    if (!this._toastTimer) {
      this._toastTimer = setTimeout(() => {
        this._toastTimer = null;
        this._flushToast();
      }, TOAST_THROTTLE_MS - elapsed);
    }
  }

  _flushToast() {
    if (this._toastPendingAmount <= 0) return;
    const amount = this._toastPendingAmount;
    const reasonCode = this._toastPendingReason || 'activity_event';
    this._toastPendingAmount = 0;
    this._toastPendingReason = null;
    this._toastLastSentAt = Date.now();

    // ECONOMY_EARNED is consumed by Notifier to display a "+X VP" toast.
    // newBalance is intentionally null here — balance was already updated
    // via ECONOMY_BALANCE_PUSH when each POST resolved.
    eventBus.emit(Events.ECONOMY_EARNED, {
      amount,
      newBalance: null,
      reasonCode,
      metadata: { throttled: true },
    });
  }
}

export const economyClient = new EconomyClient();
