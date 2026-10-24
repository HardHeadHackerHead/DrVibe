// Dr. Vibe — the parts of tools/generate-character.md (the prompt the
// "Make your own Dr. Vibe" generator hands to the player's claude / codex
// CLI) that come from the sprite format. They are written between marker
// comments and regenerated from src/config/animations.js by
// `npm run sync:generator-prompt`; tests/unit/generatorPrompt.test.js fails
// when the prompt and the row map drift apart.

import { ROW_SPEC, FRAME, STANDARD_ROWS } from './spriteSpec.js';

/** What each row should show. Keyed by spriteSpec row name. */
export const ROW_POSES = {
  idle: 'Standing front-facing, relaxed. Small breathing bob or a blink between frames.',
  coding: 'Typing: arms forward and down, hands alternating up/down, eyes on the keys.',
  thinking: 'One hand at the chin, eyes looking up; a small head tilt between frames.',
  tired: 'Slumped shoulders, half-closed eyes, maybe a yawn; slow and heavy.',
  excited: 'Arms up and out, big open smile, a 1–2 px hop.',
  alert: 'Wide eyes, open mouth, arms tense at the sides; a startled jolt.',
  walk: 'Walk cycle facing RIGHT: legs alternate (contact, pass, contact, pass), arms swing opposite. Mirrored at runtime for walking left.',
  stretching: 'Arms rise from the sides to straight overhead, body lengthens.',
  beaker: 'Holds up a small glowing beaker or flask in one hand; it rises and glows.',
  libraryCard: 'Holds up a small yellow card next to the face, showing it off.',
  thumbsUp: 'One arm comes up into a clear thumbs-up, confident smile.',
  coverEyes: 'Hands come up over the eyes; peeks through the fingers.',
  celebrating: 'Both arms straight up, jumping, open-mouth cheer.',
  focused: 'Goggles or visor down, steady and calm; barely moves.',
  concerned: 'Worried brows, small frown, hands together or a sweat drop.',
  presenting: 'Turns slightly and points one arm out to the side, as if presenting a slide.',
  levitating: 'Floats 2–3 px off the ground with feet dangling and a few sparkles around; gentle bob.',
};

export const ROW_TABLE_BEGIN = '<!-- row-table:begin — generated from src/config/animations.js; run `npm run sync:generator-prompt` -->';
export const ROW_TABLE_END = '<!-- row-table:end -->';
export const ROWS_CONST_BEGIN = '// rows:begin — generated from src/config/animations.js; do not edit';
export const ROWS_CONST_END = '// rows:end';

/** The markdown row table: index, y offset, state, frames, pose. */
export function rowTableMarkdown() {
  const lines = [
    '| Row | y | State | Frames | What it shows |',
    '|-----|---|-------|--------|---------------|',
  ];
  for (const { row, name, frames } of ROW_SPEC) {
    const optional = row >= STANDARD_ROWS ? ' (optional)' : '';
    lines.push(`| ${row} | ${row * FRAME} | \`${name}\`${optional} | ${frames} | ${ROW_POSES[name] ?? ''} |`);
  }
  return lines.join('\n');
}

/** The `ROWS` constant the script template draws from: [name, frames] per row. */
export function rowsConstSource() {
  const items = ROW_SPEC.map(({ name, frames }) => `  ['${name}', ${frames}],`);
  return ['const ROWS = [', ...items, '];'].join('\n');
}

function replaceBetween(text, begin, end, body) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end, start + begin.length);
  if (start < 0 || stop < 0) throw new Error(`Markers not found: ${begin} … ${end}`);
  return `${text.slice(0, start + begin.length)}\n${body}\n${text.slice(stop)}`;
}

/** Rewrite both generated blocks of the prompt text. */
export function syncPromptText(text) {
  const withTable = replaceBetween(text, ROW_TABLE_BEGIN, ROW_TABLE_END, rowTableMarkdown());
  return replaceBetween(withTable, ROWS_CONST_BEGIN, ROWS_CONST_END, rowsConstSource());
}
