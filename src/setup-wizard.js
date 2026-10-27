// Dr. Vibe - Setup Wizard
// First-run setup: Meet → Look → Coding setup → What Dr. Vibe watches →
// Wellness → What Dr. Vibe sends → Who can see it → Join the community
// (optional). Nothing requires an account or the network; the wizard can be
// closed at any step. Reads/writes settings via DatabaseReader and notifies
// the main window on completion.
//
// Privacy rules: Skip or close saves nothing, so the app defaults apply
// (Claude Code hooks off, crash reports off). Hooks are installed, crash
// reports flushed and the first sync made only after setup completes, by
// the main window. The send and visibility choices go to the main window
// (PrivacySync) when the player reaches the Join step, so a link made there
// already carries them; Skip or close puts back what was there before.

import { openUrl } from './core/openUrl.js';
import { WebRoutes } from './core/api/endpoints.js';
import { renderWhatDrVibeSees } from './ui/WhatDrVibeSees.js';
import { readSection, writeSection } from './core/DatabaseReader.js';
import { getPresetsForSkin, getDefaultTone, SKIN_TONE_CATEGORIES, BASE_SKIN_PALETTE, SKIN_TONE_PRESETS, tonePresetKey } from './config/skinTones.js';
import { initTheme } from './core/theme.js';
import { formatSkinName, skinVariantLabel } from './config/skinNames.js';
import { DEFAULT_SETTINGS } from './features/settings/Settings.js';
import { PRIVACY_DEFAULTS, buildPrivacyBody } from './core/api/contract.js';
import { WATCH_CHOICES, SEND_CHOICES, WHO_CHOICES, SYNC_CHOICE, renderChoices, describeValue } from './ui/privacyChoices.js';
import { wizardDefaults } from './ui/wizardDefaults.js';
initTheme();

// ── Voice presets (same definitions as settings-page.js / SoundManager) ──
const VOICE_PRESETS = {
  mumble: {
    label: 'Mumble',
    baseFreq: 350, freqRange: 200, bendAmount: 120,
    syllableMs: 55, gapMs: 30, count: 7,
    waves: ['sine', 'triangle'],
    filterFreq: 1800, filterQ: 2,
    formants: [270, 530, 730, 400, 640],
    vibrato: 4, vibratoDepth: 12,
  },
  squeaky: {
    label: 'Squeaky',
    baseFreq: 800, freqRange: 400, bendAmount: 250,
    syllableMs: 30, gapMs: 15, count: 9,
    waves: ['triangle', 'square'],
    filterFreq: 4000, filterQ: 1.5,
    formants: [600, 800, 950, 700, 850],
    vibrato: 0, vibratoDepth: 0,
  },
  gruff: {
    label: 'Gruff',
    baseFreq: 140, freqRange: 80, bendAmount: 50,
    syllableMs: 80, gapMs: 40, count: 5,
    waves: ['sawtooth', 'triangle'],
    filterFreq: 900, filterQ: 3,
    formants: [200, 350, 280, 320, 250],
    vibrato: 2, vibratoDepth: 6,
  },
  alien: {
    label: 'Alien',
    baseFreq: 500, freqRange: 600, bendAmount: 400,
    syllableMs: 60, gapMs: 20, count: 8,
    waves: ['sine', 'sine'],
    filterFreq: 3500, filterQ: 5,
    formants: [300, 900, 500, 1100, 400],
    vibrato: 12, vibratoDepth: 40,
  },
  robot: {
    label: 'Robot',
    baseFreq: 200, freqRange: 50, bendAmount: 10,
    syllableMs: 50, gapMs: 20, count: 7,
    waves: ['square', 'square'],
    filterFreq: 2000, filterQ: 8,
    formants: [300, 320, 340, 310, 330],
    vibrato: 0, vibratoDepth: 0,
  },
  mystic: {
    label: 'Mystic',
    baseFreq: 400, freqRange: 250, bendAmount: 150,
    syllableMs: 90, gapMs: 35, count: 6,
    waves: ['sine', 'triangle'],
    filterFreq: 2200, filterQ: 3,
    formants: [350, 600, 450, 700, 500],
    vibrato: 6, vibratoDepth: 20,
  },
  hyper: {
    label: 'Hyper',
    baseFreq: 550, freqRange: 450, bendAmount: 300,
    syllableMs: 25, gapMs: 12, count: 12,
    waves: ['square', 'triangle', 'sawtooth'],
    filterFreq: 3500, filterQ: 2,
    formants: [400, 700, 500, 850, 600],
    vibrato: 0, vibratoDepth: 0,
  },
  retro: {
    label: 'Retro',
    baseFreq: 440, freqRange: 200, bendAmount: 0,
    syllableMs: 45, gapMs: 20, count: 8,
    waves: ['square', 'square'],
    filterFreq: 5000, filterQ: 0.5,
    formants: [262, 330, 392, 440, 523],
    vibrato: 0, vibratoDepth: 0,
  },
};

// ── Sound preview ──
const soundPreview = {
  ctx: null,
  gain: null,
  _ensure(volume) {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.gain.gain.value = (volume ?? 50) / 100;
  },
  previewVoice(voiceName, volume) {
    this._ensure(volume);
    const preset = VOICE_PRESETS[voiceName] || VOICE_PRESETS.mumble;
    _playVoicePreset(this.ctx, this.gain, preset, 'Hello there!');
  },
};

