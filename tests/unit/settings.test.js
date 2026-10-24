// Settings: unchanged values are no-ops, and removed default coding apps
// stay removed across restarts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Settings, DEFAULT_SETTINGS } from '../../src/features/settings/Settings.js';
import { eventBus, Events } from '../../src/core/EventBus.js';
import { db } from '../../src/core/Database.js';

let saved;

beforeEach(() => {
  saved = null;
  vi.spyOn(db, 'getSection').mockImplementation(() => saved);
  vi.spyOn(db, 'setSection').mockImplementation((_s, v) => { saved = JSON.parse(JSON.stringify(v)); });
});

afterEach(() => {
  eventBus.clear();
  vi.restoreAllMocks();
});

async function load() {
  const s = new Settings();
  await s.init();
  return s;
}

describe('Settings.set', () => {
  it('does nothing when the value is unchanged', async () => {
    const s = await load();
    const changed = vi.fn();
    eventBus.on(Events.SETTINGS_CHANGED, changed);
    db.setSection.mockClear();

    s.set('workInterval', s.workInterval);
    s.set('codingApps', [...s.codingApps]);
    s.set('position', { ...s.position });
    expect(changed).not.toHaveBeenCalled();
    expect(db.setSection).not.toHaveBeenCalled();

    s.set('workInterval', 30);
    expect(changed).toHaveBeenCalledWith({ key: 'workInterval', value: 30 });
    expect(db.setSection).toHaveBeenCalledTimes(1);
  });

  it('compares after clamping', async () => {
    const s = await load();
    s.set('workInterval', 120);
    const changed = vi.fn();
    eventBus.on(Events.SETTINGS_CHANGED, changed);
    s.set('workInterval', 500); // clamps to 120
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('coding app backfill', () => {
  it('keeps a removed default app removed', async () => {
    let s = await load();
    s.save();
    s.removeCodingApp('vim');
    expect(saved.codingApps).not.toContain('vim');

    s = await load();
    expect(s.codingApps).not.toContain('vim');
  });

  it('adds defaults the profile has not been offered yet', async () => {
    const offered = DEFAULT_SETTINGS.codingApps.filter(a => a !== 'Claude');
    saved = { codingApps: ['Code'], codingAppsOffered: offered };
    const s = await load();
    expect(s.codingApps).toEqual(['Code', 'Claude']);
    expect(saved.codingAppsOffered).toEqual(expect.arrayContaining(DEFAULT_SETTINGS.codingApps));
  });

  it('backfills every missing default once for profiles saved before tracking', async () => {
    saved = { codingApps: ['Code'] };
    let s = await load();
    expect(s.codingApps).toEqual(expect.arrayContaining(DEFAULT_SETTINGS.codingApps));
    s.removeCodingApp('Zed');
    s = await load();
    expect(s.codingApps).not.toContain('Zed');
  });
});
