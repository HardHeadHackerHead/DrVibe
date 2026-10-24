// The generator prompt (tools/generate-character.md) against the 2.0 sprite
// format: its row table and ROWS constant come from src/config/animations.js,
// and the script template it hands the CLI really produces a sheet that
// passes the local spriteSpec checks.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import pngjs from 'pngjs';
import { ANIMATIONS } from '../../src/config/animations.js';
import { validateSheet, ROW_SPEC, SHEET_WIDTH, SHEET_HEIGHT, LEGACY_HEIGHT, FRAME } from '../../src/features/make/spriteSpec.js';
import { syncPromptText, ROW_POSES } from '../../src/features/make/generatorPrompt.js';

const ROOT = path.resolve(__dirname, '../..');
// Normalised: Windows checkouts (core.autocrlf) give the file CRLF line endings.
const PROMPT = fs.readFileSync(path.join(ROOT, 'tools/generate-character.md'), 'utf8').replace(/\r\n/g, '\n');

/** Placeholders generator.rs substitutes (fill_prompt). */
const APP_PLACEHOLDERS = ['$ARGUMENTS', '$SKINS_DIR', '$SCRIPTS_DIR', '$REFERENCE_SECTION', '$MODEL_NAME', '$AGENT_NAME', '$BASED_ON'];

function template() {
  const m = PROMPT.match(/```javascript\n([\s\S]*?)```/);
  if (!m) throw new Error('No script template in the prompt');
  return m[1];
}

/** Fill the template the way the CLI would, with a simple test drawing. */
function script({ skinsDir, slug = 'test-vibe', draw, levitating = true, patch = null }) {
  let src = template()
    .replaceAll('$SKINS_DIR', skinsDir.replace(/\\/g, '/'))
    .replace("const SLUG = '{slug}'; // FILL IN", `const SLUG = '${slug}';`)
    .replace(/\/\/ draw:begin[\s\S]*?\/\/ draw:end/, draw)
    .replace('const LEVITATING = true;', `const LEVITATING = ${levitating};`);
  if (patch) src = src.replace('const PATCH = null;', `const PATCH = ${JSON.stringify(patch)};`);
  return src;
}

/** A body in every frame, offset by frame index so frames differ. */
const FULL_DRAW = `
const DRAW = Object.fromEntries(ROWS.map(([name], row) => [name, (p, i) => {
  p.rect(9, 4, 14, 24, C.skin);
  p.rect(9 + i, 4, 2, 2, [row * 10, 100, 200]);
  p.rect(28, 0, 40, 4, C.ink); // runs past the frame edge: must be clipped
}]));`;

