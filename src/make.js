// Dr. Vibe — "Make your own Dr. Vibe".
//
// Three panes (PLAN → Desktop windows):
//   left   — three ways to make one: Generate with AI (the player's own
//            Claude Code / Codex CLI), Draw it (sprite editor, blank or from
//            a Lab Original) and Import a sheet; then the player's own Dr. Vibes
//   middle — the bench: all 17 animation rows with the local format checks,
//            or the generator's progress while it runs
//   right  — an animated preview, Wear, Change (AI workshop, sprite editor),
//            Export, Delete, and Submit to the Incubator
// It always opens on a fresh "Describe your Dr. Vibe…" prompt; `?edit=<slug>`
// opens an existing Dr. Vibe on the bench instead (makeHub.js).
// Everything except Submit works offline and without an account.

import { initTheme } from './core/theme.js';
import { openUrl } from './core/openUrl.js';
import { WEB_BASE, syncWebBaseFromRust } from './core/config.js';
import { desktopApi, isLinked } from './core/api/client.js';
import { designErrorMessage } from './core/api/contract.js';
import { WebRoutes } from './core/api/endpoints.js';
import { readSection, writeKey } from './core/DatabaseReader.js';
import { ANIMATIONS } from './config/animations.js';
import { formatSkinName } from './config/skinNames.js';
import { ROW_SPEC, FRAME, SHEET_WIDTH, SHEET_HEIGHT, validateSheet, templateGuide } from './features/make/spriteSpec.js';
import {
  AGENTS, TABS, parseMakeRoute, pickAgent, isOwnDesign, sourceLabel, slugify, nameFromFile,
  designActions, GENERATION_STEPS, progressStep, generationErrorMessage,
} from './features/make/makeHub.js';

initTheme();

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const emitTo = (target, event, payload) => window.__TAURI__?.event?.emitTo?.(target, event, payload)?.catch?.(() => {});
const $ = (id) => document.getElementById(id);
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const AGENT_PREF_KEY = 'drvibe-make-agent';

const state = {
  tab: 'generate',
  designs: [],       // the player's own: [{ slug, name, source }]
  originals: [],     // Lab Originals: [{ slug, name }]
  current: null,     // { kind, slug, name, source, pngBase64, animJson, byteLength, img, validation, fresh }
  wearing: null,     // slug Dr. Vibe has on
  installed: { claude: false, codex: false },
  agent: null,
  linked: false,
  busy: false,
  cancelled: false,
  previewRow: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function loadImage(b64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = `data:image/png;base64,${b64}`;
  });
}

function imageData(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function setStatus(text, kind = '', id = 'status') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `status ${kind}`;
}

function parseAnim(json) {
  try { return JSON.parse(json || '{}') || {}; } catch { return {}; }
}

function displayName(skin) {
  return skin.name || formatSkinName(skin.slug);
}

/** Animation timing for a sheet row (walk uses walkRight). */
function rowAnim(row) {
  const entry = Object.values(ANIMATIONS).find((a) => a.row === row && !a.flipH);
  const frames = ROW_SPEC[row]?.frames ?? 4;
  const durations = entry?.frameDurations || Array(frames).fill(entry?.frameDuration || 250);
  return { frames, durations };
}

function drawThumb(canvas, img) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, FRAME, FRAME, 0, 0, canvas.width, canvas.height);
}

// ── Animated previews ────────────────────────────────────────────────────

const players = new Map(); // canvas → { img, row, frame, last }

function play(canvas, img, row = 0) {
  players.set(canvas, { img, row, frame: 0, last: 0 });
}

