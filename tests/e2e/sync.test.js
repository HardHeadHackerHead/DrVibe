// [AC6] Sync extension: companion living stats sync correctly to the website
//
// Tests that CompanionManager.getEquippedStats() returns the correct data
// structure for inclusion in the 15-minute sync payload, including:
//   - companionId, hoursAccompanied, sessionsCount, lastActiveAt
//   - Accumulated hours from _flushLivingStats()
//   - Multi-companion switching preserves stats for each companion

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';
import { db } from '../../src/core/Database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompanion(n, slug = `companion-${n}`) {
  return {
    id: `comp-${n}`,
    slug,
    name: `Companion ${n}`,
    pngUrl: `https://cdn.drvibe.io/companions/${slug}.png`,
    animUrl: null,
  };
}

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

function setupTauri() {
  tauri.isAvailable = true;
  tauri.invoke = vi.fn(async (cmd, args) => {
    if (cmd === 'cache_companion_skin') return `companion-${args?.slug}`;
    if (cmd === 'update_companions_tray') return null;
    if (cmd === 'get_profile') return null;
    if (cmd === 'set_tray_tooltip') return null;
    return null;
  });
}

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  tauri.isAvailable = false;
  tauri.invoke = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('[AC6] Living stats: structure and initial values', () => {
  beforeEach(() => setupTauri());

  it('getEquippedStats returns null when no companion is equipped', async () => {
    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings);

    expect(manager.getEquippedStats()).toBeNull();
  });

  it('getEquippedStats returns all required sync-payload fields after equip', async () => {
    const { settings, promise } = makeEquipLatch();
    const manager = await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await promise;

    const stats = manager.getEquippedStats();
    expect(stats).toMatchObject({
      companionId:      'comp-1',
      hoursAccompanied: expect.any(Number),
      sessionsCount:    1,
      lastActiveAt:     expect.any(String),
    });
    // lastActiveAt must be a valid ISO 8601 date
    expect(() => new Date(stats.lastActiveAt)).not.toThrow();
    expect(new Date(stats.lastActiveAt).getTime()).not.toBeNaN();
  });

  it('sessionsCount increments on each equip of the same companion', async () => {
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);

    // First equip
    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await latch1.promise;

    // Re-equip same companion
    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await latch2.promise;

    const stats = manager.getEquippedStats();
    expect(stats.sessionsCount).toBe(2);
  });
});

describe('[AC6] Living stats: accumulated hours via _flushLivingStats', () => {
  beforeEach(() => setupTauri());

  it('accumulates hours between equip and getEquippedStats call', async () => {
    const { settings, promise } = makeEquipLatch();
    const manager = await buildManager(settings);

    // Simulate that 1 hour has already passed
    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await promise;

    // Back-date sessionStart by 1 hour (3600 seconds)
    manager._sessionStart = Date.now() - 3_600_000;

    const stats = manager.getEquippedStats();
    // Should be ≥1h (small delta for test execution time)
    expect(stats.hoursAccompanied).toBeGreaterThanOrEqual(0.999);
  });

  it('flushes hours when switching to a different companion', async () => {
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);

    // Equip companion 1
    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await latch1.promise;

    // Back-date sessionStart by 30 minutes
    manager._sessionStart = Date.now() - 1_800_000;

    // Equip companion 2 — flushes stats for comp-1 first
    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(2));
    await latch2.promise;

    // Companion 1's hours should be ≥0.499h (≈30 min) even though it's no longer equipped
    const comp1Stats = manager._livingStats['comp-1'];
    expect(comp1Stats.hoursAccompanied).toBeGreaterThanOrEqual(0.499);
  });

  it('does not double-count hours across multiple getEquippedStats calls', async () => {
    const { settings, promise } = makeEquipLatch();
    const manager = await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await promise;

    manager._sessionStart = Date.now() - 600_000; // 10 minutes ago

    const stats1 = manager.getEquippedStats();
    const stats2 = manager.getEquippedStats();

    // _flushLivingStats resets sessionStart each time, so second call adds ≈0 hours
    const delta = stats2.hoursAccompanied - stats1.hoursAccompanied;
    // Delta should be very small (microseconds of test execution, not another 10 min)
    expect(delta).toBeLessThan(0.01); // less than 36 seconds of extra hours
  });
});

describe('[AC6] Living stats: restored from db (persistence across restarts)', () => {
  beforeEach(() => setupTauri());

  it('restores accumulated hours from persisted db state', async () => {
    const persistedState = {
      equippedId: 'comp-3',
      companions: [{ id: 'comp-3', name: 'Grid Ghost', slug: 'companion-3' }],
      livingStats: {
        'comp-3': {
          hoursAccompanied: 42.5,
          sessionsCount: 7,
          lastActiveAt: '2025-06-01T10:00:00.000Z',
        },
      },
    };

    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings, persistedState);

    const stats = manager.getEquippedStats();
    expect(stats.companionId).toBe('comp-3');
    expect(stats.sessionsCount).toBe(7);
    // hoursAccompanied should be ≥ persisted value (session since restart adds a bit)
    expect(stats.hoursAccompanied).toBeGreaterThanOrEqual(42.5);
  });

  it('getEquippedId returns null after unequip, so sync payload omits companion', async () => {
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(1));
    await latch1.promise;

    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    await latch2.promise;

    expect(manager.getEquippedId()).toBeNull();
    expect(manager.getEquippedStats()).toBeNull();
  });
});

describe('[AC6] Sync payload shape matches TransientSyncState contract', () => {
  beforeEach(() => setupTauri());

  it('equippedCompanionId matches getEquippedId()', async () => {
    const { settings, promise } = makeEquipLatch();
    const manager = await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, makeCompanion(4));
    await promise;

    // The sync payload builder (in app.js) calls:
    //   equippedCompanionId: companionManager.getEquippedId()
    //   companionLivingStats: companionManager.getEquippedStats()
    // Verify these methods return consistent data.
    const id = manager.getEquippedId();
    const stats = manager.getEquippedStats();

    expect(id).toBe('comp-4');
    expect(stats.companionId).toBe(id);
  });
});
