// Dr. Vibe — the sprite format, one spec for both apps (API.md §13,
// drvibe-protocol `EquippedDrVibe`), and the local checks a design must pass
// before it can be submitted.
//
//   Frame 32 × 32, 4 columns. 128 × 512 (16 rows) or 128 × 544 with the
//   optional 17th levitating row. PNG ≤ 2 MB. The first two frames of each
//   of the 16 standard rows must be at least 5% drawn (the server's rule).
//   When row 16 is missing, players fall back to idle.

import { ANIMATIONS } from '../../config/animations.js';

export const FRAME = 32;
export const COLUMNS = 4;
export const ROWS = 17;
export const SHEET_WIDTH = FRAME * COLUMNS;   // 128
export const SHEET_HEIGHT = FRAME * ROWS;     // 544
export const STANDARD_ROWS = 16;
export const LEGACY_HEIGHT = FRAME * STANDARD_ROWS; // 512
/** Frames per row the server checks (the first two). */
const CHECKED_FRAMES = 2;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MIN_OPAQUE_FRACTION = 0.05;

const ROW_NAMES = [
  'idle', 'coding', 'thinking', 'tired', 'excited', 'alert', 'walk', 'stretching', 'beaker',
  'libraryCard', 'thumbsUp', 'coverEyes', 'celebrating', 'focused', 'concerned', 'presenting', 'levitating',
];

/** [{ row, name, frames }] — frames = how many columns the animation uses. */
export const ROW_SPEC = ROW_NAMES.map((name, row) => {
  const anim = Object.values(ANIMATIONS).find((a) => a.row === row);
  return { row, name, frames: anim?.frameCount ?? COLUMNS };
});

/** Fraction of pixels with alpha > 0 in one frame of an RGBA buffer. */
export function opaqueFraction(data, sheetWidth, col, row) {
  let opaque = 0;
  for (let y = 0; y < FRAME; y++) {
    const base = ((row * FRAME + y) * sheetWidth + col * FRAME) * 4;
    for (let x = 0; x < FRAME; x++) {
      if (data[base + x * 4 + 3] > 0) opaque++;
    }
  }
  return opaque / (FRAME * FRAME);
}

/**
 * Check a decoded sheet.
 * @param {{ width: number, height: number, data: Uint8ClampedArray|number[] }} image
 * @param {number} [byteLength]  size of the PNG file, if known
 * @returns {{ ok: boolean, wearable: boolean, errors: string[], warnings: string[],
 *            rows: Array<{ row: number, name: string, ok: boolean, emptyFrames: number[], optional: boolean }> }}
 *   ok:       passes the server's checks (can be submitted to the Incubator)
 *   wearable: good enough to wear locally (idle and walk rows drawn)
 */
export function validateSheet(image, byteLength = null) {
  const errors = [];
  const warnings = [];
  if (byteLength !== null && byteLength > MAX_BYTES) {
    errors.push(`The PNG is ${(byteLength / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB.`);
  }
  if (image.width !== SHEET_WIDTH || (image.height !== SHEET_HEIGHT && image.height !== LEGACY_HEIGHT)) {
    errors.push(`The sheet must be ${SHEET_WIDTH} × ${LEGACY_HEIGHT} px (16 rows) or ${SHEET_WIDTH} × ${SHEET_HEIGHT} px (with the levitating row); this one is ${image.width} × ${image.height}.`);
    return { ok: false, wearable: false, errors, warnings, rows: [] };
  }
  const presentRows = Math.floor(image.height / FRAME);
  const rows = ROW_SPEC.map(({ row, name, frames }) => {
    const optional = row >= STANDARD_ROWS;
    if (row >= presentRows) return { row, name, ok: optional, emptyFrames: [], optional, missing: true };
    const emptyFrames = [];
    for (let col = 0; col < Math.min(frames, CHECKED_FRAMES); col++) {
      if (opaqueFraction(image.data, image.width, col, row) < MIN_OPAQUE_FRACTION) emptyFrames.push(col);
    }
    return { row, name, ok: emptyFrames.length === 0, emptyFrames, optional };
  });
  for (const r of rows) {
    if (r.ok) continue;
    const line = `Row ${r.row} (${r.name}): frame${r.emptyFrames.length > 1 ? 's' : ''} ${r.emptyFrames.map((c) => c + 1).join(', ')} ${r.emptyFrames.length > 1 ? 'are' : 'is'} almost empty.`;
    (r.optional ? warnings : errors).push(r.optional ? `${line} Players will see idle instead.` : line);
  }
  if (presentRows < ROWS) warnings.push('No levitating row (17th); players will see idle when Dr. Vibe levitates.');
  const wearable = rows[0].ok && rows[6].ok; // idle and walk at minimum
  return { ok: errors.length === 0, wearable, errors, warnings, rows };
}

/** One line for the player saying why a sheet can't be worn or submitted yet. */
export function problemSummary(validation, max = 4) {
  if (validation.ok) return '';
  const shown = validation.errors.slice(0, max);
  const more = validation.errors.length - shown.length;
  const lead = validation.wearable
    ? 'It can be worn, but it cannot be submitted to the Incubator until this is fixed:'
    : 'This sheet does not match the Dr. Vibe sprite format yet, so it cannot be worn or submitted:';
  return [lead, ...shown, ...(more > 0 ? [`(and ${more} more)`] : [])].join(' ');
}

/** Plain-text guide that ships next to the template PNG. */
export function templateGuide() {
  const lines = ROW_SPEC.map(({ row, name, frames }) =>
    `Row ${String(row).padStart(2)}  y=${String(row * FRAME).padStart(3)}  ${name.padEnd(12)} ${frames} frame${frames > 1 ? 's' : ''}`);
  return [
    'Make your own Dr. Vibe — sprite template',
    '',
    `Sheet: ${SHEET_WIDTH} x ${SHEET_HEIGHT} px PNG, 4 columns x 17 rows of 32 x 32 frames, at most 2 MB.`,
    `The 17th row (levitating) is optional: a ${SHEET_WIDTH} x ${LEGACY_HEIGHT} sheet with 16 rows is fine too.`,
    'Draw each row left to right; leave unused columns transparent.',
    'The first two frames of each of the 16 standard rows need at least 5% non-transparent pixels.',
    'The walk row faces right (it is mirrored for walking left).',
    '',
    ...lines,
    '',
    'When it is ready: Make your own Dr. Vibe > Import a PNG. Wear it straight away;',
    'submit it to the Incubator if you want other players to vote on it.',
    'Only submit art you made or have the rights to share.',
    '',
  ].join('\n');
}