function tick(now) {
  for (const [canvas, p] of players) {
    if (!p.img) continue;
    const { frames, durations } = rowAnim(p.row);
    if (!REDUCED_MOTION && now - p.last >= (durations[p.frame] || 250)) {
      p.frame = (p.frame + 1) % frames;
      p.last = now;
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if ((p.row + 1) * FRAME <= p.img.naturalHeight) {
      ctx.drawImage(p.img, p.frame * FRAME, p.row * FRAME, FRAME, FRAME, 0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(tick);
}

// ── Tabs ─────────────────────────────────────────────────────────────────

function showTab(tab) {
  state.tab = TABS.includes(tab) ? tab : 'generate';
  for (const t of TABS) {
    const btn = $(`tab-${t}`);
    const on = t === state.tab;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.indexOf(state.tab);
      const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      showTab(next);
      $(`tab-${next}`).focus();
    });
  });
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
}

// ── Bench ────────────────────────────────────────────────────────────────

function showBench(view) {
  $('welcome').hidden = view !== 'welcome';
  $('working').hidden = view !== 'working';
  $('design-view').hidden = view !== 'design';
}

async function setCurrent(design) {
  const img = await loadImage(design.pngBase64);
  const validation = validateSheet(imageData(img), design.byteLength ?? null);
  state.current = { ...design, img, validation };
  state.previewRow = 0;
  render();
}

function clearCurrent() {
  state.current = null;
  document.querySelectorAll('.design').forEach((d) => d.classList.remove('selected'));
  render();
}

function render() {
  const cur = state.current;
  $('design-actions').hidden = !cur;
  $('stage').hidden = !cur;
  $('no-design').hidden = !!cur;
  if (!cur) {
    showBench(state.busy ? 'working' : 'welcome');
    players.delete($('preview'));
    $('preview').getContext('2d').clearRect(0, 0, 32, 32);
    $('preview-label').textContent = '';
    return;
  }
  if (!state.busy) showBench('design');
  const { img, validation } = cur;
  $('grid-title').textContent = cur.name || 'Untitled';
  if (document.activeElement !== $('design-name')) $('design-name').value = cur.name || '';
  $('design-name').disabled = cur.kind === 'original';

  const summary = $('summary');
  if (validation.ok) {
    summary.textContent = img.naturalHeight > 512 ? 'All 17 rows pass ✓' : 'All 16 rows pass ✓ (no levitating row)';
    summary.className = 'summary good';
  } else {
    summary.textContent = validation.wearable ? 'Wearable, not shareable yet' : 'Not ready yet';
    summary.className = 'summary bad';
  }
  $('errors').textContent = [...validation.errors.slice(0, 6), ...(validation.ok ? [] : validation.warnings.slice(0, 1))].join(' ');

  const hint = $('hint-bar');
  hint.hidden = !(cur.fresh || cur.kind === 'original');
  if (cur.fresh) {
    hint.textContent = 'Here it is! Click a row to watch it move. Not quite right? Change the description and generate again, or use Change it → With AI to redo one animation.';
  } else if (cur.kind === 'original') {
    hint.textContent = 'This is a Lab Original. Remix it as your own to change it; the original stays as it is.';
  }

  const rowsEl = $('rows');
  rowsEl.innerHTML = '';
  for (const spec of ROW_SPEC) {
    const result = validation.rows.find((r) => r.row === spec.row);
    const name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = `${spec.row} ${spec.name}`;
    const frames = document.createElement('button');
    frames.type = 'button';
    frames.className = `row-frames${spec.row === state.previewRow ? ' on' : ''}`;
    frames.setAttribute('aria-label', `Preview the ${spec.name} animation`);
    const c = document.createElement('canvas');
    c.width = SHEET_WIDTH;
    c.height = FRAME;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (spec.row * FRAME < img.naturalHeight) {
      ctx.drawImage(img, 0, spec.row * FRAME, SHEET_WIDTH, FRAME, 0, 0, SHEET_WIDTH, FRAME);
    }
    frames.appendChild(c);
    frames.addEventListener('click', () => previewRow(spec.row));
    const ok = document.createElement('div');
    const optionalMissing = result?.optional && result?.missing;
    ok.className = `row-ok ${optionalMissing ? '' : result?.ok ? 'good' : 'bad'}`;
    ok.textContent = optionalMissing ? '–' : result?.ok ? '✓' : '✗';
    ok.title = optionalMissing ? 'Optional; idle is used instead' : result?.ok ? 'OK' : 'Almost empty frames';
    rowsEl.append(name, frames, ok);
  }

  previewRow(state.previewRow);
  updateButtons();
}

function previewRow(row) {
  state.previewRow = row;
  const cur = state.current;
  if (!cur) return;
  const present = (row + 1) * FRAME <= cur.img.naturalHeight;
  play($('preview'), cur.img, present ? row : 0);
  $('preview-label').textContent = present ? ROW_SPEC[row].name : `${ROW_SPEC[row].name} (missing, shows idle)`;
  document.querySelectorAll('.row-frames').forEach((b, i) => b.classList.toggle('on', i === row));
}

function updateButtons() {
  const cur = state.current;
  if (!cur) return;
  const acts = designActions({
    kind: cur.kind,
    validation: cur.validation,
    linked: state.linked,
    licenseOk: $('license-ok').checked,
    agent: state.agent,
    wearing: !!cur.slug && cur.slug === state.wearing,
    busy: state.busy,
  });
  const apply = (id, act, label = null) => {
    const el = $(id);
    el.hidden = !act.show;
    el.disabled = !act.enabled;
    el.title = act.hint || el.dataset.title || '';
    if (label) el.textContent = label;
  };
  apply('btn-wear', acts.wear, cur.slug && cur.slug === state.wearing ? 'Wearing it ✓' : 'Wear it');
  apply('btn-save', acts.save);
  apply('btn-remix', acts.remix);
  apply('btn-edit-ai', acts.editAi);
  apply('btn-edit-pixels', acts.editPixels);
  apply('btn-export', acts.exportPng);
  apply('btn-delete', acts.remove);
  $('change-label').hidden = !acts.editAi.show;
  $('submit-box').hidden = !acts.submit.show;
  $('btn-submit').disabled = !acts.submit.enabled;
  $('submit-hint').textContent = acts.submit.hint;
}

// ── Your Dr. Vibes ───────────────────────────────────────────────────────

async function loadDesigns() {
  let skins = [];
  try { skins = (await invoke('list_skins')) || []; } catch { skins = []; }
  state.originals = skins.filter((s) => s?.isDefault).map((s) => ({ slug: s.slug, name: displayName(s) }));
  const mine = skins.filter(isOwnDesign);
  state.designs = await Promise.all(mine.map(async (s) => {
    let anim = {};
    try { anim = parseAnim(await invoke('read_skin_anim', { name: s.slug })); } catch { /* no sidecar */ }
    return { slug: s.slug, name: s.name || anim.name || formatSkinName(s.slug), source: anim.source || null };
  }));
  renderDesigns();
  fillStartOptions();
}

function renderDesigns() {
  const list = $('designs');
  list.innerHTML = '';
  $('designs-count').textContent = state.designs.length ? `(${state.designs.length})` : '';
  if (state.designs.length === 0) {
    list.innerHTML = '<div class="empty-designs">None yet. Generate, draw or import one and it shows up here.</div>';
    return;
  }
  for (const d of state.designs) {
    const row = document.createElement('div');
    row.className = `design${state.current?.slug === d.slug && state.current?.kind === 'own' ? ' selected' : ''}`;
    row.dataset.slug = d.slug;
    const c = document.createElement('canvas');
    c.width = FRAME;
    c.height = FRAME;
    const who = document.createElement('button');
    who.type = 'button';
    who.className = 'who';
    who.title = 'Open it';
    const strong = document.createElement('strong');
    strong.textContent = d.name;
    const meta = document.createElement('span');
    if (d.slug === state.wearing) {
      meta.innerHTML = '<span class="wearing">Wearing</span> · ';
    }
    meta.append(sourceLabel(d.source));
    who.append(strong, meta);
    who.addEventListener('click', () => openSaved(d.slug));
    const acts = document.createElement('div');
    acts.className = 'acts';
    const wear = document.createElement('button');
    wear.className = 'mini';
    wear.textContent = d.slug === state.wearing ? 'On' : 'Wear';
    wear.disabled = d.slug === state.wearing || state.busy;
    wear.title = d.slug === state.wearing ? 'Dr. Vibe is wearing this one' : `Wear ${d.name}`;
    wear.addEventListener('click', () => wearSlug(d.slug, d.name));
    const edit = document.createElement('button');
    edit.className = 'mini';
    edit.textContent = 'Edit';
    edit.title = `Check, change or share ${d.name}`;
    edit.addEventListener('click', () => openSaved(d.slug));
    acts.append(wear, edit);
    row.append(c, who, acts);
    list.appendChild(row);
    invoke('read_skin', { name: d.slug }).then(loadImage).then((img) => drawThumb(c, img)).catch(() => {});
  }
}

function fillStartOptions() {
  const fill = (select, groups, keep) => {
    const prev = select.value;
    select.querySelectorAll('optgroup').forEach((g) => g.remove());
    for (const [label, items] of groups) {
      if (!items.length) continue;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const s of items) {
        const o = document.createElement('option');
        o.value = s.slug;
        o.textContent = s.name;
        g.appendChild(o);
      }
      select.appendChild(g);
    }
    if (keep && [...select.options].some((o) => o.value === prev)) select.value = prev;
  };
  fill($('start-from'), [['Lab Originals', state.originals], ['Your Dr. Vibes', state.designs]], true);
  fill($('template-from'), [['Lab Originals', state.originals], ['Your Dr. Vibes', state.designs]], true);
  if (!$('template-from').value && state.originals[0]) $('template-from').value = state.originals[0].slug;
}

