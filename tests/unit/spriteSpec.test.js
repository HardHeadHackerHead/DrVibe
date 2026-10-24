// Sprite format checks for "Make your own Dr. Vibe" (API.md §13).

import { describe, it, expect } from 'vitest';
import { validateSheet, ROW_SPEC, SHEET_WIDTH, SHEET_HEIGHT, LEGACY_HEIGHT, FRAME, templateGuide, problemSummary } from '../../src/features/make/spriteSpec.js';

/** RGBA sheet where the first two frames of every row are drawn (minus `holes`). */
function sheet(height = SHEET_HEIGHT, holes = []) {
  const data = new Uint8ClampedArray(SHEET_WIDTH * height * 4);
  for (const { row, frames } of ROW_SPEC) {
    if ((row + 1) * FRAME > height) continue;
    for (let col = 0; col < frames; col++) {
      if (holes.some(h => h.row === row && h.col === col)) continue;
      for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) {
        data[((row * FRAME + y) * SHEET_WIDTH + col * FRAME + x) * 4 + 3] = 255;
      }
    }
  }
  return { width: SHEET_WIDTH, height, data };
}

describe('validateSheet', () => {
  it('has 17 rows ending with levitating', () => {
    expect(ROW_SPEC).toHaveLength(17);
    expect(ROW_SPEC[16].name).toBe('levitating');
  });

  it('accepts a full 128 × 544 sheet', () => {
    const v = validateSheet(sheet(), 50_000);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('accepts a 128 × 512 sheet: the levitating row is optional', () => {
    const v = validateSheet(sheet(LEGACY_HEIGHT));
    expect(v.ok).toBe(true);
    expect(v.wearable).toBe(true);
    expect(v.warnings[0]).toMatch(/levitating/);
  });

  it('only checks the first two frames of a row, like the server', () => {
    expect(validateSheet(sheet(SHEET_HEIGHT, [{ row: 1, col: 3 }])).ok).toBe(true);
    const v = validateSheet(sheet(SHEET_HEIGHT, [{ row: 2, col: 1 }]));
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/Row 2 \(thinking\): frame 2 is almost empty/);
  });

  it('an empty levitating row is a warning, not an error', () => {
    const v = validateSheet(sheet(SHEET_HEIGHT, [{ row: 16, col: 0 }]));
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/Row 16/);
  });

  it('rejects wrong sizes and files over 2 MB', () => {
    expect(validateSheet({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }).wearable).toBe(false);
    const big = validateSheet(sheet(), 3 * 1024 * 1024);
    expect(big.ok).toBe(false);
    expect(big.errors[0]).toMatch(/2 MB/);
  });

  it('ships a guide listing every row', () => {
    const guide = templateGuide();
    for (const { name } of ROW_SPEC) expect(guide).toContain(name);
  });

  it('sums up why a sheet cannot be worn or submitted', () => {
    expect(problemSummary(validateSheet(sheet()))).toBe('');
    const holes = validateSheet(sheet(SHEET_HEIGHT, [1, 2, 3, 4, 5, 7].map((row) => ({ row, col: 0 }))));
    const text = problemSummary(holes);
    expect(text).toMatch(/^It can be worn, but it cannot be submitted/);
    expect(text).toContain('Row 1 (coding)');
    expect(text).toContain('(and 2 more)');
    const old = problemSummary(validateSheet({ width: 192, height: 672, data: new Uint8ClampedArray(192 * 672 * 4) }));
    expect(old).toMatch(/cannot be worn or submitted: The sheet must be 128 × 512/);
  });
});
