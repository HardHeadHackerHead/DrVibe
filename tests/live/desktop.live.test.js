// Live end-to-end check against a running Dr. Vibe server (skipped unless
// DRVIBE_E2E_BRIDGE is set; run scripts/e2e-live.sh).
//
// The real JS modules (api client, PollClient, EconomyClient + reporter,
// PrivacySync, VisitorController, CompanionManager) talk to the real Rust
// request code through the e2e bridge (src-tauri/src/e2e_bridge.rs), which
// signs and sends exactly as the app does. Two simulated devices, "a" and
// "b", belong to two fresh players.
//
// Env: DRVIBE_E2E_BRIDGE (http://127.0.0.1:8790), DRVIBE_E2E_SERVER
// (http://localhost:8091), DRVIBE_E2E_DB (database name in the local drvibe-pg
// container, used to seed players and sessions the way OAuth would).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const BRIDGE = process.env.DRVIBE_E2E_BRIDGE;
const SERVER = process.env.DRVIBE_E2E_SERVER || 'http://localhost:8091';
const DB = process.env.DRVIBE_E2E_DB || 'desktope2e';

let device = 'a';
async function bridgeInvoke(cmd, args = {}) {
  const r = await fetch(`${BRIDGE}/invoke`, { method: 'POST', body: JSON.stringify({ device, cmd, args }) });
  const j = await r.json();
  if ('error' in j) throw j.error;
  return j.result;
}

function sql(query) {
  return execFileSync('docker', ['exec', 'drvibe-pg', 'psql', '-U', 'drvibe', '-d', DB, '-tAc', query], { encoding: 'utf8' }).trim();
}

/** A player with a browser session, as after an OAuth login. */
function seedPlayer(name) {
  const id = randomUUID();
  sql(`INSERT INTO "user" ("id","username","email","emailVerified") VALUES ('${id}','${name}','${name}@example.com',true)`);
  sql(`INSERT INTO "userprofile" ("userId") VALUES ('${id}')`);
  const secret = randomBytes(32).toString('base64url');
  const sid = createHash('sha256').update(secret).digest('hex');
  sql(`INSERT INTO "session" ("id","userId","expiresAt") VALUES ('${sid}','${id}',(now() AT TIME ZONE 'UTC') + interval '1 day')`);
  return { id, name, cookie: `drvibe_session=${id}.${secret}` };
}

