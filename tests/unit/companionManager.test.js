// CompanionManager: linking mid-session fetches the collection, unlinking
// forgets it, and unequipping returns to the user's own Lab Original.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';
import { desktopApi } from '../../src/core/api/client.js';

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
});