function _playVoicePreset(ctx, dest, preset, text) {
  const now = ctx.currentTime;
  const syllableDuration = preset.syllableMs / 1000;
  const gap = preset.gapMs / 1000;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = preset.filterFreq;
  filter.Q.value = preset.filterQ;
  filter.connect(dest);

  let seed = 0;
  for (let c = 0; c < (text || '').length; c++) {
    seed = ((seed << 5) - seed + (text || '').charCodeAt(c)) | 0;
  }
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed & 0x7fffffff) / 2147483647;
  };

  const baseSyllables = Math.round((text || '').length / 4);
  const syllableCount = Math.max(3, Math.min(14, baseSyllables || preset.count));

  for (let i = 0; i < syllableCount; i++) {
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = preset.waves[i % preset.waves.length];
    const formantShift = preset.formants[i % preset.formants.length] / 500;
    const freq = preset.baseFreq * formantShift + rand() * preset.freqRange * 0.5;
    const start = now + i * (syllableDuration + gap);
    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, freq + (rand() - 0.5) * preset.bendAmount),
      start + syllableDuration * 0.7
    );
    osc.frequency.linearRampToValueAtTime(
      Math.max(20, freq * (0.9 + rand() * 0.2)),
      start + syllableDuration
    );
    if (preset.vibrato > 0) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = preset.vibrato;
      lfoGain.gain.value = preset.vibratoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + syllableDuration + 0.01);
    }
    const attack = syllableDuration * 0.12;
    const sustain = syllableDuration * 0.5;
    oscGain.gain.setValueAtTime(0, start);
    oscGain.gain.linearRampToValueAtTime(0.15, start + attack);
    oscGain.gain.setValueAtTime(0.15 * (0.7 + rand() * 0.3), start + attack + sustain);
    oscGain.gain.exponentialRampToValueAtTime(0.001, start + syllableDuration);
    osc.connect(oscGain);
    oscGain.connect(filter);
    osc.start(start);
    osc.stop(start + syllableDuration + 0.01);
  }
}

// ── Skin helpers ──
const CATEGORY_LABELS = {
  'dr-vibe':  'Dr. Vibe',
  'human':    'Human',
  'fantasy':  'Fantasy',
  'animal':   'Animal',
  'none':     'Other',
};
const CATEGORY_ORDER = ['dr-vibe', 'human', 'fantasy', 'animal', 'none'];


function drawSkinFrame(canvas, b64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 32, 32, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = resolve;
    img.src = 'data:image/png;base64,' + b64;
  });
}

// ── Live skin preview (lightweight idle animation) ──
// Extracts idle frames (row 0) from the spritesheet and animates them
// on a preview canvas with skin tone palette swapping.

function createSkinPreview(canvasId) {
  return {
  canvas: null,
  ctx: null,
  frames: [],       // array of ImageData (32x32 each)
  currentFrame: 0,
  frameTimer: 0,
  lastTime: 0,
  animId: null,
  loadGen: 0,       // generation counter to handle rapid skin changes
  // Idle: row 0, 3 frames, timing [400, 200, 400]ms
  frameDurations: [400, 200, 400],
  frameCount: 3,

  init() {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  },

  // Load a skin spritesheet and extract idle frames with tone swap
  async load(skinName, toneName) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke || !this.canvas) return;

    this.loadGen++;
    const gen = this.loadGen;

    let b64;
    try {
      b64 = await invoke('read_skin', { name: skinName });
    } catch { return; }
    if (!b64 || gen !== this.loadGen) return;

    // Load the full spritesheet into an Image
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = 'data:image/png;base64,' + b64;
    });
    if (!img || gen !== this.loadGen) return;

    // Also try loading anim config to get per-skin idle frame count
    let animConfig = null;
    try {
      const configStr = await invoke('read_skin_anim', { name: skinName });
      if (configStr) animConfig = JSON.parse(configStr);
    } catch {}

    // Determine idle animation params from skin config or use defaults
    const idleConfig = animConfig?.animations?.idle;
    const frameCount = idleConfig?.frameCount || this.frameCount;
    const frameDurations = idleConfig?.frameDurations || this.frameDurations;

    // Build skin tone swap map
    const swapMap = this._buildSwapMap(skinName, toneName);

    // Stamp spritesheet onto temp canvas to read pixel data
    const tmp = document.createElement('canvas');
    tmp.width = img.naturalWidth || img.width;
    tmp.height = img.naturalHeight || img.height;
    const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });
    tmpCtx.drawImage(img, 0, 0);

    // Extract idle frames from row 0
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const imageData = tmpCtx.getImageData(i * 32, 0, 32, 32);
      if (swapMap) {
        const data = imageData.data;
        for (let p = 0; p < data.length; p += 4) {
          if (data[p + 3] === 0) continue;
          const key = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
          const replacement = swapMap.get(key);
          if (replacement) {
            data[p]     = replacement[0];
            data[p + 1] = replacement[1];
            data[p + 2] = replacement[2];
          }
        }
      }
      frames.push(imageData);
    }

    if (gen !== this.loadGen) return;

    this.frames = frames;
    this.frameDurations = frameDurations.length >= frameCount
      ? frameDurations.slice(0, frameCount)
      : Array(frameCount).fill(300);
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.lastTime = 0;

    // Render first frame immediately
    this._drawFrame(0);

    // Start animation loop if not running
    if (!this.animId) this._loop(performance.now());
  },

  _buildSwapMap(skinName, toneName) {
    const category = SKIN_TONE_CATEGORIES[skinName] || 'none';
    if (category === 'none') return null;
    const presets = SKIN_TONE_PRESETS[tonePresetKey(category)];
    if (!presets) return null;
    const toneKey = toneName || getDefaultTone(skinName);
    const preset = presets[toneKey] || presets[Object.keys(presets)[0]];
    if (!preset) return null;

    const base = BASE_SKIN_PALETTE;
    const pack = (r, g, b) => (r << 16) | (g << 8) | b;
    if (preset.skin[0] === base.skin[0] && preset.skin[1] === base.skin[1] && preset.skin[2] === base.skin[2]) {
      return null;
    }
    const map = new Map();
    map.set(pack(...base.skin), preset.skin);
    map.set(pack(...base.skinShade), preset.skinShade);
    map.set(pack(...base.skinDark), preset.skinDark);
    return map;
  },

  _drawFrame(index) {
    if (!this.ctx || !this.frames[index]) return;
    this.ctx.clearRect(0, 0, 32, 32);
    this.ctx.putImageData(this.frames[index], 0, 0);
  },

  _loop(time) {
    if (this.frames.length === 0) { this.animId = null; return; }

    if (this.lastTime > 0) {
      const dt = time - this.lastTime;
      this.frameTimer += dt;
      const dur = this.frameDurations[this.currentFrame] || 300;
      if (this.frameTimer >= dur) {
        this.frameTimer -= dur;
        this.currentFrame = (this.currentFrame + 1) % this.frames.length;
        this._drawFrame(this.currentFrame);
      }
    }
    this.lastTime = time;
    this.animId = requestAnimationFrame((t) => this._loop(t));
  },

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  },
  };
}

