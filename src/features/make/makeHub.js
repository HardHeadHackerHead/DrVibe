// Dr. Vibe — the logic behind "Make your own Dr. Vibe" (make.html), kept
// free of the DOM and Tauri so it can be unit tested.
//
// The window opens on a fresh "Generate with AI" prompt. The other two ways
// in are "Draw in the editor" and "Import a sheet"; `?tab=` picks one and
// `?edit=<slug>` opens an existing Dr. Vibe on the bench instead.

export const TABS = ['generate', 'draw', 'import'];

/** The CLIs the generator can drive, with where to get them. */
export const AGENTS = {
  claude: {
    label: 'Claude Code',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
  },
  codex: {
    label: 'Codex',
    installUrl: 'https://github.com/openai/codex',
    installCmd: 'npm install -g @openai/codex',
  },
};

/** Slugs are file names: letters, digits, `-` and `_` (matches Rust `is_safe_slug`). */
export function isSafeSlug(slug) {
  return typeof slug === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(slug);
}

/** `?tab=generate|draw|import&edit=<slug>` → { tab, edit }. */
export function parseMakeRoute(search) {
  const p = new URLSearchParams(search || '');
  const tab = TABS.includes(p.get('tab')) ? p.get('tab') : 'generate';
  const edit = isSafeSlug(p.get('edit')) ? p.get('edit') : null;
  return { tab, edit };
}

/** The page to open the window on; the inverse of parseMakeRoute. */
export function makeUrl({ tab = null, edit = null } = {}) {
  const p = new URLSearchParams();
  if (tab && TABS.includes(tab) && tab !== 'generate') p.set('tab', tab);
  if (edit && isSafeSlug(edit)) p.set('edit', edit);
  const q = p.toString();
  return q ? `make.html?${q}` : 'make.html';
}

/**
 * Which CLI to run: the player's preference when it is installed, else
 * whichever one is. null when neither is installed.
 * @param {{ claude: boolean, codex: boolean }} installed
 * @param {string|null} preferred
 */
export function pickAgent(installed, preferred = null) {
  if (preferred && installed?.[preferred]) return preferred;
  if (installed?.claude) return 'claude';
  if (installed?.codex) return 'codex';
  return null;
}

/**
 * A Dr. Vibe the player made (or imported) themselves — as opposed to a Lab
 * Original, a companion's cached sheet, a community skin installed from the
 * site, or a workshop draft.
 * @param {{ slug: string, isDefault?: boolean, galleryId?: string|null }} skin
 */
export function isOwnDesign(skin) {
  if (!skin || !skin.slug || skin.isDefault) return false;
  if (skin.slug.startsWith('companion-') || skin.slug.endsWith('--draft')) return false;
  return !skin.galleryId;
}

export function sourceLabel(source) {
  switch (source) {
    case 'ai_generated': return 'Made with AI';
    case 'sprite_editor': return 'Drawn';
    case 'player_made':
    case 'imported': return 'Imported';
    default: return 'Custom';
  }
}

/** File-name slug for a display name. */
export function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-dr-vibe';
}

/** Display name from an imported file's name. */
export function nameFromFile(fileName) {
  const base = String(fileName || '').replace(/\.png$/i, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : 'My Dr. Vibe';
}

/**
 * What can be done with the design on the bench.
 * @param {object} s
 * @param {'own'|'original'|'unsaved'|null} s.kind  own = saved in the player's
 *   skins folder; original = a Lab Original (read-only); unsaved = imported, not saved yet
 * @param {{ ok: boolean, wearable: boolean }|null} s.validation
 * @param {boolean} s.linked     signed in to drvibe.io
 * @param {boolean} s.licenseOk  upload-rights box ticked
 * @param {string|null} s.agent  CLI available for AI changes
 * @param {boolean} s.wearing    Dr. Vibe has it on right now
 * @param {boolean} s.busy       a generation is running
 * @returns {Record<string, { show: boolean, enabled: boolean, hint: string }>}
 */
export function designActions({ kind, validation, linked = false, licenseOk = false, agent = null, wearing = false, busy = false }) {
  const a = (show, enabled, hint = '') => ({ show, enabled: show && enabled && !busy, hint: busy && show ? 'Wait for the generator to finish' : hint });
  const wearable = !!validation?.wearable;
  const own = kind === 'own';
  return {
    wear: a(!!kind, wearable && !wearing, wearing ? 'Dr. Vibe is wearing this one' : wearable ? '' : 'The idle and walk rows need drawing first'),
    save: a(kind === 'unsaved', wearable, wearable ? '' : 'Fix the sheet first: the idle and walk rows need drawing'),
    remix: a(kind === 'original', true),
    editAi: a(own, !!agent, agent ? '' : 'Needs Claude Code or Codex'),
    editPixels: a(own, true),
    exportPng: a(own || kind === 'original', true),
    remove: a(own, true),
    submit: a(own, linked && !!validation?.ok && licenseOk,
      !linked ? 'Sign in first: Settings → Account and community'
        : !validation?.ok ? 'All 16 standard rows must pass first'
          : !licenseOk ? 'Tick the upload rights box' : ''),
  };
}

/** The generator's steps, in order, for the progress bar. */
export const GENERATION_STEPS = [
  'Starting',
  'Reading the Dr. Vibe recipe',
  'Writing the drawing script',
  'Painting the sprite sheet',
  'Checking every row',
];

/**
 * Map one line of CLI progress (Rust `claude-progress`) to a step index, or
 * -1 when the line doesn't move things on.
 */
export function progressStep(line) {
  const t = String(line || '');
  if (/GENERATED_SKIN|Saved .*\.png/i.test(t)) return 4;
  if (/Running: .*node|Sheet check failed/i.test(t)) return 3;
  if (/(Writing|Editing) (generate|patch)-/i.test(t)) return 2;
  if (/Reading .*prompt|Analyzing reference|Reference analysis/i.test(t)) return 1;
  if (/started|Initializing/i.test(t)) return 0;
  return -1;
}

/** Friendlier wording for the errors generate_character returns. */
export function generationErrorMessage(err, { cancelled = false, agentLabel = 'The AI' } = {}) {
  if (cancelled) return 'Cancelled. Nothing was saved.';
  const t = String(err?.message || err || '');
  if (/already being generated/i.test(t)) return t;
  if (/exited with status/i.test(t)) return `${agentLabel} stopped before finishing. Check that you are signed in to it (run it once in a terminal), then try again.`;
  if (/No new skin file/i.test(t)) return `${agentLabel} finished without drawing a sheet. Try again, perhaps with a simpler description.`;
  if (/Failed to start/i.test(t)) return `${agentLabel} could not be started. Is it installed?`;
  if (/must be 128|sheet/i.test(t)) return `The sheet it drew did not match the Dr. Vibe format: ${t}`;
  return t || 'Something went wrong.';
}