async function openSaved(slug, { fresh = false } = {}) {
  if (state.busy) return;
  try {
    const pngBase64 = await invoke('read_skin', { name: slug });
    let animJson = '';
    try { animJson = await invoke('read_skin_anim', { name: slug }); } catch { animJson = ''; }
    const anim = parseAnim(animJson);
    const mine = state.designs.find((d) => d.slug === slug);
    const original = state.originals.find((o) => o.slug === slug);
    const kind = mine ? 'own' : original ? 'original' : 'own';
    await setCurrent({
      kind, slug, fresh,
      name: mine?.name || anim.name || original?.name || formatSkinName(slug),
      source: anim.source || null,
      pngBase64, animJson: animJson || null, byteLength: b64ToBytes(pngBase64).length,
    });
    document.querySelectorAll('.design').forEach((d) => d.classList.toggle('selected', d.dataset.slug === slug));
    setStatus('');
    setStatus('', '', 'submit-status');
  } catch (e) {
    setStatus(`Could not open that Dr. Vibe: ${e}`, 'error');
  }
}

// ── Generate with AI ─────────────────────────────────────────────────────

function agentLabel() {
  return AGENTS[state.agent]?.label || 'your AI';
}

function renderAgent() {
  const any = state.installed.claude || state.installed.codex;
  $('no-agent').hidden = any;
  $('agent-line').hidden = !any;
  $('generate-row').hidden = !any;
  $('generate-note').hidden = !any;
  const both = state.installed.claude && state.installed.codex;
  $('agent-select').hidden = !both;
  $('agent-select').value = state.agent || 'claude';
  $('agent-text').textContent = both ? 'Runs on your' : `Runs on your ${agentLabel()}`;
  updateGenerateButton();
}

