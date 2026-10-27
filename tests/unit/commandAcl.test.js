// Command allowlist (build.rs AppManifest + capabilities): a window may call
// only the Dr. Vibe commands its capabilities grant. These checks keep the
// lists in step with the code: every command a window's page names is
// granted to it, and the sensitive ones are granted nowhere else.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const src = join(root, 'src');
const tauri = join(root, 'src-tauri');
const read = (...p) => readFileSync(join(...p), 'utf8');

const mainRs = read(tauri, 'src', 'main.rs');
const handlerBlock = mainRs.slice(mainRs.indexOf('generate_handler!['), mainRs.indexOf('])', mainRs.indexOf('generate_handler![')));
const handlerCommands = [...handlerBlock.matchAll(/\w+::(\w+)/g)].map(m => m[1]);
const buildRs = read(tauri, 'build.rs');
const buildCommands = [...buildRs.slice(buildRs.indexOf('COMMANDS'), buildRs.indexOf('];')).matchAll(/"(\w+)"/g)].map(m => m[1]);
const everyday = [...read(tauri, 'permissions', 'everyday.toml').matchAll(/"allow-([\w-]+)"/g)].map(m => m[1].replace(/-/g, '_'));
const capabilities = readdirSync(join(tauri, 'capabilities')).filter(f => f.endsWith('.json')).map(f => JSON.parse(read(tauri, 'capabilities', f)));

const SENSITIVE = [
  'api_request', 'api_poll', 'api_ack', 'api_send_events', 'api_send_visit', 'api_update_privacy', 'api_collection',
  'api_set_equipped', 'api_send_recap', 'api_submit_design', 'sync_profile', 'get_last_sync', 'start_device_link',
  'disconnect_profile', 'set_web_base_override', 'error_reports_set_enabled',
  'install_claude_code_hooks', 'uninstall_claude_code_hooks', 'set_hook_paused', 'set_hook_tracked_repos',
  'generate_character', 'regenerate_character', 'patch_character', 'accept_character_patch', 'discard_character_draft', 'cancel_generation',
  'export_local_data', 'wipe_local_data', 'preview_sync_payload', 'set_sync_enabled', 'install_skin_from_urls',
];

// Window label → its page.
const PAGES = {
  main: 'index.html', speech: 'speech.html', visitor: 'visitor.html', toast: 'toast.html',
  'character-workshop': 'character-workshop.html', 'sprite-editor': 'sprite-editor.html',
  settings: 'settings.html', 'setup-wizard': 'setup-wizard.html', dashboard: 'dashboard.html',
  session: 'session.html', about: 'about.html', achievements: 'achievements.html', skills: 'skills.html',
  weekly: 'weekly.html', 'today-wins': 'today-wins.html', 'personal-bests': 'personal-bests.html',
  debug: 'debug.html', make: 'make.html', 'whats-new': 'whats-new.html', 'toast-item-*': 'toast-item.html',
};

/** Commands named (as string literals) by a page and every module it imports. */
function commandsNamedBy(page) {
  const texts = [read(src, page)];
  const queue = [...texts[0].matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => resolve(src, m[1]));
  const seen = new Set();
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const t = readFileSync(f, 'utf8');
    texts.push(t);
    for (const m of t.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const p = m[1] || m[2];
      if (p.endsWith('.js')) queue.push(resolve(dirname(f), p));
    }
  }
  const all = texts.join('\n');
  return handlerCommands.filter(c => new RegExp(`['"\`]${c}['"\`]`).test(all));
}

function granted(label, command) {
  const allow = `allow-${command.replace(/_/g, '-')}`;
  return capabilities.some(cap => cap.windows.includes(label)
    && (cap.permissions.includes(allow) || (cap.permissions.includes('everyday') && everyday.includes(command))));
}

describe('command allowlist', () => {
  it('build.rs lists exactly the registered commands', () => {
    expect([...buildCommands].sort()).toEqual([...handlerCommands].sort());
  });

  it('"everyday" holds every command except the sensitive ones', () => {
    expect(everyday.filter(c => SENSITIVE.includes(c))).toEqual([]);
    expect([...everyday, ...SENSITIVE].sort()).toEqual([...handlerCommands].sort());
  });

  it('every window is mapped to its page', () => {
    for (const cap of capabilities) for (const w of cap.windows) expect(PAGES[w], w).toBeDefined();
  });

  it.each(Object.entries(PAGES))('%s may call every command its page names', (label, page) => {
    const missing = commandsNamedBy(page).filter(c => !granted(label, c));
    expect(missing).toEqual([]);
  });

  it('sensitive commands reach only the windows that use them', () => {
    for (const c of SENSITIVE) {
      for (const label of Object.keys(PAGES)) {
        if (granted(label, c)) expect(commandsNamedBy(PAGES[label]), `${label} → ${c}`).toContain(c);
      }
    }
    // Toast popups show server text: nothing beyond reading the site address.
    expect(handlerCommands.filter(c => granted('toast-item-*', c))).toEqual(['get_web_base_url']);
    expect(granted('main', 'install_skin_from_urls')).toBe(false);
  });
});
