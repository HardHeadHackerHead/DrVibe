# Generate a Dr. Vibe

You are making a new pixel-art character sheet for the Dr. Vibe desktop companion app.

## Your Task

Do exactly these three things, in order. Do not read any other files first; everything you need is in this prompt.

1. Write the script `$SCRIPTS_DIR/generate-{slug}.cjs` by filling in the template below.
2. Run it: `node "$SCRIPTS_DIR/generate-{slug}.cjs"`. If it prints `Sheet check failed`, fix the drawing and run it again.
3. Print as the very last line of your reply: `GENERATED_SKIN: {slug}`

The slug is lowercase, hyphen-separated, with no spaces (for example `tiny-frog`, `grumpy-wizard`, `space-robot`).

The script uses only Node's built-in modules (`fs`, `path`, `zlib`). Do not `require` any npm package and do not run `npm install`.

## Character Description

$ARGUMENTS

$REFERENCE_SECTION

## The Sheet Format

One spec for the app and the website. A sheet that breaks it cannot be worn or submitted.

- Frames are **32 × 32 px**. The sheet has **4 columns** and is **128 px wide**.
- **128 × 512** (16 rows) or **128 × 544** (17 rows, with the optional levitating row 16). Nothing else.
- Each row is one state, in the fixed order below. Draw exactly the listed number of frames, left to right from column 0. Leave the unused columns fully transparent.
- **Walk has one row, facing right.** The app mirrors it at runtime for walking left. There is no walkLeft row.
- **No bonus rows.** Rows after 16 are rejected. The Incubator only accepts this layout.
- Background is fully transparent. Every pixel is either alpha 0 or alpha 255: no anti-aliasing, no soft edges, no semi-transparent glows.
- The first two frames of each of rows 0–15 must be at least 5% drawn (52 of 1024 pixels). The script checks this before it saves.
- The PNG must stay under 2 MB (a sheet like this is a few KB).

<!-- row-table:begin — generated from src/config/animations.js; run `npm run sync:generator-prompt` -->
| Row | y | State | Frames | What it shows |
|-----|---|-------|--------|---------------|
| 0 | 0 | `idle` | 3 | Standing front-facing, relaxed. Small breathing bob or a blink between frames. |
| 1 | 32 | `coding` | 4 | Typing: arms forward and down, hands alternating up/down, eyes on the keys. |
| 2 | 64 | `thinking` | 3 | One hand at the chin, eyes looking up; a small head tilt between frames. |
| 3 | 96 | `tired` | 3 | Slumped shoulders, half-closed eyes, maybe a yawn; slow and heavy. |
| 4 | 128 | `excited` | 4 | Arms up and out, big open smile, a 1–2 px hop. |
| 5 | 160 | `alert` | 3 | Wide eyes, open mouth, arms tense at the sides; a startled jolt. |
| 6 | 192 | `walk` | 4 | Walk cycle facing RIGHT: legs alternate (contact, pass, contact, pass), arms swing opposite. Mirrored at runtime for walking left. |
| 7 | 224 | `stretching` | 4 | Arms rise from the sides to straight overhead, body lengthens. |
| 8 | 256 | `beaker` | 3 | Holds up a small glowing beaker or flask in one hand; it rises and glows. |
| 9 | 288 | `libraryCard` | 4 | Holds up a small yellow card next to the face, showing it off. |
| 10 | 320 | `thumbsUp` | 3 | One arm comes up into a clear thumbs-up, confident smile. |
| 11 | 352 | `coverEyes` | 3 | Hands come up over the eyes; peeks through the fingers. |
| 12 | 384 | `celebrating` | 4 | Both arms straight up, jumping, open-mouth cheer. |
| 13 | 416 | `focused` | 2 | Goggles or visor down, steady and calm; barely moves. |
| 14 | 448 | `concerned` | 3 | Worried brows, small frown, hands together or a sweat drop. |
| 15 | 480 | `presenting` | 3 | Turns slightly and points one arm out to the side, as if presenting a slide. |
| 16 | 512 | `levitating` (optional) | 4 | Floats 2–3 px off the ground with feet dangling and a few sparkles around; gentle bob. |
<!-- row-table:end -->

