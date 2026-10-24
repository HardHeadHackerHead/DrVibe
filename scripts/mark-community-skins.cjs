/**
 * mark-community-skins.cjs
 *
 * Reads the embedded anim.json from each community (non-Dr. Vibe) skin PNG,
 * injects "source": "sprite_editor", then re-bakes it back into the same PNG.
 *
 * This makes the "Submit to Gallery" button appear for these skins in the app.
 *
 * Usage:  node scripts/mark-community-skins.cjs [--verify]
 */

'use strict';

const { PNG } = require('pngjs');
const fs      = require('fs');
const path    = require('path');

const MAGIC     = Buffer.from([0x44, 0x52, 0x56, 0x42]); // "DRVB"
const SKINS_DIR = path.join(__dirname, '..', 'src', 'assets', 'sprites', 'skins');
const VERIFY    = process.argv.includes('--verify');

// Skins that ship with the app as built-ins — skip these.
const BUILTIN_SKINS = new Set([
  'dr-vibe-default',
  'dr-vibe-classic',
  'dr-vibe-alien',
  'dr-vibe-arctic',
  'dr-vibe-bridgemind',
  'dr-vibe-cyberpunk',
  'dr-vibe-firefighter',
  'dr-vibe-madscientist',
  'dr-vibe-pirate',
  'dr-vibe-retro80s',
  'dr-vibe-tuxedo',
  'dr-vibe-wizard',
]);

// ── LSB helpers ─────────────────────────────────────────────────────────────

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

// ── Decode embedded anim.json from a baked PNG ──────────────────────────────

function decodeFrom(pngData) {
  const header = lsbRead(pngData, 8);
  if (header.length < 8) return null;
  if (!header.slice(0, 4).equals(MAGIC)) return null;
  const len = header.readUInt32BE(4);
  if (len === 0 || len > 200_000) return null;
  const cap = Math.floor((pngData.length / 4) * 6 / 8);
  if (8 + len > cap) return null;
  const all = lsbRead(pngData, 8 + len);
  return all.slice(8).toString('utf8');
}

// ── Encode anim.json into a PNG's LSBs ──────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const entries = fs.readdirSync(SKINS_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => f.replace(/\.png$/, ''))
    .filter(slug => !BUILTIN_SKINS.has(slug));

  console.log(`Marking ${entries.length} community skins as "sprite_editor" source...\n`);

  let updated = 0, skipped = 0, failed = 0;

  for (const slug of entries) {
    const pngPath = path.join(SKINS_DIR, `${slug}.png`);

    try {
      const pngBuf  = fs.readFileSync(pngPath);
      const png     = PNG.sync.read(pngBuf);
      const animRaw = decodeFrom(png.data);

      if (!animRaw) {
        console.log(`  skip    ${slug}.png  (no embedded anim.json — run bake-skins.cjs first)`);
        skipped++;
        continue;
      }

      const anim = JSON.parse(animRaw);

      if (anim.source === 'sprite_editor' || anim.source === 'ai_generated') {
        console.log(`  skip    ${slug}.png  (already marked as "${anim.source}")`);
        skipped++;
        continue;
      }

      // Inject source tag
      anim.source = 'sprite_editor';
      const updatedJson = JSON.stringify(anim);

      const outBuf = encodeInto(pngBuf, updatedJson);
      fs.writeFileSync(pngPath, outBuf);

      if (VERIFY) {
        const check = PNG.sync.read(outBuf);
        const decoded = decodeFrom(check.data);
        if (!decoded) throw new Error('round-trip decode returned null');
        const rt = JSON.parse(decoded);
        if (rt.source !== 'sprite_editor') throw new Error('source field not found after re-bake');
        console.log(`  marked ✓ ${slug}.png`);
      } else {
        console.log(`  marked   ${slug}.png`);
      }

      updated++;
    } catch (err) {
      console.error(`  FAIL     ${slug}.png  ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone.  ${updated} marked,  ${skipped} skipped,  ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