const skinPreview = createSkinPreview('skin-preview');
const welcomePreview = createSkinPreview('welcome-character');

// ── Default coding apps ──
// The same list as Settings (WindowsTerminal and Claude included), so those
// are not shown as custom apps.
const DEFAULT_CODING_APPS = [...DEFAULT_SETTINGS.codingApps];

// ── State ──
let currentStep = 0;
const TOTAL_STEPS = 8;
const SEND_STEP = 5;
const WHO_STEP = 6;
const JOIN_STEP = 7;
let isSignedIn = false;
let signinUsername = null;
let signinPollTimer = null;
let neverAskToJoin = false;

// Wizard-local state (written to settings on finish)
let selectedSkin = 'dr-vibe-default';
let selectedSkinTone = 'medium-light';
let characterScale = 100;
let selectedVoice = 'mumble';
let soundVolume = 50;
let codingApps = [...DEFAULT_CODING_APPS];
let customApps = [];
let projectFolders = [];
let folderRepoCache = new Map();

let hydrationEnabled = true;
let hydrationFrequency = 45;
let eyeStrainEnabled = true;
let postureReminderEnabled = true;
let postureFrequency = 30;
let overworkPreventionEnabled = true;
let breakMode = 'pomodoro';

// Privacy choices (same keys and wording as Settings: ui/privacyChoices.js)
let choices = wizardDefaults();
let claudePresent = false;
let privacyBefore = null;     // the privacy section before the wizard, for Skip
let privacySentEarly = false; // the send choices went to main on leaving step 6
let errorReportsBefore = false;
let updateWatchChoices = () => {};
let updateSendChoices = () => {};
let updateSyncChoice = () => {};

// ── Step Navigation ──

function goToStep(step) {
  if (step < 0 || step >= TOTAL_STEPS) return;
  // Reaching the Join step: hand the send and visibility choices to the
  // main window now, so a link there sends them before anything else.
  if (step === JOIN_STEP && currentStep < JOIN_STEP) sendPrivacyChoices();
  currentStep = step;
  if (step === JOIN_STEP) renderJoinSummary();

  // Update panels
  document.querySelectorAll('.step-panel').forEach(p => {
    p.classList.toggle('active', parseInt(p.dataset.step) === step);
  });

  // Update step dots
  document.querySelectorAll('.step-dot').forEach(dot => {
    const s = parseInt(dot.dataset.step);
    dot.classList.toggle('active', s === step);
    dot.classList.toggle('completed', s < step);
  });

  // Update step lines
  document.querySelectorAll('.step-line').forEach(line => {
    const l = parseInt(line.dataset.line);
    line.classList.toggle('completed', l < step);
  });

  updateFooterForStep(step);
}

// Every step can be left: Back, Next, Skip and Close always work. The last
// step's primary button finishes setup whether or not the player joined.
function updateFooterForStep(step) {
  const btnBack  = document.getElementById('btn-back');
  const btnNext  = document.getElementById('btn-next');
  const btnSkip  = document.getElementById('btn-skip');

  if (btnBack) btnBack.style.display = step > 0 ? '' : 'none';
  if (btnNext) {
    if (step === JOIN_STEP) btnNext.textContent = isSignedIn ? 'Finish' : 'Finish without joining';
    else btnNext.textContent = 'Next';
  }
  if (btnSkip) btnSkip.style.display = step === JOIN_STEP ? 'none' : '';
}

// ── Skin Grid ──

