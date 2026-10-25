// Finishes: contract parsing with and without `finish`, the season tint,
// the renderer's choice of effect per tier, reduced motion, and the
// CompanionManager / PollClient plumbing that puts the finish on screen.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseEquipped, parseFinish, parseCollection, parsePollResponse } from '../../src/core/api/contract.js';
import { seasonAccent, finishLabel, ICY_ACCENT, SEASON_ACCENTS } from '../../src/config/finishes.js';
import { FinishRenderer, finishEffect, shimmerMatrix, goldMatrix } from '../../src/features/character/FinishRenderer.js';
import { CompanionManager } from '../../src/features/companion/CompanionManager.js';
import { PollClient } from '../../src/core/PollClient.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';
import { desktopApi } from '../../src/core/api/client.js';
import { tauri } from '../../src/core/TauriBridge.js';

const companion = (extra = {}) => ({
  companionId: 'c1', editionId: 'e1', editionSlug: 'tv-bob', name: 'TV Bob', editionName: 'TV Bob',
  serialNumber: 7, rarity: 'RARE', spriteSheetUrl: 'https://cdn.example/tv-bob.png', thumbnailUrl: null,
  animJson: null, skinTone: null, holo: false, retired: false, ...extra,
});

// ── Contract ───────────────────────────────────────────────────────────

describe('finish in the contract', () => {
  it('reads a finish and treats absent, null and unknown tiers as none', () => {
    expect(parseEquipped(companion({ finish: { tier: 'foil', seasonNumber: 1, serial: 3 } })).finish)
      .toEqual({ tier: 'foil', seasonNumber: 1, serial: 3 });
    expect(parseEquipped(companion()).finish).toBeNull();
    expect(parseEquipped(companion({ finish: null })).finish).toBeNull();
    expect(parseFinish({ tier: 'galaxy', seasonNumber: 2, serial: 1 })).toBeNull();
    expect(parseFinish({ tier: 'crowned', seasonNumber: '2', serial: -4 })).toEqual({ tier: 'crowned', seasonNumber: 2, serial: 0 });
  });

  it('parses the collection with and without finishes', () => {
    const c = parseCollection({
      equippedId: 'c1',
      companions: [
        { ...companion({ finish: { tier: 'prismatic', seasonNumber: 0, serial: 1 } }), equipped: true, acquiredAt: 'x' },
        { ...companion({ companionId: 'c2', editionSlug: 'neon', name: 'Neon' }), equipped: false, acquiredAt: 'x' },
        { name: 'broken' },
      ],
    });
    expect(c.equippedId).toBe('c1');
    expect(c.companions).toHaveLength(2);
    expect(c.companions[0]).toMatchObject({ id: 'c1', editionSlug: 'tv-bob', finish: { tier: 'prismatic', seasonNumber: 0, serial: 1 } });
    expect(c.companions[1].finish).toBeNull();
    expect(parseCollection({}).equippedId).toBeUndefined();
  });

  it('carries the finish on the polled equipped Dr. Vibe and on visitors', () => {
    const finish = { tier: 'shimmer', seasonNumber: 3, serial: 12 };
    const p = parsePollResponse({
      equipped: companion({ finish }),
      notifications: [],
      visits: [{ id: 'v1', from: { userId: 'u2', username: 'mara', appearance: { equipped: companion({ finish }) } } }],
    });
    expect(p.equipped.finish).toEqual(finish);
    expect(p.visits[0].from.sprite.finish).toEqual(finish);
    const old = parsePollResponse({ equipped: companion(), notifications: [], visits: [] });
    expect(old.equipped.finish).toBeNull();
  });
});

// ── Season tint and labels ─────────────────────────────────────────────

describe('season tint', () => {
  it('is icy for Launch and Season 1, then walks the palette', () => {
    expect(seasonAccent(0)).toBe(ICY_ACCENT);
    expect(seasonAccent(1)).toBe(ICY_ACCENT);
    expect(seasonAccent(undefined)).toBe(ICY_ACCENT);
    expect(seasonAccent(2)).toBe(SEASON_ACCENTS[0]);
    expect(seasonAccent(3)).toBe(SEASON_ACCENTS[1]);
    expect(seasonAccent(2 + SEASON_ACCENTS.length)).toBe(SEASON_ACCENTS[0]);
    expect(new Set(SEASON_ACCENTS).has(ICY_ACCENT)).toBe(false);
  });

  it('labels a finish with its serial', () => {
    expect(finishLabel({ tier: 'foil', seasonNumber: 1, serial: 3 })).toBe('Foil · #3');
    expect(finishLabel({ tier: 'crowned', seasonNumber: 1, serial: 0 })).toBe('Crowned');
    expect(finishLabel(null)).toBe('');
    expect(finishLabel({ tier: 'galaxy', serial: 1 })).toBe('');
  });
});

// ── Renderer ───────────────────────────────────────────────────────────

