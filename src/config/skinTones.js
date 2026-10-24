// Dr. Vibe - Skin Tone Configuration
// Defines palette presets for runtime skin color swapping.

// The universal base skin palette present in all standardized sprite sheets.
// Every skin PNG uses these exact RGB values for skin-colored pixels.
export const BASE_SKIN_PALETTE = {
  skin:      [253, 216, 176],
  skinShade: [232, 184, 136],
  skinDark:  [212, 168, 120],
};

// Which display/tone category each skin belongs to.
// Display categories control grouping in the skin picker.
// Tone presets are resolved via CATEGORY_TONE_MAP below.
export const SKIN_TONE_CATEGORIES = {
  // Dr. Vibe collection
  'dr-vibe-default':      'dr-vibe',
  'dr-vibe-tuxedo':       'dr-vibe',
  'dr-vibe-cyberpunk':    'dr-vibe',
  'dr-vibe-pirate':       'dr-vibe',
  'dr-vibe-firefighter':  'dr-vibe',
  'dr-vibe-wizard':       'dr-vibe',
  'dr-vibe-arctic':       'dr-vibe',
  'dr-vibe-retro80s':     'dr-vibe',
  'dr-vibe-bridgemind':   'dr-vibe',
  'dr-vibe-madscientist': 'dr-vibe',
  'dr-vibe-alien':        'fantasy',
  'dr-vibe-classic':      'none',
  // Animals
  'lion':                 'animal',
  'dog':                  'animal',
  // Military / occupations
  'drill-sergeant':       'human',
};

// Maps display categories → which tone preset set to use.
// Categories not listed here use their own name as the preset key.
const CATEGORY_TONE_MAP = {
  'dr-vibe': 'human',
  'human':   'human',
};

// Resolve a display category to its tone preset key
export function tonePresetKey(category) {
  return CATEGORY_TONE_MAP[category] || category;
}

// Tone presets: each has skin (base), skinShade (shadow), skinDark (deep shadow)
export const SKIN_TONE_PRESETS = {
  human: {
    'light':        { label: 'Light',        skin: [255, 235, 220], skinShade: [240, 210, 190], skinDark: [220, 190, 168] },
    'medium-light': { label: 'Medium Light', skin: [253, 216, 176], skinShade: [232, 184, 136], skinDark: [212, 168, 120] },
    'medium':       { label: 'Medium',       skin: [225, 185, 145], skinShade: [200, 158, 118], skinDark: [178, 136, 98] },
    'medium-dark':  { label: 'Medium Dark',  skin: [180, 130, 90],  skinShade: [155, 108, 72],  skinDark: [130, 90, 58] },
    'dark':         { label: 'Dark',         skin: [140, 95, 60],   skinShade: [118, 78, 48],   skinDark: [95, 62, 38] },
  },
  fantasy: {
    'green':  { label: 'Green',  skin: [110, 210, 90],  skinShade: [85, 175, 65],  skinDark: [60, 140, 45] },
    'purple': { label: 'Purple', skin: [180, 120, 210], skinShade: [150, 95, 180], skinDark: [120, 72, 150] },
    'blue':   { label: 'Blue',   skin: [100, 170, 220], skinShade: [75, 140, 190], skinDark: [55, 112, 160] },
    'pink':   { label: 'Pink',   skin: [240, 150, 180], skinShade: [210, 120, 152], skinDark: [180, 95, 125] },
    'orange': { label: 'Orange', skin: [240, 170, 80],  skinShade: [210, 140, 55],  skinDark: [180, 115, 35] },
    'red':    { label: 'Red',    skin: [210, 80, 70],   skinShade: [180, 60, 52],   skinDark: [150, 42, 38] },
  },
  animal: {
    'golden':  { label: 'Golden',  skin: [253, 216, 176], skinShade: [232, 184, 136], skinDark: [212, 168, 120] },
    'white':   { label: 'White',   skin: [245, 240, 235], skinShade: [220, 210, 200], skinDark: [195, 185, 175] },
    'dark':    { label: 'Dark',    skin: [160, 120, 70],  skinShade: [130, 95, 55],   skinDark: [105, 75, 42] },
    'red':     { label: 'Red',     skin: [210, 150, 90],  skinShade: [185, 125, 70],  skinDark: [160, 105, 55] },
    'silver':  { label: 'Silver',  skin: [200, 200, 210], skinShade: [170, 170, 185], skinDark: [140, 140, 158] },
  },
};

// Get available presets for a skin name
export function getPresetsForSkin(skinName) {
  const category = SKIN_TONE_CATEGORIES[skinName] || 'none';
  return SKIN_TONE_PRESETS[tonePresetKey(category)] || null;
}

// Get the default tone key for a skin
export function getDefaultTone(skinName) {
  const category = SKIN_TONE_CATEGORIES[skinName] || 'none';
  const preset = tonePresetKey(category);
  if (preset === 'human') return 'medium-light';
  if (preset === 'fantasy') return 'green';
  if (preset === 'animal') return 'golden';
  return null;
}

// Get the category for a skin
export function getToneCategory(skinName) {
  return SKIN_TONE_CATEGORIES[skinName] || 'none';
}
