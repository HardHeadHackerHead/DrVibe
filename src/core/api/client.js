// Dr. Vibe — the JS side of the API client.
//
// Requests are made by Rust (src-tauri/src/api.rs): it holds the device
// token, signs mutating calls and checks bodies against drvibe-protocol.
// This module only names the calls. It never throws for HTTP or network
// failures: callers get an ApiResult and decide what to do.

import { WEB_BASE, getClientTimezone } from '../config.js';
import { tauri } from '../TauriBridge.js';
import { Endpoints } from './endpoints.js';
import { parsePollResponse, toPrivacyPatch, buildVisitRequest } from './contract.js';

/**
 * @typedef {Object} ApiResult
 * @property {boolean} ok           2xx
 * @property {number} status        HTTP status, 0 on network error
 * @property {boolean} notModified  304
 * @property {any} data             parsed JSON body (null if none)
 * @property {string|null} etag
 * @property {number|null} retryAfterSeconds
 * @property {boolean} unlinked     no device token: the request was not sent
 * @property {string|null} error    API error code (`visit_cooldown`, ...)
 */

const OFFLINE = Object.freeze({ ok: false, status: 0, notModified: false, data: null, etag: null, retryAfterSeconds: null, unlinked: false, error: null });

function invokeFn() {
  if (tauri.isAvailable && tauri.invoke) return tauri.invoke;
  return window.__TAURI__?.core?.invoke ?? null;
}

async function call(command, args) {
  const invoke = invokeFn();
  if (!invoke) return { ...OFFLINE };
  try {
    const r = await invoke(command, args);
    return { ...OFFLINE, ...(r || {}) };
  } catch (e) {
    console.warn(`[api] ${command} failed:`, e);
    return { ...OFFLINE };
  }
}

/** Read the linked account (no token: it stays in Rust). */
export async function getProfile() {
  const invoke = invokeFn();
  if (!invoke) return null;
  try {
    return await invoke('get_profile');
  } catch {
    return null;
  }
}

/** True when this install has a device token. */
export async function isLinked() {
  return !!(await getProfile())?.linked;
}

/**
 * Generic call for endpoints without a typed Rust command.
 * @param {keyof typeof Endpoints} name
 * @param {{ params?: any[], body?: any, etag?: string|null }} [opts]
 * @returns {Promise<ApiResult>}
 */
export function apiRequest(name, { params = [], body, etag = null } = {}) {
  const ep = Endpoints[name];
  if (!ep) throw new Error(`unknown endpoint ${name}`);
  return call('api_request', {
    method: ep.method,
    path: ep.path(...params),
    body: body === undefined ? null : body,
    signed: ep.signed,
    etag,
    timezone: getClientTimezone(),
  });
}

// ── High-level calls ──────────────────────────────────────────────────────

export const desktopApi = {
  /** @returns {Promise<ApiResult & {poll?: import('./contract.js').PollResult}>} */
  async poll(etag = null) {
    const r = await call('api_poll', { etag });
    if (r.ok && !r.notModified) return { ...r, poll: parsePollResponse(r.data, WEB_BASE) };
    return r;
  },

  /** Acknowledge toasts shown and visits played / missed. */
  ack({ notificationIds = [], visits = [] } = {}) {
    if (notificationIds.length === 0 && visits.length === 0) return Promise.resolve({ ...OFFLINE, ok: true });
    return call('api_ack', { ack: { notificationIds, visits } });
  },

  /** Send the privacy settings. Call only when the player changed one. */
  updatePrivacy(privacy) {
    return call('api_update_privacy', { patch: toPrivacyPatch(privacy) });
  },

  sendVisit(toUsername, preset = null, replyToVisitId = null) {
    return call('api_send_visit', { request: buildVisitRequest(toUsername, preset, replyToVisitId) });
  },

  /** The last few visits other players sent here (`GET /me/visits`). */
  recentVisits(limit = 5) { return apiRequest('myVisits', { params: ['received', limit] }); },

  submitDesign({ pngBase64, animJson = null, name, description = '', vibeId = null }) {
    return call('api_submit_design', { pngBase64, animJson, name, description, vibeId });
  },

  /** Economy events (`EconomyEvent[]`), with the player's time zone for daily caps. */
  reportEvents(events) {
    return call('api_send_events', { batch: { events }, timezone: getClientTimezone() });
  },

  balance() { return apiRequest('economyBalance'); },
  quests() { return apiRequest('quests'); },
  claimQuest(userQuestId) { return apiRequest('claimQuest', { params: [userQuestId], body: {} }); },
  collection() { return call('api_collection', {}); },
  /** Equip a collected Dr. Vibe, or `null` to go back to a local skin. */
  setEquipped(companionId) { return call('api_set_equipped', { request: { companionId: companionId ?? null } }); },

  /** Last week's recap (`{ weekStart, summary, share }`, numbers only); answers `{ cardUrl }`. */
  sendRecap(request) { return call('api_send_recap', { request }); },
};
