// Dr. Vibe — crash reports from the webviews.
//
// Catches window errors and unhandled promise rejections and hands them to
// Rust (`error_report` in src-tauri/src/error_reports.rs), which queues them
// on disk and sends them to drvibe.io's own /api/v1/errors endpoint — as the
// linked device, or anonymously when not linked. No outside service.
// Rust checks the Privacy switch (off until chosen), so a report made while
// it is off is dropped there, and it cuts every path, URL and token out of
// the text. Throttled here too, so a loop can't flood the queue. Values
// thrown that are not errors (objects, numbers) are not reported at all:
// their contents could be anything.

export const MAX_PER_PAGE = 10;
export const MAX_PER_MINUTE = 3;
export const REPEAT_WINDOW_MS = 10 * 60_000;

const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /AbortError/i];

let state = null;

function describe(value) {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack };
  if (typeof value === 'string') return { message: value };
  return null;
}

/** Queue one report unless it is noise, a repeat, or over the throttle. Returns whether it was handed on. */
export function reportError(value) {
  const s = state;
  if (!s) return false;
  const d = describe(value);
  if (!d || !d.message.trim() || IGNORED.some((re) => re.test(d.message))) return false;
  const now = s.now();
  const key = `${d.message}\n${(d.stack || '').split('\n').slice(0, 3).join('\n')}`;
  const last = s.seen.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  s.recent = s.recent.filter((t) => now - t < 60_000);
  if (s.sent >= MAX_PER_PAGE || s.recent.length >= MAX_PER_MINUTE) return false;
  s.seen.set(key, now);
  s.recent.push(now);
  s.sent += 1;
  const report = {
    source: 'desktop-js',
    message: d.message.slice(0, 1000),
    stack: d.stack ? d.stack.slice(0, 8000) : undefined,
    route: (typeof location !== 'undefined' && location.pathname) || undefined,
  };
  try {
    Promise.resolve(s.send(report)).catch(() => {});
  } catch {
    // Reporting must never throw.
  }
  return true;
}

const onError = (e) => reportError(e.error ?? e.message);
const onRejection = (e) => reportError(e.reason);

function tauriSend(report) {
  const invoke = window.__TAURI__?.core?.invoke;
  return invoke ? invoke('error_report', { report }) : undefined;
}

/** Start listening in this webview. Returns an uninstall function. */
export function installErrorReporter({ send = tauriSend, now = Date.now } = {}) {
  uninstallErrorReporter();
  state = { send, now, sent: 0, recent: [], seen: new Map() };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return uninstallErrorReporter;
}

export function uninstallErrorReporter() {
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  state = null;
}

/** The Privacy switch (Rust owns the value; off until chosen). */
export async function getErrorReportsEnabled() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return false;
  try {
    return (await invoke('error_reports_get_enabled')) === true;
  } catch {
    return false;
  }
}

/** "View queued reports": what waits to be sent, already redacted by Rust. */
export async function getQueuedErrorReports() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return [];
  try {
    const q = await invoke('error_reports_queue');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

export async function setErrorReportsEnabled(enabled) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return enabled;
  return invoke('error_reports_set_enabled', { enabled: !!enabled });
}