function updateGenerateButton() {
  const btn = $('btn-generate');
  btn.disabled = state.busy || !state.agent || !$('prompt').value.trim();
  btn.textContent = state.busy ? 'Generating…' : state.current?.fresh ? 'Generate another ▶' : 'Generate ▶';
  btn.title = !state.agent ? 'Needs Claude Code or Codex' : !$('prompt').value.trim() ? 'Describe your Dr. Vibe first' : '';
  $('btn-cancel').hidden = !state.busy;
}

function renderSteps(step) {
  const ol = $('steps');
  ol.innerHTML = '';
  GENERATION_STEPS.forEach((label, i) => {
    const li = document.createElement('li');
    li.className = i < step ? 'done' : i === step ? 'now' : '';
    li.innerHTML = `<span class="mark" aria-hidden="true">${i < step ? '✓' : ''}</span>`;
    li.append(i === 0 ? `Starting ${agentLabel()}` : label);
    ol.appendChild(li);
  });
}

// One-time notice before the first AI run: where the description goes.
// Stored as settings.aiGeneratorConsentAt (ms).
let aiConsentAt = null;
let aiConsentWaiter = null;

function askAiConsent() {
  if (aiConsentAt) return Promise.resolve(true);
  const box = $('ai-consent');
  const vendor = $('ai-consent-vendor');
  if (vendor) vendor.textContent = state.agent === 'codex' ? 'OpenAI (Codex)' : 'Anthropic (Claude Code)';
  box.hidden = false;
  return new Promise((resolve) => { aiConsentWaiter = resolve; });
}

