// Dr. Vibe - Standalone Settings Page
// Reads/writes settings via unified database and notifies the main window on save.

import { readSection, writeSection } from './core/DatabaseReader.js';
import { getPresetsForSkin, getDefaultTone, getToneCategory } from './config/skinTones.js';

// --- Voice presets (shared between preview and SoundManager via same definitions) ---
// Each preset: { baseFreq, freqRange, syllableMs, gapMs, waves, filterFreq, filterQ, formants, vibrato, count }
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
    formants: [262, 330, 392, 440, 523],  // C4 E4 G4 A4 C5
    vibrato: 0, vibratoDepth: 0,
  },
};

// --- Sound Preview (self-contained, runs in the settings window) ---
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

  // Play a sample reaction sound (excited chirp + celebrating arpeggio)
  previewReaction(volume) {
    this._ensure(volume);
    const ctx = this.ctx;
    const dest = this.gain;
    const now = ctx.currentTime;

    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'square';
    o1.frequency.setValueAtTime(440, now);
    o1.frequency.linearRampToValueAtTime(660, now + 0.08);
    g1.gain.setValueAtTime(0.25, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    o1.connect(g1); g1.connect(dest);
    o1.start(now); o1.stop(now + 0.12);

    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      const t = now + 0.2 + i * 0.07;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + 0.1);
    });
  },

  // Play a voice style preview using a preset name
  previewVoice(voiceName, volume) {
    this._ensure(volume);
    const preset = VOICE_PRESETS[voiceName] || VOICE_PRESETS.mumble;
    _playVoicePreset(this.ctx, this.gain, preset, 'Hello there!');
  },
};

// Shared voice generator used by both preview and SoundManager
function _playVoicePreset(ctx, dest, preset, text) {
  const now = ctx.currentTime;
  const syllableDuration = preset.syllableMs / 1000;
  const gap = preset.gapMs / 1000;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = preset.filterFreq;
  filter.Q.value = preset.filterQ;
  filter.connect(dest);

  // Seeded random from text
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

    // Formant-based frequency
    const formantShift = preset.formants[i % preset.formants.length] / 500;
    const freq = preset.baseFreq * formantShift + rand() * preset.freqRange * 0.5;
    const start = now + i * (syllableDuration + gap);

    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    // Two-phase pitch contour
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, freq + (rand() - 0.5) * preset.bendAmount),
      start + syllableDuration * 0.7
    );
    osc.frequency.linearRampToValueAtTime(
      Math.max(20, freq * (0.9 + rand() * 0.2)),
      start + syllableDuration
    );

    // Vibrato (LFO on frequency)
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

    // Smooth envelope
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

const SETTING_KEYS = [
  'workInterval', 'breakInterval', 'notificationsEnabled', 'boundaryAwarenessEnabled',
  'breakMode', 'idleThresholdMinutes', 'longBreakInterval', 'longBreakMinutes',
  'focusModeDuration', 'encouragementEnabled', 'encouragementFrequency',
  'resumeSuggestionsEnabled', 'learningResourcesEnabled', 'eyeStrainEnabled',
  'postureReminderEnabled', 'postureFrequency', 'overworkPreventionEnabled',
  'fatigueDetectionEnabled', 'stuckDetectionEnabled',
  'hydrationEnabled', 'hydrationFrequency',
  'notificationPosition', 'notifyBreaks', 'notifyHydration', 'notifyPosture',
  'notifyEyeStrain', 'notifyFatigue', 'notifyStuck', 'notifyOverwork',
  'notifyAchievements', 'notifyBoundary', 'popupDuration',
  'clickThroughGhostEnabled', 'selectedSkin', 'selectedSkinTone',
  'walkingEnabled', 'walkingBoundLeftPercent', 'walkingBoundRightPercent',
  'codingApps', 'soundReactionsEnabled', 'soundTalkEnabled',
  'soundVolume', 'soundTalkVoice',
];

// --- Coding Apps management ---
let currentCodingApps = [];

