// Dr. Vibe - Skin Tone Configuration
// Defines palette presets for runtime skin color swapping.

// The universal base skin palette present in all standardized sprite sheets.
// Every skin PNG uses these exact RGB values for skin-colored pixels.
export const BASE_SKIN_PALETTE = {
  skin:      [253, 216, 176],
  skinShade: [232, 184, 136],
  skinDark:  [212, 168, 120],
};

// Which tone category each skin uses
export const SKIN_TONE_CATEGORIES = {
  'dr-vibe-default':      'human',
  'dr-vibe-default2':     'human',
  'dr-vibe-tuxedo':       'human',
  'dr-vibe-cyberpunk':    'human',
  'dr-vibe-pirate':       'human',
  'dr-vibe-firefighter':  'human',
  'dr-vibe-wizard':       'human',
  'dr-vibe-arctic':       'human',
  'dr-vibe-retro80s':     'human',
  'dr-vibe-bridgemind':   'human',
  'dr-vibe-madscientist': 'human',
  'dr-vibe-alien':        'fantasy',
  'dr-vibe-classic':      'none',
};

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
};

// Get available presets for a skin name
export function getPresetsForSkin(skinName) {
  const category = SKIN_TONE_CATEGORIES[skinName] || 'none';
  return SKIN_TONE_PRESETS[category] || null;
}

// Get the default tone key for a skin
export function getDefaultTone(skinName) {
  const category = SKIN_TONE_CATEGORIES[skinName] || 'none';
  if (category === 'human') return 'medium-light';
  if (category === 'fantasy') return 'green';
  return null;
}

// Get the category for a skin
export function getToneCategory(skinName) {
  return SKIN_TONE_CATEGORIES[skinName] || 'none';
}