function answerAiConsent(ok) {
  $('ai-consent').hidden = true;
  if (ok) {
    aiConsentAt = Date.now();
    writeKey('settings', 'aiGeneratorConsentAt', aiConsentAt).catch(() => {});
    emitTo('main', 'settings-saved', { aiGeneratorConsentAt: aiConsentAt });
  }
  const resolve = aiConsentWaiter;
  aiConsentWaiter = null;
  resolve?.(ok);
}

async function generate() {
  const description = $('prompt').value.trim();
  if (!description || !state.agent || state.busy) return;
  if (!(await askAiConsent())) return;
  const referenceSlug = $('start-from').value || null;
  state.busy = true;
  state.cancelled = false;
  state.current = null;
  document.querySelectorAll('.design').forEach((d) => d.classList.remove('selected'));
  render();
  showBench('working');
  $('working-title').textContent = 'Generating your Dr. Vibe…';
  $('log').textContent = '';
  let step = 0;
  renderSteps(step);
  updateGenerateButton();
  renderDesigns();
  const started = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('elapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  let unlisten = () => {};
  try {
    unlisten = await window.__TAURI__.event.listen('claude-progress', (evt) => {
      const line = String(evt.payload ?? '');
      const log = $('log');
      log.textContent += (log.textContent ? '\n' : '') + line;
      log.scrollTop = log.scrollHeight;
      const s = progressStep(line);
      if (s > step) { step = s; renderSteps(step); }
    });
  } catch { /* progress is a nicety */ }

  try {
    const slug = await invoke('generate_character', { description, agent: state.agent, referenceSlug });
    renderSteps(GENERATION_STEPS.length);
    state.busy = false;
    await loadDesigns();
    emitTo('settings', 'skins-changed', { wearing: state.wearing });
    await openSaved(slug, { fresh: true });
    setStatus(state.current?.validation.wearable
      ? 'Saved to Your Dr. Vibes. Give it a name and wear it.'
      : 'It was saved, but some rows are missing, so it cannot be worn yet. Try generating again.', state.current?.validation.wearable ? 'ok' : 'error');
  } catch (e) {
    state.busy = false;
    render();
    showBench('working');
    $('working-title').textContent = state.cancelled ? 'Cancelled' : 'That did not work';
    $('steps').innerHTML = '';
    const li = document.createElement('li');
    li.textContent = generationErrorMessage(e, { cancelled: state.cancelled, agentLabel: agentLabel() });
    li.style.cssText = 'color:var(--text-soft);max-width:340px;line-height:1.5;text-align:center';
    $('steps').appendChild(li);
  } finally {
    state.busy = false;
    clearInterval(timer);
    try { unlisten(); } catch { /* already gone */ }
    updateGenerateButton();
    renderDesigns();
    updateButtons();
  }
}

async function cancelGenerate() {
  state.cancelled = true;
  $('working-title').textContent = 'Cancelling…';
  try { await invoke('cancel_generation'); } catch { /* it may have just finished */ }
}

// ── Actions ──────────────────────────────────────────────────────────────

async function importPng(file) {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) {
    setStatus('That is not a PNG file.', 'error');
    return;
  }
  document.querySelectorAll('.design').forEach((d) => d.classList.remove('selected'));
  try {
    await setCurrent({ kind: 'unsaved', slug: null, name: nameFromFile(file.name), source: 'player_made', pngBase64: bytesToB64(bytes), animJson: null, byteLength: bytes.length });
    setStatus(state.current.validation.wearable
      ? 'Imported. Name it, then save or wear it.'
      : 'Imported, but it does not match the sprite format yet. See the rows marked ✗.', state.current.validation.wearable ? 'ok' : 'error');
  } catch (e) {
    setStatus(String(e.message || e), 'error');
  }
}