Timings, behaviours and frame counts come from the app; the sheet only supplies the art.

## Style (match the Lab Originals)

The 12 bundled Lab Originals share one look; a new Dr. Vibe should sit next to them naturally.

- **Front-facing chibi**: a big head (about 12–14 px wide) on a short body with stubby legs. Expressive eyes and mouth do most of the acting.
- **Same footprint in every frame**: the character fills roughly x 5–26 and y 3–27 of each frame, centred, with the feet on y 27. Keep the head and feet in the same place across rows so switching states does not jump. Props, raised arms and sparkles may go out to x 1–30 and y 0–31.
- **Skin tones are swappable**: draw skin with exactly these three colours and use them for nothing else. The app swaps them for the player's chosen skin tone.
  - `skin` [253, 216, 176] (lit), `skinShade` [232, 184, 136] (shade), `skinDark` [212, 168, 120] (deep shade)
  - A non-human character (robot, animal) can skip them; then set `blink: false` in the sidecar.
- **Flat, shaded colour**: 2–3 shades per material (base, shade, dark), light from the top left. About 40–80 colours in the whole sheet.
- **No black outlines**: edges come from the darker shade of each material. Use a dark navy such as [42, 42, 58] for pupils, boots and the darkest details instead of pure black.
- **One strong idea**: a hat, a costume, a prop or a colour scheme that reads at 32 px. Keep the silhouette clear.
- **Motion**: change the pose between frames (arms, head tilt, a 1–2 px bob), not just a colour. Idle stays subtle; excited and celebrating are big.

## Patch Mode

If the Character Description starts with `patch <slug>: fix the <animation> animation`, you are fixing one row of an existing sheet instead of making a new one:

- Write `$SCRIPTS_DIR/patch-<slug>.cjs` from the same template. Set `PATCH` to an object with `row` (the row name), `input` (the `PNG_INPUT` path from the `[PATHS]` line) and `output` (the `PNG_OUTPUT` path), as shown in the template comment, and draw only that row in `DRAW`. The animation names `walkRight` and `walkLeft` both mean the `walk` row.
- The script loads the input sheet, clears that row, draws it again and writes the output. Every other row is kept as it is. Use `copyFrame` to start from an existing frame (for example idle) so the character keeps its look.
- Run it, then print `PATCHED_SKIN: <slug>` as the last line.

## Sidecar (`{slug}.anim.json`)

The script also writes the character's personality next to the PNG. Tune it to the description: a hyper character breathes fast and walks quickly, a sleepy one is slow, a bouncy one has big squash and stretch.

- `name`: the display name.
- `idleMicroMotion`: `breathing` { scaleY 0.01–0.03, period 2000–5000 ms } and `sway` { offsetX 0.5–2, period 3000–6000 ms }.
- `idleFlourishes`: { minInterval, maxInterval, actions }. Each action is `{ name, weight, type: 'transform', duration }` and `name` is one of `lookAround`, `adjustGoggles`, `tapFoot`, `smallWave`.
- `squashStretch`: per state, `{ scaleX, scaleY, speed }` (scaleX 0.003–0.08, scaleY 0.008–0.12, speed 0.4–6).
- `walk`: { maxSpeed 1.5–3.5, minIdleMs, maxIdleMs }.
- `blink`: true for a face with eyes where the default blink lands, false otherwise.

Do not write `animations`, `bonusAnimations` or `generation` blocks. The app records provenance itself (model `$MODEL_NAME`, agent `$AGENT_NAME`, based on `$BASED_ON`).

## Script Template

Fill in the parts marked FILL IN. Keep everything else as it is.

