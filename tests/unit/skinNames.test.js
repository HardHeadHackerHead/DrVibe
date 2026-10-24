import { describe, it, expect } from 'vitest';
import { LAB_ORIGINAL_NAMES, formatSkinName, skinVariantLabel } from '../../src/config/skinNames.js';

describe('skin display names', () => {
  it('names the bundled Lab Originals as the website does', () => {
    expect(formatSkinName('dr-vibe-alien')).toBe('Alien');
    expect(formatSkinName('dr-vibe-default')).toBe('Dr. Vibe');
    expect(formatSkinName('dr-vibe-madscientist')).toBe('Mad Scientist');
    expect(skinVariantLabel('dr-vibe-retro80s')).toBe("Retro '80s");
    expect(skinVariantLabel('dr-vibe-bridgemind')).toBe('BridgeMind');
    expect(Object.values(LAB_ORIGINAL_NAMES)).toEqual([
      'Dr. Vibe', 'Classic', 'Tuxedo', 'Cyberpunk', 'Alien', 'Pirate', 'Firefighter', 'Wizard', 'Arctic', "Retro '80s", 'BridgeMind', 'Mad Scientist',
    ]);
  });

  it('keeps other dr-vibe-* slugs as "Dr. Vibe <variant>"', () => {
    expect(formatSkinName('dr-vibe-neon-ghost')).toBe('Dr. Vibe Neon Ghost');
    expect(skinVariantLabel('dr-vibe-neon-ghost')).toBe('Neon Ghost');
  });

  it('title-cases other slugs', () => {
    expect(formatSkinName('my-cool-vibe')).toBe('My Cool Vibe');
    expect(skinVariantLabel('companion-neon')).toBe('Companion Neon');
    expect(formatSkinName('')).toBe('');
  });
});