/** Save an imported sheet into the skins folder; returns its slug. */
async function saveCurrent() {
  const cur = state.current;
  if (!cur) return null;
  if (cur.kind !== 'unsaved') return cur.slug;
  const name = $('design-name').value.trim() || cur.name;
  const anim = JSON.stringify({ ...parseAnim(cur.animJson), name, source: 'player_made' });
  const slug = await invoke('import_skin', { name: slugify(name), pngB64: cur.pngBase64, animJson: anim });
  await loadDesigns();
  emitTo('settings', 'skins-changed', { wearing: state.wearing });
  await openSaved(slug);
  return slug;
}

async function wearSlug(slug, name) {
  try {
    await window.__TAURI__.event.emitTo('main', 'switch-skin', { slug });
    state.wearing = slug;
    emitTo('settings', 'skins-changed', { wearing: slug });
    renderDesigns();
    updateButtons();
    setStatus(`Dr. Vibe is wearing ${name || 'it'} now.`, 'ok');
  } catch (e) {
    setStatus(`Could not wear it: ${e}`, 'error');
  }
}

async function wearCurrent() {
  try {
    const slug = await saveCurrent();
    if (slug) await wearSlug(slug, state.current?.name);
  } catch (e) {
    setStatus(`Could not wear it: ${e}`, 'error');
  }
}

async function renameCurrent() {
  const cur = state.current;
  const name = $('design-name').value.trim();
  if (!cur || !name || name === cur.name) return;
  if (cur.kind === 'unsaved') { cur.name = name; $('grid-title').textContent = name; return; }
  if (cur.kind !== 'own') return;
  try {
    await invoke('rename_skin', { slug: cur.slug, displayName: name });
    cur.name = name;
    $('grid-title').textContent = name;
    const d = state.designs.find((x) => x.slug === cur.slug);
    if (d) d.name = name;
    renderDesigns();
    emitTo('settings', 'skins-changed', { wearing: state.wearing });
    setStatus('Renamed.', 'ok');
  } catch (e) {
    setStatus(`Could not rename it: ${e}`, 'error');
  }
}

async function remixCurrent() {
  const cur = state.current;
  if (cur?.kind !== 'original') return;
  try {
    const slug = await invoke('copy_skin', { sourceSlug: cur.slug, newSlug: `my-${cur.slug.replace(/^dr-vibe-/, '')}` });
    await invoke('rename_skin', { slug, displayName: `My ${cur.name}` }).catch(() => {});
    await loadDesigns();
    emitTo('settings', 'skins-changed', { wearing: state.wearing });
    await openSaved(slug);
    setStatus('Copied to Your Dr. Vibes. Change it with AI or edit the pixels.', 'ok');
  } catch (e) {
    setStatus(`Could not copy it: ${e}`, 'error');
  }
}

async function editWithAi() {
  const cur = state.current;
  if (cur?.kind !== 'own' || !state.agent) return;
  if (!(await askAiConsent())) return;
  try {
    await invoke('open_character_workshop', { slug: cur.slug, agent: state.agent });
  } catch (e) {
    setStatus(String(e), 'error');
  }
}

async function editPixels() {
  const cur = state.current;
  if (cur?.kind !== 'own') return;
  try {
    await invoke('open_sprite_editor', { slug: cur.slug, mode: 'edit' });
  } catch (e) {
    setStatus(String(e), 'error');
  }
}

