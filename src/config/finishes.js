// Dr. Vibe — finishes: names, labels and the season tint.
//
// A finish is drawn on top of one owned Dr. Vibe's own sprite sheet
// (protocol `Finish`: { tier, seasonNumber, serial }). The website keeps the
// same palette so a finish reads the same on drvibe.io and on the desktop;
// change both together.

export const FINISH_TIERS = Object.freeze(['shimmer', 'foil', 'prismatic', 'crowned']);

export const FINISH_LABELS = Object.freeze({
  shimmer: 'Shimmer',
  foil: 'Foil',
  prismatic: 'Prismatic',
  crowned: 'Crowned',
});

/** Launch (season 0) and Season 1: icy blue-cyan. */
export const ICY_ACCENT = '#7fe8ff';

/**
 * Season 2 onwards: SEASON_ACCENTS[(seasonNumber - 2) % length], so
 * Season 2 is amber, 3 violet, ... and Season 8 starts over at amber.
 */
export const SEASON_ACCENTS = Object.freeze([
  '#ffb547', // amber
  '#b88cff', // violet
  '#6ff0b4', // mint
  '#ff7eb9', // rose
  '#c9f55f', // lime
  '#ff8c66', // coral
]);

/** Accent for the foil band and the prismatic halo of a finish from `seasonNumber`. */
export function seasonAccent(seasonNumber) {
  const n = Math.floor(Number(seasonNumber));
  if (!Number.isFinite(n) || n <= 1) return ICY_ACCENT;
  return SEASON_ACCENTS[(n - 2) % SEASON_ACCENTS.length];
}

/** `Foil · #3`, or '' for no finish. */
export function finishLabel(finish) {
  const name = finish && FINISH_LABELS[finish.tier];
  if (!name) return '';
  return finish.serial > 0 ? `${name} · #${finish.serial}` : name;
}
