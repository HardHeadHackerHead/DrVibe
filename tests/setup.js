// Global test setup — runs before every test file.
// Provides a minimal window.__TAURI__ stub so TauriBridge initialises
// without an actual Tauri host process.

import { vi, afterEach } from 'vitest';

// ── Tauri event-listener registry ────────────────────────────────────────────
// Keeps track of handlers registered via window.__TAURI__.event.listen so
// individual tests can fire synthetic Rust→JS events (e.g. tray clicks).

const _tauriEventCallbacks = {};

const mockTauriListen = vi.fn(async (event, handler) => {
  if (!_tauriEventCallbacks[event]) _tauriEventCallbacks[event] = [];
  _tauriEventCallbacks[event].push(handler);
  // Return an unlisten function, same as real Tauri
  return () => {
    _tauriEventCallbacks[event] = _tauriEventCallbacks[event]?.filter(h => h !== handler);
  };
});

// Tests call this to simulate a Rust-emitted event (e.g. companion-tray-equip)
global.__simulateTauriEvent = (event, payload) => {
  for (const fn of _tauriEventCallbacks[event] ?? []) {
    fn({ payload });
  }
};

// Reset per-file listener registry
afterEach(() => {
  Object.keys(_tauriEventCallbacks).forEach(k => delete _tauriEventCallbacks[k]);
  vi.clearAllMocks();
});

// ── window.__TAURI__ stub ─────────────────────────────────────────────────────
window.__TAURI__ = {
  core: {
    // Tests override specific commands via tauri.invoke mock; the base stub
    // returns null for anything not explicitly handled.
    invoke: vi.fn(async () => null),
  },
  window: {
    getCurrentWindow: () => ({
      show:                  vi.fn(async () => {}),
      hide:                  vi.fn(async () => {}),
      setIgnoreCursorEvents: vi.fn(async () => {}),
      scaleFactor:           vi.fn(async () => 1),
      outerPosition:         vi.fn(async () => ({ x: 0, y: 0 })),
      outerSize:             vi.fn(async () => ({ width: 200, height: 200 })),
      setPosition:           vi.fn(async () => {}),
    }),
    availableMonitors: vi.fn(async () => []),
    primaryMonitor:    vi.fn(async () => null),
    currentMonitor:    vi.fn(async () => null),
  },
  event: { listen: mockTauriListen },
  notification: { sendNotification: vi.fn(async () => {}) },
};

// ── fetch stub ───────────────────────────────────────────────────────────────
// CompanionManager._fetchCompanions() makes HTTP calls; default to a
// well-behaved empty response so init() doesn't error in unrelated tests.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ({ companions: [], equippedId: null }),
})));
