// The setup wizard's privacy steps: Skip or close leaves the private
// defaults (no hooks, no crash reports, no settings written), and Finish
// hands every choice over explicitly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wizardDefaults } from '../../src/ui/wizardDefaults.js';
import { WATCH_CHOICES, SEND_CHOICES, WHO_CHOICES, SYNC_CHOICE, choiceByKey } from '../../src/ui/privacyChoices.js';
import { SENT_WHEN_LINKED, STAYS_LOCAL } from '../../src/ui/WhatDrVibeSees.js';
import { PRIVACY_DEFAULTS } from '../../src/core/api/contract.js';

const html = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'setup-wizard.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');

describe('wizard defaults', () => {
  it('a first run starts private where the owner decided, and community defaults stay', () => {
    const d = wizardDefaults();
    expect(d).toMatchObject({
      claudeCodeHooksEnabled: false,
      trackClaudeRepos: false,
      errorReports: false,
      gitTrackingEnabled: true,
      hideWhenPresenting: true,
      shareWeeklyRecap: true,
      syncEnabled: true,
      profileVisibility: 'public',
      appearInLeaderboards: true,
      showProjectNames: false,
      showOnVibeMap: false,
      visitsFrom: 'followers',
      shareActivityTimes: true,
      shareCodingNow: true,
    });
  });

  it('"Run setup again" starts from what is saved', () => {
    const d = wizardDefaults({
      settings: { claudeCodeHooksEnabled: true, trackClaudeRepos: true, shareWeeklyRecap: false },
      privacy: { ...PRIVACY_DEFAULTS, shareCodingNow: false, profileVisibility: 'private' },
      errorReports: true,
    });
    expect(d).toMatchObject({
      claudeCodeHooksEnabled: true, trackClaudeRepos: true, shareWeeklyRecap: false,
      shareCodingNow: false, profileVisibility: 'private', errorReports: true,
    });
    // Track-Claude-repos needs the hooks.
    expect(wizardDefaults({ settings: { trackClaudeRepos: true } }).trackClaudeRepos).toBe(false);
  });

  it('every choice has a label, help text and a default', () => {
    for (const c of [...WATCH_CHOICES, ...SEND_CHOICES, ...WHO_CHOICES, SYNC_CHOICE]) {
      // One plain line in the row, the long text behind "More".
      expect(c.short.length, c.key).toBeLessThanOrEqual(72);
      expect(c.label.length, c.key).toBeGreaterThan(3);
      expect(c.help.length, c.key).toBeGreaterThan(20);
      expect(c.default, c.key).not.toBeUndefined();
    }
    const sendKeys = [...SEND_CHOICES, ...WHO_CHOICES].filter(c => c.store === 'privacy').map(c => c.key).sort();
    expect(sendKeys).toEqual(Object.keys(PRIVACY_DEFAULTS).sort());
  });
});

describe('"What Dr. Vibe sees"', () => {
  it('names every send switch and every piece of metadata that leaves', () => {
    const sent = SENT_WHEN_LINKED.join(' ');
    for (const key of ['shareActivityTimes', 'shareCodingNow', 'showProjectNames', 'shareWeeklyRecap']) {
      expect(sent).toContain(choiceByKey(key).label);
    }
    expect(sent).toContain('Sync my stats');
    for (const what of ['time zone', '60 seconds', 'rounded to the minute', 'keyed hash', 'unlocked', 'picture']) {
      expect(sent).toContain(what);
    }
    const local = STAYS_LOCAL.join(' ');
    expect(local).toContain('all open windows');
    expect(local).toContain('tracked repos only');
    expect(local).toContain('never the command');
  });
});

