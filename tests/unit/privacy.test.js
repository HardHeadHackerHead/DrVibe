// Privacy settings are sent only when changed locally, and only once.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PrivacySync } from '../../src/features/privacy/PrivacySync.js';
import { PRIVACY_DEFAULTS } from '../../src/core/api/contract.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

function make({ linked = true, ok = true, syncOn = true } = {}) {
  let saved = null;
  const store = { load: () => saved, save: (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const api = { updatePrivacy: vi.fn(async () => ({ ok, status: ok ? 200 : 503 })) };
  const account = { linked, markTokenRejected: vi.fn() };
  const sync = new PrivacySync({ api, account, store, sync: { enabled: syncOn } });
  return { sync, api, account, store, saved: () => saved };
}

afterEach(() => eventBus.clear());

describe('PrivacySync', () => {
  it('starts from the PLAN defaults and sends nothing on start', async () => {
    const { sync, api } = make();
    sync.init();
    await sync.flush();
    expect(sync.get()).toEqual(PRIVACY_DEFAULTS);
    expect(sync.get()).toMatchObject({
      profileVisibility: 'public', showProjectNames: false, showOnVibeMap: false, appearInLeaderboards: true,
    });
    expect(api.updatePrivacy).not.toHaveBeenCalled();
  });

  it('sends the full settings once after a local change', async () => {
    const { sync, api } = make();
    await sync.update({ showOnVibeMap: true });
    expect(api.updatePrivacy).toHaveBeenCalledTimes(1);
    expect(api.updatePrivacy.mock.calls[0][0]).toEqual({ ...PRIVACY_DEFAULTS, showOnVibeMap: true });
    expect(sync.pending).toBe(false);
    await sync.flush();
    expect(api.updatePrivacy).toHaveBeenCalledTimes(1);
  });

  it('does not send when the value did not actually change', async () => {
    const { sync, api } = make();
    await sync.update({ profileVisibility: 'public' });
    expect(api.updatePrivacy).not.toHaveBeenCalled();
  });

  it('keeps a change made while unlinked pending and sends it when linked', async () => {
    const ctx = make({ linked: false });
    ctx.sync.init();
    await ctx.sync.update({ profileVisibility: 'private' });
    expect(ctx.api.updatePrivacy).not.toHaveBeenCalled();
    expect(ctx.sync.pending).toBe(true);
    ctx.account.linked = true;
    eventBus.emit(Events.ACCOUNT_LINKED, {});
    await ctx.sync.flush();
    expect(ctx.api.updatePrivacy).toHaveBeenCalledTimes(1);
    expect(ctx.api.updatePrivacy.mock.calls[0][0].profileVisibility).toBe('private');
    expect(ctx.sync.pending).toBe(false);
  });

  it('stays pending when the server fails', async () => {
    const { sync } = make({ ok: false });
    await sync.update({ appearInLeaderboards: false });
    expect(sync.pending).toBe(true);
  });

  it('normalises bad values', () => {
    const { sync } = make({ linked: false });
    sync.update({ profileVisibility: 'everyone', visitsFrom: 'nobody' });
    expect(sync.get().profileVisibility).toBe('public');
    expect(sync.get().visitsFrom).toBe('nobody');
  });

  it('adopts settings changed on the website, unless a local change is pending', async () => {
    const { sync, api } = make({ linked: false });
    expect(sync.applyServer({ profileVisibility: 'private', showProjectNames: true, showOnVibeMap: false, appearInLeaderboards: true, visitsFrom: 'nobody', updatedAt: 't1' })).toBe(true);
    expect(sync.get()).toMatchObject({ profileVisibility: 'private', visitsFrom: 'nobody' });
    expect(api.updatePrivacy).not.toHaveBeenCalled();
    await sync.update({ showOnVibeMap: true });
    expect(sync.applyServer({ profileVisibility: 'public', updatedAt: 't2' })).toBe(false);
    expect(sync.get().showOnVibeMap).toBe(true);
  });

  it('sends whoCanVisit to the server (PrivacySettingsPatch)', async () => {
    const { toPrivacyPatch } = await import('../../src/core/api/contract.js');
    expect(toPrivacyPatch({ visitsFrom: 'everyone' })).toEqual({
      profileVisibility: 'public', showProjectNames: false, showOnVibeMap: false, appearInLeaderboards: true, whoCanVisit: 'everyone',
      shareActivityTimes: true, shareCodingNow: true, allowSearchIndexing: true,
    });
  });

  it('keeps a local send switch when the server leaves it out', async () => {
    const { parsePrivacy } = await import('../../src/core/api/contract.js');
    const { sync, store } = make();
    await sync.update({ shareActivityTimes: false });
    expect(store.load().pending).toBe(false);
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    const old = parsePrivacy({ profileVisibility: 'followers', showProjectNames: false, showOnVibeMap: false, appearInLeaderboards: true, whoCanVisit: 'followers', updatedAt: iso(60_000) });
    expect('shareActivityTimes' in old).toBe(false);
    expect('allowSearchIndexing' in old).toBe(false);
    expect(sync.applyServer(old)).toBe(true);
    expect(sync.get()).toMatchObject({ profileVisibility: 'followers', shareActivityTimes: false, shareCodingNow: true, allowSearchIndexing: true });
    // A website change made after the local choice wins like any other.
    expect(sync.applyServer(parsePrivacy({ ...old, whoCanVisit: 'followers', shareActivityTimes: true, updatedAt: iso(120_000) }))).toBe(true);
    expect(sync.get().shareActivityTimes).toBe(true);
  });

  it('a server value no newer than the local choice never resets a send switch', async () => {
    const { parsePrivacy } = await import('../../src/core/api/contract.js');
    const acked = new Date(Date.now() + 5_000).toISOString();
    const { sync, api } = make();
    api.updatePrivacy.mockResolvedValue({ ok: true, status: 200, data: { updatedAt: acked } });
    await sync.update({ shareCodingNow: false });
    // A server that saved nothing for the switch echoes the default with its own timestamp.
    const echoed = parsePrivacy({ ...PRIVACY_DEFAULTS, whoCanVisit: 'followers', shareCodingNow: true, allowSearchIndexing: false, updatedAt: acked });
    sync.applyServer(echoed);
    expect(sync.get().shareCodingNow).toBe(false);
    // Website-only fields still follow the site.
    expect(sync.get().allowSearchIndexing).toBe(false);
  });

  it('the setup wizard can send the whole body even when nothing changed', async () => {
    const { sync, api } = make();
    expect(await sync.update({}, { force: false })).toBe(false);
    expect(await sync.update({}, { force: true })).toBe(true);
    expect(api.updatePrivacy).toHaveBeenCalledTimes(1);
  });

  it('holds changes while "Sync my stats" is off', async () => {
    const { sync, api } = make({ syncOn: false });
    expect(await sync.update({ showOnVibeMap: true })).toBe(false);
    expect(sync.pending).toBe(true);
    expect(api.updatePrivacy).not.toHaveBeenCalled();
  });
});