async function populateSkins() {
  const grid = document.getElementById('skin-grid');
  const catBar = document.getElementById('skin-cat-bar');
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke || !grid) return;

  let raw;
  try {
    raw = await invoke('list_skins');
  } catch (e) {
    console.error('Failed to list skins:', e);
    grid.innerHTML = '<div class="skin-grid-placeholder">Could not load skins.</div>';
    return;
  }

  if (!raw || raw.length === 0) {
    grid.innerHTML = '<div class="skin-grid-placeholder">No skins found.</div>';
    return;
  }

  // list_skins returns [{ slug, isDefault, name, galleryId }, ...] — normalize
  // to plain { slug, name } so the rest of the code can stay simple.
  const skins = raw.map(s => (typeof s === 'string') ? { slug: s } : s).filter(s => s && s.slug);

  // Category filter bar
  const presentCats = new Set(skins.map(s => SKIN_TONE_CATEGORIES[s.slug] || 'none'));
  if (catBar) {
    catBar.innerHTML = '';
    const mkBtn = (label, cat, isActive) => {
      const btn = document.createElement('button');
      btn.className = 'skin-cat' + (isActive ? ' active' : '');
      btn.dataset.cat = cat;
      btn.textContent = label;
      return btn;
    };
    catBar.appendChild(mkBtn('All', '', true));
    for (const cat of CATEGORY_ORDER) {
      if (presentCats.has(cat)) catBar.appendChild(mkBtn(CATEGORY_LABELS[cat] || cat, cat, false));
    }
    if (!catBar.dataset.bound) {
      catBar.dataset.bound = '1';
      catBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.skin-cat');
        if (!btn) return;
        catBar.querySelectorAll('.skin-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.dataset.cat;
        grid.querySelectorAll('.skin-card').forEach(card => {
          card.style.display = (!cat || card.dataset.cat === cat) ? '' : 'none';
        });
      });
    }
  }

  // Skin cards
  grid.innerHTML = '';
  for (const entry of skins) {
    const slug = entry.slug;
    const card = document.createElement('div');
    card.className = 'skin-card' + (slug === selectedSkin ? ' selected' : '');
    card.dataset.skin = slug;
    card.dataset.cat = SKIN_TONE_CATEGORIES[slug] || 'none';

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;

    const nameEl = document.createElement('div');
    nameEl.className = 'skin-card-name';
    nameEl.textContent = entry.name || skinVariantLabel(slug);
    nameEl.title = entry.name || formatSkinName(slug);

    card.appendChild(canvas);
    card.appendChild(nameEl);
    card.addEventListener('click', () => {
      selectedSkin = slug;
      grid.querySelectorAll('.skin-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.skin === slug);
      });
      populateSkinTones(slug);
      updateSkinPreview();
    });
    grid.appendChild(card);

    // Load sprite thumbnail
    invoke('read_skin', { name: slug })
      .then(b64 => drawSkinFrame(canvas, b64))
      .catch(() => {});

    // Load metadata for display name / author
    invoke('read_skin_anim', { name: slug })
      .then(json => {
        if (!json) return;
        try {
          const meta = JSON.parse(json);
          if (meta.name) { nameEl.textContent = meta.name; nameEl.title = meta.name; }
          if (meta.author) {
            const authorEl = document.createElement('div');
            authorEl.className = 'skin-card-author';
            authorEl.textContent = `@${meta.author}`;
            card.appendChild(authorEl);
          }
        } catch {}
      })
      .catch(() => {});
  }
}

function populateSkinTones(skinName) {
  const select = document.getElementById('sel-skin-tone');
  const row = document.getElementById('skin-tone-row');
  const presets = getPresetsForSkin(skinName);

  if (!presets) {
    if (row) row.style.display = 'none';
    select.innerHTML = '';
    selectedSkinTone = '';
    return;
  }

  if (row) row.style.display = '';
  select.innerHTML = '';

  for (const [key, preset] of Object.entries(presets)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = preset.label;
    select.appendChild(opt);
  }

  // Use existing tone if compatible, otherwise default
  const defaultTone = getDefaultTone(skinName);
  if (select.querySelector(`option[value="${selectedSkinTone}"]`)) {
    select.value = selectedSkinTone;
  } else {
    select.value = defaultTone || Object.keys(presets)[0];
    selectedSkinTone = select.value;
  }

  select.onchange = () => { selectedSkinTone = select.value; updateSkinPreview(); };
}

// ── Skin Preview Update ──

// Dr. Vibe on the desktop demonstrates each choice live.
function previewOnDesktop(changes) {
  try {
    return window.__TAURI__?.event?.emitTo?.('main', 'settings-saved', changes)?.catch?.(() => {});
  } catch { /* main window not ready */ }
}

// What Dr. Vibe looked like before the wizard previewed anything; restored
// when the wizard is skipped or closed without finishing.
let previewSnapshot = null;

async function snapshotPreviewedSettings() {
  const saved = (await readSection('settings')) || {};
  previewSnapshot = {};
  for (const key of ['selectedSkin', 'selectedSkinTone', 'characterScale']) {
    previewSnapshot[key] = saved[key] ?? DEFAULT_SETTINGS[key];
  }
}

function updateSkinPreview() {
  // Update animated preview
  skinPreview.load(selectedSkin, selectedSkinTone);
  previewOnDesktop({ selectedSkin, selectedSkinTone });
  // Update name label
  const nameEl = document.getElementById('skin-preview-name');
  if (nameEl) nameEl.textContent = formatSkinName(selectedSkin);
  // Try to load the display name from metadata
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    invoke('read_skin_anim', { name: selectedSkin })
      .then(json => {
        if (!json) return;
        try {
          const meta = JSON.parse(json);
          if (meta.name && nameEl) nameEl.textContent = meta.name;
        } catch {}
      })
      .catch(() => {});
  }
}

// ── Voice Preset ──

function populateVoicePresets() {
  const select = document.getElementById('sel-voice');
  if (!select) return;
  select.innerHTML = '';
  for (const [key, preset] of Object.entries(VOICE_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = preset.label;
    select.appendChild(opt);
  }
  select.value = selectedVoice;
  select.onchange = () => { selectedVoice = select.value; };
}

// ── Coding Apps ──

function renderCodingApps() {
  const grid = document.getElementById('coding-apps-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const app of DEFAULT_CODING_APPS) {
    const label = document.createElement('label');
    label.className = 'coding-app-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = codingApps.includes(app);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!codingApps.includes(app)) codingApps.push(app);
      } else {
        codingApps = codingApps.filter(a => a !== app);
      }
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(app));
    grid.appendChild(label);
  }
}