```javascript
/**
 * FILL IN: character name — a Dr. Vibe made from a description.
 * Usage: node generate-{slug}.cjs
 * Uses only Node's built-in modules.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SLUG = '{slug}'; // FILL IN
const SKINS_DIR = String.raw`$SKINS_DIR`;
// Patch mode only: { row: 'walk', input: String.raw`…`, output: String.raw`…` }
const PATCH = null;

// ── Sheet format (do not change) ────────────────────────────────────────
const F = 32;
const COLS = 4;
// rows:begin — generated from src/config/animations.js; do not edit
const ROWS = [
  ['idle', 3],
  ['coding', 4],
  ['thinking', 3],
  ['tired', 3],
  ['excited', 4],
  ['alert', 3],
  ['walk', 4],
  ['stretching', 4],
  ['beaker', 3],
  ['libraryCard', 4],
  ['thumbsUp', 3],
  ['coverEyes', 3],
  ['celebrating', 4],
  ['focused', 2],
  ['concerned', 3],
  ['presenting', 3],
  ['levitating', 4],
];
// rows:end
const STANDARD_ROWS = 16;
const LEVITATING = true; // draw row 16 (128 × 544); false gives a 16-row 128 × 512 sheet
const W = COLS * F;

// ── Palette (FILL IN the character's colours) ───────────────────────────
const C = {
  skin: [253, 216, 176],      // swappable skin tones: use exactly these, only for skin
  skinShade: [232, 184, 136],
  skinDark: [212, 168, 120],
  ink: [42, 42, 58],          // darkest detail (eyes, boots); never pure black
  white: [245, 245, 250],
};

// ── Drawing (FILL IN) ───────────────────────────────────────────────────
// DRAW[rowName](p, i) paints frame i (0-based) of that row. `p` draws in
// frame-local coordinates 0–31; anything outside the frame is clipped, so a
// frame can never spill into its neighbours.
//   p.px(x, y, col)            one pixel
//   p.hline(x, y, w, col)      horizontal run
//   p.vline(x, y, h, col)      vertical run
//   p.rect(x, y, w, h, col)    filled rectangle
//   p.erase(x, y, w = 1, h = 1) back to transparent
// Share a base body between rows with your own helpers, e.g.
// drawBody(p, { bob, armL, armR, eyes, mouth }).
// draw:begin
function drawBody(p, o = {}) {
  const y = o.bob || 0;
  p.rect(10, 4 + y, 12, 12, C.skin);    // head
  p.rect(9, 16 + y, 14, 9, C.white);    // body
  p.rect(11, 25, 4, 3, C.ink);          // legs and feet stay on the ground
  p.rect(17, 25, 4, 3, C.ink);
}
const DRAW = {
  idle(p, i) { drawBody(p, { bob: i === 1 ? 1 : 0 }); },
  // … one entry for every row name in ROWS
};
// draw:end

// ── Engine (do not change) ──────────────────────────────────────────────
let rowCount = LEVITATING && DRAW.levitating ? STANDARD_ROWS + 1 : STANDARD_ROWS;
let sheet;
if (PATCH) {
  const input = readPng(PATCH.input);
  const patchRow = ROWS.findIndex(([name]) => name === PATCH.row);
  if (patchRow < 0) throw new Error(`Unknown row ${PATCH.row}.`);
  if (input.width !== W || input.height % F || input.height > ROWS.length * F) {
    throw new Error(`Input sheet is ${input.width} × ${input.height}; expected ${W} wide and at most ${ROWS.length} rows.`);
  }
  rowCount = Math.max(input.height / F, patchRow + 1, STANDARD_ROWS);
  sheet = new Uint8Array(W * rowCount * F * 4);
  sheet.set(input.data);
  sheet.fill(0, patchRow * F * W * 4, (patchRow + 1) * F * W * 4); // clear the row being redrawn
} else {
  sheet = new Uint8Array(W * rowCount * F * 4);
}
const H = rowCount * F;

function painter(col, row) {
  const ox = col * F;
  const oy = row * F;
  const set = (x, y, c, a) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= F || y >= F) return; // clip to this frame
    const k = ((oy + y) * W + ox + x) * 4;
    sheet[k] = c[0]; sheet[k + 1] = c[1]; sheet[k + 2] = c[2]; sheet[k + 3] = a;
  };
  const p = {
    px(x, y, c) { if (c) set(x, y, c, 255); },
    hline(x, y, w, c) { for (let i = 0; i < w; i++) p.px(x + i, y, c); },
    vline(x, y, h, c) { for (let i = 0; i < h; i++) p.px(x, y + i, c); },
    rect(x, y, w, h, c) { for (let r = 0; r < h; r++) p.hline(x, y + r, w, c); },
    erase(x, y, w = 1, h = 1) { for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) set(x + i, y + r, [0, 0, 0], 0); },
  };
  return p;
}

/** Copy one frame onto another (handy in patch mode and for shared poses). */
function copyFrame(fromCol, fromRow, toCol, toRow) {
  for (let y = 0; y < F; y++) {
    const from = ((fromRow * F + y) * W + fromCol * F) * 4;
    const to = ((toRow * F + y) * W + toCol * F) * 4;
    sheet.copyWithin(to, from, from + F * 4);
  }
}

ROWS.forEach(([name, frames], row) => {
  if (row >= rowCount || (PATCH && name !== PATCH.row)) return;
  const draw = DRAW[name];
  if (!draw) throw new Error(`No drawing for row ${row} (${name}).`);
  for (let i = 0; i < frames; i++) draw(painter(i, row), i);
});

// Same check as the app and the website: the first two frames of every
// standard row must be at least 5% drawn.
const problems = [];
ROWS.forEach(([name, frames], row) => {
  if (row >= rowCount) return;
  for (let col = 0; col < Math.min(frames, 2); col++) {
    let opaque = 0;
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        if (sheet[((row * F + y) * W + col * F + x) * 4 + 3] > 0) opaque++;
      }
    }
    if (opaque < 0.05 * F * F) problems.push(`Row ${row} (${name}) frame ${col + 1} is almost empty (${opaque} px drawn, needs 52).`);
  }
});
if (problems.length) {
  console.error(`Sheet check failed:\n${problems.join('\n')}`);
  process.exit(1);
}

const out = PATCH ? PATCH.output : path.join(SKINS_DIR, `${SLUG}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(W, H, sheet));
console.log(`Saved ${out} (${W} × ${H})`);

