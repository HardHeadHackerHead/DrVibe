/**
 * bake-skins.cjs
 *
 * Embeds each skin's .anim.json into the LSBs of its PNG sprite sheet,
 * PICO-8 style. After running this, every skin PNG is self-contained —
 * no separate sidecar file is needed for animation data.
 *
 * Uses pngjs for raw pixel access with no color-profile transforms.
 *
 * Usage:  node scripts/bake-skins.cjs [--verify]
 *   --verify  Re-reads each PNG after writing and confirms the round-trip.
 */

'use strict';

const { PNG } = require('pngjs');
const fs      = require('fs');
const path    = require('path');

const MAGIC     = Buffer.from([0x44, 0x52, 0x56, 0x42]); // "DRVB"
const SKINS_DIR = path.join(__dirname, '..', 'src', 'assets', 'sprites', 'skins');
const VERIFY    = process.argv.includes('--verify');

// ── LSB helpers ─────────────────────────────────────────────────────────────

/** Write `payload` into the 2 LSBs of R,G,B in RGBA pixel buffer. */
function lsbWrite(data, payload) {
  let bitPos  = 0;
  const total = payload.length * 8;
  let px      = 0;
  while (bitPos < total) {
    const base = px * 4;
    for (let ch = 0; ch < 3; ch++) {
      if (bitPos >= total) break;
      const b1 = (payload[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
      bitPos++;
      const b2 = bitPos < total
        ? (payload[bitPos >> 3] >> (7 - (bitPos & 7))) & 1
        : 0;
      if (bitPos < total) bitPos++;
      data[base + ch] = (data[base + ch] & 0xFC) | (b1 << 1) | b2;
    }
    px++;
  }
}

/** Read `byteCount` bytes from the 2-LSB stream of R,G,B. */
function lsbRead(data, byteCount) {
  const out = Buffer.allocUnsafe(byteCount);
  let bits = 0, held = 0, outIdx = 0, px = 0;
  while (outIdx < byteCount) {
    const base = px * 4;
    if (base + 2 >= data.length) break;
    bits = (bits << 2) | (data[base]     & 3);
    bits = (bits << 2) | (data[base + 1] & 3);
    bits = (bits << 2) | (data[base + 2] & 3);
    held += 6;
    px++;
    while (held >= 8 && outIdx < byteCount) {
      held -= 8;
      out[outIdx++] = (bits >> held) & 0xFF;
    }
  }
  return out;
}

// ── Encode / decode ──────────────────────────────────────────────────────────

function encodeInto(pngBuf, animJson) {
  const png     = PNG.sync.read(pngBuf);
  const jsonBuf = Buffer.from(animJson, 'utf8');
  const lenBuf  = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(jsonBuf.length, 0);
  const payload = Buffer.concat([MAGIC, lenBuf, jsonBuf]);
  const cap     = Math.floor(png.width * png.height * 6 / 8);
  if (payload.length > cap) {
    throw new Error(`anim.json too large (${payload.length} B) — PNG capacity is ${cap} B`);
  }
  lsbWrite(png.data, payload);
  return PNG.sync.write(png);
}

function decodeFrom(pngBuf) {
  const png    = PNG.sync.read(pngBuf);
  const header = lsbRead(png.data, 8);
  if (header.length < 8) return null;
  if (!header.slice(0, 4).equals(MAGIC)) return null;
  const len = header.readUInt32BE(4);
  if (len === 0 || len > 200_000) return null;
  const cap = Math.floor(png.width * png.height * 6 / 8);
  if (8 + len > cap) return null;
  const all = lsbRead(png.data, 8 + len);
  return all.slice(8).toString('utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const entries = fs.readdirSync(SKINS_DIR).filter(f => f.endsWith('.png'));
  let baked = 0, skipped = 0, failed = 0;

  for (const pngFile of entries) {
    const slug     = pngFile.replace(/\.png$/, '');
    const pngPath  = path.join(SKINS_DIR, pngFile);
    const animPath = path.join(SKINS_DIR, `${slug}.anim.json`);

    if (!fs.existsSync(animPath)) {
      console.log(`  skip    ${pngFile}  (no .anim.json)`);
      skipped++;
      continue;
    }

    try {
      const animJson = fs.readFileSync(animPath, 'utf8');
      const inBuf    = fs.readFileSync(pngPath);
      const outBuf   = encodeInto(inBuf, animJson);
      fs.writeFileSync(pngPath, outBuf);

      if (VERIFY) {
        const decoded = decodeFrom(outBuf);
        if (!decoded) throw new Error('round-trip decode returned null');
        // Compare normalised JSON to catch whitespace differences
        const orig = JSON.stringify(JSON.parse(animJson));
        const rt   = JSON.stringify(JSON.parse(decoded));
        if (orig !== rt) throw new Error('round-trip JSON mismatch');
        console.log(`  baked ✓ ${pngFile}  (${animJson.length} B JSON, ${inBuf.length} → ${outBuf.length} B PNG)`);
      } else {
        console.log(`  baked   ${pngFile}  (${animJson.length} B JSON baked into PNG)`);
      }
      baked++;
    } catch (err) {
      console.error(`  FAIL    ${pngFile}  ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone.  ${baked} baked,  ${skipped} skipped,  ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
