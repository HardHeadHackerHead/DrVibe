// Dr. Vibe — every server endpoint the desktop app calls, in one place.
//
// Paths are below `/api/v1` (server/API.md). All requests go out through the
// Rust commands in src-tauri/src/api.rs, which add the device token, sign the
// mutating ones (API.md §2) and check typed bodies against drvibe-protocol.
// `signed: true` marks the routes API.md lists as device-signed.

/**
 * @typedef {Object} Endpoint
 * @property {'GET'|'POST'|'PUT'|'DELETE'} method
 * @property {(...args: any[]) => string} path
 * @property {boolean} signed
 * @property {string} [command]  dedicated typed Rust command, if any
 */

const enc = encodeURIComponent;

/** @type {Record<string, Endpoint>} */
export const Endpoints = {
  // §3 sync and poll
  desktopPoll:     { method: 'GET',  path: () => '/desktop/poll', signed: false, command: 'api_poll' },
  desktopAck:      { method: 'POST', path: () => '/desktop/ack', signed: true, command: 'api_ack' },
  desktopSync:     { method: 'POST', path: () => '/desktop/sync', signed: true, command: 'sync_profile' },
  lastSync:        { method: 'GET',  path: () => '/me/last-sync', signed: false, command: 'get_last_sync' },
  // §6 privacy
  updatePrivacy:   { method: 'PUT',  path: () => '/privacy', signed: true, command: 'api_update_privacy' },
  // §7 economy
  economyEvents:   { method: 'POST', path: () => '/desktop/events', signed: true, command: 'api_send_events' },
  economyBalance:  { method: 'GET',  path: () => '/economy/balance', signed: false },
  // §8 quests
  quests:          { method: 'GET',  path: () => '/quests', signed: false },
  claimQuest:      { method: 'POST', path: (id) => `/quests/${enc(id)}/claim`, signed: true },
  // §12 collection
  collection:      { method: 'GET',  path: () => '/desktop/collection', signed: false, command: 'api_collection' },
  setEquipped:     { method: 'PUT',  path: () => '/desktop/equipped', signed: true, command: 'api_set_equipped' },
  // §13 designs (multipart, bearer)
  submitDesign:    { method: 'POST', path: () => '/designs', signed: false, command: 'api_submit_design' },
  // §18 weekly recap card
  sendRecap:       { method: 'POST', path: () => '/me/recap', signed: true, command: 'api_send_recap' },
  // §19 visits
  sendVisit:       { method: 'POST', path: () => '/visits', signed: true, command: 'api_send_visit' },
  myVisits:        { method: 'GET',  path: (direction = 'received', limit = 5) => `/me/visits?direction=${enc(direction)}&limit=${limit}`, signed: false },
};

// ── Website pages the app opens in the browser ───────────────────────────
// Linking itself is started by the Rust command `start_device_link`, which
// opens `/connect?codeChallenge&installId&deviceName&platform&appVersion`.

export const WebRoutes = {
  privacy: () => '/privacy',
  terms: () => '/terms',
  machines: () => '/machines',
  me: () => '/me',
  collection: () => '/collection',
  trades: () => '/trades',
  donate: () => '/donate',
  incubator: () => '/incubator',
  profile: (username) => `/u/${enc(username)}`,
  community: () => '/community',
};
