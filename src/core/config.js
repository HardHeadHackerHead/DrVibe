// Dr. Vibe — Centralised endpoint configuration.
// Single source of truth for every URL the frontend points at — if the app
// ever moves to a new domain, change it here.

// Dev runs under live-server on port 1425 (see tauri.conf.json devUrl).
// Release builds are served from a custom protocol with no port, on both
// Windows (http://tauri.localhost/) and macOS (tauri://localhost/).
export const IS_DEV = window.location.port === '1425';

const URL_PRODUCTION = 'https://drvibe.io';
// A Dr. Vibe server running locally.
const URL_LOCALHOST = 'http://localhost:8080';

// Reads the persisted devServerOverride from the unified database mirror
// that Database.js writes to localStorage. It is set from the Developer tab
// in settings, which exists only in dev builds; release builds ignore it
// and always talk to production.
function readOverride() {
  if (!IS_DEV) return null;
  try {
    const raw = window.localStorage?.getItem('dr-vibe-database');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const value = parsed?.settings?.devServerOverride;
    if (typeof value !== 'string' || !value || value === 'auto') return null;
    return value;
  } catch {
    return null;
  }
}

function resolveWebBase() {
  const override = readOverride();
  if (override?.startsWith('custom:')) {
    const url = override.slice('custom:'.length).trim();
    return url || (IS_DEV ? URL_LOCALHOST : URL_PRODUCTION);
  }
  if (override === 'production') return URL_PRODUCTION;
  if (override === 'localhost')  return URL_LOCALHOST;
  return IS_DEV ? URL_LOCALHOST : URL_PRODUCTION;
}

// `export let` creates an ES module live binding — importers see the
// current value every time they dereference WEB_BASE. When the Admin →
// Dev Server panel hot-swaps the server, `reloadWebBase()` rewrites this
// value and all template-string callers (e.g. `${WEB_BASE}/api/...`)
// immediately start hitting the new URL on their next call.

export let WEB_BASE = resolveWebBase();

/**
 * Re-reads the persisted override from localStorage and reassigns the
 * module-level WEB_BASE binding. Called in every webview after the
 * Admin panel fires the 'server-switched' Tauri event so both the
 * settings window and the main window pick up the new URL without
 * restarting the process.
 *
 * Returns the new URL for convenience.
 */
export function reloadWebBase() {
  WEB_BASE = resolveWebBase();
  return WEB_BASE;
}

/**
 * Asks Rust for the current web_base_url() and reassigns WEB_BASE to
 * match. Call once at the top of each webview's boot path. Without this,
 * `npm run dev:prod` (which sets DR_VIBE_WEB_BASE_URL=https://drvibe.io
 * for Rust) would still leave the JS side defaulting to the local
 * server because IS_DEV is true. Env vars don't reach the renderer process
 * directly, so this round-trip is the bridge.
 *
 * Safe to call before Tauri is ready — falls back silently if the invoke
 * isn't available yet.
 */
export async function syncWebBaseFromRust() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return WEB_BASE;
    const url = await invoke('get_web_base_url');
    if (typeof url === 'string' && url) {
      WEB_BASE = url;
    }
    return WEB_BASE;
  } catch {
    return WEB_BASE;
  }
}

/**
 * Returns the IANA timezone of the host machine (e.g. "America/Los_Angeles").
 * Sent as X-Client-Timezone on every economy request so the server can use
 * the user's local midnight as the daily-cap / quest-rollover boundary
 * instead of UTC midnight.
 * Falls back to 'UTC' if the runtime doesn't expose Intl.
 */
export function getClientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