/** The /connect page: approve the device with the browser session. */
async function approveOnWeb(connectUrl, cookie) {
  const q = new URL(connectUrl).searchParams;
  const r = await fetch(`${SERVER}/api/v1/desktop/link/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      codeChallenge: q.get('codeChallenge'), installId: q.get('installId'), deviceName: q.get('deviceName'),
      platform: q.get('platform'), appVersion: q.get('appVersion'),
    }),
  });
  expect(r.status).toBe(200);
  return (await r.json()).redirectUrl;
}

// ── tiny PNG writer for the design upload ─────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 128 x (32 * rows) RGBA sheet: a coloured blob in every 32x32 frame. */
function spriteSheet(rows, hue) {
  const w = 128, h = 32 * rows;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const fx = (x % 32) - 16, fy = (y % 32) - 16;
      const inside = fx * fx + fy * fy < 100 + ((x >> 5) + (y >> 5)) % 5 * 8;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      if (inside) { raw[o] = (hue + y) & 255; raw[o + 1] = (x * 2) & 255; raw[o + 2] = (hue * 3 + x + y) & 255; raw[o + 3] = 255; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!BRIDGE)('desktop app against a live server', () => {
  const tag = randomBytes(3).toString('hex');
  const alice = { name: `alice_${tag}` };
  const bob = { name: `bob_${tag}` };
  let m; // modules, imported after the invoke shim is installed


  beforeAll(async () => {
    vi.unstubAllGlobals(); // the real fetch (tests/setup.js stubs it)
    Object.assign(alice, seedPlayer(alice.name));
    Object.assign(bob, seedPlayer(bob.name));
    window.__TAURI__.core.invoke = bridgeInvoke;
    for (device of ['a', 'b']) await bridgeInvoke('reset');
    const { tauri } = await import('../../src/core/TauriBridge.js');
    await tauri.init();
    m = {
      tauri,
      ...(await import('../../src/core/api/client.js')),
      ...(await import('../../src/core/EventBus.js')),
      ...(await import('../../src/core/PollClient.js')),
      ...(await import('../../src/core/AccountState.js')),
      ...(await import('../../src/features/economy/EconomyClient.js')),
      ...(await import('../../src/features/economy/ActivityReporter.js')),
      ...(await import('../../src/features/privacy/PrivacySync.js')),
      ...(await import('../../src/features/visits/VisitorController.js')),
      ...(await import('../../src/features/companion/CompanionManager.js')),
      ...(await import('../../src/features/streak/DailyStreakTracker.js')),
      ...(await import('../../src/features/session/WeeklyRecap.js')),
    };
  });

  afterAll(() => { m?.eventBus.clear(); });

  /** One poll the way PollClient does it, returning what it dispatched. */
  async function pollOnce(client) {
    const seen = [];
    const offs = [
      m.eventBus.on(m.Events.VISIT_RECEIVED, ({ visit }) => seen.push(['visit', visit])),
      m.eventBus.on(m.Events.NOTIFICATION_RECEIVED, ({ notification }) => seen.push(['notification', notification])),
      m.eventBus.on(m.Events.COMPANION_EQUIPPED, (e) => seen.push(['equipped', e])),
      m.eventBus.on(m.Events.COMPANION_UNEQUIPPED, () => seen.push(['unequipped'])),
      m.eventBus.on(m.Events.ECONOMY_BALANCE_PUSH, ({ newBalance }) => seen.push(['balance', newBalance])),
    ];
    await client.pollNow();
    await settle();
    offs.forEach((off) => off());
    return seen;
  }

  function pollClientFor(equippedId = () => null) {
    const results = [];
    const api = {
      poll: async (etag) => { const r = await m.desktopApi.poll(etag); results.push(r); return r; },
      ack: (a) => m.desktopApi.ack(a),
    };
    const client = new m.PollClient({ api, account: { linked: true }, getEquippedId: equippedId, intervalMs: 3_600_000 });
    client._running = true; // drive pollNow by hand
    return { client, results };
  }

  it('links two devices through /connect and the dr-vibe:// callback', async () => {
    for (const [dev, player] of [['a', alice], ['b', bob]]) {
      device = dev;
      expect((await m.getProfile()).linked).toBe(false);
      const connectUrl = await bridgeInvoke('start_link');
      expect(connectUrl).toMatch(/\/connect\?codeChallenge=/);
      const redirect = await approveOnWeb(connectUrl, player.cookie);
      expect(redirect).toMatch(/^dr-vibe:\/\/auth\/callback\?code=/);
      const linked = await bridgeInvoke('deep_link', { url: redirect });
      expect(linked).toMatchObject({ username: player.name, firstLink: true });
      expect(await m.getProfile()).toMatchObject({ linked: true, username: player.name });
    }
  });

  it('polls with ETag, gets 304, and sees the welcome grants', async () => {
    device = 'a';
    const { client, results } = pollClientFor();
    const first = await pollOnce(client);
    expect(results[0].ok).toBe(true);
    expect(results[0].etag).toBeTruthy();
    expect(first.find(([k]) => k === 'balance')?.[1]).toBeGreaterThanOrEqual(50);
    // First link grants the Dr. Vibe Original and equips it (PLAN "The first
    // ten minutes"), so the first poll hands the desktop that sprite.
    expect(results[0].poll.equipped).toMatchObject({ slug: 'dr-vibe-original' });
    expect(first.find(([k]) => k === 'equipped')).toBeTruthy();
    const second = await pollOnce(client);
    expect(results[1].status).toBe(304);
    expect(results[1].notModified).toBe(true);
    expect(second).toEqual([]);
    expect(client.status).toBe('live');
  });

  it('syncs the profile (signed) and reads it back as "Show my last sync"', async () => {
    device = 'a';
    await bridgeInvoke('set_store', { store: {
      streak: { current: 1, max: 1 },
      session: { history: [{ date: m.localDay(), codingSeconds: 1800 }] },
      achievements: { lifetimeCommitCount: 3, seenRepos: ['r'], commitDays: [m.localDay()] },
    } });
    const transient = {
      isCodingNow: true, currentMomentum: 40, peakMomentumSession: 55, currentSessionMinutes: 30,
      currentProject: 'secret', codingHourOfDay: new Array(24).fill(0), achievements: [], masteryTracks: [],
      sessionCommitCount: 1, selectedSkin: 'dr-vibe-default', showProjectNames: false, equippedCompanionId: null,
    };
    const data = await m.tauri.invoke('sync_profile', { transient });
    expect(data.success).toBe(true);
    expect(data.leaderboard).toHaveProperty('rank');
    const community = (await import('../../src/core/api/contract.js')).communityFromSync(data);
    expect(community).toHaveProperty('activeFriends');
    const last = await m.tauri.invoke('get_last_sync');
    expect(JSON.parse(last.body).stats.totalCodingHours).toBe(0.5);
    expect(JSON.parse(last.body).presence.currentProject).toBeUndefined();
  });

  it('reports a streak day and a pomodoro through the event queue (signed, X-Client-Timezone)', async () => {
    device = 'a';
    m.accountState._set(true, alice.name);
    const before = (await m.desktopApi.balance()).data.vibePoints;
    const earned = [];
    m.eventBus.on(m.Events.ECONOMY_EARNED, (e) => earned.push(e));
    await m.economyClient.init();
    m.activityReporter.init();
    const tracker = new m.DailyStreakTracker();
    await tracker.init();
    m.eventBus.emit(m.Events.ACTIVITY_CODING_START, {});
    m.eventBus.emit(m.Events.TIMER_WORK_COMPLETE, {});
    await vi.waitFor(() => expect(m.economyClient.queueLength).toBe(0), { timeout: 5000 });
    const after = await m.desktopApi.balance();
    // STREAK_DAY 5 + POMODORO_COMPLETE 5 + CODING_SESSION_START 1.
    expect(after.data.vibePoints).toBe(before + 11);
    expect(after.data.recent.map((t) => t.source)).toEqual(expect.arrayContaining([expect.stringMatching(/streak/i)]));
    // Same day again: the fixed id makes it a replay, nothing new is paid.
    m.economyClient.reportActivity('STREAK_DAY', { streakLength: 1, day: m.localDay() }, `streak-day-${m.localDay()}`);
    await vi.waitFor(() => expect(m.economyClient.queueLength).toBe(0), { timeout: 5000 });
    expect((await m.desktopApi.balance()).data.vibePoints).toBe(before + 11);
    tracker.destroy();
  });

  it('lists quests and claims through the signed route', async () => {
    device = 'a';
    const q = await m.desktopApi.quests();
    expect(q.ok).toBe(true);
    expect(q.data.quests.length).toBeGreaterThan(0);
    const claim = await m.desktopApi.claimQuest(q.data.quests[0].userQuestId);
    expect([200, 409]).toContain(claim.status);
    if (claim.status === 409) expect(claim.error).toBe('quest_incomplete');
  });

  it('sends a privacy change once and the poll reports it back', async () => {
    device = 'a';
    let saved = {};
    const ps = new m.PrivacySync({ account: { linked: true }, store: { load: () => saved, save: (v) => { saved = v; } } });
    expect(await ps.update({ visitsFrom: 'everyone' })).toBe(true);
    expect(ps.pending).toBe(false);
    const r = await m.desktopApi.poll(null);
    expect(r.poll.privacy.visitsFrom).toBe('everyone');
  });

  it('plays a visit, waves back, and turns a missed one into a notification', async () => {
    // Device a must have polled lately for a walk-on delivery.
    device = 'a';
    await m.desktopApi.poll(null);

    device = 'b';
    const sent = await m.desktopApi.sendVisit(alice.name, 'nice_streak');
    expect(sent.status).toBe(201);
    expect(sent.data.delivery).toBe('walk_on');
    const again = await m.desktopApi.sendVisit(alice.name, 'nice_streak');
    expect(again.error).toBe('visit_cooldown');

    device = 'a';
    const shown = [];
    const vc = new m.VisitorController({
      isBusy: () => false,
      showVisitor: async (p) => { shown.push(p); },
      resolveSprite: async () => ({ localSkin: 'dr-vibe-default' }),
      getStage: async () => ({ scale: 100, size: { width: 128, height: 151 }, geometry: {} }),
      onArrive: () => {},
      sendVisit: (toUsername, inReplyTo) => m.desktopApi.sendVisit(toUsername, null, inReplyTo),
      ackVisit: (id, outcome) => m.desktopApi.ack({ visits: [{ id, outcome }] }),
    });
    vc.init();
    const { client } = pollClientFor();
    const seen = await pollOnce(client);
    const visit = seen.find(([k]) => k === 'visit')?.[1];
    expect(visit).toMatchObject({ id: sent.data.visitId, preset: 'nice_streak' });
    await settle();
    expect(shown.map((s) => s.visit.id)).toEqual([visit.id]);
    vc.done(); // walked off: acked played
    await settle(300);
    const after = await m.desktopApi.poll(null);
    expect(after.poll.visits).toEqual([]);

    // Bob only lets followers visit; a wave back within 24 h may.
    const wave = await vc.waveBack(bob.name, visit.id);
    expect(wave.status).toBe(201);
    const twice = await vc.waveBack(bob.name, visit.id);
    // The hourly cooldown is checked before the one-wave-back rule.
    expect(['visit_cooldown', 'already_waved_back']).toContain(twice.error);

    // The Community tab's "Recent visits" (GET /me/visits, bearer).
    const { parseVisitList } = await import('../../src/core/api/contract.js');
    const mine = parseVisitList((await m.desktopApi.recentVisits()).data);
    expect(mine[0]).toMatchObject({ id: visit.id, username: bob.name, outcome: 'played', isWaveBack: false });

    device = 'b';
    const bobPoll = await m.desktopApi.poll(null);
    const wv = bobPoll.poll.visits.find((v) => v.from.username === alice.name);
    expect(wv).toBeTruthy();
    // Bob was busy until it expired: ack missed, then the server notifies.
    await m.desktopApi.ack({ visits: [{ id: wv.id, outcome: 'missed' }] });
    const { client: bobClient, results } = pollClientFor();
    const bobSeen = await pollOnce(bobClient);
    const note = bobSeen.find(([k]) => k === 'notification')?.[1];
    expect(note?.body).toMatch(new RegExp(alice.name));
    expect(results[0].poll.visits).toEqual([]);
    // PollClient acked the toast: it leaves the poll.
    await settle(300);
    const later = await m.desktopApi.poll(null);
    expect(later.poll.notifications.find((n) => n.id === note.id)).toBeUndefined();
  });

  it('equips from My Collection (signed PUT) and the poll follows', async () => {
    device = 'a';
    const settings = { set: vi.fn(), get: vi.fn() };
    const cm = new m.CompanionManager();
    await cm.init(settings);
    await vi.waitFor(() => expect(cm._companions.length).toBeGreaterThan(0), { timeout: 5000 });
    const original = cm._companions.find((c) => c.editionSlug === 'dr-vibe-original');
    expect(original).toBeTruthy();

    // Back to a local skin first (null), then equip from the tray.
    cm.syncEquippedToSlug('dr-vibe-default');
    await settle(300);
    let r = await m.desktopApi.poll(null);
    expect(r.poll.equipped).toBeNull();

    await cm._equipFromCache({ id: original.id });
    await settle(300);
    expect(cm.getEquippedId()).toBe(original.id);
    r = await m.desktopApi.poll(null);
    expect(r.poll.equipped).toMatchObject({ id: original.id, slug: 'dr-vibe-original' });
    expect(r.poll.equipped.pngUrl).toMatch(/^https?:\/\//);

    const col = await m.desktopApi.collection();
    expect(col.data.equippedId).toBe(original.id);
  });

  it('submits a 128x544 and a 128x512 design to the Incubator', async () => {
    // Uploads need an account linked for 7 days.
    sql(`UPDATE "device" SET "createdAt" = "createdAt" - interval '8 days' WHERE "userId" IN ('${alice.id}','${bob.id}')`);
    for (const [dev, rows, hue] of [['a', 17, 40], ['b', 16, 200]]) {
      device = dev;
      const r = await m.desktopApi.submitDesign({ pngBase64: spriteSheet(rows, hue), name: `E2E ${rows} ${tag}`, description: 'live test' });
      expect([201, 409], JSON.stringify(r.data)).toContain(r.status);
      if (r.status === 201) expect(['held_for_review', 'voting']).toContain(r.data.design.status);
      else expect(r.error).toBe('near_duplicate');
    }
  });

  it('posts the last week recap once (numbers only) and the card URL is a PNG', async () => {
    device = 'b';
    const monday = m.lastCompleteWeek(new Date());
    const [d0, , d2] = m.weekDays(monday);
    const history = [
      { date: d0, codingSeconds: 5400, filesCreated: 2, filesModified: 7, longestSessionSeconds: 3600, projects: [`secret_${tag}`] },
      { date: d2, codingSeconds: 1800, filesModified: 1, longestSessionSeconds: 1800, projects: [`secret_${tag}`] },
    ];
    let saved = null;
    const onSent = vi.fn();
    const recap = new m.WeeklyRecapSync({
      getHistory: () => history, getStreak: () => 2, onSent,
      settings: { get: () => true }, privacy: { get: () => ({ profileVisibility: 'public' }) },
      account: { linked: true }, store: { load: () => saved, save: (v) => { saved = v; } },
    });
    expect(await recap.maybeSend()).toBe('sent');
    expect(await recap.maybeSend()).toBe('already_sent');
    expect(saved.lastSentWeek).toBe(monday);
    expect(saved.cardUrl).toMatch(/\/api\/v1\/recaps\/[^/]+\/card\.png$/);
    expect(onSent).toHaveBeenCalledTimes(1);

    const stored = sql(`SELECT "summary"::text || '|' || "share"::text FROM "weeklyrecap" WHERE "userId" = '${bob.id}'`);
    expect(stored).not.toContain('secret_');
    expect(JSON.parse(stored.split('|')[0])).toMatchObject({ totalSeconds: 7200, activeDays: 2, totalFilesCreated: 2, totalFilesModified: 8, streak: 2 });
    expect(stored.endsWith('|true')).toBe(true);

    const card = await fetch(saved.cardUrl);
    expect(card.status).toBe(200);
    expect(card.headers.get('content-type')).toBe('image/png');
    const bytes = Buffer.from(await card.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  });
});