if (!PATCH) {
  const anim = {
    name: 'FILL IN display name',
    idleMicroMotion: { breathing: { scaleY: 0.02, period: 3000 }, sway: { offsetX: 1, period: 4500 } },
    idleFlourishes: {
      minInterval: 15000,
      maxInterval: 40000,
      actions: [
        { name: 'lookAround', weight: 3, type: 'transform', duration: 1200 },
        { name: 'tapFoot', weight: 2, type: 'transform', duration: 1500 },
        { name: 'smallWave', weight: 1, type: 'transform', duration: 1000 },
      ],
    },
    squashStretch: {
      idle: { scaleX: 0.01, scaleY: 0.02, speed: 0.8 },
      excited: { scaleX: 0.03, scaleY: 0.06, speed: 3.0 },
      celebrating: { scaleX: 0.04, scaleY: 0.08, speed: 3.5 },
    },
    walk: { maxSpeed: 2.5, minIdleMs: 10000, maxIdleMs: 28000 },
    blink: true,
  };
  const sidecar = path.join(SKINS_DIR, `${SLUG}.anim.json`);
  fs.writeFileSync(sidecar, JSON.stringify(anim, null, 2));
  console.log(`Saved ${sidecar}`);
}

// ── PNG (RGBA, 8-bit) with zlib ─────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8; let w = 0; let h = 0; let type = 0; let depth = 0; let interlace = 0;
  let palette = null; let trns = null; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = { 2: 3, 3: 1, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error('Only 8-bit, non-interlaced RGB, RGBA or palette PNGs can be patched.');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (type === 6) { data.set(px.subarray(i * 4, i * 4 + 4), i * 4); continue; }
    const rgb = type === 3 ? palette.subarray(px[i] * 3, px[i] * 3 + 3) : px.subarray(i * 3, i * 3 + 3);
    data.set(rgb, i * 4);
    data[i * 4 + 3] = type === 3 && trns && px[i] < trns.length ? trns[px[i]] : 255;
  }
  return { width: w, height: h, data };
}
```

## Rules

- Write the script, run it, and finish with `GENERATED_SKIN: {slug}` (or `PATCHED_SKIN: <slug>` in patch mode) as the last line.
- Every row in the table needs a `DRAW` entry; row 16 (levitating) is optional — set `LEVITATING = false` to leave it out.
- Do not change the sheet format constants, the engine or the PNG code.
- If the script fails, read its error, fix the drawing and run it again before you finish.
