// Display names for skin slugs that have no `name` in their metadata.

// The 12 bundled Lab Originals, named exactly as the website and server
// name them (server `sprites::LAB_ORIGINALS`, `GET /lab-originals`).
export const LAB_ORIGINAL_NAMES = {
  default: 'Dr. Vibe',
  classic: 'Classic',
  tuxedo: 'Tuxedo',
  cyberpunk: 'Cyberpunk',
  alien: 'Alien',
  pirate: 'Pirate',
  firefighter: 'Firefighter',
  wizard: 'Wizard',
  arctic: 'Arctic',
  retro80s: "Retro '80s",
  bridgemind: 'BridgeMind',
  madscientist: 'Mad Scientist',
};

const titleCase = (s) => s.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** The bundled Lab Original's name for "dr-vibe-<id>", else null. */
function originalName(slug) {
  const m = /^dr-vibe-(.+)$/.exec(slug || '');
  return m && Object.hasOwn(LAB_ORIGINAL_NAMES, m[1]) ? LAB_ORIGINAL_NAMES[m[1]] : null;
}

/** Short label for a card: "dr-vibe-alien" → "Alien", "dr-vibe-neon" → "Neon"; other slugs → full name. */
export function skinVariantLabel(slug) {
  const name = originalName(slug);
  if (name) return name;
  const m = /^dr-vibe-(.+)$/.exec(slug || '');
  if (!m) return formatSkinName(slug);
  return titleCase(m[1]);
}

/** Full name: "dr-vibe-alien" → "Alien" (Lab Originals use their site name), "dr-vibe-neon" → "Dr. Vibe Neon", "my-cool-vibe" → "My Cool Vibe". */
export function formatSkinName(slug) {
  if (!slug) return '';
  const name = originalName(slug);
  if (name) return name;
  if (/^dr-vibe-.+$/.test(slug)) return `Dr. Vibe ${skinVariantLabel(slug)}`;
  return titleCase(slug);
}
