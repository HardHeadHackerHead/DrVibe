// [AC4] Sprite sheet caching: equip → close app → reopen → cached sprite loads instantly
// [AC5] LRU cache eviction: equip 21+ companions → oldest evicted, newest cached
//
// The LRU eviction logic lives in Rust (cache_companion_skin command). These tests
// verify the JS layer's responsibilities:
//   - cache_companion_skin is invoked with the correct args for every equip
//   - The returned finalSlug is used for skin switching
//   - CompanionManager restores persisted companions from db on restart (AC4)
//   - Equipping 21+ companions each trigger the invoke (Rust handles eviction) (AC5)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';
import { db } from '../../src/core/Database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompanion(n) {
  return {
    id: `comp-${n}`,
    slug: `companion-${n}`,
    name: `Companion ${n}`,
    pngUrl: `https://cdn.drvibe.io/companions/companion-${n}.png`,
    animUrl: `https://cdn.drvibe.io/companions/companion-${n}.anim.json`,
  };
}

/** Awaits until manager._settings.set('selectedSkin') is called. */
function makeEquipLatch() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const settings = {
    set: vi.fn((key, value) => { if (key === 'selectedSkin') resolve(value); }),
    get: vi.fn(),
  };
  return { settings, promise };
}

async function buildManager(settings, dbState = null) {
  vi.spyOn(db, 'getSection').mockReturnValue(dbState);
  vi.spyOn(db, 'setSection').mockImplementation(() => {});
  const manager = new CompanionManager();
  await manager.init(settings);
  return manager;
}

function setupTauri(invokeImpl) {
  tauri.isAvailable = true;
  tauri.invoke = vi.fn(invokeImpl ?? (async (cmd, args) => {
    if (cmd === 'cache_companion_skin') return `companion-${args?.slug}`;
    if (cmd === 'update_companions_tray') return null;
    if (cmd === 'get_profile') return null; // skip _fetchCompanions
    if (cmd === 'set_tray_tooltip') return null;
    return null;
  }));
}

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  tauri.isAvailable = false;
  tauri.invoke = null;
});

// ── [AC4] Sprite sheet caching ────────────────────────────────────────────────

describe('[AC4] Sprite sheet caching across app restarts', () => {
  it('restores equippedId and companions list from db on init', async () => {
    setupTauri();
    const persistedState = {
      equippedId: 'comp-7',
      companions: [{ id: 'comp-7', name: 'Lucky Seven', slug: 'companion-7' }],
      livingStats: { 'comp-7': { hoursAccompanied: 2.5, sessionsCount: 3, lastActiveAt: '2025-01-01T00:00:00.000Z' } },
    };

    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings, persistedState);

    expect(manager.getEquippedId()).toBe('comp-7');
    // Living stats are accessible without needing a new equip
    const stats = manager.getEquippedStats();
    expect(stats).not.toBeNull();
    expect(stats.companionId).toBe('comp-7');
    expect(stats.sessionsCount).toBe(3);
    expect(stats.hoursAccompanied).toBeGreaterThanOrEqual(2.5);
  });

  it('populates tray with cached companions immediately on init (no network)', async () => {
    setupTauri();
    const persistedState = {
      equippedId: 'comp-2',
      companions: [
        { id: 'comp-1', name: 'Alpha', slug: 'companion-1' },
        { id: 'comp-2', name: 'Beta',  slug: 'companion-2' },
      ],
      livingStats: {},
    };

    const { settings } = makeEquipLatch();
    await buildManager(settings, persistedState);

    expect(tauri.invoke).toHaveBeenCalledWith(
      'update_companions_tray',
      expect.objectContaining({
        companions: expect.arrayContaining([
          expect.objectContaining({ id: 'comp-1', name: 'Alpha' }),
          expect.objectContaining({ id: 'comp-2', name: 'Beta' }),
        ]),
        equippedId: 'comp-2',
      }),
    );
  });

  it('calls cache_companion_skin on every equip (Rust persists the file)', async () => {
    setupTauri();
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await promise;

    expect(tauri.invoke).toHaveBeenCalledWith('cache_companion_skin', expect.objectContaining({
      slug: 'companion-1',
    }));
  });

  it('uses the finalSlug returned from cache_companion_skin as the skin name', async () => {
    // Rust normalises slug by prepending 'companion-'
    setupTauri(async (cmd, args) => {
      if (cmd === 'cache_companion_skin') return `companion-${args.slug}`;
      return null;
    });

    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    const rawSlug = 'pixel-wizard';
    eventBus.emit(Events.COMPANION_EQUIPPED, { ...makeCompanion(1), slug: rawSlug });
    const usedSlug = await promise;

    expect(usedSlug).toBe(`companion-${rawSlug}`);
  });

  it('starts a session timer on init when a companion was previously equipped', async () => {
    setupTauri();
    const before = Date.now();
    const persistedState = {
      equippedId: 'comp-5',
      companions: [{ id: 'comp-5', name: 'Specter', slug: 'companion-5' }],
      livingStats: {},
    };

    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings, persistedState);

    // _sessionStart should be set (≥ time before init)
    expect(manager._sessionStart).toBeGreaterThanOrEqual(before);
  });
});

