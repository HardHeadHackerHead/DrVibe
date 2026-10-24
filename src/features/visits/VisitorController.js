// Dr. Vibe — decides when a visit plays on this desktop.
//
// Visits arrive from the 60 s poll (VISIT_RECEIVED) or a local test
// trigger. Rules (PLAN → Visits):
//   - one visitor on screen at a time; the rest queue
//   - during focus mode, a pomodoro work block, a screen share or a
//     fullscreen app the visit waits and plays at the next break
//   - at most 5 walk-ons per hour; extras, and visits that waited too long,
//     are acked `missed` (POST /desktop/ack), and the server turns them into
//     a "@sender visited while you were away" notification. Played ones are
//     acked `played`.
// The visitor window (visitor.html) does the walking; this controller feeds
// it geometry and the sprite, and makes this player's Dr. Vibe wave back.

import { eventBus, Events } from '../../core/EventBus.js';
import { VISIT_PRESETS } from '../../core/api/contract.js';

export const MAX_WALK_ONS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
/** A visit that waited longer than this plays as a notification instead. */
export const MAX_VISIT_WAIT_MS = 2 * HOUR_MS;
const BETWEEN_VISITS_MS = 3000;
/** If the visitor window never reports `visitor-done`, free the stage after this. */
export const VISIT_WATCHDOG_MS = 90_000;

export class VisitorController {
  /**
   * @param {Object} deps
   * @param {() => boolean} deps.isBusy           focus / pomodoro / presenting
   * @param {(payload: Object) => Promise<void>} deps.showVisitor   emits visitor-play
   * @param {(visit: Object) => Promise<Object|null>} deps.resolveSprite  { localSkin } | { pngBase64, animJson, slug }
   * @param {() => Promise<Object>} deps.getStage  { geometry, size, scale, skinTone }
   * @param {(visit: Object) => void} deps.onArrive  main Dr. Vibe waves + speech
   * @param {(toUsername: string, inReplyTo: string) => Promise<{ok: boolean, status: number}>} deps.sendVisit
   * @param {(visitId: string, outcome: 'played'|'missed') => Promise<any>} [deps.ackVisit]
   * @param {typeof eventBus} [deps.bus]
   * @param {() => number} [deps.now]
   */
  constructor({ isBusy, showVisitor, resolveSprite, getStage, onArrive, sendVisit, ackVisit = async () => {}, bus = eventBus, now = () => Date.now() }) {
    this._ackVisit = ackVisit;
    this._isBusy = isBusy;
    this._showVisitor = showVisitor;
    this._resolveSprite = resolveSprite;
    this._getStage = getStage;
    this._onArrive = onArrive;
    this._sendVisit = sendVisit;
    this._bus = bus;
    this._now = now;
    this._queue = [];
    this._walkOns = [];
    this._playing = null;
    this._retryTimer = null;
    this._watchdog = null;
  }

  get queueLength() { return this._queue.length; }
  get playing() { return this._playing; }

  init() {
    this._bus.on(Events.VISIT_RECEIVED, ({ visit }) => this.enqueue(visit));
    // Moments when a held visit may play.
    for (const ev of [Events.PRESENTING_ENDED, Events.TIMER_BREAK_START, Events.FOCUS_MODE_ENDED]) {
      this._bus.on(ev, () => this.tryPlay());
    }
  }

  enqueue(visit) {
    if (!visit?.from?.username) return;
    if (this._playing?.id === visit.id || this._queue.some((q) => q.visit.id === visit.id)) return;
    this._queue.push({ visit, receivedAt: this._now() });
    this.tryPlay();
  }

  /** Called by the visitor window when the visit has walked off. */
  done() {
    clearTimeout(this._watchdog);
    this._watchdog = null;
    const visit = this._playing;
    if (visit && !visit.test) this._ack(visit, 'played');
    this._playing = null;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this.tryPlay(), BETWEEN_VISITS_MS);
  }

  /** Called by the visitor window when the visitor reached its spot. */
  arrived(visit) {
    this._onArrive(visit);
  }

  /** "Wave back" from the visitor's menu: send a visit in return. */
  async waveBack(toUsername, inReplyTo) {
    return this._sendVisit(toUsername, inReplyTo);
  }

  _ack(visit, outcome) {
    Promise.resolve(this._ackVisit(visit.id, outcome)).catch(() => {});
  }

  async tryPlay() {
    if (this._playing) return;
    this._expireStale();
    if (this._queue.length === 0) return;
    // Local test visits (debug trigger) skip the busy and rate rules.
    const next = this._queue[0].visit;
    if (!next.test && this._isBusy()) return;

    const { visit } = this._queue.shift();
    if (!visit.test && !this._hasWalkOnBudget()) {
      this._ack(visit, 'missed');
      return this.tryPlay();
    }

    this._playing = visit;
    if (!visit.test) this._walkOns.push(this._now());
    try {
      const [sprite, stage] = await Promise.all([this._resolveSprite(visit), this._getStage()]);
      await this._showVisitor({ visit, sprite, ...stage });
      // A lost visitor-done event must not block visits for the session.
      clearTimeout(this._watchdog);
      this._watchdog = setTimeout(() => {
        if (this._playing === visit) {
          console.warn('[visits] no visitor-done; freeing the stage');
          this.done();
        }
      }, VISIT_WATCHDOG_MS);
    } catch (e) {
      console.warn('[visits] could not play visit, showing a notification instead:', e);
      this._playing = null;
      if (visit.test) this._notifyMissed(visit, 'stopped by');
      else this._ack(visit, 'missed');
    }
  }

  _hasWalkOnBudget() {
    const cutoff = this._now() - HOUR_MS;
    this._walkOns = this._walkOns.filter((t) => t > cutoff);
    return this._walkOns.length < MAX_WALK_ONS_PER_HOUR;
  }

  _expireStale() {
    const cutoff = this._now() - MAX_VISIT_WAIT_MS;
    const stale = this._queue.filter((q) => q.receivedAt < cutoff);
    if (stale.length === 0) return;
    this._queue = this._queue.filter((q) => q.receivedAt >= cutoff);
    for (const q of stale) {
      if (q.visit.test) this._notifyMissed(q.visit, 'visited while you were away');
      else this._ack(q.visit, 'missed');
    }
  }

  _notifyMissed(visit, verb) {
    const line = visit.preset && VISIT_PRESETS[visit.preset] ? ` “${VISIT_PRESETS[visit.preset]}”` : '';
    this._bus.emit(Events.NOTIFICATION_RECEIVED, {
      notification: {
        id: `visit-${visit.id}`,
        type: 'visit',
        title: `@${visit.from.username} ${verb}`,
        body: `Their Dr. Vibe dropped by.${line}`,
        url: null,
        data: { visitId: visit.id, fromUserId: visit.from.id },
        createdAt: visit.createdAt || null,
      },
    });
  }
}

/** Speech line for the receiver: "@sender stopped by!" plus the preset. */
export function visitSpeech(visit) {
  const preset = visit.preset && VISIT_PRESETS[visit.preset];
  const verb = visit.isWaveBack ? 'waved back' : 'stopped by';
  return { text: `@${visit.from.username} ${verb}!`, tip: preset || null };
}