// --- Element references ---
const els = {
  workInterval: () => document.getElementById('work-interval'),
  breakInterval: () => document.getElementById('break-interval'),
  notifications: () => document.getElementById('notifications'),
  boundaryAwareness: () => document.getElementById('boundary-awareness'),
  breakMode: () => document.getElementById('break-mode'),
  idleThreshold: () => document.getElementById('idle-threshold'),
  idleThresholdRow: () => document.getElementById('idle-threshold-row'),
  longBreakInterval: () => document.getElementById('long-break-interval'),
  longBreakMinutes: () => document.getElementById('long-break-minutes'),
  focusDuration: () => document.getElementById('focus-duration'),
  encouragementEnabled: () => document.getElementById('encouragement-enabled'),
  encouragementFrequency: () => document.getElementById('encouragement-frequency'),
  encouragementFrequencyRow: () => document.getElementById('encouragement-frequency-row'),
  resumeSuggestions: () => document.getElementById('resume-suggestions'),
  learningResources: () => document.getElementById('learning-resources'),
  eyeStrainEnabled: () => document.getElementById('eye-strain-enabled'),
  postureEnabled: () => document.getElementById('posture-enabled'),
  postureFrequency: () => document.getElementById('posture-frequency'),
  postureFrequencyRow: () => document.getElementById('posture-frequency-row'),
  fatigueDetection: () => document.getElementById('fatigue-detection'),
  stuckDetection: () => document.getElementById('stuck-detection'),
  overworkPrevention: () => document.getElementById('overwork-prevention'),
  hydrationEnabled: () => document.getElementById('hydration-enabled'),
  hydrationFrequency: () => document.getElementById('hydration-frequency'),
  notificationPosition: () => document.getElementById('notification-position'),
  notifyBreaks: () => document.getElementById('notify-breaks'),
  notifyHydration: () => document.getElementById('notify-hydration'),
  notifyPosture: () => document.getElementById('notify-posture'),
  notifyEyeStrain: () => document.getElementById('notify-eyestrain'),
  notifyFatigue: () => document.getElementById('notify-fatigue'),
  notifyStuck: () => document.getElementById('notify-stuck'),
  notifyOverwork: () => document.getElementById('notify-overwork'),
  notifyAchievements: () => document.getElementById('notify-achievements'),
  notifyBoundary: () => document.getElementById('notify-boundary'),
  popupDuration: () => document.getElementById('popup-duration'),
  selectedSkin: () => document.getElementById('selected-skin'),
  skinTone: () => document.getElementById('skin-tone'),
  skinToneRow: () => document.getElementById('skin-tone-row'),
  clickThroughGhost: () => document.getElementById('click-through-ghost'),
  walkingEnabled: () => document.getElementById('walking-enabled'),
  walkingBoundLeft: () => document.getElementById('walking-bound-left'),
  walkingBoundLeftRow: () => document.getElementById('walking-bound-left-row'),
  walkingBoundRight: () => document.getElementById('walking-bound-right'),
  walkingBoundRightRow: () => document.getElementById('walking-bound-right-row'),
  soundReactionsEnabled: () => document.getElementById('sound-reactions-enabled'),
  soundTalkEnabled: () => document.getElementById('sound-talk-enabled'),
  soundVolume: () => document.getElementById('sound-volume'),
  soundVolumeRow: () => document.getElementById('sound-volume-row'),
  soundTalkVoice: () => document.getElementById('sound-talk-voice'),
  soundTalkVoiceRow: () => document.getElementById('sound-talk-voice-row'),
};

// --- Format a skin filename into a display name ---
// "dr-vibe-default" → "Dr Vibe Default"
function formatSkinName(filename) {
  return filename
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --- Populate the skins dropdown from actual files on disk ---
async function populateSkins() {
  const select = els.selectedSkin();
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) {
      console.warn('Tauri invoke not available, cannot list skins');
      return;
    }
    const skins = await invoke('list_skins');
    select.innerHTML = '';
    if (!skins || skins.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no skins found)';
      select.appendChild(opt);
      return;
    }
    for (const skin of skins) {
      const opt = document.createElement('option');
      opt.value = skin;
      opt.textContent = formatSkinName(skin);
      select.appendChild(opt);
    }
  } catch (e) {
    console.error('Failed to list skins:', e);
  }
}

