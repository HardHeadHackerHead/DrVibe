// [AC7] System tray: list companions, equip from tray, open collection
//
// Tests that CompanionManager correctly:
//   - Calls update_companions_tray with the full companion list and equipped ID
//   - Reflects equip status changes in subsequent tray updates
//   - Responds to the companion-tray-equip Rust event to local-equip from cache
//   - Syncs the local equip to the server (best-effort fetch POST)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';
import { db } from '../../src/core/Database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEquipLatch() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const settings = {
    set: vi.fn((key, value) => { if (key === 'selectedSkin') resolve(value); }),
    get: vi.fn(),
  };
  return { settings, promise };
}

function setupTauri() {
  tauri.isAvailable = true;
  tauri.invoke = vi.fn(async (cmd, args) => {
    if (cmd === 'cache_companion_skin') return `companion-${args?.slug}`;
    if (cmd === 'update_companions_tray') return null;
    if (cmd === 'get_profile') return { apiToken: 'test-token' };
    if (cmd === 'set_tray_tooltip') return null;
    return null;
  });
}

async function buildManager(settings, dbState = null) {
  vi.spyOn(db, 'getSection').mockReturnValue(dbState);
  vi.spyOn(db, 'setSection').mockImplementation(() => {});
  const manager = new CompanionManager();
  await manager.init(settings);
  return manager;
}

/** Returns the most recent call args for update_companions_tray. */
function lastTrayUpdate() {
  const calls = tauri.invoke.mock.calls.filter(c => c[0] === 'update_companions_tray');
  return calls.length ? calls[calls.length - 1][1] : null;
}

beforeEach(() => {
  // Prevent _fetchCompanions / _syncEquipToServer from making real network calls
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tauri.isAvailable = false;
  tauri.invoke = null;
});

// ── [AC7] Tray: companion list ────────────────────────────────────────────────

describe('[AC7] Tray: companion list reflects equipped state', () => {
  beforeEach(() => setupTauri());

  it('calls update_companions_tray on init with empty list when no companions cached', async () => {
    const { settings } = makeEquipLatch();
    await buildManager(settings);

    const firstTray = tauri.invoke.mock.calls.find(c => c[0] === 'update_companions_tray');
    expect(firstTray).toBeTruthy();
    expect(firstTray[1]).toMatchObject({ companions: [], equippedId: null });
  });

  it('populates tray with companions from persisted db on cold start', async () => {
    const dbState = {
      equippedId: 'comp-A',
      companions: [
        { id: 'comp-A', name: 'Alpha', slug: 'companion-alpha' },
        { id: 'comp-B', name: 'Beta',  slug: 'companion-beta' },
      ],
      livingStats: {},
    };
    const { settings } = makeEquipLatch();
    await buildManager(settings, dbState);

    const tray = lastTrayUpdate();
    expect(tray.companions).toHaveLength(2);
    expect(tray.equippedId).toBe('comp-A');
    expect(tray.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'comp-A', name: 'Alpha' }),
      expect.objectContaining({ id: 'comp-B', name: 'Beta' }),
    ]));
  });

  it('updates tray with new companion after equip via socket event', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, {
      id: 'comp-X', slug: 'rune-runner', name: 'Rune Runner',
      pngUrl: 'https://cdn.drvibe.io/rune-runner.png',
    });
    await promise;

    const tray = lastTrayUpdate();
    expect(tray.equippedId).toBe('comp-X');
    expect(tray.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'comp-X', name: 'Rune Runner' }),
    ]));
  });

  it('clears equippedId in tray after COMPANION_UNEQUIPPED', async () => {
    // Start equipped
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);
    eventBus.emit(Events.COMPANION_EQUIPPED, {
      id: 'comp-Y', slug: 'ghost-byte', name: 'Ghost Byte',
      pngUrl: 'https://cdn.drvibe.io/ghost-byte.png',
    });
    await latch1.promise;

    // Now unequip
    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    await latch2.promise;

    const tray = lastTrayUpdate();
    expect(tray.equippedId).toBeNull();
    // Companion remains in the list (still owned, just not equipped)
    expect(tray.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'comp-Y' }),
    ]));
  });

  it('marks the correct companion as equipped when switching between companions', async () => {
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, {
      id: 'comp-1', slug: 'alpha-bot', name: 'Alpha Bot',
      pngUrl: 'https://cdn.drvibe.io/alpha-bot.png',
    });
    await latch1.promise;

    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_EQUIPPED, {
      id: 'comp-2', slug: 'beta-bot', name: 'Beta Bot',
      pngUrl: 'https://cdn.drvibe.io/beta-bot.png',
    });
    await latch2.promise;

    const tray = lastTrayUpdate();
    expect(tray.equippedId).toBe('comp-2');
    expect(tray.companions).toHaveLength(2);
  });
});