describe('setup wizard window', () => {
  let invoke;
  let emitTo;
  let osClose = null;

  async function openWizard({ claude = true } = {}) {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = body;
    invoke = vi.fn(async (cmd) => {
      if (cmd === 'list_skins') return [];
      if (cmd === 'get_profile') return { linked: false };
      if (cmd === 'claude_code_present') return claude;
      if (cmd === 'error_reports_get_enabled') return false;
      return null;
    });
    emitTo = vi.fn(async () => {});
    window.__TAURI__ = {
      core: { invoke },
      event: { emitTo, listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) },
      window: { getCurrentWindow: () => ({ close: vi.fn(), startDragging: vi.fn(), onCloseRequested: (fn) => { osClose = fn; return Promise.resolve(() => {}); } }) },
    };
    await import('../../src/setup-wizard.js');
    await vi.waitFor(() => expect(document.querySelector('#send-choices [data-choice="errorReports"]')).not.toBeNull());
  }

  const stored = () => JSON.parse(localStorage.getItem('dr-vibe-database') || '{}');
  const emitted = (event) => emitTo.mock.calls.filter(([to, ev]) => to === 'main' && ev === event).map(c => c[2]);
  const next = () => document.getElementById('btn-next').click();

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Skip on the first step saves no settings, installs nothing and leaves crash reports off', async () => {
    await openWizard();
    document.getElementById('btn-skip').click();
    await vi.waitFor(() => expect(emitted('setup-wizard-completed')).toHaveLength(1));
    expect(stored().settings).toBeUndefined();
    expect(stored().setupWizard).toEqual({ completed: true });
    const cmds = invoke.mock.calls.map(c => c[0]);
    expect(cmds).not.toContain('install_claude_code_hooks');
    expect(cmds).not.toContain('error_reports_set_enabled');
    expect(emitted('privacy-changed')).toEqual([]);
    for (const saved of emitted('settings-saved')) {
      expect(Object.keys(saved).every(k => ['selectedSkin', 'selectedSkinTone', 'characterScale'].includes(k)), JSON.stringify(saved)).toBe(true);
    }
  });

  it('closing after the privacy step puts the choices back', async () => {
    await openWizard();
    for (let i = 0; i < 5; i++) next();
    document.querySelector('#send-choices [data-choice="shareCodingNow"]').click();
    next();
    expect(emitted('privacy-changed')).toEqual([]);
    next(); // reaches the Join step: handed over early
    expect(emitted('privacy-changed')[0]).toMatchObject({ shareCodingNow: false, force: true });
    document.getElementById('btn-close').click();
    await vi.waitFor(() => expect(emitted('setup-wizard-completed')).toHaveLength(1));
    expect(emitted('privacy-changed')[1]).toEqual({ ...PRIVACY_DEFAULTS });
    expect(invoke.mock.calls.map(c => c[0])).not.toContain('error_reports_set_enabled');
  });

  it('closing the window from the OS (Alt+F4) is a Skip that puts choices back', async () => {
    await openWizard();
    for (let i = 0; i < 5; i++) next();
    document.querySelector('#send-choices [data-choice="shareActivityTimes"]').click();
    next();
    next();
    const event = { preventDefault: vi.fn() };
    osClose(event);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(emitted('setup-wizard-completed')).toHaveLength(1));
    expect(emitted('privacy-changed').at(-1)).toEqual({ ...PRIVACY_DEFAULTS });
    expect(stored().settings).toBeUndefined();
  });

  it('Finish hands over every choice, with hooks and crash reports only if chosen', async () => {
    await openWizard();
    for (let i = 0; i < 3; i++) next();
    document.querySelector('#watch-choices [data-choice="claudeCodeHooksEnabled"]').click();
    next();
    next();
    document.querySelector('#send-choices [data-choice="errorReports"]').click();
    document.querySelector('#send-choices [data-choice="shareActivityTimes"]').click();
    next();
    document.querySelector('#who-choices [data-choice="showOnVibeMap"]').click();
    next();
    expect(document.getElementById('join-summary').textContent).toContain('Send my activity times: off');
    expect(document.getElementById('join-summary').textContent).toContain('Show me on the Vibe Map: on');
    document.getElementById('btn-join-change-who').click();
    expect(document.querySelector('.step-panel.active').dataset.step).toBe('6');
    next();
    next(); // Finish without joining
    await vi.waitFor(() => expect(emitted('setup-wizard-completed')).toHaveLength(1));
    const saved = emitted('settings-saved').at(-1);
    expect(saved).toMatchObject({ claudeCodeHooksEnabled: true, trackClaudeRepos: true, shareWeeklyRecap: true, syncEnabled: true });
    expect(invoke).toHaveBeenCalledWith('error_reports_set_enabled', { enabled: true });
    expect(emitted('privacy-changed').at(-1)).toEqual({ ...PRIVACY_DEFAULTS, shareActivityTimes: false, showOnVibeMap: true, force: true });
    // The main window installs hooks after completion, never the wizard.
    expect(invoke.mock.calls.map(c => c[0])).not.toContain('install_claude_code_hooks');
  });

  it('without Claude Code the hooks cannot be chosen', async () => {
    await openWizard({ claude: false });
    expect(document.querySelector('#watch-choices [data-choice="claudeCodeHooksEnabled"]')).toBeNull();
    for (let i = 0; i < 7; i++) next();
    expect(document.querySelectorAll('.step-dot')).toHaveLength(8);
    next();
    await vi.waitFor(() => expect(emitted('setup-wizard-completed')).toHaveLength(1));
    expect(emitted('settings-saved').at(-1)).toMatchObject({ claudeCodeHooksEnabled: false, trackClaudeRepos: false });
    expect(invoke).toHaveBeenCalledWith('error_reports_set_enabled', { enabled: false });
  });
});
