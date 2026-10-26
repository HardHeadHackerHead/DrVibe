// CompanionManager: linking mid-session fetches the collection, unlinking
// forgets it, and unequipping returns to the user's own Lab Original.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';
import { desktopApi } from '../../src/core/api/client.js';
import { tauri } from '../../src/core/TauriBridge.js';

let saved;

function fakeSettings(selectedSkin) {
  const s = {
    selectedSkin,
    get: (k) => s[k],
    set: vi.fn((k, v) => {
      if (s[k] === v) return;
      s[k] = v;
      eventBus.emit(Events.SETTINGS_CHANGED, { key: k, value: v });
    }),
  };
  return s;
}

beforeEach(() => {
  saved = null;
  vi.spyOn(db, 'getSection').mockImplementation(() => saved);
  vi.spyOn(db, 'setSection').mockImplementation((_s, v) => { saved = JSON.parse(JSON.stringify(v)); });
  vi.spyOn(desktopApi, 'collection').mockResolvedValue({ ok: true, data: { equippedId: null, companions: [{ companionId: 'c1', editionSlug: 'neon', name: 'Neon' }] } });
  vi.spyOn(desktopApi, 'setEquipped').mockResolvedValue({ ok: true });
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

describe('CompanionManager', () => {
  it('fetches companions when the account links mid-session and clears them on unlink', async () => {
    const m = new CompanionManager();
    await m.init(fakeSettings('dr-vibe-alien'));
    await vi.waitFor(() => expect(desktopApi.collection).toHaveBeenCalledTimes(1));

    eventBus.emit(Events.ACCOUNT_LINKED, {});
    await vi.waitFor(() => expect(desktopApi.collection).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(saved.companions).toHaveLength(1));

    eventBus.emit(Events.ACCOUNT_UNLINKED, {});
    expect(saved.companions).toEqual([]);
    expect(saved.equippedId).toBeNull();
  });

  it("unequipping restores the user's chosen Lab Original", async () => {
    const settings = fakeSettings('dr-vibe-pirate');
    const m = new CompanionManager();
    await m.init(settings);
    settings.set('selectedSkin', 'companion-neon');
    eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    expect(settings.selectedSkin).toBe('dr-vibe-pirate');
  });

  describe('new art for a Dr. Vibe already worn', () => {
    let available; let invoke;
    beforeEach(() => {
      available = tauri.isAvailable; invoke = tauri.invoke;
      tauri.isAvailable = true;
      tauri.invoke = vi.fn(async (cmd, args) => (cmd === 'cache_companion_skin' ? `companion-${args.slug}` : undefined));
    });
    afterEach(() => { tauri.isAvailable = available; tauri.invoke = invoke; });

    const equipped = (pngUrl) => ({ id: 'c1', slug: 'neon', name: 'Neon', pngUrl, animUrl: null, animJson: null, finish: null });

    it('re-downloads and reloads the sheet when the poll brings a new URL for the same copy', async () => {
      const settings = fakeSettings('dr-vibe-alien');
      const m = new CompanionManager();
      await m.init(settings);
      eventBus.emit(Events.COMPANION_EQUIPPED, equipped('https://cdn/sprites/c1/sheet.png'));
      await vi.waitFor(() => expect(settings.selectedSkin).toBe('companion-neon'));
      const reloads = [];
      eventBus.on(Events.SETTINGS_CHANGED, (e) => { if (e.key === 'selectedSkin') reloads.push(e.value); });
      tauri.invoke.mockClear();

      // Same URL: nothing to do.
      eventBus.emit(Events.COMPANION_ART_FROM_SERVER, equipped('https://cdn/sprites/c1/sheet.png'));
      await new Promise((r) => setTimeout(r, 0));
      expect(tauri.invoke).not.toHaveBeenCalled();

      // The Lab replaced the art: new versioned URL.
      eventBus.emit(Events.COMPANION_ART_FROM_SERVER, equipped('https://cdn/sprites/c1/sheet-v2.png'));
      await vi.waitFor(() => expect(reloads).toEqual(['companion-neon']));
      expect(tauri.invoke).toHaveBeenCalledWith('cache_companion_skin', expect.objectContaining({ pngUrl: 'https://cdn/sprites/c1/sheet-v2.png' }));
      expect(saved.companions.find((c) => c.id === 'c1').spriteSheetUrl).toBe('https://cdn/sprites/c1/sheet-v2.png');
    });

    it('the collection fetch notices new art for the worn copy too', async () => {
      desktopApi.collection.mockResolvedValue({ ok: true, data: { equippedId: 'c1', companions: [{ companionId: 'c1', editionSlug: 'neon', name: 'Neon', spriteSheetUrl: 'https://cdn/sprites/c1/sheet.png' }] } });
      const settings = fakeSettings('dr-vibe-alien');
      const m = new CompanionManager();
      await m.init(settings);
      await vi.waitFor(() => expect(settings.selectedSkin).toBe('companion-neon'));
      const local = saved.companions.find((c) => c.id === 'c1');
      expect(local.spriteSheetUrl).toBe('https://cdn/sprites/c1/sheet.png');
      tauri.invoke.mockClear();

      desktopApi.collection.mockResolvedValue({ ok: true, data: { equippedId: 'c1', companions: [{ companionId: 'c1', editionSlug: 'neon', name: 'Neon', spriteSheetUrl: 'https://cdn/sprites/c1/sheet-v2.png' }] } });
      eventBus.emit(Events.ACCOUNT_LINKED, {});
      await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('cache_companion_skin', expect.objectContaining({ pngUrl: 'https://cdn/sprites/c1/sheet-v2.png' })));
    });
  });
});