// ── [AC7] Tray: equip from tray (Rust event → _equipFromCache) ───────────────

describe('[AC7] Tray: equip from tray click', () => {
  beforeEach(() => setupTauri());

  it('_equipFromCache switches skin to the cached companion slug', async () => {
    // Pre-populate companions in the db so init restores them
    const dbState = {
      equippedId: 'comp-1',
      companions: [
        { id: 'comp-1', name: 'Current', slug: 'companion-current' },
        { id: 'comp-2', name: 'Cached',  slug: 'companion-cached' },
      ],
      livingStats: {},
    };

    const settings = { set: vi.fn(), get: vi.fn() };
    // Pass dbState so _companions is populated from the persisted state
    const manager = await buildManager(settings, dbState);

    await manager._equipFromCache({ id: 'comp-2' });

    expect(settings.set).toHaveBeenCalledWith('selectedSkin', 'companion-cached');
    expect(manager.getEquippedId()).toBe('comp-2');
  });

  it('does nothing when tray equip targets the already-equipped companion', async () => {
    const dbState = {
      equippedId: 'comp-1',
      companions: [{ id: 'comp-1', name: 'Same', slug: 'companion-same' }],
      livingStats: {},
    };

    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings, dbState);

    const invokeCallsBefore = tauri.invoke.mock.calls.length;
    await manager._equipFromCache({ id: 'comp-1' }); // same as already equipped

    // No additional invoke calls (tray update or skin switch) should have fired
    expect(tauri.invoke.mock.calls.length).toBe(invokeCallsBefore);
  });

  it('does nothing when tray equip targets an unknown companion ID', async () => {
    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings);

    const settingSetCallsBefore = settings.set.mock.calls.length;
    await manager._equipFromCache({ id: 'unknown-id' });

    expect(settings.set.mock.calls.length).toBe(settingSetCallsBefore);
  });

  it('sends PUT /desktop/equipped (signed, via Rust) after tray equip', async () => {
    const dbState = {
      equippedId: 'comp-1',
      companions: [
        { id: 'comp-1', name: 'Current', slug: 'companion-current' },
        { id: 'comp-2', name: 'Remote',  slug: 'companion-remote' },
      ],
      livingStats: {},
    };

    const latch = makeEquipLatch();
    const manager = await buildManager(latch.settings, dbState);

    // Reset the latch so we can await the actual tray equip
    const trayEquipDone = new Promise(resolve => {
      latch.settings.set.mockImplementation((key) => {
        if (key === 'selectedSkin') resolve();
      });
    });

    manager._equipFromCache({ id: 'comp-2' });
    await trayEquipDone;
    // Give _syncEquipToServer a moment (it's best-effort, non-blocking)
    await new Promise(r => setTimeout(r, 20));

    const apiCalls = tauri.invoke.mock.calls.filter(([cmd]) => cmd === 'api_set_equipped');
    expect(apiCalls.length).toBeGreaterThanOrEqual(1);
    expect(apiCalls[0][1]).toEqual({ request: { companionId: 'comp-2' } });
  });

  it('receives companion-tray-equip Rust event and invokes _equipFromCache', async () => {
    const dbState = {
      equippedId: 'comp-A',
      companions: [
        { id: 'comp-A', name: 'A', slug: 'companion-a' },
        { id: 'comp-B', name: 'B', slug: 'companion-b' },
      ],
      livingStats: {},
    };

    // The latch must resolve when _equipFromCache sets selectedSkin
    const latch = makeEquipLatch();
    const manager = await buildManager(latch.settings, dbState);

    const skinSet = new Promise(resolve => {
      latch.settings.set.mockImplementation((key, value) => {
        if (key === 'selectedSkin') resolve(value);
      });
    });

    // Fire the synthetic Tauri event (registered in CompanionManager.init)
    global.__simulateTauriEvent('companion-tray-equip', { id: 'comp-B' });
    const skin = await skinSet;

    expect(skin).toBe('companion-b');
    expect(manager.getEquippedId()).toBe('comp-B');
  });
});
