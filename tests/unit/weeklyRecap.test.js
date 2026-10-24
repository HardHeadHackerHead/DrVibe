// Weekly recap: last complete week, once, numbers only, privacy-gated.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  WeeklyRecapSync, buildRecapRequest, lastCompleteWeek, mondayOf, weekDays,
} from '../../src/features/session/WeeklyRecap.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { Endpoints } from '../../src/core/api/endpoints.js';

// Wednesday 22 October 2026; last week is Mon 12 – Sun 18 October.
const NOW = new Date('2026-10-22T15:00:00Z');
const HISTORY = [
  { date: '2026-10-11', codingSeconds: 9999, filesCreated: 50, projects: ['sunday-before'] },
  { date: '2026-10-12', codingSeconds: 3600, filesCreated: 2, filesModified: 5, longestSessionSeconds: 2400, projects: ['secret-client'] },
  { date: '2026-10-15', codingSeconds: 1800.4, filesModified: 3, longestSessionSeconds: 1800, projects: ['secret-client', 'side-thing'] },
  { date: '2026-10-18', codingSeconds: 600, filesCreated: 1, longestSessionSeconds: 600, projects: [] },
  { date: '2026-10-19', codingSeconds: 7777, projects: ['this-week'] },
];

function make({
  linked = true, response = { ok: true, status: 200, data: { cardUrl: 'http://localhost:8092/api/v1/recaps/r1/card.png' } },
  share = true, visibility = 'public', history = HISTORY, now = NOW,
} = {}) {
  let saved = null;
  const store = { load: () => saved, save: (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const api = { sendRecap: vi.fn(async () => (typeof response === 'function' ? response() : response)) };
  const account = { linked, markTokenRejected: vi.fn() };
  const settings = { values: { shareWeeklyRecap: share }, get(k) { return this.values[k]; } };
  const privacy = { profileVisibility: visibility, get() { return { profileVisibility: this.profileVisibility }; } };
  const onSent = vi.fn();
  const clock = { now };
  const recap = new WeeklyRecapSync({
    getHistory: async () => history, getStreak: () => 4, settings, onSent, api, account, privacy, store,
    now: () => clock.now,
  });
  return { recap, api, account, settings, privacy, onSent, clock, saved: () => saved };
}

afterEach(() => {
  eventBus.clear();
  vi.useRealTimers();
});

describe('week bookkeeping', () => {
  it('finds the Monday of a week and the last complete week', () => {
    expect(mondayOf('2026-10-22')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // Sunday
    expect(lastCompleteWeek(NOW)).toBe('2026-10-12');
    // Weeks turn over at the player's local midnight.
    expect(lastCompleteWeek(new Date(2026, 9, 19, 0, 30))).toBe('2026-10-12');
    expect(lastCompleteWeek(new Date(2026, 9, 18, 23, 30))).toBe('2026-10-05');
    expect(lastCompleteWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-21');
  });

  it('lists the seven days of a week', () => {
    expect(weekDays('2026-10-12')).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ]);
  });
});

describe('payload', () => {
  it('sums only that Monday–Sunday and carries numbers, never project names', () => {
    const r = buildRecapRequest(HISTORY, '2026-10-12', 4);
    expect(r.weekStart).toBe('2026-10-12');
    expect(r.share).toBe(true);
    const { weekLabel, ...numbers } = r.summary;
    expect(numbers).toEqual({
      totalSeconds: 6000, activeDays: 3, totalFilesCreated: 3, totalFilesModified: 8,
      longestSessionSeconds: 2400, streak: 4,
    });
    expect(typeof weekLabel).toBe('string');
    expect(Object.keys(r.summary).sort()).toEqual([
      'activeDays', 'longestSessionSeconds', 'streak', 'totalFilesCreated', 'totalFilesModified', 'totalSeconds', 'weekLabel',
    ]);
    expect(JSON.stringify(r)).not.toMatch(/secret|side-thing|projects|dailyBreakdown/);
  });

  it('is a signed endpoint with a typed Rust command', () => {
    expect(Endpoints.sendRecap).toMatchObject({ method: 'POST', signed: true, command: 'api_send_recap' });
    expect(Endpoints.sendRecap.path()).toBe('/me/recap');
  });
});

describe('WeeklyRecapSync', () => {
  it('sends last week once and shows the card toast', async () => {
    const ctx = make();
    expect(await ctx.recap.maybeSend()).toBe('sent');
    expect(ctx.api.sendRecap).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendRecap.mock.calls[0][0].weekStart).toBe('2026-10-12');
    expect(ctx.saved()).toEqual({ lastSentWeek: '2026-10-12', cardUrl: 'http://localhost:8092/api/v1/recaps/r1/card.png' });
    expect(ctx.onSent).toHaveBeenCalledWith('http://localhost:8092/api/v1/recaps/r1/card.png', expect.any(Object));

    expect(await ctx.recap.maybeSend()).toBe('already_sent');
    expect(ctx.api.sendRecap).toHaveBeenCalledTimes(1);
  });

  it('sends again when a new week completes', async () => {
    const ctx = make({ history: [...HISTORY, { date: '2026-10-20', codingSeconds: 60 }] });
    await ctx.recap.maybeSend();
    ctx.clock.now = new Date('2026-10-26T09:00:00Z');
    expect(await ctx.recap.maybeSend()).toBe('sent');
    expect(ctx.api.sendRecap.mock.calls[1][0].weekStart).toBe('2026-10-19');
  });

  it('is skipped while unlinked and sends on ACCOUNT_LINKED', async () => {
    vi.useFakeTimers();
    const ctx = make({ linked: false });
    expect(await ctx.recap.init()).toBe('unlinked');
    expect(ctx.api.sendRecap).not.toHaveBeenCalled();
    ctx.account.linked = true;
    eventBus.emit(Events.ACCOUNT_LINKED, {});
    await vi.waitFor(() => expect(ctx.saved()?.lastSentWeek).toBe('2026-10-12'));
    ctx.recap.destroy();
  });

  it('respects "Share my weekly recap" and a private profile', async () => {
    const off = make({ share: false });
    expect(await off.recap.maybeSend()).toBe('opted_out');
    const hidden = make({ visibility: 'private' });
    expect(await hidden.recap.maybeSend()).toBe('opted_out');
    expect(off.api.sendRecap).not.toHaveBeenCalled();
    expect(hidden.api.sendRecap).not.toHaveBeenCalled();
    expect(off.saved()).toBeNull();

    // Turning it back on sends the week after all.
    off.settings.values.shareWeeklyRecap = true;
    expect(await off.recap.maybeSend()).toBe('sent');
    // Followers-only profiles still get a card (the server gates who sees it).
    expect(await make({ visibility: 'followers' }).recap.maybeSend()).toBe('sent');
  });

  it('does not send an empty week', async () => {
    const ctx = make({ history: [{ date: '2026-10-19', codingSeconds: 500 }] });
    expect(await ctx.recap.maybeSend()).toBe('empty');
    expect(ctx.api.sendRecap).not.toHaveBeenCalled();
  });

  it('retries network errors and 5xx, then succeeds', async () => {
    vi.useFakeTimers();
    const replies = [{ ok: false, status: 0 }, { ok: false, status: 503 }];
    const ctx = make({ response: () => replies.shift() ?? { ok: true, status: 200, data: { cardUrl: 'http://x/card.png' } } });
    expect(await ctx.recap.maybeSend()).toBe('retry');
    expect(ctx.saved()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.api.sendRecap).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ctx.api.sendRecap).toHaveBeenCalledTimes(3);
    expect(ctx.saved()?.lastSentWeek).toBe('2026-10-12');
    expect(ctx.onSent).toHaveBeenCalledTimes(1);
  });

  it('gives up on a week the server refuses (4xx)', async () => {
    const ctx = make({ response: { ok: false, status: 422, error: 'validation' } });
    expect(await ctx.recap.maybeSend()).toBe('rejected');
    expect(ctx.saved()).toEqual({ lastSentWeek: '2026-10-12', cardUrl: null });
    expect(ctx.onSent).not.toHaveBeenCalled();
  });

  it('reports a rejected token and does not mark the week', async () => {
    const ctx = make({ response: { ok: false, status: 401, error: 'invalid_signature' } });
    expect(await ctx.recap.maybeSend()).toBe('unlinked');
    expect(ctx.account.markTokenRejected).toHaveBeenCalled();
    expect(ctx.saved()).toBeNull();
  });
});