function renderCustomApps() {
  const list = document.getElementById('custom-apps-list');
  if (!list) return;
  list.innerHTML = '';
  for (const app of customApps) {
    const tag = document.createElement('span');
    tag.className = 'custom-app-tag';
    tag.textContent = app;
    const btn = document.createElement('button');
    btn.textContent = '\u00d7';
    btn.addEventListener('click', () => {
      customApps = customApps.filter(a => a !== app);
      codingApps = codingApps.filter(a => a !== app);
      renderCustomApps();
    });
    tag.appendChild(btn);
    list.appendChild(tag);
  }
}

function addCustomApp() {
  const input = document.getElementById('input-custom-app');
  const name = input.value.trim();
  if (name && !codingApps.includes(name)) {
    customApps.push(name);
    codingApps.push(name);
    renderCustomApps();
  }
  input.value = '';
}

// ── Project Folders ──

function renderProjectFolders() {
  const container = document.getElementById('project-folders-list');
  if (!container) return;

  if (projectFolders.length === 0) {
    container.innerHTML = '<div class="project-folders-empty">No folders added yet.</div>';
    return;
  }

  container.innerHTML = '';
  for (const folder of projectFolders) {
    const tag = document.createElement('div');
    tag.className = 'project-folder-tag';

    const header = document.createElement('div');
    header.className = 'project-folder-header';
    const span = document.createElement('span');
    span.textContent = folder;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', () => {
      projectFolders = projectFolders.filter(f => f !== folder);
      folderRepoCache.delete(folder);
      renderProjectFolders();
    });
    header.appendChild(span);
    header.appendChild(removeBtn);
    tag.appendChild(header);

    // Show scanned repos
    const repos = folderRepoCache.get(folder);
    const repoArea = document.createElement('div');
    repoArea.className = 'project-folder-repos';
    if (repos === undefined) {
      repoArea.innerHTML = '<div class="project-folder-scanning">Scanning...</div>';
    } else if (repos.length === 0) {
      repoArea.innerHTML = '<div class="project-folder-none">No git repos found</div>';
    } else {
      for (const repo of repos) {
        const el = document.createElement('div');
        el.className = 'project-folder-repo';
        el.textContent = repo.name || repo.root;
        repoArea.appendChild(el);
      }
    }
    tag.appendChild(repoArea);
    container.appendChild(tag);
  }
}

async function addProjectFolder() {
  const input = document.getElementById('input-folder-path');
  if (!input) return;
  const folderPath = input.value.trim();
  input.value = '';

  if (!folderPath || projectFolders.includes(folderPath)) return;

  projectFolders.push(folderPath);
  folderRepoCache.set(folderPath, undefined); // scanning state
  renderProjectFolders();

  // Scan for repos
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) {
      // The folder's own repo, or the repos directly inside it
      const repos = await invoke('find_folder_repos', { folder: folderPath });
      folderRepoCache.set(folderPath, repos || []);
    } else {
      folderRepoCache.set(folderPath, []);
    }
  } catch {
    folderRepoCache.set(folderPath, []);
  }
  renderProjectFolders();
}

// ── Break Mode ──

function initBreakModeCards() {
  document.querySelectorAll('.break-mode-card').forEach(card => {
    card.addEventListener('click', () => {
      breakMode = card.dataset.mode;
      document.querySelectorAll('.break-mode-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.mode === breakMode);
      });
    });
  });
}

// ── Welcome character ──

async function loadWelcomeCharacter() {
  await welcomePreview.load(selectedSkin, selectedSkinTone);
}

// ── Join the community (optional, last step) ──

function renderSigninState() {
  const outBox  = document.getElementById('join-out');
  const inBox   = document.getElementById('join-in');
  const userEl  = document.getElementById('join-username');
  const waiting = document.getElementById('join-waiting');

  if (isSignedIn) {
    if (outBox) outBox.style.display = 'none';
    if (inBox)  inBox.style.display  = 'flex';
    if (userEl) userEl.textContent   = '@' + (signinUsername || 'you');
  } else {
    if (outBox) outBox.style.display = 'flex';
    if (inBox)  inBox.style.display  = 'none';
    if (waiting) waiting.style.display = 'none';
  }
  const syncBox = document.getElementById('join-sync-choice');
  if (syncBox) syncBox.style.display = isSignedIn ? '' : 'none';
  updateFooterForStep(currentStep);
}

// ── Privacy steps ──

/** The privacy section values the wizard shows (send choices of store 'privacy'). */
function privacyValues() {
  return buildPrivacyBody(Object.fromEntries(
    [...SEND_CHOICES, ...WHO_CHOICES].filter(c => c.store === 'privacy').map(c => [c.key, choices[c.key]]),
  ));
}

function sendPrivacyChoices() {
  try {
    // force: the whole body goes out as an explicit choice, defaults included.
    window.__TAURI__?.event?.emitTo?.('main', 'privacy-changed', { ...privacyValues(), force: true })?.catch?.(() => {});
    privacySentEarly = true;
  } catch { /* main window not ready */ }
}

function watchDisabled(c, values) {
  if (c.needsClaude && !claudePresent) return true;
  return !!c.requires && !values[c.requires];
}

