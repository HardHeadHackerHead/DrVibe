// PollClient: 60 s poll with ETag, dispatch of equip / notifications / visits,
// and pausing while unlinked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PollClient } from '../../src/core/PollClient.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { parsePollResponse } from '../../src/core/api/contract.js';

function okPoll(json, etag = '"v1"') {
  return { ok: true, status: 200, notModified: false, etag, poll: parsePollResponse(json, 'https://drvibe.io') };
}
const notModified = { ok: false, status: 304, notModified: true, etag: '"v1"' };

function setup({ linked = true, responses = [], equippedId = null } = {}) {
  const account = { linked, markTokenRejected: vi.fn(() => { account.linked = false; }) };
  const api = { poll: vi.fn(async () => responses.shift() ?? notModified), ack: vi.fn(async () => ({ ok: true })) };
  const client = new PollClient({ api, account, getEquippedId: () => equippedId, intervalMs: 60_000 });
  return { client, api, account };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); eventBus.clear(); });

describe('PollClient scheduling', () => {
  it('polls immediately when linked, then every 60 s', async () => {
    const { client, api } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(api.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.poll).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('does not poll while unlinked and starts on ACCOUNT_LINKED', async () => {
    const { client, api, account } = setup({ linked: false });
    client.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.poll).not.toHaveBeenCalled();
    account.linked = true;
    eventBus.emit(Events.ACCOUNT_LINKED, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(api.poll).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it('pauses on ACCOUNT_UNLINKED', async () => {
    const { client, api, account } = setup();
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    account.linked = false;
    eventBus.emit(Events.ACCOUNT_UNLINKED, {});
    await vi.advanceTimersByTimeAsync(300_000);
    expect(api.poll).toHaveBeenCalledTimes(1);
    expect(client.status).toBe('unlinked');
    client.stop();
  });

  it('sends the last ETag as If-None-Match and treats 304 as nothing new', async () => {
    const { client, api } = setup({ responses: [okPoll({ notifications: [] }, '"abc"'), notModified] });
    const seen = vi.fn();
    eventBus.on(Events.NOTIFICATION_RECEIVED, seen);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.poll.mock.calls[0][0]).toBeNull();
    expect(api.poll.mock.calls[1][0]).toBe('"abc"');
    expect(seen).not.toHaveBeenCalled();
    expect(client.status).toBe('live');
    client.stop();
  });

  it('a revoked token (401 invalid_device_token) stops polling', async () => {
    const { client, api, account } = setup({ responses: [{ ok: false, status: 401, error: 'invalid_device_token' }] });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(account.markTokenRejected).toHaveBeenCalled();
    expect(api.poll).toHaveBeenCalledTimes(1);
    expect(client.status).toBe('error');
    client.stop();
  });

  it('honours Retry-After on 429', async () => {
    const { client, api } = setup({ responses: [{ ok: false, status: 429, retryAfterSeconds: 300 }] });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.poll).toHaveBeenCalledTimes(2);
    client.stop();
  });
});

describe('PollClient dispatch', () => {
  const equipped = {
    companionId: 'c1', editionId: 'e1', editionSlug: 'neon', name: 'Neon', editionName: 'Neon', serialNumber: 7,
    rarity: 'RARE', spriteSheetUrl: 'https://cdn.drvibe.io/neon.png', thumbnailUrl: null, animJson: { vibeId: 'x' },
    skinTone: null, holo: false, retired: false,
  };

  it('emits COMPANION_EQUIPPED only when the equipped Dr. Vibe changes', async () => {
    const { client } = setup({ responses: [okPoll({ equipped })], equippedId: 'c0' });
    const onEquip = vi.fn();
    eventBus.on(Events.COMPANION_EQUIPPED, onEquip);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onEquip).toHaveBeenCalledWith(expect.objectContaining({
      id: 'c1', slug: 'neon', pngUrl: 'https://cdn.drvibe.io/neon.png', animJson: { vibeId: 'x' },
    }));
    client.stop();

    const again = setup({ responses: [okPoll({ equipped })], equippedId: 'c1' });
    const onEquip2 = vi.fn();
    eventBus.on(Events.COMPANION_EQUIPPED, onEquip2);
    again.client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onEquip2).not.toHaveBeenCalled();
    again.client.stop();
  });

  it('emits COMPANION_UNEQUIPPED when the server says nothing is equipped', async () => {
    const { client } = setup({ responses: [okPoll({ equipped: null })], equippedId: 'c1' });
    const onUnequip = vi.fn();
    eventBus.on(Events.COMPANION_UNEQUIPPED, onUnequip);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUnequip).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it('shows each notification once and acks them', async () => {
    const body = {
      notifications: [
        { id: 'n1', kind: 'follow', message: '@bob followed you', ctaUrl: '/u/bob', celebrate: false, createdAt: '2026-10-22T00:00:00.000Z' },
        { id: 'n2', kind: 'donation_thanks', message: 'Thank you!', ctaUrl: null, celebrate: true, createdAt: '2026-10-22T00:00:00.000Z' },
      ],
    };
    const { client, api } = setup({ responses: [okPoll(body), okPoll(body, '"v2"')] });
    const seen = vi.fn();
    eventBus.on(Events.NOTIFICATION_RECEIVED, seen);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen).toHaveBeenCalledTimes(2);
    const first = seen.mock.calls[0][0].notification;
    expect(first).toMatchObject({ type: 'follow', title: 'New follower', body: '@bob followed you', url: 'https://drvibe.io/u/bob' });
    expect(seen.mock.calls[1][0].notification.celebrate).toBe(true);
    expect(api.ack).toHaveBeenCalledWith({ notificationIds: ['n1', 'n2'] });
    client.stop();
  });

  it('pushes the VP balance and the stored privacy settings', async () => {
    const body = {
      account: { userId: 'u', username: 'ada', displayName: null, avatarUrl: null, vibePoints: 120, supporter: { isSupporter: false, monthlyActive: false }, freePulls: 1 },
      privacy: { profileVisibility: 'followers', showProjectNames: true, showOnVibeMap: false, appearInLeaderboards: true, whoCanVisit: 'nobody', updatedAt: '2026-10-22T00:00:00.000Z' },
    };
    const { client } = setup({ responses: [okPoll(body)] });
    const balance = vi.fn();
    const privacy = vi.fn();
    eventBus.on(Events.ECONOMY_BALANCE_PUSH, balance);
    eventBus.on(Events.PRIVACY_FROM_SERVER, privacy);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(balance).toHaveBeenCalledWith({ newBalance: 120 });
    expect(privacy.mock.calls[0][0].privacy).toMatchObject({ profileVisibility: 'followers', visitsFrom: 'nobody', showProjectNames: true });
    client.stop();
  });

  it('emits VISIT_RECEIVED for each new visit, with the sender\'s look', async () => {
    const body = { visits: [
      { id: 'v1', from: { userId: 'u1', username: 'ada', displayName: null, avatarUrl: null,
        appearance: { equipped, fallbackSkinSlug: 'pirate', skinTone: null } }, preset: 'nice_streak', isWaveBack: false, createdAt: 'x' },
      { id: 'v2', from: { userId: 'u2', username: 'bo', displayName: null, avatarUrl: null,
        appearance: { equipped: null, fallbackSkinSlug: 'pirate', skinTone: 'dark' } }, preset: null, isWaveBack: true, createdAt: 'y' },
    ] };
    const { client } = setup({ responses: [okPoll(body)] });
    const onVisit = vi.fn();
    eventBus.on(Events.VISIT_RECEIVED, onVisit);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onVisit).toHaveBeenCalledTimes(2);
    expect(onVisit.mock.calls[0][0].visit).toMatchObject({ id: 'v1', preset: 'nice_streak', from: { username: 'ada', sprite: { pngUrl: equipped.spriteSheetUrl } } });
    expect(onVisit.mock.calls[1][0].visit).toMatchObject({ isWaveBack: true, from: { sprite: { localSkin: 'dr-vibe-pirate', skinTone: 'dark' } } });
    client.stop();
  });
});

describe('parsePollResponse', () => {
  it('is forgiving about missing and malformed fields', () => {
    const p = parsePollResponse({ notifications: [null, { id: 'a', message: '' }, { id: 'b', kind: 'system', message: 'ok' }], visits: [{ from: {} }] });
    expect(p.equipped).toBeUndefined();
    expect(p.notifications).toHaveLength(1);
    expect(p.visits).toHaveLength(0);
    expect(parsePollResponse(null).notifications).toEqual([]);
  });
});
