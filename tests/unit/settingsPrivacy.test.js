// Settings → Privacy shows the same choices as setup, each going where it
// belongs: privacy fields to the main window (PrivacySync), the crash report
// switch to Rust, the rest into settings.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SEND_CHOICES } from '../../src/ui/privacyChoices.js';

const html = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'settings.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');

describe('Settings → Privacy', () => {
  let invoke;
  let emitTo;
  const emitted = (event) => emitTo.mock.calls.filter(([to, ev]) => to === 'main' && ev === event).map(c => c[2]);

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // jsdom has no CSS.escape (the skin grid uses it).
    globalThis.CSS = globalThis.CSS || { escape: (s) => String(s) };
    localStorage.clear();
    localStorage.setItem('dr-vibe-database', JSON.stringify({ settings: { shareWeeklyRecap: true } }));
    document.body.innerHTML = body;
    invoke = vi.fn(async (cmd) => {
      if (cmd === 'get_profile') return { linked: false };
      if (cmd === 'list_skins') return [];
      if (cmd === 'error_reports_get_enabled') return false;
      if (cmd === 'error_reports_set_enabled') return true;
      if (cmd === 'check_claude_code_hooks') return false;
      return null;
    });
    emitTo = vi.fn(async () => {});
    window.__TAURI__ = {
      core: { invoke },
      event: { emitTo, emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) },
      window: { getCurrentWindow: () => ({ close: vi.fn(), startDragging: vi.fn(async () => {}) }) },
    };
    await import('../../src/settings-page.js');
    await vi.waitFor(() => expect(document.querySelector('#privacy-send-choices [data-choice="errorReports"]')).not.toBeNull());
  });

  it('lists every send choice with its setup wording, crash reports off', async () => {
    const rows = document.querySelectorAll('#privacy-send-choices [data-choice-row]');
    expect([...rows].map(r => r.dataset.choiceRow)).toEqual(SEND_CHOICES.map(c => c.key));
    expect(document.getElementById('privacy-send-choices').textContent).toContain('Send my activity times');
    await vi.waitFor(() => expect(document.getElementById('choice-errorReports').checked).toBe(false));
    expect(document.getElementById('choice-shareActivityTimes').checked).toBe(true);
    expect(document.getElementById('choice-syncEnabled')).not.toBeNull();
  });

  it('a send switch goes to the main window; crash reports go to Rust', async () => {
    document.getElementById('choice-shareCodingNow').click();
    expect(emitted('privacy-changed')).toContainEqual({ shareCodingNow: false });
    document.getElementById('choice-errorReports').click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('error_reports_set_enabled', { enabled: true }));
  });

  it('Claude Code is off and its repos switch waits for it', async () => {
    await vi.waitFor(() => expect(document.getElementById('track-claude-repos').disabled).toBe(true));
    expect(document.getElementById('claude-hooks-enabled').checked).toBe(false);
    expect(document.querySelector('[data-choice-help="claudeCodeHooksEnabled"]').textContent).toContain('~/.claude/settings.json');
  });

  it('pause buttons and local data actions ask the main window', () => {
    document.querySelector('[data-pause="1h"]').click();
    expect(emitted('pause-tracking')).toContainEqual({ mode: '1h' });
    document.getElementById('local-forget-repos-btn').click();
    expect(emitted('local-data')).toContainEqual({ action: 'forget-repos' });
    const wipe = document.getElementById('local-wipe-btn');
    wipe.click();
    expect(emitted('local-data')).not.toContainEqual({ action: 'wipe' });
    wipe.click();
    expect(emitted('local-data')).toContainEqual({ action: 'wipe' });
  });
});