function initPrivacySteps() {
  const watch = WATCH_CHOICES.filter(c => !c.needsClaude || claudePresent);
  updateWatchChoices = renderChoices(document.getElementById('watch-choices'), watch, choices, (key, value) => {
    choices[key] = value;
    // Turning Claude Code on offers its repos too; off switches them off.
    if (key === 'claudeCodeHooksEnabled') choices.trackClaudeRepos = value;
    updateWatchChoices(choices);
  }, { variant: 'wizard', disabled: watchDisabled });
  updateSendChoices = renderChoices(document.getElementById('send-choices'), SEND_CHOICES, choices, (key, value) => {
    choices[key] = value;
  }, { variant: 'wizard' });
  renderChoices(document.getElementById('who-choices'), WHO_CHOICES, choices, (key, value) => {
    choices[key] = value;
  }, { variant: 'wizard' });
  updateSyncChoice = renderChoices(document.getElementById('join-sync-choice'), [SYNC_CHOICE], choices, (key, value) => {
    choices[key] = value;
  }, { variant: 'wizard' });

  document.getElementById('btn-sends-details')?.addEventListener('click', (e) => {
    const box = document.getElementById('sends-details');
    if (!box) return;
    const open = box.style.display === 'none';
    if (open) renderWhatDrVibeSees(box, { linked: isSignedIn });
    box.style.display = open ? '' : 'none';
    e.target.textContent = open ? 'Hide details' : 'See details';
  });
  document.getElementById('btn-join-outbox')?.addEventListener('click', requestOutbox);
  window.__TAURI__?.event?.listen?.('outbox-data', (e) => {
    const pre = document.getElementById('join-outbox');
    if (!pre || e?.payload?.for !== 'setup-wizard') return;
    pre.style.display = '';
    pre.textContent = JSON.stringify(e.payload.sync ?? { note: 'Not available in browser mode.' }, shortenLong, 2);
  })?.catch?.(() => {});
}

/** Long strings (a custom sprite) are shortened for reading. */
function shortenLong(_k, val) {
  return typeof val === 'string' && val.length > 200 ? `${val.slice(0, 60)}… (${val.length - 60} more characters)` : val;
}

function requestOutbox() {
  // The main window builds it with the same code as the real sync.
  sendPrivacyChoices();
  const pre = document.getElementById('join-outbox');
  if (pre) { pre.style.display = ''; pre.textContent = 'Building…'; }
  setTimeout(() => {
    window.__TAURI__?.event?.emitTo?.('main', 'outbox-request', { for: 'setup-wizard' })?.catch?.(() => {});
  }, 300);
}

/** "What you chose to send", with a Change link back to the step. */
function renderJoinSummary() {
  const el = document.getElementById('join-summary');
  if (!el) return;
  const line = (list) => list.map(c => `${c.label}: <b>${describeValue(c, choices[c.key])}</b>`).join('<br>');
  el.innerHTML = `<div class="join-summary-cols">`
    + `<div>${line(SEND_CHOICES)}<br><button class="link-btn" id="btn-join-change" type="button">Change what is sent</button></div>`
    + `<div>${line(WHO_CHOICES)}<br><button class="link-btn" id="btn-join-change-who" type="button">Change who can see it</button></div>`
    + `</div>`;
  document.getElementById('btn-join-change')?.addEventListener('click', () => goToStep(SEND_STEP));
  document.getElementById('btn-join-change-who')?.addEventListener('click', () => goToStep(WHO_STEP));
}

async function checkProfileSignedIn() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return false;
    const profile = await invoke('get_profile') || {};
    if (profile.linked) {
      isSignedIn = true;
      signinUsername = profile.username || null;
      return true;
    }
  } catch (e) {
    console.warn('[setup-wizard] get_profile failed:', e);
  }
  return false;
}

function startSigninPolling() {
  if (signinPollTimer) return;
  // Backstop in case the account-linked event doesn't reach this window
  // (e.g. Tauri event delivered before the listener was attached).
  signinPollTimer = setInterval(async () => {
    if (isSignedIn) { stopSigninPolling(); return; }
    const ok = await checkProfileSignedIn();
    if (ok) {
      renderSigninState();
      stopSigninPolling();
    }
  }, 1500);
}

function stopSigninPolling() {
  if (signinPollTimer) {
    clearInterval(signinPollTimer);
    signinPollTimer = null;
  }
}

async function startSignin(provider) {
  const errEl     = document.getElementById('join-error');
  const waitingEl = document.getElementById('join-waiting');
  if (errEl)     { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (waitingEl) waitingEl.style.display = 'block';

  try {
    // Rust opens /connect with a PKCE challenge; the site sends the browser
    // back to dr-vibe://auth/callback and Rust finishes the link.
    await window.__TAURI__.core.invoke('start_device_link', { provider });
    startSigninPolling();
  } catch (e) {
    console.error('[setup-wizard] sign-in launch failed:', e);
    if (errEl) {
      errEl.textContent = 'Could not open the browser. You can join later from Settings → Account and community.';
      errEl.style.display = 'block';
    }
    if (waitingEl) waitingEl.style.display = 'none';
  }
}

function bindSigninListener() {
  // Rust emits 'account-linked' to all windows after exchanging the code
  // from dr-vibe://auth/callback. We just need to flip our local state.
  if (!window.__TAURI__?.event) return;
  window.__TAURI__.event.listen('account-linked', (event) => {
    isSignedIn = true;
    signinUsername = event.payload?.username || null;
    renderSigninState();
    stopSigninPolling();
  }).catch(e => console.warn('[setup-wizard] event.listen failed:', e));
  window.__TAURI__.event.listen('account-link-error', (event) => {
    const errEl = document.getElementById('join-error');
    const waitingEl = document.getElementById('join-waiting');
    if (waitingEl) waitingEl.style.display = 'none';
    if (errEl) {
      errEl.textContent = event.payload?.message || 'Linking did not work. Try again.';
      errEl.style.display = 'block';
    }
    stopSigninPolling();
  }).catch(() => {});
}

// ── Save & Complete ──

async function finishWizard() {
  // Merge wizard choices into existing settings
  const existing = (await readSection('settings')) || {};

  const merged = {
    ...existing,
    // Privacy choices (steps 4 and 6, and Sync on the Join step)
    gitTrackingEnabled: choices.gitTrackingEnabled,
    claudeCodeHooksEnabled: claudePresent && choices.claudeCodeHooksEnabled,
    trackClaudeRepos: claudePresent && choices.claudeCodeHooksEnabled && choices.trackClaudeRepos,
    hideWhenPresenting: choices.hideWhenPresenting,
    shareWeeklyRecap: choices.shareWeeklyRecap,
    syncEnabled: choices.syncEnabled,
    selectedSkin,
    selectedSkinTone,
    characterScale,
    soundTalkVoice: selectedVoice,
    soundVolume,
    codingApps: [...codingApps],
    projectFolders: [...projectFolders],
    hydrationEnabled,
    hydrationFrequency,
    eyeStrainEnabled,
    postureReminderEnabled,
    postureFrequency,
    overworkPreventionEnabled,
    breakMode,
    // Joined, or asked never to be asked again: no more join invites.
    communityInviteDismissed: isSignedIn || neverAskToJoin || existing.communityInviteDismissed === true,
  };

  // Write settings
  await writeSection('settings', merged);

  // Mark setup complete
  await writeSection('setupWizard', { completed: true });

  // Crash reports: Rust owns the switch. Flushing waits for setup to complete.
  try {
    await window.__TAURI__?.core?.invoke?.('error_reports_set_enabled', { enabled: !!choices.errorReports });
  } catch (e) {
    console.log('Could not set crash reports:', e);
  }

  // Notify main window: settings, then the privacy body as an explicit
  // choice, then completion (main installs hooks and syncs only now).
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'settings-saved', merged);
    await emitTo('main', 'privacy-changed', { ...privacyValues(), force: true });
    await emitTo('main', 'setup-wizard-completed', { completed: true });
  } catch (e) {
    console.log('Could not notify main window:', e);
  }

  // Close wizard window
  closeWindow();
}