// --- Populate the skin tone dropdown based on the selected skin ---
function populateSkinTones(skinName, savedTone) {
  const select = els.skinTone();
  const row = els.skinToneRow();
  const presets = getPresetsForSkin(skinName);

  if (!presets) {
    // No tone options for this skin — hide the row
    if (row) row.style.display = 'none';
    select.innerHTML = '';
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

  // Set the saved value, or fall back to category default
  const defaultTone = getDefaultTone(skinName);
  if (savedTone && presets[savedTone]) {
    select.value = savedTone;
  } else if (defaultTone) {
    select.value = defaultTone;
  }
}

function renderCodingApps() {
  const container = document.getElementById('coding-apps-list');
  container.innerHTML = '';
  for (const app of currentCodingApps) {
    const tag = document.createElement('span');
    tag.className = 'coding-app-tag';
    tag.textContent = app;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '\u00d7';
    removeBtn.title = `Remove ${app}`;
    removeBtn.addEventListener('click', () => {
      currentCodingApps = currentCodingApps.filter(a => a !== app);
      renderCodingApps();
      debouncedSave();
    });
    tag.appendChild(removeBtn);
    container.appendChild(tag);
  }
}

function addCodingApp() {
  const input = document.getElementById('coding-app-input');
  const name = input.value.trim();
  if (name && !currentCodingApps.includes(name)) {
    currentCodingApps.push(name);
    renderCodingApps();
  }
  input.value = '';
}

// --- Load settings from store into form ---
async function loadSettings() {
  // Populate the skins dropdown before loading saved values
  await populateSkins();

  const saved = await readSection('settings');
  if (!saved) {
    console.log('No saved settings found, form will use defaults');
    return;
  }

  const v = (key) => saved[key];

  if (v('workInterval') != null) els.workInterval().value = v('workInterval');
  if (v('breakInterval') != null) els.breakInterval().value = v('breakInterval');
  if (v('notificationsEnabled') != null) els.notifications().checked = v('notificationsEnabled');
  if (v('boundaryAwarenessEnabled') != null) els.boundaryAwareness().checked = v('boundaryAwarenessEnabled');
  if (v('breakMode') != null) els.breakMode().value = v('breakMode');
  if (v('idleThresholdMinutes') != null) els.idleThreshold().value = v('idleThresholdMinutes');
  if (v('longBreakInterval') != null) els.longBreakInterval().value = v('longBreakInterval');
  if (v('longBreakMinutes') != null) els.longBreakMinutes().value = v('longBreakMinutes');
  if (v('focusModeDuration') != null) els.focusDuration().value = v('focusModeDuration');
  if (v('encouragementEnabled') != null) els.encouragementEnabled().checked = v('encouragementEnabled');
  if (v('encouragementFrequency') != null) els.encouragementFrequency().value = v('encouragementFrequency');
  if (v('resumeSuggestionsEnabled') != null) els.resumeSuggestions().checked = v('resumeSuggestionsEnabled');
  if (v('learningResourcesEnabled') != null) els.learningResources().checked = v('learningResourcesEnabled');
  if (v('eyeStrainEnabled') != null) els.eyeStrainEnabled().checked = v('eyeStrainEnabled');
  if (v('postureReminderEnabled') != null) els.postureEnabled().checked = v('postureReminderEnabled');
  if (v('postureFrequency') != null) els.postureFrequency().value = v('postureFrequency');
  if (v('fatigueDetectionEnabled') != null) els.fatigueDetection().checked = v('fatigueDetectionEnabled');
  if (v('stuckDetectionEnabled') != null) els.stuckDetection().checked = v('stuckDetectionEnabled');
  if (v('overworkPreventionEnabled') != null) els.overworkPrevention().checked = v('overworkPreventionEnabled');
  if (v('hydrationEnabled') != null) els.hydrationEnabled().checked = v('hydrationEnabled');
  if (v('hydrationFrequency') != null) els.hydrationFrequency().value = v('hydrationFrequency');
  if (v('notificationPosition') != null) els.notificationPosition().value = v('notificationPosition');
  if (v('notifyBreaks') != null) els.notifyBreaks().checked = v('notifyBreaks');
  if (v('notifyHydration') != null) els.notifyHydration().checked = v('notifyHydration');
  if (v('notifyPosture') != null) els.notifyPosture().checked = v('notifyPosture');
  if (v('notifyEyeStrain') != null) els.notifyEyeStrain().checked = v('notifyEyeStrain');
  if (v('notifyFatigue') != null) els.notifyFatigue().checked = v('notifyFatigue');
  if (v('notifyStuck') != null) els.notifyStuck().checked = v('notifyStuck');
  if (v('notifyOverwork') != null) els.notifyOverwork().checked = v('notifyOverwork');
  if (v('notifyAchievements') != null) els.notifyAchievements().checked = v('notifyAchievements');
  if (v('notifyBoundary') != null) els.notifyBoundary().checked = v('notifyBoundary');
  if (v('popupDuration') != null) els.popupDuration().value = v('popupDuration');
  if (v('clickThroughGhostEnabled') != null) els.clickThroughGhost().checked = v('clickThroughGhostEnabled');
  if (v('selectedSkin') != null) els.selectedSkin().value = v('selectedSkin');
  populateSkinTones(els.selectedSkin().value, v('selectedSkinTone'));
  if (v('walkingEnabled') != null) els.walkingEnabled().checked = v('walkingEnabled');
  if (v('walkingBoundLeftPercent') != null) els.walkingBoundLeft().value = v('walkingBoundLeftPercent');
  if (v('walkingBoundRightPercent') != null) els.walkingBoundRight().value = v('walkingBoundRightPercent');

  if (v('soundReactionsEnabled') != null) els.soundReactionsEnabled().checked = v('soundReactionsEnabled');
  if (v('soundTalkEnabled') != null) els.soundTalkEnabled().checked = v('soundTalkEnabled');
  if (v('soundVolume') != null) els.soundVolume().value = v('soundVolume');
  if (v('soundTalkVoice') != null) els.soundTalkVoice().value = v('soundTalkVoice');

  if (Array.isArray(v('codingApps'))) {
    currentCodingApps = [...v('codingApps')];
  }
  renderCodingApps();

  updateConditionalRows();
}

// --- Gather current form state ---
function gatherSettings() {
  return {
    workInterval: parseInt(els.workInterval().value) || 2,
    breakInterval: parseInt(els.breakInterval().value) || 1,
    notificationsEnabled: els.notifications().checked,
    boundaryAwarenessEnabled: els.boundaryAwareness().checked,
    breakMode: els.breakMode().value || 'pomodoro',
    idleThresholdMinutes: parseInt(els.idleThreshold().value) || 5,
    longBreakInterval: parseInt(els.longBreakInterval().value) || 4,
    longBreakMinutes: parseInt(els.longBreakMinutes().value) || 15,
    focusModeDuration: parseInt(els.focusDuration().value) || 25,
    encouragementEnabled: els.encouragementEnabled().checked,
    encouragementFrequency: parseInt(els.encouragementFrequency().value) || 60,
    resumeSuggestionsEnabled: els.resumeSuggestions().checked,
    learningResourcesEnabled: els.learningResources().checked,
    eyeStrainEnabled: els.eyeStrainEnabled().checked,
    postureReminderEnabled: els.postureEnabled().checked,
    postureFrequency: parseInt(els.postureFrequency().value) || 30,
    fatigueDetectionEnabled: els.fatigueDetection().checked,
    stuckDetectionEnabled: els.stuckDetection().checked,
    overworkPreventionEnabled: els.overworkPrevention().checked,
    hydrationEnabled: els.hydrationEnabled().checked,
    hydrationFrequency: parseInt(els.hydrationFrequency().value) || 45,
    notificationPosition: els.notificationPosition().value || 'bottom-right',
    notifyBreaks: els.notifyBreaks().checked,
    notifyHydration: els.notifyHydration().checked,
    notifyPosture: els.notifyPosture().checked,
    notifyEyeStrain: els.notifyEyeStrain().checked,
    notifyFatigue: els.notifyFatigue().checked,
    notifyStuck: els.notifyStuck().checked,
    notifyOverwork: els.notifyOverwork().checked,
    notifyAchievements: els.notifyAchievements().checked,
    notifyBoundary: els.notifyBoundary().checked,
    popupDuration: parseInt(els.popupDuration().value) || 20,
    clickThroughGhostEnabled: els.clickThroughGhost().checked,
    selectedSkin: els.selectedSkin().value || 'dr-vibe-default',
    selectedSkinTone: els.skinTone().value || 'medium-light',
    walkingEnabled: els.walkingEnabled().checked,
    walkingBoundLeftPercent: parseInt(els.walkingBoundLeft().value) || 0,
    walkingBoundRightPercent: parseInt(els.walkingBoundRight().value) || 0,
    codingApps: [...currentCodingApps],
    soundReactionsEnabled: els.soundReactionsEnabled().checked,
    soundTalkEnabled: els.soundTalkEnabled().checked,
    soundVolume: parseInt(els.soundVolume().value) || 50,
    soundTalkVoice: els.soundTalkVoice().value || 'mumble',
  };
}

// --- Save settings to store and notify main window ---
async function saveSettings() {
  const data = gatherSettings();

  // Write to unified database
  await writeSection('settings', data);

  // Notify the main window
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'settings-saved', data);
  } catch (e) {
    console.error('Failed to emit settings-saved event:', e);
  }
}