/** A 2D context that records what is drawn into `sink.calls`. */
function fakeCtx(pixels = null, sink = { calls: [] }) {
  const calls = { push: (c) => sink.calls.push(c) };
  const gradient = () => ({ addColorStop: () => {} });
  const state = { globalCompositeOperation: 'source-over', imageSmoothingEnabled: false };
  const methods = {
    getImageData: (x, y, w, h) => ({ data: pixels || new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: gradient, createRadialGradient: gradient, createConicGradient: gradient,
  };
  return {
    calls: sink.calls,
    ctx: new Proxy(state, {
      get(t, k) {
        if (k in methods) return (...a) => { calls.push([k]); return methods[k](...a); };
        if (k in t) return t[k];
        return (...a) => { calls.push([k, ...a.filter((v) => typeof v === 'number')]); };
      },
      set(t, k, v) { t[k] = v; calls.push([`=${String(k)}`, typeof v === 'object' ? 'obj' : v]); return true; },
    }),
  };
}

function fakeCanvas(w, h, pixels = null, sink) {
  const { ctx } = fakeCtx(pixels, sink);
  return { width: w, height: h, getContext: () => ctx };
}

/** A 32×32 frame with a small opaque block (rows 4–9, columns 10–20). */
function spriteFrame() {
  const px = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 4; y < 10; y++) {
    for (let x = 10; x <= 20; x++) {
      const i = (y * 32 + x) * 4;
      px[i] = 200; px[i + 1] = 60; px[i + 2] = 40; px[i + 3] = 255;
    }
  }
  return fakeCanvas(32, 32, px);
}

const renderer = (opts) => new FinishRenderer({ reducedMotion: false, createCanvas: (w, h) => fakeCanvas(w, h), ...opts });

describe('FinishRenderer', () => {
  it('picks the effect per tier and none for null or unknown', () => {
    for (const tier of ['shimmer', 'foil', 'prismatic', 'crowned']) {
      expect(finishEffect({ tier, seasonNumber: 1, serial: 1 })).toBe(tier);
    }
    expect(finishEffect(null)).toBeNull();
    expect(finishEffect({ tier: 'galaxy' })).toBeNull();
  });

  it('draws a plain frame, and nothing else, without a finish', () => {
    const r = renderer();
    r.setFinish(null);
    const { ctx, calls } = fakeCtx();
    r.draw(ctx, spriteFrame(), 128, 128, 1234);
    expect(calls).toEqual([['drawImage', 0, 0, 32, 32, 0, 0, 128, 128]]);
    expect(r.animating).toBe(false);
  });

  it('routes each tier to its look', () => {
    const looks = { shimmer: '_drawShimmer', foil: '_drawFoil', prismatic: '_drawPrismatic', crowned: '_drawCrowned' };
    for (const [tier, method] of Object.entries(looks)) {
      const r = renderer();
      const spies = Object.fromEntries(Object.values(looks).map((m) => [m, vi.spyOn(r, m)]));
      r.setFinish({ tier, seasonNumber: 1, serial: 1 });
      r.draw(fakeCtx().ctx, spriteFrame(), 128, 128, 500);
      for (const [m, spy] of Object.entries(spies)) expect(spy).toHaveBeenCalledTimes(m === method ? 1 : 0);
    }
  });

  it('moves over time, and holds still with reduced motion', () => {
    // Everything drawn, offscreen canvases included.
    const sink = { calls: [] };
    const createCanvas = (w, h) => fakeCanvas(w, h, null, sink);
    const log = (r, t) => {
      sink.calls = [];
      r.draw(fakeCtx(null, sink).ctx, frame, 128, 128, t);
      return JSON.stringify(sink.calls);
    };
    const frame = spriteFrame();
    for (const tier of ['shimmer', 'foil', 'prismatic', 'crowned']) {
      const moving = renderer({ createCanvas });
      moving.setFinish({ tier, seasonNumber: 1, serial: 1 });
      expect(moving.animating).toBe(true);
      log(moving, 0);
      expect(log(moving, 300)).not.toBe(log(moving, 1100));

      const still = renderer({ reducedMotion: true, createCanvas });
      still.setFinish({ tier, seasonNumber: 1, serial: 1 });
      expect(still.animating).toBe(false);
      log(still, 0); // the first draw also builds the offscreen canvases
      expect(log(still, 300)).toBe(log(still, 1100));
    }
  });

  it('reuses its offscreen canvases from frame to frame', () => {
    const createCanvas = vi.fn((w, h) => fakeCanvas(w, h));
    const frame = spriteFrame();
    for (const tier of ['shimmer', 'foil', 'prismatic', 'crowned']) {
      const r = new FinishRenderer({ reducedMotion: false, createCanvas });
      r.setFinish({ tier, seasonNumber: 4, serial: 1 });
      r.draw(fakeCtx().ctx, frame, 128, 128, 0);
      const made = createCanvas.mock.calls.length;
      for (let t = 33; t < 3000; t += 33) r.draw(fakeCtx().ctx, frame, 128, 128, t);
      expect(createCanvas.mock.calls.length).toBe(made);
    }
  });

  it('puts the crown on the head', () => {
    const r = renderer({ reducedMotion: true });
    r.setFinish({ tier: 'crowned', seasonNumber: 1, serial: 1 });
    const { ctx, calls } = fakeCtx();
    r.draw(ctx, spriteFrame(), 128, 128, 0);
    // Top opaque row is 4, head spans columns 10–20 → crown columns 13–17, rows 2–4 (×4 px).
    const crown = calls.filter((c) => c[0] === 'fillRect' && c[3] === 4 && c[4] === 4);
    expect(crown.length).toBe(13);
    expect(Math.min(...crown.map((c) => c[1]))).toBe(13 * 4);
    expect(Math.min(...crown.map((c) => c[2]))).toBe(2 * 4);
  });

  it('builds CSS-equivalent color matrices', () => {
    const close = (m, e) => m.forEach((v, i) => expect(v).toBeCloseTo(e[i], 3));
    close(shimmerMatrix(0, 1), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    close(shimmerMatrix(360, 1), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    close(goldMatrix(0, 1), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // saturate(0) maps every color to its luminance
    const grey = shimmerMatrix(0, 0);
    expect(grey[0]).toBeCloseTo(grey[3], 5);
    expect(grey[1]).toBeCloseTo(grey[7], 5);
  });
});

// ── Plumbing ───────────────────────────────────────────────────────────

describe('finish plumbing', () => {
  let saved;
  let prevInvoke;
  const settings = () => {
    const s = { selectedSkin: 'dr-vibe-default', get: (k) => s[k], set: vi.fn((k, v) => { s[k] = v; eventBus.emit(Events.SETTINGS_CHANGED, { key: k, value: v }); }) };
    return s;
  };

  beforeEach(() => {
    saved = null;
    vi.spyOn(db, 'getSection').mockImplementation(() => saved);
    vi.spyOn(db, 'setSection').mockImplementation((_s, v) => { saved = JSON.parse(JSON.stringify(v)); });
    vi.spyOn(desktopApi, 'setEquipped').mockResolvedValue({ ok: true });
    prevInvoke = tauri.invoke;
  });
  afterEach(() => { tauri.invoke = prevInvoke; eventBus.clear(); vi.restoreAllMocks(); });

  it('shows the equipped copy’s finish, updates it from the poll, and clears it on unequip', async () => {
    const finish = { tier: 'foil', seasonNumber: 1, serial: 3 };
    vi.spyOn(desktopApi, 'collection').mockResolvedValue({
      ok: true,
      data: { equippedId: 'c1', companions: [{ ...companion({ finish }), equipped: true, acquiredAt: 'x' }] },
    });
    tauri.invoke = vi.fn(async (cmd) => (cmd === 'cache_companion_skin' ? 'companion-tv-bob' : null));
    const shown = [];
    eventBus.on(Events.COMPANION_FINISH_SHOWN, (e) => shown.push(e));

    const m = new CompanionManager();
    await m.init(settings());
    await vi.waitFor(() => expect(m.getEquippedFinish()).toEqual(finish));
    expect(shown.at(-1)).toEqual({ finish, skin: 'companion-tv-bob' });
    expect(tauri.invoke).toHaveBeenCalledWith('update_companions_tray', {
      companions: [{ id: 'c1', name: 'TV Bob · Foil · #3' }], equippedId: 'c1',
    });

    const crowned = { tier: 'crowned', seasonNumber: 1, serial: 1 };
    eventBus.emit(Events.COMPANION_FINISH_FROM_SERVER, { id: 'c1', finish: crowned });
    expect(shown.at(-1)).toEqual({ finish: crowned, skin: 'companion-tv-bob' });
    const count = shown.length;
    eventBus.emit(Events.COMPANION_FINISH_FROM_SERVER, { id: 'c1', finish: { ...crowned } });
    expect(shown.length).toBe(count); // unchanged → no re-send

    eventBus.emit(Events.COMPANION_UNEQUIPPED, {});
    expect(shown.at(-1)).toEqual({ finish: null, skin: null });
  });

  it('PollClient passes a new finish on the same Dr. Vibe without re-equipping', async () => {
    vi.useFakeTimers();
    const finish = { tier: 'shimmer', seasonNumber: 2, serial: 5 };
    const poll = parsePollResponse({ equipped: companion({ finish }), notifications: [], visits: [] });
    const api = { poll: vi.fn(async () => ({ ok: true, status: 200, notModified: false, etag: '"v"', poll })), ack: vi.fn() };
    const equipped = vi.fn(), fromServer = vi.fn();
    eventBus.on(Events.COMPANION_EQUIPPED, equipped);
    eventBus.on(Events.COMPANION_FINISH_FROM_SERVER, fromServer);
    const client = new PollClient({ api, account: { linked: true }, getEquippedId: () => 'c1' });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    vi.useRealTimers();
    expect(equipped).not.toHaveBeenCalled();
    expect(fromServer).toHaveBeenCalledWith({ id: 'c1', finish });
  });
});