async function skipWizard() {
  // Mark setup complete without changing any settings, and undo the live preview
  if (previewSnapshot) await previewOnDesktop(previewSnapshot);
  // Choices handed over early go back to what they were (defaults on a first run).
  if (privacySentEarly && privacyBefore) {
    try {
      await window.__TAURI__?.event?.emitTo?.('main', 'privacy-changed', { ...privacyBefore });
    } catch { /* main window gone */ }
  }
  await writeSection('setupWizard', { completed: true });

  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'setup-wizard-completed', { completed: true });
  } catch {}

  closeWindow();
}

// Set once finish or skip has run, so the close they ask for goes through.
let closingForGood = false;

function closeWindow() {
  closingForGood = true;
  try {
    const win = window.__TAURI__?.window?.getCurrentWindow();
    if (win) { win.close(); return; }
  } catch {}
  window.close();
}

// ── Load existing settings (if any) ──

async function loadExistingSettings() {
  // "Run setup again" shows the current privacy choices.
  const privacy = buildPrivacyBody({ ...PRIVACY_DEFAULTS, ...((await readSection('privacy'))?.settings || {}) });
  privacyBefore = privacy;
  errorReportsBefore = await window.__TAURI__?.core?.invoke?.('error_reports_get_enabled').then(v => v === true).catch(() => false) ?? false;
  claudePresent = await window.__TAURI__?.core?.invoke?.('claude_code_present').then(v => v === true).catch(() => false) ?? false;
  const saved = await readSection('settings');
  choices = wizardDefaults({ settings: saved || {}, privacy, errorReports: errorReportsBefore });
  if (!saved) return;

  if (saved.selectedSkin) selectedSkin = saved.selectedSkin;
  if (saved.selectedSkinTone) selectedSkinTone = saved.selectedSkinTone;
  if (saved.characterScale) characterScale = saved.characterScale;
  if (saved.soundTalkVoice) selectedVoice = saved.soundTalkVoice;
  if (saved.soundVolume !== undefined) soundVolume = saved.soundVolume;
  if (saved.codingApps) {
    codingApps = [...saved.codingApps];
    // Detect custom apps (any app not in the default list)
    customApps = codingApps.filter(a => !DEFAULT_CODING_APPS.includes(a));
  }
  if (saved.projectFolders) projectFolders = [...saved.projectFolders];
  if (saved.hydrationEnabled !== undefined) hydrationEnabled = saved.hydrationEnabled;
  if (saved.hydrationFrequency) hydrationFrequency = saved.hydrationFrequency;
  if (saved.eyeStrainEnabled !== undefined) eyeStrainEnabled = saved.eyeStrainEnabled;
  if (saved.postureReminderEnabled !== undefined) postureReminderEnabled = saved.postureReminderEnabled;
  if (saved.postureFrequency) postureFrequency = saved.postureFrequency;
  if (saved.overworkPreventionEnabled !== undefined) overworkPreventionEnabled = saved.overworkPreventionEnabled;
  if (saved.breakMode) breakMode = saved.breakMode;
}

// ── Bind wellness UI to state ──

function syncWellnessUI() {
  const chkHydration = document.getElementById('chk-hydration');
  const selHydrationFreq = document.getElementById('sel-hydration-freq');
  const chkEyestrain = document.getElementById('chk-eyestrain');
  const chkPosture = document.getElementById('chk-posture');
  const selPostureFreq = document.getElementById('sel-posture-freq');
  const chkOverwork = document.getElementById('chk-overwork');

  if (chkHydration) { chkHydration.checked = hydrationEnabled; chkHydration.onchange = () => { hydrationEnabled = chkHydration.checked; }; }
  if (selHydrationFreq) { selHydrationFreq.value = String(hydrationFrequency); selHydrationFreq.onchange = () => { hydrationFrequency = parseInt(selHydrationFreq.value); }; }
  if (chkEyestrain) { chkEyestrain.checked = eyeStrainEnabled; chkEyestrain.onchange = () => { eyeStrainEnabled = chkEyestrain.checked; }; }
  if (chkPosture) { chkPosture.checked = postureReminderEnabled; chkPosture.onchange = () => { postureReminderEnabled = chkPosture.checked; }; }
  if (selPostureFreq) { selPostureFreq.value = String(postureFrequency); selPostureFreq.onchange = () => { postureFrequency = parseInt(selPostureFreq.value); }; }
  if (chkOverwork) { chkOverwork.checked = overworkPreventionEnabled; chkOverwork.onchange = () => { overworkPreventionEnabled = chkOverwork.checked; }; }

  // Break mode cards
  document.querySelectorAll('.break-mode-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.mode === breakMode);
  });
}

