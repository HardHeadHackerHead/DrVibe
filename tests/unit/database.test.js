// Database: every section the app writes is reloaded from the Tauri store,
// so a cleared localStorage doesn't lose them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, NEW_SECTIONS } from '../../src/core/Database.js';

let store;
let realInvoke;

beforeEach(() => {
  localStorage.clear();
  store = { _version: 1 };
  realInvoke = window.__TAURI__.core.invoke;
  window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === 'plugin:store|load') return 1;
    if (cmd === 'plugin:store|get') return args.key in store ? [store[args.key], true] : [null, false];
    if (cmd === 'plugin:store|set') { store[args.key] = args.value; return null; }
    return null;
  };
});

afterEach(() => {
  window.__TAURI__.core.invoke = realInvoke;
  localStorage.clear();
});

describe('Database._loadAll', () => {
  it.each(['setupWizard', 'companion', 'claudeCode', 'privacy', 'economy', 'weeklyRecap', 'codingHourOfDay'])(
    'reloads %s from the store',
    async (section) => {
      store[section] = { marker: section };
      const fresh = new db.constructor();
      await fresh.init();
      expect(fresh.getSection(section)).toEqual({ marker: section });
    },
  );

  it('never loads the Rust-owned profile section', async () => {
    expect(NEW_SECTIONS).not.toContain('profile');
    store.profile = { linked: true };
    const fresh = new db.constructor();
    await fresh.init();
    expect(fresh.getSection('profile')).toBeNull();
  });
});