let tmp;
function run(src, name = 'generate-test.cjs') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, src);
  return spawnSync(process.execPath, [file], { encoding: 'utf8' });
}
function readSheet(file) {
  const png = pngjs.PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drvibe-gen-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('generator prompt: the row map', () => {
  it('is in sync with animations.js (npm run sync:generator-prompt)', () => {
    expect(syncPromptText(PROMPT)).toBe(PROMPT);
  });

  it('lists every row with the frame count the animator plays', () => {
    const table = [...PROMPT.matchAll(/^\| (\d+) \| (\d+) \| `(\w+)`[^|]*\| (\d) \|/gm)]
      .map(([, row, y, name, frames]) => ({ row: +row, y: +y, name, frames: +frames }));
    expect(table).toHaveLength(17);
    for (const t of table) {
      expect(t.y).toBe(t.row * FRAME);
      const anims = Object.values(ANIMATIONS).filter((a) => a.row === t.row);
      expect(anims.length).toBeGreaterThan(0);
      for (const a of anims) expect(a.frameCount).toBe(t.frames);
      expect(t.frames).toBeLessThanOrEqual(4);
      expect(ROW_POSES[t.name]).toBeTruthy();
    }
    expect(table.map((t) => t.name)).toEqual(ROW_SPEC.map((r) => r.name));
  });

  it('describes the 2.0 sheet, not the old layout', () => {
    expect(PROMPT).toContain('128 × 512');
    expect(PROMPT).toContain('128 × 544');
    expect(PROMPT).toMatch(/no walkLeft row/i);
    expect(PROMPT).toMatch(/No bonus rows/);
    expect(PROMPT).not.toMatch(/maxFrames/);
    expect(PROMPT).not.toMatch(/bonusAnimations": \{|BONUS_ROWS|require\('canvas'\)/);
  });

  it('only uses placeholders the app fills, and keeps the output contract', () => {
    const used = new Set(PROMPT.match(/\$[A-Z_]+/g));
    expect([...used].sort()).toEqual([...APP_PLACEHOLDERS].sort());
    expect(PROMPT).toContain('GENERATED_SKIN: {slug}');
    expect(PROMPT).toContain('`$SKINS_DIR`');
  });
});

describe('generator prompt: the script template', () => {
  it('writes a 128 × 544 sheet that passes the local checks, and its sidecar', () => {
    const r = run(script({ skinsDir: tmp, draw: FULL_DRAW }));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const img = readSheet(path.join(tmp, 'test-vibe.png'));
    expect([img.width, img.height]).toEqual([SHEET_WIDTH, SHEET_HEIGHT]);
    const v = validateSheet(img, fs.statSync(path.join(tmp, 'test-vibe.png')).size);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    // Unused columns stay transparent: idle has 3 frames, so column 3 is empty
    // apart from the clipped bar of column 2, which must not bleed into it.
    let opaque = 0;
    for (let y = 0; y < FRAME; y++) for (let x = 96; x < 128; x++) opaque += img.data[(y * SHEET_WIDTH + x) * 4 + 3] > 0;
    expect(opaque).toBe(0);
    const anim = JSON.parse(fs.readFileSync(path.join(tmp, 'test-vibe.anim.json'), 'utf8'));
    expect(anim.animations).toBeUndefined();
    expect(anim.bonusAnimations).toBeUndefined();
    expect(anim.idleFlourishes.actions.every((a) => a.type === 'transform')).toBe(true);
  });

  it('writes a 128 × 512 sheet without the levitating row', () => {
    const r = run(script({ skinsDir: tmp, slug: 'no-float', draw: FULL_DRAW, levitating: false }));
    expect(r.status).toBe(0);
    const img = readSheet(path.join(tmp, 'no-float.png'));
    expect(img.height).toBe(LEGACY_HEIGHT);
    expect(validateSheet(img).ok).toBe(true);
  });

  it('refuses to save when a row is almost empty', () => {
    const draw = FULL_DRAW.replace("p.rect(9, 4, 14, 24, C.skin);", "if (name !== 'focused') p.rect(9, 4, 14, 24, C.skin);");
    const r = run(script({ skinsDir: tmp, slug: 'holes', draw }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Sheet check failed[\s\S]*Row 13 \(focused\) frame 1/);
    expect(fs.existsSync(path.join(tmp, 'holes.png'))).toBe(false);
  });

  it('patch mode redraws one row and keeps the rest of a Lab Original', () => {
    const input = path.join(ROOT, 'src/assets/sprites/skins/dr-vibe-default.png');
    const output = path.join(tmp, 'patched--draft.png');
    const draw = `const DRAW = { walk(p, i) { copyFrame(0, 0, i, 6); p.rect(2, 2, 3, 3, [255, 0, 0]); } };`;
    const r = run(script({ skinsDir: tmp, draw, patch: { row: 'walk', input, output } }), 'patch-test.cjs');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const before = readSheet(input);
    const after = readSheet(output);
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    const rowBytes = SHEET_WIDTH * FRAME * 4;
    for (let row = 0; row < before.height / FRAME; row++) {
      const a = before.data.subarray(row * rowBytes, (row + 1) * rowBytes);
      const b = after.data.subarray(row * rowBytes, (row + 1) * rowBytes);
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0).toBe(row !== 6);
    }
    expect(validateSheet(after).ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'test-vibe.anim.json'))).toBe(true);
  });

  it('uses only Node built-ins', () => {
    const requires = [...template().matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    expect(requires.sort()).toEqual(['fs', 'path', 'zlib']);
    expect(() => execFileSync(process.execPath, ['--check', '-'], { input: script({ skinsDir: tmp, draw: FULL_DRAW }) })).not.toThrow();
  });
});
