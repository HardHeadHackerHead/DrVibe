// Release-only configuration that no dev run exercises: bundled resources and
// window capabilities. A missing entry passes every dev run and test while
// the installed app silently loses the feature.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const tauriDir = join(root, 'src-tauri');
const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'));

describe('bundled resources', () => {
  it('ships the Lab Original skins where skins.rs looks for them', () => {
    const { resources } = conf.bundle;
    // skins.rs: resource_dir()/assets/sprites/skins/<slug>.png
    const entry = Object.entries(resources).find(([, dest]) => dest.replace(/\/$/, '') === 'assets/sprites/skins');
    expect(entry).toBeDefined();
    const src = join(tauriDir, entry[0]);
    expect(existsSync(src)).toBe(true);
    const files = readdirSync(src);
    expect(files).toContain('dr-vibe-default.png');
    // Flat layout: the directory map copies <slug>.png / <slug>.anim.json as-is.
    expect(files.every(f => /\.(png|anim\.json)$/.test(f))).toBe(true);
  });
});

const capability = (name) => JSON.parse(readFileSync(join(tauriDir, 'capabilities', `${name}.json`), 'utf8'));
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const rustSources = readdirSync(join(tauriDir, 'src')).filter(f => f.endsWith('.rs')).map(f => read('src-tauri', 'src', f)).join('\n');
const appJs = read('src', 'app.js');

// Every window the app can open: config windows, Rust open_panel calls and
// JS openPanelWindow calls.
function openedWindowLabels() {
  const labels = new Set(conf.app.windows.map(w => w.label));
  for (const m of rustSources.matchAll(/open_panel\(\s*[^,]+,\s*"([a-z-]+)"/g)) labels.add(m[1]);
  for (const m of appJs.matchAll(/openPanelWindow\(\s*'([a-z-]+)'/g)) labels.add(m[1]);
  return [...labels];
}

describe('capabilities', () => {
  const def = capability('default');

  it('cover every window the app opens', () => {
    const labels = openedWindowLabels();
    expect(labels).toContain('whats-new');
    for (const label of labels) expect(def.windows, label).toContain(label);
  });

  it('let frameless windows be dragged by their custom title bars', () => {
    expect(def.permissions).toContain('core:window:allow-start-dragging');
  });

  it('let toast items open their "View" link', () => {
    const { permissions } = capability('toast-item');
    expect(permissions.some(p => p === 'opener:default' || p === 'opener:allow-open-url')).toBe(true);
  });
});

describe('panel windows', () => {
  it('open frameless when the page draws its own title bar', () => {
    const calls = [...appJs.matchAll(/openPanelWindow\(\s*'([a-z-]+)',\s*'([a-z-]+\.html)'([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(5);
    for (const [, label, page, rest] of calls) {
      const ownTitleBar = /class="titlebar"/.test(read('src', page));
      const args = rest.split(',').map(a => a.trim());
      const decorations = args[5] ?? 'true'; // title, width, height, resizable, ..., decorations
      expect(decorations, label).toBe(ownTitleBar ? 'false' : 'true');
    }
  });
});