// --- Debounced auto-save (500ms delay) ---
let _saveTimer = null;
function debouncedSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveSettings().catch(e => console.error('Auto-save failed:', e));
  }, 500);
}

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

// --- Conditional row visibility ---
function updateConditionalRows() {
  const idleRow = els.idleThresholdRow();
  if (idleRow) {
    idleRow.style.display = els.breakMode().value === 'smart' ? '' : 'none';
  }

  const postureRow = els.postureFrequencyRow();
  if (postureRow) {
    postureRow.style.display = els.postureEnabled().checked ? '' : 'none';
  }

  const encouragementRow = els.encouragementFrequencyRow();
  if (encouragementRow) {
    encouragementRow.style.display = els.encouragementEnabled().checked ? '' : 'none';
  }

  const walkingBoundLeftRow = els.walkingBoundLeftRow();
  const walkingBoundRightRow = els.walkingBoundRightRow();
  const walkingOn = els.walkingEnabled().checked;
  if (walkingBoundLeftRow) walkingBoundLeftRow.style.display = walkingOn ? '' : 'none';
  if (walkingBoundRightRow) walkingBoundRightRow.style.display = walkingOn ? '' : 'none';

  const anySoundOn = els.soundReactionsEnabled().checked || els.soundTalkEnabled().checked;
  const soundVolumeRow = els.soundVolumeRow();
  if (soundVolumeRow) soundVolumeRow.style.display = anySoundOn ? '' : 'none';

  const talkOn = els.soundTalkEnabled().checked;
  const soundTalkVoiceRow = els.soundTalkVoiceRow();
  if (soundTalkVoiceRow) soundTalkVoiceRow.style.display = talkOn ? '' : 'none';
}