async function exportCurrent() {
  const cur = state.current;
  if (!cur?.slug) return;
  try {
    const path = await invoke('export_skin', { slug: cur.slug });
    setStatus('Saved the PNG and its settings to your Downloads folder.', 'ok');
    try { await window.__TAURI__.opener.revealItemInDir(path); } catch { /* reveal is a nicety */ }
  } catch (e) {
    setStatus(`Could not export it: ${e}`, 'error');
  }
}

let deleteTimer = null;
async function deleteCurrent() {
  const cur = state.current;
  const btn = $('btn-delete');
  if (cur?.kind !== 'own') return;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Delete for good?';
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => { btn.classList.remove('confirming'); btn.textContent = 'Delete'; }, 3000);
    return;
  }
  clearTimeout(deleteTimer);
  btn.classList.remove('confirming');
  btn.textContent = 'Delete';
  try {
    if (state.wearing === cur.slug) {
      await window.__TAURI__.event.emitTo('main', 'switch-skin', { slug: 'dr-vibe-default' });
      state.wearing = 'dr-vibe-default';
    }
    await invoke('delete_skin', { name: cur.slug });
    const name = cur.name;
    clearCurrent();
    await loadDesigns();
    emitTo('settings', 'skins-changed', { wearing: state.wearing });
    setStatus(`Deleted ${name}.`, 'ok');
  } catch (e) {
    setStatus(`Could not delete it: ${e}`, 'error');
  }
}

async function submitCurrent() {
  const cur = state.current;
  if (cur?.kind !== 'own' || !cur.validation.ok || !$('license-ok').checked) return;
  const name = $('design-name').value.trim() || cur.name;
  $('btn-submit').disabled = true;
  setStatus('Submitting…', '', 'submit-status');
  // POST /designs (multipart; licenseAccepted + ownWorkConfirmed are sent
  // because the player ticked the upload-rights box).
  const r = await desktopApi.submitDesign({
    pngBase64: cur.pngBase64,
    animJson: cur.animJson,
    name,
    description: $('design-desc').value.trim(),
    vibeId: parseAnim(cur.animJson).vibeId || null,
  });
  if (r.ok) {
    const status = r.data?.design?.status;
    setStatus(status === 'held_for_review'
      ? 'Submitted! A moderator takes a quick look first, then players can vote.'
      : 'Submitted! Players can vote on it in the Incubator.', 'ok', 'submit-status');
    emitTo('main', 'community-gallery-submitted', { slug: cur.slug, name });
  } else {
    setStatus(designErrorMessage(r), 'error', 'submit-status');
  }
  updateButtons();
}

async function downloadTemplate() {
  try {
    const base = await loadImage(await invoke('read_skin', { name: 'dr-vibe-default' }));
    const c = document.createElement('canvas');
    c.width = SHEET_WIDTH;
    c.height = SHEET_HEIGHT;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0);
    const pngBase64 = c.toDataURL('image/png').split(',')[1];
    const path = await invoke('save_sprite_template', { pngBase64, guide: templateGuide() });
    setStatus('Saved the template and its guide to your Downloads folder.', 'ok');
    try { await window.__TAURI__.opener.revealItemInDir(path); } catch { /* reveal is a nicety */ }
  } catch (e) {
    setStatus(`Could not save the template: ${e}`, 'error');
  }
}

function openEditor(slug, mode) {
  invoke('open_sprite_editor', { slug, mode }).catch((e) => setStatus(String(e), 'error'));
}

/** Show what the URL (or a `make-route` event from Settings) asks for. */
async function route({ tab, edit }) {
  showTab(tab);
  if (edit) await openSaved(edit);
  else if (!state.busy && state.current?.kind !== 'unsaved') clearCurrent();
}

// ── Wire up ──────────────────────────────────────────────────────────────

