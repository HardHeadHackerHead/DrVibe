// Settings → Privacy shows the same choices as setup, each going where it
// belongs: privacy fields to the main window (PrivacySync), the crash report
// switch to Rust, the rest into settings. The send and visibility rows are
// greyed out while the account isn't linked or Sync my stats is off.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SEND_CHOICES, WHO_CHOICES } from '../../src/ui/privacyChoices.js';

const html = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'settings.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');

/** Opens the Settings page with a stubbed Tauri. Returns the spies. */
async function openSettings({ linked }) {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // jsdom has no CSS.escape (the skin grid uses it) or scrollIntoView.
  globalThis.CSS = globalThis.CSS || { escape: (s) => String(s) };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  localStorage.clear();
  localStorage.setItem('dr-vibe-database', JSON.stringify({ settings: { shareWeeklyRecap: true } }));
  document.body.innerHTML = body;
  const invoke = vi.fn(async (cmd) => {
    if (cmd === 'get_profile') return linked ? { linked: true, username: 'ada' } : { linked: false };
    if (cmd === 'list_skins') return [];
    if (cmd === 'error_reports_get_enabled') return false;
    if (cmd === 'error_reports_set_enabled') return true;
    if (cmd === 'check_claude_code_hooks') return false;
    return null;
  });
  const emitTo = vi.fn(async () => {});
  window.__TAURI__ = {
    core: { invoke },
    event: { emitTo, emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) },
    window: { getCurrentWindow: () => ({ close: vi.fn(), startDragging: vi.fn(async () => {}) }) },
  };
  await import('../../src/settings-page.js');
  // Settled once the privacy tab has loaded the account state.
  await vi.waitFor(() => expect(document.getElementById('choice-shareActivityTimes').disabled).toBe(!linked));
  await vi.waitFor(() => expect(document.getElementById('privacy-gate-note').hidden).toBe(linked));
  const emitted = (event) => emitTo.mock.calls.filter(([to, ev]) => to === 'main' && ev === event).map(c => c[2]);
  return { invoke, emitTo, emitted };
}

describe('Settings → Privacy, not linked', () => {
  let ctx;
  beforeAll(async () => { ctx = await openSettings({ linked: false }); });

  it('lists the send and visibility choices in their groups, with a one-line description and More', () => {
    const keys = (id) => [...document.querySelectorAll(`#${id} [data-choice-row]`)].map(r => r.dataset.choiceRow);
    expect(keys('privacy-send-choices')).toEqual(SEND_CHOICES.filter(c => !c.always).map(c => c.key));
    expect(keys('privacy-crash-choice')).toEqual(['errorReports']);
    expect(keys('privacy-who-choices')).toEqual(WHO_CHOICES.map(c => c.key));
    const row = document.querySelector('[data-choice-row="shareActivityTimes"]');
    expect(row.textContent).toContain('When you code and commit.');
    expect(row.querySelector('details.choice-more').open).toBe(false);
  });

  it('greys out what needs an account, with one line saying why; crash reports stay usable', async () => {
    expect(document.getElementById('privacy-gate-note').textContent).toContain('Not linked');
    expect(document.getElementById('choice-shareActivityTimes').disabled).toBe(true);
    expect(document.getElementById('choice-profileVisibility').disabled).toBe(true);
    expect(document.getElementById('choice-syncEnabled').disabled).toBe(true);
    const crash = document.getElementById('choice-errorReports');
    expect(crash.disabled).toBe(false);
    await vi.waitFor(() => expect(crash.checked).toBe(false));
    crash.click();
    await vi.waitFor(() => expect(ctx.invoke).toHaveBeenCalledWith('error_reports_set_enabled', { enabled: true }));
  });

  it('the explainer is closed, and screen sharing and pause live in Tracking', () => {
    expect(document.querySelector('details.privacy-explainer').open).toBe(false);
    expect(document.querySelector('#panel-privacy #pause-buttons')).toBeNull();
    expect(document.querySelector('#panel-tracking #pause-buttons')).not.toBeNull();
    expect(document.querySelector('#panel-tracking #choice-hideWhenPresenting')).not.toBeNull();
  });

  it('Claude Code is off: its repos switch waits for it and Repair hooks is hidden', async () => {
    await vi.waitFor(() => expect(document.getElementById('track-claude-repos').disabled).toBe(true));
    expect(document.getElementById('track-claude-repos-row').classList.contains('is-disabled')).toBe(true);
    expect(document.getElementById('claude-hooks-enabled').checked).toBe(false);
    expect(document.getElementById('hooks-install-btn').hidden).toBe(true);
    expect(document.querySelector('[data-choice-help="claudeCodeHooksEnabled"]').textContent).toContain('~/.claude/settings.json');
  });

  it('git settings are greyed out, not hidden, while git tracking is off', () => {
    const git = document.getElementById('git-tracking-enabled');
    git.click();
    const rows = document.getElementById('git-tracking-sub-rows');
    expect(rows.classList.contains('is-disabled')).toBe(true);
    expect(document.getElementById('git-commit-reminders').disabled).toBe(true);
    git.click();
    expect(rows.classList.contains('is-disabled')).toBe(false);
  });

  it('"View queued reports" opens the Outbox', () => {
    document.getElementById('crash-queue-btn').click();
    expect(ctx.emitted('outbox-request')).toContainEqual({ for: 'settings' });
  });

  it('pause buttons and local data actions ask the main window', () => {
    document.querySelector('[data-pause="1h"]').click();
    expect(ctx.emitted('pause-tracking')).toContainEqual({ mode: '1h' });
    document.getElementById('local-forget-repos-btn').click();
    expect(ctx.emitted('local-data')).toContainEqual({ action: 'forget-repos' });
    const wipe = document.getElementById('local-wipe-btn');
    wipe.click();
    expect(ctx.emitted('local-data')).not.toContainEqual({ action: 'wipe' });
    wipe.click();
    expect(ctx.emitted('local-data')).toContainEqual({ action: 'wipe' });
  });
});

describe('Settings → Privacy, linked', () => {
  let ctx;
  beforeAll(async () => { ctx = await openSettings({ linked: true }); });

  it('a send switch goes to the main window', () => {
    document.getElementById('choice-shareCodingNow').click();
    expect(ctx.emitted('privacy-changed')).toContainEqual({ shareCodingNow: false });
  });

  it('Sync my stats off greys out the send and visibility rows', () => {
    document.getElementById('choice-syncEnabled').click();
    expect(document.getElementById('privacy-gate-note').textContent).toContain('Sync my stats is off');
    expect(document.getElementById('choice-shareActivityTimes').disabled).toBe(true);
    expect(document.getElementById('choice-visitsFrom').disabled).toBe(true);
    expect(document.getElementById('choice-errorReports').disabled).toBe(false);
    document.getElementById('choice-syncEnabled').click();
    expect(document.getElementById('privacy-gate-note').hidden).toBe(true);
    expect(document.getElementById('choice-shareActivityTimes').disabled).toBe(false);
  });
});