// --- Tab switching ---
function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all
      buttons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      // Activate chosen
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// --- Event listeners ---
function setupListeners() {
  setupTabs();

  document.getElementById('settings-close').addEventListener('click', closeWindow);

  document.getElementById('coding-app-add-btn').addEventListener('click', () => { addCodingApp(); debouncedSave(); });
  document.getElementById('coding-app-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCodingApp(); debouncedSave(); }
  });

  els.breakMode().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.postureEnabled().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.encouragementEnabled().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.walkingEnabled().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.soundReactionsEnabled().addEventListener('change', () => {
    updateConditionalRows();
    debouncedSave();
    if (els.soundReactionsEnabled().checked) {
      soundPreview.previewReaction(parseInt(els.soundVolume().value) || 50);
    }
  });
  els.soundTalkEnabled().addEventListener('change', () => {
    updateConditionalRows();
    debouncedSave();
    if (els.soundTalkEnabled().checked) {
      soundPreview.previewVoice(els.soundTalkVoice().value, parseInt(els.soundVolume().value) || 50);
    }
  });

  // Voice style change → preview
  els.soundTalkVoice().addEventListener('change', () => {
    debouncedSave();
    soundPreview.previewVoice(els.soundTalkVoice().value, parseInt(els.soundVolume().value) || 50);
  });

  // Volume change → preview whichever is active
  els.soundVolume().addEventListener('change', () => {
    debouncedSave();
    if (els.soundTalkEnabled().checked) {
      soundPreview.previewVoice(els.soundTalkVoice().value, parseInt(els.soundVolume().value) || 50);
    } else if (els.soundReactionsEnabled().checked) {
      soundPreview.previewReaction(parseInt(els.soundVolume().value) || 50);
    }
  });

  // When skin changes, update tone dropdown to match the new skin's category
  els.selectedSkin().addEventListener('change', () => {
    const newSkin = els.selectedSkin().value;
    const defaultTone = getDefaultTone(newSkin);
    populateSkinTones(newSkin, defaultTone);
    debouncedSave();
  });

  // Auto-save on any select or checkbox change
  document.querySelectorAll('.tab-body select, .tab-body input[type="checkbox"]').forEach(el => {
    el.addEventListener('change', debouncedSave);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWindow();
  });
}

// --- Init ---
try {
  setupListeners();
  loadSettings().catch(e => console.error('Settings load failed:', e));
} catch (e) {
  console.error('Settings init failed:', e);
}
