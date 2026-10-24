// Day keys (YYYY-MM-DD) follow the player's own midnight, not UTC: with
// toISOString() a US evening already counts as tomorrow.

/** Local calendar day of `d`, YYYY-MM-DD. */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