wireTabs();
$('prompt').addEventListener('input', updateGenerateButton);
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate(); });
document.querySelectorAll('[data-idea]').forEach((chip) => chip.addEventListener('click', () => {
  $('prompt').value = chip.dataset.idea;
  updateGenerateButton();
  $('prompt').focus();
}));
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openUrl(AGENTS[b.dataset.open].installUrl)));
$('agent-select').addEventListener('change', (e) => {
  state.agent = e.target.value;
  try { localStorage.setItem(AGENT_PREF_KEY, state.agent); } catch { /* ignore */ }
  renderAgent();
});
$('btn-generate').addEventListener('click', generate);
$('btn-cancel').addEventListener('click', cancelGenerate);
$('btn-draw-blank').addEventListener('click', () => openEditor('', 'blank'));
$('btn-draw-template').addEventListener('click', () => { const slug = $('template-from').value; if (slug) openEditor(slug, 'template'); });
$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => { importPng(e.target.files?.[0]); e.target.value = ''; });
$('btn-template').addEventListener('click', downloadTemplate);
$('btn-template-2').addEventListener('click', downloadTemplate);
$('btn-wear').addEventListener('click', wearCurrent);
$('btn-save').addEventListener('click', () => saveCurrent().then(() => setStatus('Saved to Your Dr. Vibes.', 'ok')).catch((e) => setStatus(String(e), 'error')));
$('btn-remix').addEventListener('click', remixCurrent);
$('btn-edit-ai').addEventListener('click', editWithAi);
$('btn-edit-pixels').addEventListener('click', editPixels);
$('btn-export').addEventListener('click', exportCurrent);
$('btn-delete').addEventListener('click', deleteCurrent);
$('btn-submit').addEventListener('click', submitCurrent);
$('license-ok').addEventListener('change', updateButtons);
$('terms-link').addEventListener('click', () => openUrl(`${WEB_BASE}${WebRoutes.terms()}#uploads`));
$('design-name').addEventListener('change', renameCurrent);
$('design-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// Saves from the sprite editor and AI workshop show up when we regain focus
// (and when they announce `skins-changed`).
async function refreshFromOutside() {
  if (state.busy) return;
  await loadDesigns();
  const cur = state.current;
  if (cur?.kind === 'own') {
    if (state.designs.some((d) => d.slug === cur.slug)) await openSaved(cur.slug, { fresh: cur.fresh });
    else clearCurrent();
  }
}
window.addEventListener('focus', refreshFromOutside);

requestAnimationFrame(tick);

(async () => {
  showTab('generate');
  render();
  await syncWebBaseFromRust();
  let settings = null;
  try { settings = await readSection('settings'); } catch { settings = null; }
  state.wearing = settings?.selectedSkin || 'dr-vibe-default';
  aiConsentAt = settings?.aiGeneratorConsentAt || null;
  $('btn-ai-consent-ok')?.addEventListener('click', () => answerAiConsent(true));
  $('btn-ai-consent-cancel')?.addEventListener('click', () => answerAiConsent(false));
  const [claude, codex, linked] = await Promise.all([
    invoke('check_claude_installed').catch(() => false),
    invoke('check_codex_installed').catch(() => false),
    isLinked().catch(() => false),
  ]);
  state.installed = { claude: !!claude, codex: !!codex };
  let pref = null;
  try { pref = localStorage.getItem(AGENT_PREF_KEY); } catch { /* ignore */ }
  pref = pref || settings?.aiAgent || null;
  state.agent = pickAgent(state.installed, pref);
  state.linked = linked;
  renderAgent();
  await loadDesigns();
  try {
    const def = await loadImage(await invoke('read_skin', { name: 'dr-vibe-default' }));
    play($('welcome-canvas'), def, 0);
  } catch { /* the welcome sprite is decoration */ }
  await route(parseMakeRoute(location.search));
  window.__TAURI__?.event?.listen?.('make-route', (e) => route(parseMakeRoute(e.payload?.search || '')));
  window.__TAURI__?.event?.listen?.('skins-changed', (e) => {
    if (e.payload?.wearing) state.wearing = e.payload.wearing;
    refreshFromOutside();
  });
  if (state.tab === 'generate' && !state.current) $('prompt').focus();
})();
