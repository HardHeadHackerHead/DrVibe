import { describe, it, expect } from 'vitest';
import {
  parseMakeRoute, makeUrl, pickAgent, isOwnDesign, sourceLabel, slugify, nameFromFile,
  designActions, progressStep, generationErrorMessage, GENERATION_STEPS,
} from '../../src/features/make/makeHub.js';

describe('Make your own Dr. Vibe routes', () => {
  it('opens on a fresh Generate prompt by default', () => {
    expect(parseMakeRoute('')).toEqual({ tab: 'generate', edit: null });
    // The worn skin is never passed in any more; old ?slug= links are ignored
    expect(parseMakeRoute('?slug=dr-vibe-default')).toEqual({ tab: 'generate', edit: null });
  });

  it('opens a tab or an existing Dr. Vibe on request', () => {
    expect(parseMakeRoute('?tab=draw')).toEqual({ tab: 'draw', edit: null });
    expect(parseMakeRoute('?tab=import')).toEqual({ tab: 'import', edit: null });
    expect(parseMakeRoute('?edit=neon-ghost')).toEqual({ tab: 'generate', edit: 'neon-ghost' });
    expect(parseMakeRoute('edit=neon-ghost')).toEqual({ tab: 'generate', edit: 'neon-ghost' });
  });

  it('refuses unknown tabs and unsafe slugs', () => {
    expect(parseMakeRoute('?tab=animations').tab).toBe('generate');
    expect(parseMakeRoute("?edit=x');alert(1)//").edit).toBeNull();
    expect(parseMakeRoute('?edit=../secret').edit).toBeNull();
  });

  it('builds the URLs Settings opens', () => {
    expect(makeUrl()).toBe('make.html');
    expect(makeUrl({ tab: 'generate' })).toBe('make.html');
    expect(makeUrl({ edit: 'neon-ghost' })).toBe('make.html?edit=neon-ghost');
    expect(makeUrl({ tab: 'draw' })).toBe('make.html?tab=draw');
    expect(makeUrl({ edit: 'a b' })).toBe('make.html');
    expect(parseMakeRoute(makeUrl({ tab: 'import', edit: 'x' }).split('?')[1])).toEqual({ tab: 'import', edit: 'x' });
  });
});

describe('picking the AI', () => {
  it('uses the preference when it is installed, else whichever is', () => {
    expect(pickAgent({ claude: true, codex: true }, 'codex')).toBe('codex');
    expect(pickAgent({ claude: true, codex: false }, 'codex')).toBe('claude');
    expect(pickAgent({ claude: false, codex: true }, null)).toBe('codex');
    expect(pickAgent({ claude: false, codex: false }, 'claude')).toBeNull();
  });
});

describe('Your Dr. Vibes', () => {
  it('lists only designs the player made or imported', () => {
    expect(isOwnDesign({ slug: 'neon-ghost', isDefault: false })).toBe(true);
    expect(isOwnDesign({ slug: 'dr-vibe-pirate', isDefault: true })).toBe(false);
    expect(isOwnDesign({ slug: 'companion-abc', isDefault: false })).toBe(false);
    expect(isOwnDesign({ slug: 'neon-ghost--draft', isDefault: false })).toBe(false);
    expect(isOwnDesign({ slug: 'g-123', isDefault: false, galleryId: 'g-123' })).toBe(false);
    expect(isOwnDesign(null)).toBe(false);
  });

  it('labels where a design came from', () => {
    expect(sourceLabel('ai_generated')).toBe('Made with AI');
    expect(sourceLabel('sprite_editor')).toBe('Drawn');
    expect(sourceLabel('player_made')).toBe('Imported');
    expect(sourceLabel(undefined)).toBe('Custom');
  });

  it('names imports and slugs', () => {
    expect(nameFromFile('space_captain-v2.png')).toBe('Space Captain V2');
    expect(nameFromFile('.png')).toBe('My Dr. Vibe');
    expect(slugify('Captain Nova!')).toBe('captain-nova');
    expect(slugify('***')).toBe('my-dr-vibe');
  });
});

