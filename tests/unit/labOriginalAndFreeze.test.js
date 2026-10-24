// Wearing a Lab Original chosen on the site, and streak freezes from the poll:
// parsing, PollClient dispatch, CompanionManager applying the choice once.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PollClient } from '../../src/core/PollClient.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { parsePollResponse } from '../../src/core/api/contract.js';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { db } from '../../src/core/Database.js';
import { desktopApi } from '../../src/core/api/client.js';

const account = { userId: 'u1', username: 'mara', vibePoints: 10, freePulls: 0 };

describe('poll parsing', () => {
  it('reads labOriginal and streakFreeze', () => {
    const p = parsePollResponse({
      account: { ...account, streakFreeze: { held: 1, coveredDays: ['2026-10-21', 'nope'] } },
      equipped: null,
      labOriginal: { slug: 'pirate', chosenAt: '2026-10-23T10:00:00.000Z' },
    });
    expect(p.labOriginal).toEqual({ slug: 'pirate', chosenAt: '2026-10-23T10:00:00.000Z' });
    expect(p.streakFreeze).toEqual({ held: 1, coveredDays: ['2026-10-21'] });
  });

  it('treats absent or unknown fields as nothing', () => {
    const p = parsePollResponse({ account, equipped: null });
    expect(p.labOriginal).toBeNull();
    expect(p.streakFreeze).toEqual({ held: 0, coveredDays: [] });
    expect(parsePollResponse({ labOriginal: { slug: 'not-a-skin', chosenAt: 'x' } }).labOriginal).toBeNull();
    expect(parsePollResponse({ labOriginal: { slug: 'pirate' } }).labOriginal).toBeNull();
    expect(parsePollResponse({}).streakFreeze).toBeNull();
  });

  it('titles streak freeze toasts', () => {
    const p = parsePollResponse({ notifications: [{ id: 'n1', kind: 'streak_freeze', message: 'A streak freeze covered Tuesday.' }] });
    expect(p.notifications[0].title).toBe('Streak freeze used');
  });
});

describe('PollClient dispatch', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); eventBus.clear(); });

  function run(json, equippedId) {
    const api = {
      poll: vi.fn(async () => ({ ok: true, status: 200, etag: '"1"', poll: parsePollResponse(json) })),
      ack: vi.fn(async () => ({ ok: true })),
    };
    return new PollClient({ api, account: { linked: true }, getEquippedId: () => equippedId });
  }

  it('a site pick while a companion is out sends one LAB_ORIGINAL_CHOSEN and no unequip', async () => {
    const chosen = vi.fn();
    const unequipped = vi.fn();
    eventBus.on(Events.LAB_ORIGINAL_CHOSEN, chosen);
    eventBus.on(Events.COMPANION_UNEQUIPPED, unequipped);
    const client = run({ account, equipped: null, labOriginal: { slug: 'wizard', chosenAt: 't1' } }, 'c1');
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    expect(chosen).toHaveBeenCalledWith({ slug: 'wizard', chosenAt: 't1' });
    expect(unequipped).not.toHaveBeenCalled();
  });

  it('an equipped companion wins over the site pick', async () => {
    const chosen = vi.fn();
    eventBus.on(Events.LAB_ORIGINAL_CHOSEN, chosen);
    const equipped = { companionId: 'c2', editionSlug: 'neon', name: 'Neon', spriteSheetUrl: 'https://x/neon.png' };
    const client = run({ account, equipped, labOriginal: { slug: 'wizard', chosenAt: 't1' } }, null);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    expect(chosen).not.toHaveBeenCalled();
  });

  it('forwards streak freezes', async () => {
    const seen = vi.fn();
    eventBus.on(Events.STREAK_FREEZE_FROM_SERVER, seen);
    const client = run({ account: { ...account, streakFreeze: { held: 2, coveredDays: [] } } }, null);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    expect(seen).toHaveBeenCalledWith({ held: 2, coveredDays: [] });
  });
});

describe('CompanionManager and the site pick', () => {
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
  afterEach(() => { eventBus.clear(); vi.restoreAllMocks(); });

  it('switches to the bundled skin once per chosenAt and persists it', async () => {
    const settings = fakeSettings('companion-neon');
    const m = new CompanionManager();
    await m.init(settings);
    await vi.waitFor(() => expect(saved?.companions).toHaveLength(1));
    eventBus.emit(Events.LAB_ORIGINAL_CHOSEN, { slug: 'pirate', chosenAt: 't1' });
    expect(settings.selectedSkin).toBe('dr-vibe-pirate');
    expect(m.getEquippedId()).toBeNull();
    expect(saved.labOriginalChosenAt).toBe('t1');
    expect(saved.originalSkin).toBe('dr-vibe-pirate');
    expect(desktopApi.setEquipped).not.toHaveBeenCalled();

    // A later pick on the desktop wins until the site chooses again.
    settings.set('selectedSkin', 'dr-vibe-alien');
    eventBus.emit(Events.LAB_ORIGINAL_CHOSEN, { slug: 'pirate', chosenAt: 't1' });
    expect(settings.selectedSkin).toBe('dr-vibe-alien');
    eventBus.emit(Events.LAB_ORIGINAL_CHOSEN, { slug: 'wizard', chosenAt: 't2' });
    expect(settings.selectedSkin).toBe('dr-vibe-wizard');
  });

  it('does not re-apply after a restart', async () => {
    saved = { equippedId: null, companions: [], livingStats: {}, originalSkin: 'dr-vibe-pirate', labOriginalChosenAt: 't1' };
    const settings = fakeSettings('dr-vibe-alien');
    const m = new CompanionManager();
    await m.init(settings);
    eventBus.emit(Events.LAB_ORIGINAL_CHOSEN, { slug: 'pirate', chosenAt: 't1' });
    expect(settings.selectedSkin).toBe('dr-vibe-alien');
  });
});