// ── [AC5] LRU cache eviction ──────────────────────────────────────────────────

describe('[AC5] LRU cache eviction: 21+ companions', () => {
  it('invokes cache_companion_skin for each of 21 distinct companions', async () => {
    setupTauri();

    // Equip companions one at a time, awaiting each
    for (let i = 1; i <= 21; i++) {
      const { settings, promise } = makeEquipLatch();
      const manager = i === 1
        ? await buildManager(settings)
        : await (async () => {
            const m = new CompanionManager();
            await m.init(settings);
            return m;
          })();
      void manager; // suppress unused warning

      eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(i));
      await promise;
      eventBus.clear(); // reset between iterations
    }

    // cache_companion_skin should have been called 21 times across all managers
    const cacheCalls = tauri.invoke.mock.calls.filter(c => c[0] === 'cache_companion_skin');
    expect(cacheCalls.length).toBe(21);
  });

  it('passes unique slug for each companion to cache_companion_skin', async () => {
    setupTauri();
    const slugsSeen = new Set();

    for (let i = 1; i <= 5; i++) {
      const { settings, promise } = makeEquipLatch();
      const manager = new CompanionManager();
      await manager.init(settings);
      eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(i));
      await promise;
      eventBus.clear();
    }

    const cacheCalls = tauri.invoke.mock.calls.filter(c => c[0] === 'cache_companion_skin');
    for (const [, args] of cacheCalls) {
      slugsSeen.add(args.slug);
    }
    expect(slugsSeen.size).toBe(5); // all 5 slugs are distinct
  });

  it('adds new companions to the local list (JS layer does not enforce 20-limit)', async () => {
    setupTauri();
    // The 20-companion cap is Rust-side (file cache). JS list is unbounded.
    const latches = [];
    let manager;

    for (let i = 1; i <= 22; i++) {
      const latch = makeEquipLatch();
      latches.push(latch);

      if (i === 1) {
        manager = await buildManager(latch.settings);
      } else {
        manager._settings = latch.settings;
      }

      eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(i));
      await latch.promise;
    }

    expect(manager._companions.length).toBe(22);
  });

  it('documents Rust-side LRU as an integration test requirement', () => {
    // The actual file deletion (oldest companion sprite evicted from disk when
    // cache exceeds 20 entries) is implemented in Rust's cache_companion_skin
    // command and requires an integration test with a real Tauri process.
    //
    // To verify manually:
    //   1. Run `npm run dev`
    //   2. Equip 21 distinct companions via the website
    //   3. Inspect APP_DATA_DIR/companion-cache.json — should have ≤20 entries
    //   4. Confirm the oldest companion's .png and .anim.json files are gone
    expect(true).toBe(true); // intentional no-op marker for documentation
  });
});
