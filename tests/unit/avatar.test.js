// Profile pictures: the <img> fallback to initials, and keeping the stored
// profile in step with the poll's account.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { setAvatar, initialsFor, isAvatarUrl } from '../../src/ui/avatar.js';
import { createProfileRefresher, profileChanged, profileFromAccount } from '../../src/core/accountProfile.js';
import { parsePollResponse } from '../../src/core/api/contract.js';
import { PollClient } from '../../src/core/PollClient.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

function els() {
  const img = document.createElement('img');
  const initials = document.createElement('span');
  return { img, initials };
}

describe('setAvatar', () => {
  it('shows the picture with safe attributes', () => {
    const { img, initials } = els();
    setAvatar(img, initials, { url: 'https://cdn.discordapp.com/avatars/1/a.png', name: 'DHack' });
    expect(img.getAttribute('src')).toBe('https://cdn.discordapp.com/avatars/1/a.png');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.alt).toBe('DHack');
    expect(img.style.display).toBe('block');
    expect(initials.style.display).toBe('none');
  });

  it('falls back to initials when the picture fails to load', () => {
    const { img, initials } = els();
    setAvatar(img, initials, { url: 'https://cdn.discordapp.com/avatars/1/dead.png', name: 'dhack' });
    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
    expect(initials.style.display).toBe('');
    expect(initials.textContent).toBe('DH');
  });

  it('uses initials without a URL, and ? when signed out', () => {
    const { img, initials } = els();
    setAvatar(img, initials, { url: null, name: 'Ada' });
    expect(img.style.display).toBe('none');
    expect(initials.textContent).toBe('AD');
    setAvatar(img, initials, { url: 'https://x/a.png', name: 'Ada', show: false });
    expect(img.hasAttribute('src')).toBe(false);
    expect(initials.textContent).toBe('?');
  });

  it('never loads non-http URLs', () => {
    const { img, initials } = els();
    setAvatar(img, initials, { url: 'javascript:alert(1)', name: 'x' });
    expect(img.hasAttribute('src')).toBe(false);
    expect(isAvatarUrl('data:image/png;base64,AAA')).toBe(false);
    expect(initialsFor('@bo')).toBe('BO');
    expect(initialsFor('')).toBe('?');
  });
});

describe('profile refresh', () => {
  const stored = { linked: true, username: 'dhack', displayName: 'DHack', avatarUrl: 'https://cdn.discordapp.com/avatars/1/old.png' };

  it('detects changes in name or picture only', () => {
    expect(profileChanged(stored, profileFromAccount({ ...stored, vibePoints: 5 }))).toBe(false);
    expect(profileChanged(stored, profileFromAccount({ ...stored, avatarUrl: null }))).toBe(true);
    expect(profileFromAccount({ username: '' })).toBeNull();
    expect(profileFromAccount({ username: 'a', avatarUrl: 'file:///x' }).avatarUrl).toBeNull();
  });

  it('invokes update_profile once per change', async () => {
    const invoke = vi.fn(async () => true);
    const refresh = createProfileRefresher(invoke, stored);
    expect(await refresh({ ...stored })).toBe(false);
    const changed = { username: 'dhack', displayName: 'DHack', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' };
    expect(await refresh(changed)).toBe(true);
    expect(await refresh(changed)).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('update_profile', changed);
  });

  it('retries after a failed invoke', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
    const refresh = createProfileRefresher(invoke, stored);
    const changed = { ...stored, avatarUrl: null };
    expect(await refresh(changed)).toBe(false);
    expect(await refresh(changed)).toBe(true);
  });
});

describe('poll account profile', () => {
  afterEach(() => eventBus.clear());

  it('parses and emits the account name and picture', async () => {
    const poll = parsePollResponse({
      account: { userId: 'u', username: 'dhack', displayName: 'DHack', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4', vibePoints: 3, freePulls: 0 },
      notifications: [], visits: [],
    });
    expect(poll.account.avatarUrl).toBe('https://avatars.githubusercontent.com/u/2?v=4');
    const seen = [];
    eventBus.on(Events.ACCOUNT_PROFILE_FROM_SERVER, (p) => seen.push(p));
    const client = new PollClient({ api: { poll: vi.fn(), ack: vi.fn() }, account: { linked: true } });
    client._dispatch(poll);
    expect(seen).toEqual([{ username: 'dhack', displayName: 'DHack', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }]);
  });
});