// ── Init ──

// Wire navigation/control handlers FIRST so the wizard is always usable —
// even if data loading hangs or throws (Tauri not ready, missing skin assets, etc.)
function bindControls() {
  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (currentStep === TOTAL_STEPS - 1) {
      finishWizard();
    } else {
      goToStep(currentStep + 1);
    }
  });

  document.getElementById('btn-back')?.addEventListener('click', () => {
    goToStep(currentStep - 1);
  });

  document.getElementById('btn-skip')?.addEventListener('click', () => {
    skipWizard();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => {
    skipWizard();
  });

  // Join the community (optional last step)
  for (const id of ['btn-join-github', 'btn-join-discord']) {
    const btn = document.getElementById(id);
    btn?.addEventListener('click', () => startSignin(btn.dataset.provider));
  }
  document.getElementById('chk-never-ask')?.addEventListener('change', (e) => {
    neverAskToJoin = e.target.checked;
  });
  document.getElementById('link-privacy')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const { WEB_BASE } = await import('./core/config.js');
    openUrl(`${WEB_BASE}${WebRoutes.privacy()}`);
  });
  document.getElementById('link-terms')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const { WEB_BASE } = await import('./core/config.js');
    openUrl(`${WEB_BASE}${WebRoutes.terms()}`);
  });

  // Voice preview
  document.getElementById('btn-voice-preview')?.addEventListener('click', () => {
    soundPreview.previewVoice(selectedVoice, soundVolume);
  });

  // Add custom coding app
  document.getElementById('btn-add-app')?.addEventListener('click', addCustomApp);
  document.getElementById('input-custom-app')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomApp(); }
  });

  // Add project folder
  document.getElementById('btn-add-folder')?.addEventListener('click', addProjectFolder);
  document.getElementById('input-folder-path')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addProjectFolder(); }
  });
  document.getElementById('btn-browse-folder')?.addEventListener('click', async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    const selected = await invoke('pick_folder').catch(() => null);
    if (!selected) return;
    const input = document.getElementById('input-folder-path');
    if (input) input.value = selected;
    await addProjectFolder();
  });

  // Keyboard: Escape closes the wizard at any step
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    skipWizard();
  });

  // Re-check profile when the wizard regains focus (user returns from browser)
  window.addEventListener('focus', () => {
    if (isSignedIn) return;
    checkProfileSignedIn().then(ok => { if (ok) renderSigninState(); });
  });

  // Closing the window any other way (Alt+F4, the taskbar) is a skip too.
  try {
    window.__TAURI__?.window?.getCurrentWindow?.()?.onCloseRequested?.((e) => {
      if (closingForGood) return;
      e.preventDefault();
      skipWizard();
    })?.catch?.(() => {});
  } catch { /* not in Tauri */ }

  // Titlebar drag
  const titlebar = document.querySelector('.titlebar');
  if (titlebar) {
    titlebar.addEventListener('mousedown', async (e) => {
      if (e.target.closest('.titlebar-controls')) return;
      try {
        const win = window.__TAURI__?.window?.getCurrentWindow();
        if (win) await win.startDragging();
      } catch {}
    });
  }
}

// Wrap each setup phase in its own try/catch so one failure can't take
// down the rest of the wizard or leave the user staring at a frozen page.
async function safe(label, fn) {
  try { await fn(); }
  catch (e) { console.error(`[setup-wizard] ${label} failed:`, e); }
}

async function init() {
  bindControls();

  updateFooterForStep(0);

  await safe('snapshot', snapshotPreviewedSettings);
  await safe('loadExistingSettings', loadExistingSettings);

  // Step 1: Meet Dr. Vibe (animated idle)
  await safe('welcomePreview', async () => {
    welcomePreview.init();
    loadWelcomeCharacter();
  });

  // Join step. Bind the Tauri event listener early so we
  // never miss the auth callback; an install that is already linked shows it.
  await safe('join-init', async () => {
    bindSigninListener();
    await checkProfileSignedIn();
    renderSigninState();
  });

  // Step 2: Appearance
  await safe('appearance', async () => {
    skinPreview.init();
    await populateSkins();
    populateSkinTones(selectedSkin);
    updateSkinPreview();

    const scaleSlider = document.getElementById('slider-scale');
    const scaleLabel = document.getElementById('scale-label');
    if (scaleSlider) {
      scaleSlider.value = characterScale;
      scaleLabel.textContent = characterScale + '%';
      scaleSlider.oninput = () => {
        characterScale = parseInt(scaleSlider.value);
        scaleLabel.textContent = characterScale + '%';
        previewOnDesktop({ characterScale });
      };
    }

    populateVoicePresets();
  });

  // Step 3: Coding setup
  await safe('coding', async () => {
    renderCodingApps();
    renderCustomApps();
    renderProjectFolders();
  });

  // Step 5: Wellness
  await safe('wellness', async () => {
    syncWellnessUI();
    initBreakModeCards();
  });

  // Steps 4, 6, 7 and the Join step's Sync switch
  await safe('privacy', async () => {
    initPrivacySteps();
  });
}

init().catch(e => console.error('Setup wizard init failed:', e));
