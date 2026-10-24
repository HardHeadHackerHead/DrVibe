// Dashboard Community tab: rank, rank change, friends coding now, Visit.
// Data comes from the last POST /desktop/sync response (SyncResponse).

import { describe, it, expect, vi } from 'vitest';
import { renderCommunity, mountCommunityTab } from '../../src/ui/CommunityTab.js';
import { communityFromSync, visitErrorMessage } from '../../src/core/api/contract.js';

const snapshot = communityFromSync({
  newAchievements: [],
  leaderboard: { rank: 42, change: 3 },
  friends: {
    activeFriends: 2,
    codingNow: [{ username: 'ada', displayName: 'Ada <script>', avatarUrl: null, currentProject: null, currentStreak: 5 }],
  },
  skinApproved: true,
});

describe('Community tab', () => {
  it('maps SyncResponse: rank 0 means hidden from leaderboards', () => {
    expect(snapshot.rank).toBe(42);
    expect(communityFromSync({ leaderboard: { rank: 0, change: 0 }, friends: { activeFriends: 0, codingNow: [] } }).rank).toBeNull();
  });

  it('shows rank, rank change and friends, escaping names', () => {
    const root = document.createElement('div');
    renderCommunity(root, { state: 'ready', community: snapshot });
    expect(root.querySelector('.comm-rank-value').textContent).toBe('#42');
    expect(root.querySelector('.comm-rank-change').textContent).toBe('▲ 3');
    expect(root.querySelectorAll('.comm-friend')).toHaveLength(1);
    expect(root.innerHTML).not.toContain('<script>');
    expect(root.querySelector('[data-action="visit"]').dataset.username).toBe('ada');
  });

  it('invites unlinked players instead of showing data', () => {
    const root = document.createElement('div');
    renderCommunity(root, { state: 'unlinked' });
    expect(root.querySelector('[data-action="join"]')).not.toBeNull();
  });

  it('sends a visit by username with the chosen preset', async () => {
    const root = document.createElement('div');
    const api = { sendVisit: vi.fn(async () => ({ ok: true, status: 201, data: { visitId: 'v1', delivery: 'walk_on' } })) };
    const tab = mountCommunityTab(root, {
      openUrl: vi.fn(), siteBase: () => 'https://drvibe.io',
      getView: () => ({ linked: true, community: snapshot }), api,
    });
    tab.refresh();
    root.querySelector('.comm-preset').value = 'nice_streak';
    root.querySelector('[data-action="visit"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(api.sendVisit).toHaveBeenCalledWith('ada', 'nice_streak');
    expect(root.querySelector('[data-role="status"]').textContent).toContain('on the way to @ada');
  });

  it('starts linking from the join button', () => {
    const root = document.createElement('div');
    const startLink = vi.fn();
    const tab = mountCommunityTab(root, { openUrl: vi.fn(), siteBase: () => '', getView: () => ({ linked: false, community: null }), startLink });
    tab.refresh();
    root.querySelector('[data-action="join"]').click();
    expect(startLink).toHaveBeenCalled();
  });

  it('lists recent visits on open and waves back within 24 h', async () => {
    const now = Date.now();
    const api = {
      recentVisits: vi.fn(async () => ({ ok: true, status: 200, data: { visits: [
        { id: 'v1', from: { id: 'u1', username: 'ada', displayName: null }, to: {}, preset: 'nice_streak', delivery: 'walk_on',
          isWaveBack: false, createdAt: new Date(now - 3600e3).toISOString(), outcome: 'played' },
        { id: 'v2', from: { id: 'u2', username: 'bo', displayName: 'Bo' }, to: {}, preset: null, delivery: 'notification',
          isWaveBack: false, createdAt: new Date(now - 48 * 3600e3).toISOString(), outcome: 'missed' },
      ], nextCursor: null } })),
      sendVisit: vi.fn(async () => ({ ok: true, status: 201, data: { visitId: 'v3', delivery: 'walk_on' } })),
    };
    const root = document.createElement('div');
    const tab = mountCommunityTab(root, { openUrl: vi.fn(), siteBase: () => '', getView: () => ({ linked: true, community: snapshot }), api });
    await tab.start();
    const rows = root.querySelectorAll('.comm-visit');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Nice streak!');
    expect(rows[1].textContent).toContain('while you were away');
    // Only the visit from the last 24 h can be waved back.
    const waves = root.querySelectorAll('[data-action="wave"]');
    expect(waves).toHaveLength(1);
    waves[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(api.sendVisit).toHaveBeenCalledWith('ada', null, 'v1');
    expect(root.querySelector('[data-role="status"]').textContent).toContain('waved back at @ada');
  });

  it('explains visit errors from API.md §19', () => {
    expect(visitErrorMessage({ error: 'visit_cooldown' }, 'ada')).toMatch(/this hour/);
    expect(visitErrorMessage({ error: 'followers_only' }, 'ada')).toMatch(/their followers/);
  });
});