describe('bench actions', () => {
  const ok = { ok: true, wearable: true };
  const wearableOnly = { ok: false, wearable: true };
  const broken = { ok: false, wearable: false };

  it('an own design can be worn, changed, exported, deleted and submitted', () => {
    const a = designActions({ kind: 'own', validation: ok, linked: true, licenseOk: true, agent: 'claude' });
    for (const k of ['wear', 'editAi', 'editPixels', 'exportPng', 'remove', 'submit']) {
      expect(a[k]).toMatchObject({ show: true, enabled: true });
    }
    expect(a.save.show).toBe(false);
    expect(a.remix.show).toBe(false);
  });

  it('explains why Submit is off', () => {
    expect(designActions({ kind: 'own', validation: ok, linked: false }).submit.hint).toMatch(/Sign in/);
    expect(designActions({ kind: 'own', validation: wearableOnly, linked: true }).submit.hint).toMatch(/rows/);
    expect(designActions({ kind: 'own', validation: ok, linked: true }).submit.hint).toMatch(/Tick/);
  });

  it('a Lab Original is remixed, never edited or deleted', () => {
    const a = designActions({ kind: 'original', validation: ok, agent: 'claude' });
    expect(a.remix).toMatchObject({ show: true, enabled: true });
    expect(a.editAi.show).toBe(false);
    expect(a.editPixels.show).toBe(false);
    expect(a.remove.show).toBe(false);
    expect(a.submit.show).toBe(false);
    expect(a.exportPng.show).toBe(true);
  });

  it('an import must be saved, and a broken sheet cannot be worn', () => {
    const a = designActions({ kind: 'unsaved', validation: broken });
    expect(a.save).toMatchObject({ show: true, enabled: false });
    expect(a.wear.enabled).toBe(false);
    expect(a.remove.show).toBe(false);
  });

  it('AI changes need a CLI; nothing runs while generating', () => {
    expect(designActions({ kind: 'own', validation: ok, agent: null }).editAi).toMatchObject({ show: true, enabled: false });
    const busy = designActions({ kind: 'own', validation: ok, agent: 'claude', busy: true });
    expect(busy.wear.enabled).toBe(false);
    expect(busy.remove.enabled).toBe(false);
    expect(busy.wear.hint).toMatch(/Wait/);
  });

  it('the worn design says so', () => {
    expect(designActions({ kind: 'own', validation: ok, wearing: true }).wear).toMatchObject({ enabled: false, hint: 'Dr. Vibe is wearing this one' });
  });
});

describe('generator progress', () => {
  it('maps CLI lines to steps', () => {
    expect(progressStep('Claude Code started')).toBe(0);
    expect(progressStep('Codex started')).toBe(0);
    expect(progressStep('→ Reading dr-vibe-char-prompt.txt')).toBe(1);
    expect(progressStep("Analyzing reference character 'dr-vibe-pirate'...")).toBe(1);
    expect(progressStep('→ Writing generate-space-captain.cjs')).toBe(2);
    expect(progressStep('→ Running: node "C:/tmp/generate-space-captain.cjs"')).toBe(3);
    expect(progressStep('[stderr] Sheet check failed:')).toBe(3);
    expect(progressStep('Saved C:/x/space-captain.png (128 × 544)')).toBe(4);
    expect(progressStep('  GENERATED_SKIN: space-captain')).toBe(4);
    expect(progressStep('  Let me think about the palette')).toBe(-1);
    expect(GENERATION_STEPS).toHaveLength(5);
  });

  it('explains failures', () => {
    expect(generationErrorMessage('Claude exited with status exit code: 1.', { cancelled: true })).toMatch(/Cancelled/);
    expect(generationErrorMessage('Claude exited with status exit code: 1.', { agentLabel: 'Claude Code' })).toMatch(/Claude Code stopped/);
    expect(generationErrorMessage('No new skin file was created.')).toMatch(/without drawing/);
    expect(generationErrorMessage('A Dr. Vibe is already being generated. Wait for it to finish or cancel it first.')).toMatch(/already/);
    expect(generationErrorMessage(new Error('boom'))).toBe('boom');
  });
});
