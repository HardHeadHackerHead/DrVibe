// EconomyClient: runs only when linked, caps the offline queue, pauses on 401.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EconomyClient, MAX_QUEUE } from '../../src/features/economy/EconomyClient.js';
import { eventBus } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';

function make({ linked = true, reply } = {}) {
  const account = { linked, markTokenRejected: vi.fn() };
  const api = {
    reportEvents: vi.fn(async (events) => reply?.(events) ?? {
      ok: true, status: 200, data: { results: events.map(() => ({ awarded: 0, reasonCode: 'cap' })) },
    }),
  };
  return { client: new EconomyClient({ api, account }), api, account };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(db, 'get').mockReturnValue(null);
  vi.spyOn(db, 'set').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  eventBus.clear();
});

describe('EconomyClient', () => {
  it('ignores activity while unlinked', async () => {
    const { client, api } = make({ linked: false });
    await client.init();
    client.reportActivity('GIT_COMMIT', {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.queueLength).toBe(0);
    expect(api.reportEvents).not.toHaveBeenCalled();
  });

  it('sends queued events when linked', async () => {
    const { client, api } = make();
    await client.init();
    client.reportActivity('GIT_COMMIT', { repo: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.reportEvents).toHaveBeenCalledTimes(1);
    expect(api.reportEvents.mock.calls[0][0][0]).toMatchObject({ eventType: 'GIT_COMMIT', metadata: { repo: 'x' } });
    expect(client.queueLength).toBe(0);
  });

  it('keeps events on network failure (offline) and caps the queue', async () => {
    const { client } = make({ reply: () => ({ ok: false, status: 0 }) });
    await client.init();
    for (let i = 0; i < MAX_QUEUE + 25; i++) client.reportActivity('CODING_SESSION_START', { i });
    expect(client.queueLength).toBe(MAX_QUEUE);
    // Oldest were dropped: the first remaining item is #25.
    expect(client._queue[0].metadata.i).toBe(25);
  });

  it('pauses when the device token was revoked (401 invalid_device_token)', async () => {
    const { client, account, api } = make({ reply: () => ({ ok: false, status: 401, error: 'invalid_device_token' }) });
    await client.init();
    client.reportActivity('GIT_COMMIT', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(account.markTokenRejected).toHaveBeenCalled();
    expect(client.queueLength).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.reportEvents).toHaveBeenCalledTimes(1);
  });

  it('retries other 401s (clock skew) instead of pausing', async () => {
    const { client, api } = make({ reply: () => ({ ok: false, status: 401, error: 'clock_skew' }) });
    await client.init();
    client.reportActivity('GIT_COMMIT', {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.reportEvents.mock.calls.length).toBeGreaterThan(1);
  });

  it('uses EventBatchResponse: per-event errors and the batch balance', async () => {
    const pushes = [];
    eventBus.on('economy:balancePush', (p) => pushes.push(p.newBalance));
    const { client } = make({ reply: (events) => ({
      ok: true, status: 200,
      data: { balance: 42, results: events.map((e, i) => (i === 0
        ? { clientEventId: e.clientEventId, awarded: 0, capHit: false, reasonCode: '', error: 'rate_limited' }
        : { clientEventId: e.clientEventId, awarded: 3, capHit: false, reasonCode: 'git_commit' })) },
    }) });
    await client.init();
    client.reportActivity('GIT_COMMIT', {});
    client.reportActivity('POMODORO_COMPLETE', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes).toContain(42);
    // The rate-limited one stays queued for later.
    expect(client._queue.map((q) => q.eventType)).toContain('GIT_COMMIT');
  });

  it('a fixed clientEventId is queued once (STREAK_DAY per day)', async () => {
    const { client } = make({ reply: () => ({ ok: false, status: 0 }) });
    await client.init();
    client.reportActivity('STREAK_DAY', { streakLength: 3, day: '2026-10-22' }, 'streak-day-2026-10-22');
    client.reportActivity('STREAK_DAY', { streakLength: 3, day: '2026-10-22' }, 'streak-day-2026-10-22');
    expect(client.queueLength).toBe(1);
    expect(client._queue[0].clientEventId).toBe('streak-day-2026-10-22');
  });

  it('pauses when the request could not be sent because there is no token', async () => {
    const { client } = make({ reply: () => ({ ok: false, status: 0, unlinked: true }) });
    await client.init();
    client.reportActivity('GIT_COMMIT', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(client._paused).toBe(true);
    expect(client.queueLength).toBe(1);
  });
});
