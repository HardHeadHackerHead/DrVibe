// [AC1] Equip flow: equip on website → Socket.io event → desktop sprite swap
// [AC3] Offline fallback: unequip reverts to default sprite, no crashes

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { tauri } from '../../src/core/TauriBridge.js';
import { db } from '../../src/core/Database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_COMPANION = {
  id: 'comp-001',
  slug: 'pixel-wizard',
  name: 'Pixel Wizard',
  pngUrl: 'https://cdn.drvibe.io/companions/pixel-wizard.png',
  animUrl: 'https://cdn.drvibe.io/companions/pixel-wizard.anim.json',
};

/** Returns a settings mock + promise that resolves when selectedSkin is set. */
function makeEquipLatch() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const settings = {
    set: vi.fn((key, value) => { if (key === 'selectedSkin') resolve(value); }),
    get: vi.fn(),
  };
  return { settings, promise };
}

/** Build a single CompanionManager with a clean db. */
async function buildManager(settings, dbState = null) {
  vi.spyOn(db, 'getSection').mockReturnValue(dbState);
  vi.spyOn(db, 'setSection').mockImplementation(() => {});
  const manager = new CompanionManager();
  await manager.init(settings);
  return manager;
}

// ── Shared setup / teardown ───────────────────────────────────────────────────
// NOTE: Each test creates its OWN manager via buildManager() so that only one
// handler is subscribed to the eventBus per test. Having two managers subscribed
// causes them to race and can produce misleading results for state checks.

beforeEach(() => {
  tauri.isAvailable = true;
  tauri.invoke = vi.fn(async (cmd, args) => {
    if (cmd === 'cache_companion_skin') return `companion-${args?.slug ?? 'default'}`;
    if (cmd === 'update_companions_tray') return null;
    if (cmd === 'get_profile') return null; // skip _fetchCompanions network call
    if (cmd === 'set_tray_tooltip') return null;
    return null;
  });
  // _fetchCompanions falls back gracefully when fetch is stubbed to fail
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tauri.isAvailable = false;
  tauri.invoke = null;
});

// ── [AC1] Equip flow ──────────────────────────────────────────────────────────

describe('[AC1] Equip flow: socket event → desktop sprite swap', () => {
  it('invokes cache_companion_skin with the correct payload', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await promise;

    expect(tauri.invoke).toHaveBeenCalledWith('cache_companion_skin', {
      id:      'comp-001',
      slug:    'pixel-wizard',
      name:    'Pixel Wizard',
      pngUrl:  TEST_COMPANION.pngUrl,
      animUrl: TEST_COMPANION.animUrl,
      animJson: null,
    });
  });

  it('sets selectedSkin to the slug returned by cache_companion_skin', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    const finalSlug = await promise;

    expect(finalSlug).toBe('companion-pixel-wizard');
    expect(settings.set).toHaveBeenCalledWith('selectedSkin', 'companion-pixel-wizard');
  });

  it('completes the full sprite-swap in under 5 seconds', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    const t0 = Date.now();
    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await promise;

    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('tracks the equipped companion ID after equip', async () => {
    const { settings, promise } = makeEquipLatch();
    const manager = await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await promise;

    expect(manager.getEquippedId()).toBe('comp-001');
  });

  it('initialises living stats with sessionsCount=1 on first equip', async () => {
    const { settings, promise } = makeEquipLatch();
    const manager = await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await promise;

    const stats = manager.getEquippedStats();
    expect(stats).not.toBeNull();
    expect(stats.companionId).toBe('comp-001');
    expect(stats.sessionsCount).toBe(1);
    expect(stats.hoursAccompanied).toBeGreaterThanOrEqual(0);
    expect(stats.lastActiveAt).toBeTruthy();
  });

  it('increments sessionsCount on re-equip of the same companion', async () => {
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await latch1.promise;

    // Re-equip: swap settings latch so promise resolves on the second equip
    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await latch2.promise;

    const stats = manager.getEquippedStats();
    expect(stats.sessionsCount).toBe(2);
  });

  it('updates the tray menu with the new companion after equip', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await promise;

    expect(tauri.invoke).toHaveBeenCalledWith(
      'update_companions_tray',
      expect.objectContaining({
        companions: expect.arrayContaining([
          expect.objectContaining({ id: 'comp-001', name: 'Pixel Wizard' }),
        ]),
        equippedId: 'comp-001',
      }),
    );
  });

  it('persists companion state to db after equip', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await promise;

    expect(db.setSection).toHaveBeenCalledWith(
      'companion',
      expect.objectContaining({ equippedId: 'comp-001' }),
    );
  });

  it('handles equip without animUrl gracefully (passes animUrl: null)', async () => {
    const { settings, promise } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, { ...TEST_COMPANION, animUrl: undefined });
    await promise;

    expect(tauri.invoke).toHaveBeenCalledWith('cache_companion_skin',
      expect.objectContaining({ animUrl: null }),
    );
  });

  it('ignores equip events with missing slug or pngUrl', async () => {
    const { settings } = makeEquipLatch();
    await buildManager(settings);

    eventBus.emit(Events.COMPANION_EQUIPPED, { id: 'bad', slug: '', pngUrl: '' });

    // Give async work a chance to run
    await new Promise(r => setTimeout(r, 20));
    expect(tauri.invoke).not.toHaveBeenCalledWith('cache_companion_skin', expect.anything());
  });
});

// ── [AC3] Offline fallback ────────────────────────────────────────────────────

describe('[AC3] Offline fallback: unequip reverts to default sprite', () => {
  it('reverts selectedSkin to dr-vibe-default on COMPANION_UNEQUIPPED', async () => {
    // First equip a companion
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);
    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await latch1.promise;

    // Now unequip — swap in a new latch to catch the skin revert
    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    const skin = await latch2.promise;

    expect(skin).toBe('dr-vibe-default');
    expect(manager.getEquippedId()).toBeNull();
  });

  it('does not throw when COMPANION_UNEQUIPPED fires with no companion equipped', async () => {
    const { settings } = makeEquipLatch();
    await buildManager(settings);

    expect(() => {
      eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    }).not.toThrow();
  });

  it('clears equippedId so getEquippedStats returns null after unequip', async () => {
    const latch1 = makeEquipLatch();
    const manager = await buildManager(latch1.settings);
    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await latch1.promise;

    const latch2 = makeEquipLatch();
    manager._settings = latch2.settings;
    eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    await latch2.promise;

    expect(manager.getEquippedStats()).toBeNull();
  });

  it('reverts to default skin even when Tauri invoke fails during equip', async () => {
    tauri.invoke = vi.fn(async (cmd) => {
      if (cmd === 'cache_companion_skin') throw new Error('Network error');
      return null;
    });

    const { settings } = makeEquipLatch();
    const manager = await buildManager(settings);

    // Equip silently fails (try/catch in _onEquipped)
    eventBus.emit(Events.COMPANION_EQUIPPED, TEST_COMPANION);
    await new Promise(r => setTimeout(r, 30));
    expect(manager.getEquippedId()).toBeNull();

    // Unequip should be safe even with no companion equipped
    expect(() => eventBus.emit(Events.COMPANION_UNEQUIPPED, {})).not.toThrow();
  });
});
