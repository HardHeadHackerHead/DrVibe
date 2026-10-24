// Dr. Vibe - Standalone Settings Page
// Reads/writes settings via unified database and notifies the main window on save.

import { openUrl } from './core/openUrl.js';
import { desktopApi } from './core/api/client.js';
import { WebRoutes } from './core/api/endpoints.js';
import { PRIVACY_DEFAULTS } from './core/api/contract.js';
import { renderWhatDrVibeSees } from './ui/WhatDrVibeSees.js';
import { applyClaudeHooksSetting } from './features/activity/claudeHooks.js';
import { setAvatar } from './ui/avatar.js';
import { readSection, writeSection } from './core/DatabaseReader.js';
import { formatSkinName, skinVariantLabel } from './config/skinNames.js';
import { DEFAULT_SETTINGS } from './features/settings/Settings.js';
import { getPresetsForSkin, getDefaultTone, getToneCategory, SKIN_TONE_CATEGORIES } from './config/skinTones.js';
import { WEB_BASE as SITE_URL, IS_DEV, syncWebBaseFromRust } from './core/config.js';
import { getErrorReportsEnabled, installErrorReporter, setErrorReportsEnabled } from './core/errorReporter.js';
import { makeUrl } from './features/make/makeHub.js';
import { formatAgo, visibleRepos, trackedSummary, repoTag } from './ui/foundRepos.js';
import { repoName } from './features/activity/repoPaths.js';

installErrorReporter();

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
  'notificationPosition', 'notifyBreaks', 'notifyAchievements', 'notifyVpEarned', 'notifyTrades', 'popupDuration',
  'clickThroughGhostEnabled', 'selectedSkin', 'selectedSkinTone', 'characterScale',
  'walkingEnabled', 'walkingLockedToScreen', 'walkingBoundLeftPercent', 'walkingBoundRightPercent',
  'codingApps', 'soundReactionsEnabled', 'soundTalkEnabled',
  'soundVolume', 'soundTalkVoice',
  'claudeCodeHooksEnabled', 'gitTrackingEnabled', 'gitCommitNotificationsEnabled', 'gitBranchNotificationsEnabled', 'gitPollIntervalMinutes',
  'gitCommitRemindersEnabled', 'gitReminderThresholdMinutes', 'gitReminderMinChanges',
  'hideWhenPresenting', 'shareWeeklyRecap', 'trackClaudeRepos', 'ignoredRepos',
];

// --- Coding Apps management ---
let currentCodingApps = [];

// --- Project Folders management ---
let currentProjectFolders = [];
// Cache of folder path → array of { name, root, worktree } repos, 'untracked'
// for a place never tracked (undefined = not looked at yet)
const folderRepoCache = new Map();

// --- Tracked repos state ---
let currentIgnoredRepos = [];
let trackedStatus = null; // TrackedRepos.getStatus() from the main window

// --- Account state (set by the dr-vibe://auth-callback deep link) ---
let apiToken       = null;
let discordUsername    = null;
let discordDisplayName = null;
let discordAvatarUrl   = null;

// --- Developer mode state ---
// Debug builds only (IS_DEV): reveals the Developer tab (server switching,
// bulk upload). Release builds never enable it, whatever the saved setting.
let adminMode = false;

// Dev server override state — tracks the value loaded at page open so we
// can detect when the user has changed it and show the "Restart required"
// banner. See the Admin tab in settings.html.
let _initialDevServerOverride = 'auto';

async function loadFolderRepos(folder) {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    const [untracked] = await invoke('untracked_places', { paths: [folder] });
    folderRepoCache.set(folder, untracked ? 'untracked' : (await invoke('find_folder_repos', { folder })) || []);
  } catch {
    folderRepoCache.set(folder, []);
  }
  renderProjectFolders();
}

// --- Developer gate: show/hide developer-only tools (debug builds) ---

function applyAdminGate() {
  if (adminMode) {
    document.body.classList.add('admin-active');
  } else {
    document.body.classList.remove('admin-active');
  }
}

// --- Gallery Account: load / render ----------------------------------------

async function loadAccount() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    let profile = {};
    if (invoke) {
      // Read directly from Tauri Store via Rust (bypasses localStorage isolation)
      profile = await invoke('get_profile') || {};
      console.log('[dr-vibe] loadAccount from store:', profile);
    } else {
      profile = await readSection('profile') || {};
    }
    // `linked` only: the device token itself never leaves Rust.
    apiToken           = profile.linked ? true : null;
    discordUsername    = profile.username    || null;
    discordDisplayName = profile.displayName || null;
    discordAvatarUrl   = profile.avatarUrl   || null;
    renderAccountStatus();
  } catch (e) {
    console.error('[dr-vibe] loadAccount error:', e);
  }
}

function renderAccountStatus() {
  const connected = !!(apiToken && discordUsername);

  // Titlebar dot
  const tbDot = document.getElementById('tb-connected-dot');
  if (tbDot) tbDot.classList.toggle('visible', connected);

  // Community account card
  const usernameEl      = document.getElementById('account-username');
  const commDisplayName = document.getElementById('comm-display-name');
  const commAvatarImg   = document.getElementById('comm-avatar-img');
  const commAvatarInit  = document.getElementById('comm-avatar-initials');
  if (usernameEl)      usernameEl.textContent      = connected ? ('@' + discordUsername) : '';
  if (commDisplayName) commDisplayName.textContent = connected ? (discordDisplayName || discordUsername || '—') : '—';
  // Profile picture (Discord/GitHub); initials if none or it fails to load.
  const avatarName = discordDisplayName || discordUsername || null;
  setAvatar(commAvatarImg, commAvatarInit, { url: discordAvatarUrl, name: avatarName, show: connected });

  // Titlebar: profile chip vs connect button
  const shProfile    = document.getElementById('sh-profile');
  const shConnectBtn = document.getElementById('sh-connect-btn');
  if (shProfile)    shProfile.classList.toggle('visible', connected);
  if (shConnectBtn) shConnectBtn.classList.toggle('hidden', connected);

  // Titlebar display name (prefer Discord global_name, fall back to username)
  const shDisplayName = document.getElementById('sh-display-name');
  if (shDisplayName) shDisplayName.textContent = connected ? (discordDisplayName || discordUsername) : '—';

  // Titlebar avatar: image if URL available, else initials
  const shAvatarImg      = document.getElementById('sh-avatar-img');
  const shAvatarInitials = document.getElementById('sh-avatar-initials');
  setAvatar(shAvatarImg, shAvatarInitials, { url: discordAvatarUrl, name: avatarName, show: connected });

  // Community gate vs settings panel
  const gate     = document.getElementById('community-gate');
  const settings = document.getElementById('community-settings');
  if (gate)     gate.style.display     = connected ? 'none' : '';
  if (settings) settings.style.display = connected ? '' : 'none';

  // Vibe Points balance — fetch authoritative value from the server whenever
  // the connected state flips true. Silent failure if offline.
  if (connected) {
    refreshVpBalance().catch(() => {});
  } else {
    const vpEl = document.getElementById('comm-vp-balance');
    if (vpEl) vpEl.innerHTML = '—<span class="comm-vp-unit">VP</span>';
  }
}

// Human-readable labels for VP transaction sources, mirrors SOURCE_LABELS on
// the website shop page. Fallback is title-cased snake_case.
const VP_SOURCE_LABELS = {
  activity_event: 'Activity',
  pomodoro_complete: 'Pomodoro',
  focus_session_end: 'Focus Session',
  git_commit: 'Git Commit',
  coding_session_start: 'Coding Session',
  wellness_check: 'Wellness Check',
  personal_best: 'Personal Best',
  achievement_unlock: 'Achievement',
  mastery_level_up: 'Mastery',
  quest_complete: 'Quest',
  store_purchase: 'Store Purchase',
  trade_offer: 'Trade',
  trade_refund: 'Trade Refund',
  gacha_pull: 'Gacha Pull',
  mint_fee: 'Mint Fee',
  admin_grant: 'Admin Grant',
  admin_deduct: 'Admin Deduct',
  refund: 'Refund',
};

function formatVpSource(source) {
  if (VP_SOURCE_LABELS[source]) return VP_SOURCE_LABELS[source];
  return String(source || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatVpDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function renderVpHistory(transactions) {
  const container = document.getElementById('comm-vp-history');
  if (!container) return;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    container.innerHTML = '<div class="comm-vp-history-empty">No activity yet.</div>';
    return;
  }
  const rows = transactions.slice(0, 10).map((tx) => {
    const amt = Number(tx.amount ?? 0);
    const sign = amt >= 0 ? '+' : '';
    const cls = amt >= 0 ? 'positive' : 'negative';
    const label = tx.description || formatVpSource(tx.source);
    return `
      <div class="comm-vp-tx-row">
        <div class="comm-vp-tx-left">
          <div class="comm-vp-tx-title">${escapeHtml(label)}</div>
          <div class="comm-vp-tx-meta">${escapeHtml(formatVpSource(tx.source))} · ${formatVpDate(tx.createdAt)}</div>
        </div>
        <div class="comm-vp-tx-amount ${cls}">${sign}${amt.toLocaleString('en-US')} VP</div>
      </div>`;
  }).join('');
  container.innerHTML = rows;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function refreshVpBalance() {
  if (!apiToken) return;
  try {
    const res = await desktopApi.balance();
    if (!res.ok) return;
    const data = res.data || {};
    const vp = Number(data?.vibePoints ?? 0);
    const vpEl = document.getElementById('comm-vp-balance');
    if (vpEl) {
      vpEl.innerHTML = `${vp.toLocaleString('en-US')}<span class="comm-vp-unit">VP</span>`;
    }
    // The balance endpoint already returns the top 20 recent VP transactions —
    // no second fetch needed for the settings history widget.
    renderVpHistory(data?.recent || []);
  } catch (e) {
    // Offline or server down — leave the placeholder and try again next refresh
    console.warn('[settings] VP balance fetch failed:', e);
  }
}

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
  resumeSuggestions: () => document.getElementById('resume-suggestions'),
  learningResources: () => document.getElementById('learning-resources'),
  eyeStrainEnabled: () => document.getElementById('eye-strain-enabled'),
  postureEnabled: () => document.getElementById('posture-enabled'),
  postureFrequency: () => document.getElementById('posture-frequency'),
  fatigueDetection: () => document.getElementById('fatigue-detection'),
  stuckDetection: () => document.getElementById('stuck-detection'),
  overworkPrevention: () => document.getElementById('overwork-prevention'),
  hydrationEnabled: () => document.getElementById('hydration-enabled'),
  hydrationFrequency: () => document.getElementById('hydration-frequency'),
  notificationPosition: () => document.getElementById('notification-position'),
  notifyBreaks: () => document.getElementById('notify-breaks'),
  notifyAchievements: () => document.getElementById('notify-achievements'),
  notifyVpEarned: () => document.getElementById('notify-vp-earned'),
  notifyTrades: () => document.getElementById('notify-trades'),
  hideWhenPresenting: () => document.getElementById('hide-when-presenting'),
  shareWeeklyRecap: () => document.getElementById('privacy-weekly-recap'),
  popupDuration: () => document.getElementById('popup-duration'),
  selectedSkin: () => document.getElementById('selected-skin'),
  skinTone: () => document.getElementById('skin-tone'),
  skinToneRow: () => document.getElementById('skin-tone-row'),
  clickThroughGhost: () => document.getElementById('click-through-ghost'),
  mouseNudgeEnabled:  () => document.getElementById('mouse-nudge-enabled'),
  mouseNudgeSpeed:    () => document.getElementById('mouse-nudge-speed'),
  mouseNudgeSpeedRow: () => document.getElementById('mouse-nudge-speed-row'),
  characterScale: () => document.getElementById('character-scale'),
  walkingEnabled: () => document.getElementById('walking-enabled'),
  walkingLocked: () => document.getElementById('walking-locked'),
  walkingLockedRow: () => document.getElementById('walking-locked-row'),
  walkingBoundLeft: () => document.getElementById('walking-bound-left'),
  walkingBoundLeftRow: () => document.getElementById('walking-bound-left-row'),
  walkingBoundRight: () => document.getElementById('walking-bound-right'),
  walkingBoundRightRow: () => document.getElementById('walking-bound-right-row'),
  soundReactionsEnabled: () => document.getElementById('sound-reactions-enabled'),
  soundTalkEnabled: () => document.getElementById('sound-talk-enabled'),
  soundVolume: () => document.getElementById('sound-volume'),
  soundVolumeRow: () => document.getElementById('sound-volume-row'),
  soundTalkVoice: () => document.getElementById('sound-talk-voice'),
  claudeHooksEnabled: () => document.getElementById('claude-hooks-enabled'),
  gitTrackingEnabled: () => document.getElementById('git-tracking-enabled'),
  trackClaudeRepos: () => document.getElementById('track-claude-repos'),
  gitCommitNotifications: () => document.getElementById('git-commit-notifications'),
  gitBranchNotifications: () => document.getElementById('git-branch-notifications'),
  gitPollInterval: () => document.getElementById('git-poll-interval'),
  gitTrackingSubRows: () => document.getElementById('git-tracking-sub-rows'),
  gitCommitReminders: () => document.getElementById('git-commit-reminders'),
  gitReminderThreshold: () => document.getElementById('git-reminder-threshold'),
  gitReminderMinChanges: () => document.getElementById('git-reminder-min-changes'),
  gitReminderSubRows: () => document.getElementById('git-reminder-sub-rows'),
  soundTalkVoiceRow: () => document.getElementById('sound-talk-voice-row'),
  momentumMeterEnabled: () => document.getElementById('momentum-meter-enabled'),
  momentumMeterPosition: () => document.getElementById('momentum-meter-position'),
  momentumMeterPositionRow: () => document.getElementById('momentum-meter-position-row'),
  aiAgent: () => document.getElementById('ai-agent'),
  autoStartEnabled: () => document.getElementById('auto-start-enabled'),
};

// Keep the hidden <select> able to hold `slug`, even when it isn't in the
// local list yet (e.g. an inventory companion picked before it's installed);
// otherwise gatherSettings() would save the select's first option instead.
function ensureSkinOption(select, slug) {
  if (!select || !slug) return;
  if (![...select.options].some(o => o.value === slug)) {
    const opt = document.createElement('option');
    opt.value = slug; opt.textContent = slug;
    select.appendChild(opt);
  }
}

// Category display labels
const CATEGORY_LABELS = {
  'dr-vibe':  'Dr. Vibe',
  'human':    'Human',
  'fantasy':  'Fantasy',
  'animal':   'Animal',
  'none':     'Other',
};

// Category display order
const CATEGORY_ORDER = ['dr-vibe', 'human', 'fantasy', 'animal', 'none'];

// --- Draw the first idle frame of a sprite sheet onto a canvas ---
// b64: base64-encoded PNG data (local skins)
// remoteUrl: direct URL to a sprite sheet or thumbnail (inventory skins)
function drawSkinFrame(canvas, b64, remoteUrl) {
  return new Promise((resolve) => {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    if (remoteUrl) img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, 32, 32, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = () => {
      // Draw a placeholder silhouette when the image can't be loaded
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(127,127,127,0.15)';
      ctx.fillRect(4, 2, 24, 28);
      ctx.fillStyle = 'rgba(127,127,127,0.3)';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 16, 16);
      resolve();
    };
    img.src = b64 ? ('data:image/png;base64,' + b64) : (remoteUrl || '');
  });
}

// --- Filter the visible skin cards by category and search text ---
let _skinFilterCat = '';
let _skinFilterText = '';

function filterSkinGrid(cat) {
  if (typeof cat === 'string') _skinFilterCat = cat;
  const grid = document.getElementById('skin-grid');
  if (!grid) return;
  const q = _skinFilterText.trim().toLowerCase();
  grid.querySelectorAll('.skin-card').forEach(card => {
    const catOk = !_skinFilterCat || card.dataset.cat === _skinFilterCat;
    let textOk = true;
    if (q) {
      const name = (card.querySelector('.skin-card-name')?.textContent || '').toLowerCase();
      const slug = (card.dataset.skin || '').toLowerCase();
      textOk = name.includes(q) || slug.includes(q);
    }
    card.style.display = (catOk && textOk) ? '' : 'none';
  });
}

// --- Update the selected skin detail bar ---
const BUILT_IN_SKINS = ['dr-vibe-default','dr-vibe-classic','dr-vibe-tuxedo',
  'dr-vibe-cyberpunk','dr-vibe-alien','dr-vibe-pirate','dr-vibe-firefighter',
  'dr-vibe-wizard','dr-vibe-arctic','dr-vibe-retro80s','dr-vibe-bridgemind',
  'dr-vibe-madscientist'];

// Returns true if a skin is bundled with the app (stored in the default skins dir).
// Used only for backend constraints (e.g. bundled skins can't be deleted from disk).
// Does NOT affect UI section placement — skins are split by inventory status, not this.
function isSkinDefault(skinName) {
  const card = document.getElementById('skin-grid')?.querySelector(`[data-skin="${CSS.escape(skinName)}"]`);
  if (card) return card.dataset.isDefault === 'true';
  return BUILT_IN_SKINS.includes(skinName);
}

async function updateSkinDetail(skinName) {
  const detail  = document.getElementById('skin-detail');
  const nameEl  = document.getElementById('skin-detail-name');
  const metaEl  = document.getElementById('skin-detail-meta');
  const delBtn  = document.getElementById('skin-delete-btn');
  if (detail) detail.style.display = skinName ? '' : 'none';
  if (nameEl) nameEl.textContent = formatSkinName(skinName || '');
  if (metaEl) { metaEl.style.display = 'none'; metaEl.textContent = ''; }
  if (delBtn) delBtn.style.display = (!skinName || isSkinDefault(skinName)) ? 'none' : '';
  if (!skinName) return;
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    const animStr = await invoke('read_skin_anim', { name: skinName });
    if (!animStr) return;
    const meta = JSON.parse(animStr);
    if (nameEl && meta.name) nameEl.textContent = meta.name;
    const parts = [];
    if (meta.author) parts.push(`by @${meta.author}`);
    if (meta.description) parts.push(meta.description);
    if (metaEl && parts.length) { metaEl.textContent = parts.join(' · '); metaEl.style.display = ''; }
  } catch {}
}

// --- Visually select a skin card and sync the hidden <select> ---
function selectSkinCard(skinName) {
  const grid = document.getElementById('skin-grid');
  if (grid) {
    grid.querySelectorAll('.skin-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.skin === skinName);
    });
    const sel = grid.querySelector('.skin-card.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  const select = els.selectedSkin();
  if (select) { ensureSkinOption(select, skinName); select.value = skinName; }
  updateSkinDetail(skinName);
}

// --- Called when the user clicks a skin card ---
function onSkinCardClick(skinName) {
  selectSkinCard(skinName);
  populateSkinTones(skinName, getDefaultTone(skinName));
  checkSkinEligibility(skinName).catch(() => {});
  debouncedSave();
}

// --- Fetch the user's inventory (skins they own) from the website API ---
// Returns an array of slug strings. Cached for the session.
let _inventoryCache = null;
let _inventoryFetchPromise = null;

async function fetchInventory() {
  if (_inventoryCache) return _inventoryCache;
  if (_inventoryFetchPromise) return _inventoryFetchPromise;
  if (!apiToken) return [];
  // GET /desktop/collection → the collected Dr. Vibes, cached locally as
  // `companion-<editionSlug>` (the same slugs CompanionManager uses).
  _inventoryFetchPromise = desktopApi.collection()
    .then(r => (r.ok ? (r.data?.companions || []) : []))
    .then(companions => {
      _inventoryCache = companions.map(c => ({
        slug: `companion-${c.editionSlug}`,
        editionSlug: c.editionSlug,
        companionId: c.companionId,
        name: c.name,
        thumbnailUrl: c.thumbnailUrl || null,
        spriteSheetUrl: c.spriteSheetUrl || null,
        animJson: c.animJson || null,
      }));
      _inventoryFetchPromise = null;
      return _inventoryCache;
    })
    .catch(() => {
      _inventoryFetchPromise = null;
      return [];
    });
  return _inventoryFetchPromise;
}

// Call when inventory changes (buy/sell/upload) to force a re-fetch next time
function invalidateInventory() {
  _inventoryCache = null;
  _inventoryFetchPromise = null;
}

// Re-fetch inventory and re-render just the inventory portion of the skin grid
function refreshInventorySection() {
  invalidateInventory();
  const savedSkin = document.querySelector('#skin-grid .skin-card.selected')?.dataset?.skin;
  populateSkins(savedSkin || 'dr-vibe-default').catch(() => {});
}

// --- Build the visual skin grid and category filter bar ---
// skins: array of { slug, isDefault, name, galleryId } objects from list_skins (local files)
// Two sections:
//   "My Skins"  — all local skins the user can edit and manage
//   "Inventory" — skins the user owns on the website (fetched from API, account-based)
function renderSkinGrid(skins, selectedSkin) {
  const grid = document.getElementById('skin-grid');
  const catBar = document.getElementById('skin-cat-bar');
  if (!grid) return;

  const slugs = skins.map(s => s.slug);
  const presentCats = new Set(slugs.map(s => SKIN_TONE_CATEGORIES[s] || 'none'));

  // Category filter bar
  if (catBar) {
    catBar.innerHTML = '';
    const mkBtn = (label, cat, isActive) => {
      const btn = document.createElement('button');
      btn.className = 'skin-cat' + (isActive ? ' active' : '');
      btn.dataset.cat = cat;
      btn.textContent = label;
      return btn;
    };
    catBar.appendChild(mkBtn('All', '', !_skinFilterCat));
    for (const cat of CATEGORY_ORDER) {
      if (presentCats.has(cat)) catBar.appendChild(mkBtn(CATEGORY_LABELS[cat] || cat, cat, _skinFilterCat === cat));
    }
    if (!catBar.dataset.bound) {
      catBar.dataset.bound = '1';
      catBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.skin-cat');
        if (!btn) return;
        catBar.querySelectorAll('.skin-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterSkinGrid(btn.dataset.cat);
      });
    }
  }

  grid.innerHTML = '';
  const invoke = window.__TAURI__?.core?.invoke;

  // remotePreviewUrl: optional URL for inventory skins not stored locally
  // opts.showStatus: outline the card by upload status (uploaded / draft / stale)
  const appendSkinCard = ({ slug, isDefault }, remotePreviewUrl, opts = {}) => {
    const { showStatus = false } = opts;
    const card = document.createElement('div');
    card.className = 'skin-card' + (slug === selectedSkin ? ' selected' : '');
    card.dataset.skin = slug;
    card.dataset.isDefault = String(isDefault);
    card.dataset.cat = SKIN_TONE_CATEGORIES[slug] || 'none';

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;

    const nameEl = document.createElement('div');
    nameEl.className = 'skin-card-name';
    nameEl.textContent = skinVariantLabel(slug);
    nameEl.title = formatSkinName(slug);

    card.appendChild(canvas);
    card.appendChild(nameEl);
    card.addEventListener('click', () => onSkinCardClick(slug));
    grid.appendChild(card);

    if (invoke) {
      invoke('read_skin', { name: slug })
        .then(b64 => drawSkinFrame(canvas, b64))
        .catch(() => {
          // Local skin not found — fall back to remote preview URL (inventory skins)
          if (remotePreviewUrl) drawSkinFrame(canvas, null, remotePreviewUrl);
        });
      invoke('read_skin_anim', { name: slug })
        .then(json => {
          if (!json) return;
          try {
            const meta = JSON.parse(json);
            if (meta.name) {
              nameEl.textContent = meta.name; nameEl.title = meta.name;
              if (_skinFilterText) filterSkinGrid();
            }
            if (meta.author) {
              const authorEl = document.createElement('div');
              authorEl.className = 'skin-card-author';
              authorEl.textContent = `@${meta.author}`;
              card.appendChild(authorEl);
            }
            if (showStatus) {
              // uploaded = sidecar has uploadedAt
              // stale    = uploaded but the user has edited the sidecar/PNG since (skipped for now —
              //            mtime check would need a separate Tauri call; treat all uploaded as "uploaded")
              // draft    = no uploadedAt (or no vibeId, but backfill ensures vibeId always exists)
              if (meta.uploadedAt) {
                card.classList.add('uploaded');
              } else {
                card.classList.add('draft');
              }
            }
          } catch {}
        })
        .catch(() => {});
    } else if (remotePreviewUrl) {
      // No Tauri — use remote URL directly
      drawSkinFrame(canvas, null, remotePreviewUrl);
    }
  };

  // --- My Skins section: every local Dr. Vibe (bundled, imported, made) ---
  {
    const myHeader = document.createElement('div');
    myHeader.className = 'skin-section-header';
    myHeader.textContent = 'My Skins';
    grid.appendChild(myHeader);

    if (skins.length > 0) {
      for (const skin of skins) appendSkinCard(skin, undefined, { showStatus: true });
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'skin-grid-placeholder';
      placeholder.textContent = 'No skins found.';
      grid.appendChild(placeholder);
    }
  }

  // --- Inventory section (skins owned on the website, fetched from API) ---
  // This is the primary skin picker for regular users.
  // Server is the source of truth — if you sell a skin, it disappears here.
  const invHeader = document.createElement('div');
  invHeader.className = 'skin-section-header';
  invHeader.innerHTML = 'Inventory <a href="#" class="skin-inv-refresh" title="Refresh inventory">\u21BB</a>';
  invHeader.querySelector('.skin-inv-refresh')?.addEventListener('click', (e) => {
    e.preventDefault();
    refreshInventorySection();
  });
  grid.appendChild(invHeader);

  const invPlaceholder = document.createElement('div');
  invPlaceholder.className = 'skin-grid-placeholder';

  const openExternal = (url) => openUrl(url);

  if (!apiToken) {
    // Not logged in — show connect button
    invPlaceholder.innerHTML = '<a href="#" class="skin-gallery-link">Join the community</a> to wear the Dr. Vibes you collect.';
    invPlaceholder.querySelector('.skin-gallery-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.__TAURI__?.core?.invoke('start_device_link', {}).catch(() => {});
    });
    grid.appendChild(invPlaceholder);
  } else {
    invPlaceholder.textContent = 'Loading inventory\u2026';
    grid.appendChild(invPlaceholder);

    fetchInventory().then(ownedItems => {
      // If the grid was re-rendered while we were fetching, our invHeader
      // is no longer in the DOM — abort to avoid appending duplicate cards.
      if (!invHeader.isConnected) return;
      invPlaceholder.remove();
      if (ownedItems.length === 0) {
        // Logged in but no Dr. Vibes — prompt to get one
        const empty = document.createElement('div');
        empty.className = 'skin-grid-placeholder';
        empty.innerHTML = 'You don\u2019t have any Dr. Vibes yet. <a href="#" class="skin-gallery-link">Click here to get a Dr. Vibe!</a> Then hit <a href="#" class="skin-inv-refresh-link">\u21BB refresh</a>.';
        empty.querySelector('.skin-gallery-link')?.addEventListener('click', (e) => {
          e.preventDefault();
          openExternal(`${SITE_URL}${WebRoutes.machines()}`);
        });
        empty.querySelector('.skin-inv-refresh-link')?.addEventListener('click', (e) => {
          e.preventDefault();
          refreshInventorySection();
        });
        invHeader.after(empty);
      } else {
        // Render inventory cards — cache skins locally if not already present
        const localBySlug = Object.fromEntries(skins.map(s => [s.slug, s]));
        for (const item of ownedItems) {
          const slug = typeof item === 'string' ? item : item.slug;
          const local = localBySlug[slug];
          const spriteUrl = item.spriteSheetUrl || null;
          const previewUrl = item.thumbnailUrl || spriteUrl;

          if (local) {
            // Skin already exists locally — show it under Inventory only, not twice
            grid.querySelectorAll(`.skin-card[data-skin="${CSS.escape(slug)}"]`).forEach(c => c.remove());
            appendSkinCard(local);
          } else if (spriteUrl && invoke) {
            // Skin not local — download and install it, then re-draw preview
            appendSkinCard({ slug, isDefault: false }, previewUrl);
            invoke('cache_companion_skin', {
              id: item.companionId,
              slug: item.editionSlug,
              name: item.name,
              pngUrl: spriteUrl,
              animUrl: null,
              animJson: item.animJson,
            }).then(installedSlug => {
              // Re-draw the card with the now-local skin data
              const cardEl = grid.querySelector(`[data-skin="${CSS.escape(slug)}"]`);
              if (cardEl) {
                const canvas = cardEl.querySelector('canvas');
                if (canvas) {
                  invoke('read_skin', { name: installedSlug })
                    .then(b64 => drawSkinFrame(canvas, b64))
                    .catch(() => {});
                }
              }
            }).catch(() => {
              // Download failed (broken URL, offline, etc.) — preview stays as-is
            });
          } else {
            // No sprite URL available — render with placeholder
            appendSkinCard({ slug, isDefault: false }, previewUrl);
          }
        }
        filterSkinGrid();
      }
    });
  }

  updateSkinDetail(selectedSkin);
  filterSkinGrid();
}

// --- Populate skins: fills hidden <select> AND renders the visual grid ---
async function populateSkins(savedSkin) {
  const select = els.selectedSkin();
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) {
      console.warn('Tauri invoke not available, cannot list skins');
      return;
    }
    // list_skins returns [{ slug, isDefault, name, galleryId }, ...]
    let skins = [];
    try {
      skins = (await invoke('list_skins')) || [];
    } catch (e) {
      console.error('Failed to list skins:', e);
    }

    // Keep hidden <select> in sync for gatherSettings() compatibility
    select.innerHTML = '';
    for (const { slug } of skins) {
      const opt = document.createElement('option');
      opt.value = slug; opt.textContent = slug;
      select.appendChild(opt);
    }
    const selected = savedSkin || skins[0]?.slug || 'dr-vibe-default';
    ensureSkinOption(select, selected);
    select.value = selected;

    // Always render: an empty "My Skins" still needs the Inventory section.
    renderSkinGrid(skins, selected);
  } catch (e) {
    console.error('Failed to render skins:', e);
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

// --- Open "Make your own Dr. Vibe" (or bring it forward and route it) ---
async function openMakeWindow(route = {}) {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return;
  const url = makeUrl(route);
  try {
    await tauri.core.invoke('open_panel_window', {
      label: 'make', url, title: 'Make your own Dr. Vibe',
      width: 980, height: 680, resizable: true, decorations: true,
    });
    // Already open: open_panel_window only focuses it, so tell it where to go.
    if (route.edit) await tauri.event.emitTo('make', 'make-route', { search: url.split('?')[1] || '' });
  } catch (e) {
    console.error('[Make]', e);
  }
}

// --- Check if the current skin is eligible for gallery submission / workshop editing ---
// Shows or hides the "Submit to Gallery" and "Edit Character" rows based on source tag.
// Every player can edit any Dr. Vibe and submit the ones they made.
async function checkSkinEligibility(skinName) {
  const btn = document.getElementById('gallery-submit-btn');
  const editRow = document.getElementById('edit-character-row');
  if (editRow) {
    editRow.style.display = skinName ? '' : 'none';
  }
  if (!btn) return;
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke || !skinName) { btn.style.display = 'none'; return; }
  try {
    const animStr = await invoke('read_skin_anim', { name: skinName });
    if (!animStr) { btn.style.display = 'none'; return; }
    const anim = JSON.parse(animStr);
    const eligible = ['ai_generated', 'sprite_editor', 'player_made'].includes(anim.source);
    btn.style.display = eligible ? '' : 'none';
  } catch {
    btn.style.display = 'none';
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

function renderProjectFolders() {
  const container = document.getElementById('project-folders-list');
  container.innerHTML = '';
  for (const folder of currentProjectFolders) {
    const tag = document.createElement('div');
    tag.className = 'project-folder-tag';

    // Header row: path + remove button
    const header = document.createElement('div');
    header.className = 'project-folder-header';
    const label = document.createElement('span');
    label.textContent = folder;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '\u00d7';
    removeBtn.title = `Remove ${folder}`;
    removeBtn.addEventListener('click', () => {
      currentProjectFolders = currentProjectFolders.filter(f => f !== folder);
      folderRepoCache.delete(folder);
      renderProjectFolders();
      debouncedSave();
    });
    header.appendChild(label);
    header.appendChild(removeBtn);
    tag.appendChild(header);

    // Repo list area
    const repoArea = document.createElement('div');
    repoArea.className = 'project-folder-repos';
    const cached = folderRepoCache.get(folder);
    if (cached === undefined) {
      const scanning = document.createElement('span');
      scanning.className = 'project-folder-scanning';
      scanning.textContent = 'looking…';
      repoArea.appendChild(scanning);
    } else if (cached === 'untracked') {
      const none = document.createElement('span');
      none.className = 'project-folder-none';
      none.textContent = 'never tracked: a temp, app-data or system folder, or your whole home folder';
      repoArea.appendChild(none);
    } else if (cached.length === 0) {
      const none = document.createElement('span');
      none.className = 'project-folder-none';
      none.textContent = 'no repos found';
      repoArea.appendChild(none);
    } else {
      for (const repo of cached) {
        const row = document.createElement('div');
        row.className = 'project-folder-repo';
        row.title = repo.worktree;
        const name = document.createElement('span');
        name.className = 'project-folder-repo-name';
        name.textContent = repo.name;
        row.appendChild(name);
        repoArea.appendChild(row);
      }
    }
    tag.appendChild(repoArea);
    container.appendChild(tag);
  }
}

function addProjectFolder() {
  const input = document.getElementById('project-folder-input');
  const path = input.value.trim();
  if (path && !currentProjectFolders.includes(path)) {
    currentProjectFolders.push(path);
    renderProjectFolders();
    loadFolderRepos(path); // re-renders when done
  }
  input.value = '';
}

// --- Tracked repos ("Track repos Claude Code works in") ---

function applyTrackedStatus(status) {
  trackedStatus = status || null;
  renderTrackedRepos();
}

function updateTrackClaudeDesc() {
  const desc = document.getElementById('track-claude-repos-desc');
  if (!desc) return;
  desc.textContent = els.trackClaudeRepos()?.checked !== false
    ? 'Repos where Claude Code starts a session or edits files are tracked and remembered, plus the repos in your project folders below. Temp, app-data and system folders never are. Paths stay on this computer.'
    : 'Off: only the repos in your project folders below (and the project open in your editor) are tracked.';
}

function trackedRepoRow(repo, { ignored }) {
  const row = document.createElement('div');
  row.className = 'found-repo';
  row.title = [repo.path, ...(repo.worktrees || []).filter(w => w !== repo.path)].join('\n');
  const name = document.createElement('span');
  name.className = 'found-repo-name';
  name.textContent = repo.name;
  const tagText = ignored ? '' : repoTag(repo);
  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'found-repo-tag';
    tag.textContent = tagText;
    name.appendChild(tag);
  }
  const when = document.createElement('span');
  when.className = 'found-repo-when';
  when.textContent = repo.lastSeen ? formatAgo(repo.lastSeen) : '';
  const btn = document.createElement('button');
  btn.textContent = ignored ? 'Track' : 'Ignore';
  btn.title = ignored ? `Track ${repo.name} again` : `Never track ${repo.name}`;
  btn.addEventListener('click', () => {
    currentIgnoredRepos = ignored
      ? currentIgnoredRepos.filter(p => p !== repo.path)
      : [...currentIgnoredRepos, repo.path];
    renderTrackedRepos();
    debouncedSave();
  });
  const path = document.createElement('span');
  path.className = 'found-repo-path';
  path.textContent = repo.path;
  row.append(name, when, btn, path);
  return row;
}

function renderTrackedRepos() {
  const list = document.getElementById('found-repos-list');
  if (!list) return;
  const repos = visibleRepos(trackedStatus?.repos, currentIgnoredRepos);
  document.getElementById('found-repos-summary').textContent = trackedSummary(trackedStatus, repos.length);

  list.innerHTML = '';
  for (const repo of repos) list.appendChild(trackedRepoRow(repo, { ignored: false }));

  const wrap = document.getElementById('ignored-repos-wrap');
  const ignoredList = document.getElementById('ignored-repos-list');
  wrap.hidden = currentIgnoredRepos.length === 0;
  document.getElementById('ignored-repos-summary').textContent = `Ignored (${currentIgnoredRepos.length})`;
  ignoredList.innerHTML = '';
  for (const path of currentIgnoredRepos) {
    ignoredList.appendChild(trackedRepoRow({ name: repoName(path), path }, { ignored: true }));
  }
}

function initTrackedRepos() {
  renderTrackedRepos();
  const ev = window.__TAURI__?.event;
  ev?.listen?.('tracked-repos-status', e => applyTrackedStatus(e.payload));
  ev?.emit?.('request-tracked-repos-status', {})?.catch?.(() => {});
}

// --- Load settings from store into form ---
async function checkHooksStatus() {
  const invoke = window.__TAURI__?.core?.invoke;
  const statusEl = document.getElementById('hooks-status');
  const btn = document.getElementById('hooks-install-btn');
  if (!statusEl) return;
  const enabled = els.claudeHooksEnabled()?.checked !== false;
  if (btn) btn.disabled = !enabled;
  statusEl.style.color = 'var(--muted-2)';
  if (!enabled) { statusEl.textContent = 'Off'; return; }
  statusEl.textContent = 'Checking…';
  if (!invoke) { statusEl.textContent = 'Not available in browser mode.'; return; }
  try {
    const installed = await invoke('check_claude_code_hooks');
    if (installed) {
      statusEl.textContent = '✓ Hooks installed';
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.textContent = '✗ Not installed';
      statusEl.style.color = '#f87171';
    }
  } catch {
    statusEl.textContent = 'Could not check status.';
  }
}

/** Install or remove the hooks to match the switch, and say what happened. */
async function applyHooksSwitch(enabled) {
  const invoke = window.__TAURI__?.core?.invoke;
  const statusEl = document.getElementById('hooks-status');
  const resultEl = document.getElementById('hooks-result');
  if (resultEl) { resultEl.textContent = ''; resultEl.style.color = 'var(--muted-2)'; }
  if (!invoke) {
    if (resultEl) resultEl.textContent = 'Not available in browser mode.';
    return;
  }
  if (statusEl) { statusEl.textContent = enabled ? 'Installing…' : 'Removing…'; statusEl.style.color = 'var(--muted-2)'; }
  const r = await applyClaudeHooksSetting(enabled, invoke);
  if (resultEl) {
    if (r.notFound) {
      resultEl.textContent = 'Claude Code isn’t installed on this computer (no ~/.claude folder). Install it, then press Install / Fix.';
    } else if (r.error) {
      resultEl.textContent = enabled ? 'Install failed. Check that Claude Code is installed.' : 'Could not remove the hooks.';
      resultEl.style.color = '#f87171';
    } else {
      resultEl.textContent = enabled
        ? 'Done! Restart Claude Code for the hooks to take effect.'
        : 'Hooks removed. Restart Claude Code to stop them.';
    }
  }
  await checkHooksStatus();
}

// --- Detect which AI CLI tools are installed and update the UI ---
async function detectAiAgents() {
  const invoke = window.__TAURI__?.core?.invoke;
  const statusEl = document.getElementById('ai-agent-status');
  const select = els.aiAgent();
  if (!invoke || !select) return;

  const [claudeOk, codexOk] = await Promise.all([
    invoke('check_claude_installed').catch(() => false),
    invoke('check_codex_installed').catch(() => false),
  ]);

  // Mark unavailable options as disabled with a hint
  for (const opt of select.options) {
    if (opt.value === 'claude' && !claudeOk) {
      opt.disabled = true;
      opt.textContent = 'Claude Code (not detected)';
    } else if (opt.value === 'claude' && claudeOk) {
      opt.disabled = false;
      opt.textContent = 'Claude Code';
    }
    if (opt.value === 'codex' && !codexOk) {
      opt.disabled = true;
      opt.textContent = 'OpenAI Codex (not detected)';
    } else if (opt.value === 'codex' && codexOk) {
      opt.disabled = false;
      opt.textContent = 'OpenAI Codex';
    }
  }

  // If current selection is unavailable, switch to the other if possible
  if (select.value === 'claude' && !claudeOk && codexOk) {
    select.value = 'codex';
  } else if (select.value === 'codex' && !codexOk && claudeOk) {
    select.value = 'claude';
  }

  // Show status message
  if (statusEl) {
    if (!claudeOk && !codexOk) {
      statusEl.style.display = '';
      statusEl.style.color = '#f87171';
      statusEl.innerHTML = 'No AI CLI detected. Install <strong>Claude Code</strong> (npm i -g @anthropic-ai/claude-code) or <strong>Codex</strong> (npm i -g @openai/codex) to create characters.';
    } else if (!claudeOk || !codexOk) {
      statusEl.style.display = '';
      statusEl.style.color = 'var(--muted)';
      const missing = !claudeOk ? 'Claude Code' : 'Codex';
      statusEl.textContent = missing + ' not detected — install it to use as an option.';
    } else {
      statusEl.style.display = 'none';
    }
  }
  // Make your own Dr. Vibe explains a missing CLI itself and offers drawing
  // and importing instead, so its buttons stay enabled.
}

async function loadSettings() {
  // No saved section yet: fill the form from the defaults so the rest of the
  // page (coding apps, tones, folders...) still initialises.
  const saved = (await readSection('settings')) || DEFAULT_SETTINGS;
  const v = (key) => saved?.[key] ?? null;

  // Populate skin grid first (needs savedSkin to pre-select the right card)
  await populateSkins(v('selectedSkin'));

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
  if (els.claudeHooksEnabled()) els.claudeHooksEnabled().checked = v('claudeCodeHooksEnabled') !== false;
  checkHooksStatus();
  if (v('gitTrackingEnabled') != null && els.gitTrackingEnabled()) els.gitTrackingEnabled().checked = v('gitTrackingEnabled');
  if (v('gitCommitNotificationsEnabled') != null && els.gitCommitNotifications()) els.gitCommitNotifications().checked = v('gitCommitNotificationsEnabled');
  if (v('gitBranchNotificationsEnabled') != null && els.gitBranchNotifications()) els.gitBranchNotifications().checked = v('gitBranchNotificationsEnabled');
  if (v('gitPollIntervalMinutes') != null && els.gitPollInterval()) els.gitPollInterval().value = v('gitPollIntervalMinutes');
  if (v('gitCommitRemindersEnabled') != null && els.gitCommitReminders()) els.gitCommitReminders().checked = v('gitCommitRemindersEnabled');
  if (v('gitReminderThresholdMinutes') != null && els.gitReminderThreshold()) els.gitReminderThreshold().value = v('gitReminderThresholdMinutes');
  if (v('gitReminderMinChanges') != null && els.gitReminderMinChanges()) els.gitReminderMinChanges().value = v('gitReminderMinChanges');
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
  if (v('notifyAchievements') != null) els.notifyAchievements().checked = v('notifyAchievements');
  if (v('notifyVpEarned') != null) els.notifyVpEarned().checked = v('notifyVpEarned');
  if (v('notifyTrades') != null) els.notifyTrades().checked = v('notifyTrades');
  if (els.hideWhenPresenting()) els.hideWhenPresenting().checked = v('hideWhenPresenting') !== false;
  if (els.shareWeeklyRecap()) els.shareWeeklyRecap().checked = v('shareWeeklyRecap') !== false;
  if (v('popupDuration') != null) els.popupDuration().value = v('popupDuration');
  if (v('clickThroughGhostEnabled') != null) els.clickThroughGhost().checked = v('clickThroughGhostEnabled');
  if (v('mouseNudgeEnabled') != null) els.mouseNudgeEnabled().checked = v('mouseNudgeEnabled');
  if (v('mouseNudgeSpeed')   != null) {
    els.mouseNudgeSpeed().value = v('mouseNudgeSpeed');
    document.getElementById('mouse-nudge-speed-label').textContent = v('mouseNudgeSpeed');
  }
  if (v('characterScale') != null) els.characterScale().value = v('characterScale');
  // Skin grid already populated by populateSkins(savedSkin) above — just set tone + eligibility
  populateSkinTones(els.selectedSkin().value, v('selectedSkinTone'));
  checkSkinEligibility(els.selectedSkin().value).catch(() => {});
  if (v('aiAgent')) els.aiAgent().value = v('aiAgent');

  // Detect which AI CLIs are actually installed and gate the UI
  detectAiAgents().catch(() => {});

  if (v('walkingEnabled') != null) els.walkingEnabled().checked = v('walkingEnabled');
  if (v('walkingLockedToScreen') != null) els.walkingLocked().checked = v('walkingLockedToScreen');
  if (v('walkingBoundLeftPercent') != null) els.walkingBoundLeft().value = v('walkingBoundLeftPercent');
  if (v('walkingBoundRightPercent') != null) els.walkingBoundRight().value = v('walkingBoundRightPercent');

  if (v('soundReactionsEnabled') != null) els.soundReactionsEnabled().checked = v('soundReactionsEnabled');
  if (v('soundTalkEnabled') != null) els.soundTalkEnabled().checked = v('soundTalkEnabled');
  if (v('soundVolume') != null) els.soundVolume().value = v('soundVolume');
  if (v('soundTalkVoice') != null) els.soundTalkVoice().value = v('soundTalkVoice');

  if (v('momentumMeterEnabled') != null) els.momentumMeterEnabled().checked = v('momentumMeterEnabled');
  if (v('momentumMeterPosition') != null && els.momentumMeterPosition()) els.momentumMeterPosition().value = v('momentumMeterPosition');
  // Sync auto-start state from OS (ground truth over stored value)
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) {
      const isEnabled = await invoke('plugin:autostart|is_enabled');
      if (els.autoStartEnabled()) els.autoStartEnabled().checked = isEnabled;
    }
  } catch (e) {
    if (v('autoStartEnabled') != null && els.autoStartEnabled()) {
      els.autoStartEnabled().checked = v('autoStartEnabled');
    }
  }
  if (Array.isArray(v('codingApps'))) {
    currentCodingApps = [...v('codingApps')];
  }
  renderCodingApps();

  if (Array.isArray(v('projectFolders'))) {
    currentProjectFolders = [...v('projectFolders')];
  }
  renderProjectFolders();
  // Look up the repos in each saved folder so their lists fill in on open
  for (const folder of currentProjectFolders) {
    loadFolderRepos(folder);
  }

  if (els.trackClaudeRepos()) els.trackClaudeRepos().checked = v('trackClaudeRepos') !== false;
  currentIgnoredRepos = Array.isArray(v('ignoredRepos')) ? [...v('ignoredRepos')] : [];
  updateTrackClaudeDesc();
  initTrackedRepos();

  // Developer mode (debug builds only)
  adminMode = IS_DEV && v('adminMode') === true;
  const adminToggle = document.getElementById('admin-mode-toggle');
  if (adminToggle) adminToggle.checked = adminMode;
  // If admin mode was previously on, show the titlebar toggle automatically
  if (adminMode) {
    const tbAdmin = document.getElementById('tb-admin-toggle');
    if (tbAdmin) tbAdmin.style.display = 'flex';
  }
  applyAdminGate();

  // Dev server override (developer mode, debug builds only)
  const savedOverride = (typeof v('devServerOverride') === 'string') ? v('devServerOverride') : 'auto';
  _initialDevServerOverride = savedOverride;
  const devRadios = document.querySelectorAll('input[name="dev-server"]');
  devRadios.forEach(r => { r.checked = (r.value === savedOverride); });
  // Hide the localhost option entirely in release builds — release binaries
  // should never be able to redirect themselves at localhost.
  const localhostRow = document.getElementById('dev-server-localhost-row');
  if (localhostRow && !IS_DEV) localhostRow.style.display = 'none';
  // Show the currently resolved URL so the admin can see what's actually in use.
  const currentEl = document.getElementById('dev-server-current');
  if (currentEl) currentEl.textContent = `current: ${SITE_URL}`;

  updateConditionalRows();
  updateNotifyBadges();
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
    claudeCodeHooksEnabled: els.claudeHooksEnabled()?.checked !== false,
    gitTrackingEnabled: els.gitTrackingEnabled()?.checked ?? true,
    gitCommitNotificationsEnabled: els.gitCommitNotifications()?.checked ?? true,
    gitBranchNotificationsEnabled: els.gitBranchNotifications()?.checked ?? true,
    gitPollIntervalMinutes: parseInt(els.gitPollInterval()?.value) || 1,
    gitCommitRemindersEnabled: els.gitCommitReminders()?.checked ?? true,
    gitReminderThresholdMinutes: parseInt(els.gitReminderThreshold()?.value) || 30,
    gitReminderMinChanges: parseInt(els.gitReminderMinChanges()?.value) || 3,
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
    notifyHydration: true,
    notifyPosture: true,
    notifyEyeStrain: true,
    notifyFatigue: true,
    notifyStuck: true,
    notifyOverwork: true,
    notifyAchievements: els.notifyAchievements().checked,
    notifyVpEarned: els.notifyVpEarned().checked,
    notifyTrades: els.notifyTrades().checked,
    hideWhenPresenting: els.hideWhenPresenting()?.checked !== false,
    shareWeeklyRecap: els.shareWeeklyRecap()?.checked !== false,
    notifyBoundary: true,
    popupDuration: parseInt(els.popupDuration().value) || 20,
    clickThroughGhostEnabled: els.clickThroughGhost().checked,
    mouseNudgeEnabled: els.mouseNudgeEnabled().checked,
    mouseNudgeSpeed:   parseInt(els.mouseNudgeSpeed().value) || 7,
    characterScale: parseInt(els.characterScale().value) || 100,
    selectedSkin: els.selectedSkin().value || 'dr-vibe-default',
    selectedSkinTone: els.skinTone().value || 'medium-light',
    walkingEnabled: els.walkingEnabled().checked,
    walkingLockedToScreen: els.walkingLocked().checked,
    walkingBoundLeftPercent: parseInt(els.walkingBoundLeft().value) || 0,
    walkingBoundRightPercent: parseInt(els.walkingBoundRight().value) || 0,
    codingApps: [...currentCodingApps],
    projectFolders: [...currentProjectFolders],
    trackClaudeRepos: els.trackClaudeRepos()?.checked !== false,
    ignoredRepos: [...currentIgnoredRepos],
    soundReactionsEnabled: els.soundReactionsEnabled().checked,
    soundTalkEnabled: els.soundTalkEnabled().checked,
    soundVolume: parseInt(els.soundVolume().value) || 50,
    soundTalkVoice: els.soundTalkVoice().value || 'mumble',
    momentumMeterEnabled: els.momentumMeterEnabled()?.checked ?? true,
    momentumMeterPosition: els.momentumMeterPosition()?.value ?? 'bottom',
    aiAgent: els.aiAgent()?.value || 'claude',
    autoStartEnabled: els.autoStartEnabled()?.checked ?? false,
    adminMode: adminMode,
    devServerOverride: (document.querySelector('input[name="dev-server"]:checked')?.value) || 'auto',
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

  const nudgeSpeedRow = els.mouseNudgeSpeedRow();
  if (nudgeSpeedRow) nudgeSpeedRow.style.display = els.mouseNudgeEnabled().checked ? '' : 'none';

  const walkingLockedRow = els.walkingLockedRow();
  const walkingBoundLeftRow = els.walkingBoundLeftRow();
  const walkingBoundRightRow = els.walkingBoundRightRow();
  const walkingOn = els.walkingEnabled().checked;
  if (walkingLockedRow) walkingLockedRow.style.display = walkingOn ? '' : 'none';
  if (walkingBoundLeftRow) walkingBoundLeftRow.style.display = walkingOn ? '' : 'none';
  if (walkingBoundRightRow) walkingBoundRightRow.style.display = walkingOn ? '' : 'none';

  const gitSubRows = els.gitTrackingSubRows();
  const gitTrackingOn = els.gitTrackingEnabled()?.checked ?? true;
  if (gitSubRows) gitSubRows.style.display = gitTrackingOn ? '' : 'none';

  const gitReminderSubRows = els.gitReminderSubRows();
  const gitRemindersOn = gitTrackingOn && (els.gitCommitReminders()?.checked ?? true);
  if (gitReminderSubRows) gitReminderSubRows.style.display = gitRemindersOn ? '' : 'none';

  const anySoundOn = els.soundReactionsEnabled().checked || els.soundTalkEnabled().checked;
  const soundVolumeRow = els.soundVolumeRow();
  if (soundVolumeRow) soundVolumeRow.style.display = anySoundOn ? '' : 'none';

  const talkOn = els.soundTalkEnabled().checked;
  const soundTalkVoiceRow = els.soundTalkVoiceRow();
  if (soundTalkVoiceRow) soundTalkVoiceRow.style.display = talkOn ? '' : 'none';

  const momentumPositionRow = els.momentumMeterPositionRow();
  if (momentumPositionRow) momentumPositionRow.style.display = els.momentumMeterEnabled()?.checked ? '' : 'none';
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

// --- Sync active class on notify badges and chips ---
function updateNotifyBadges() {
  document.querySelectorAll('.notify-badge, .notify-chip').forEach(badge => {
    const cb = badge.querySelector('input[type="checkbox"]');
    if (cb) badge.classList.toggle('active', cb.checked);
  });
}

// --- Event listeners ---
function setupListeners() {
  setupTabs();

  document.getElementById('settings-close').addEventListener('click', closeWindow);

  // Titlebar close button + drag
  document.getElementById('tb-close')?.addEventListener('click', closeWindow);
  document.getElementById('settings-titlebar')?.addEventListener('mousedown', (e) => {
    if (e.target.closest('.titlebar-controls') || e.buttons !== 1) return;
    window.__TAURI__?.window?.getCurrentWindow()?.startDragging()?.catch?.(() => {});
  });

  // Forward Rust-side workshop debug messages into this console
  window.__TAURI__?.event?.listen('workshop-debug', e => {
    console.log('[Workshop-Rust]', e.payload);
  });

  // Sync indicator in the account hero badge (state of the 60 s poll).
  // Main app broadcasts on every state change; we ask for the current state on load.
  const SYNC_STATUS_LABELS = {
    live:       'Synced • drvibe.io',
    connecting: 'Connecting…',
    offline:    'Offline — will retry',
    error:      'Sign-in expired',
    unlinked:   'Not linked',
  };
  function applySyncStatus(status) {
    const text = document.getElementById('sync-status-text');
    const dot  = document.getElementById('sync-status-dot');
    const state = status?.state ?? 'connecting';
    if (text) text.textContent = SYNC_STATUS_LABELS[state] || SYNC_STATUS_LABELS.connecting;
    if (dot) {
      dot.classList.remove('sync-live', 'sync-connecting', 'sync-offline', 'sync-error', 'sync-unlinked');
      dot.classList.add(`sync-${state}`);
      if (status?.detail) dot.title = status.detail;
      else if (status?.reason) dot.title = `Reason: ${status.reason}`;
      else dot.removeAttribute('title');
    }
  }
  window.__TAURI__?.event?.listen?.('sync-status', e => applySyncStatus(e.payload));
  // Ask main for the current state right now (settings window may have opened mid-session).
  try {
    const { emit } = window.__TAURI__?.event ?? {};
    emit?.('request-sync-status', {});
  } catch {}

  // "Make your own Dr. Vibe" always opens on a fresh prompt; "Edit this
  // character" opens the selected one on its bench (makeHub.js routes).
  document.getElementById('make-drvibe-btn')?.addEventListener('click', () => openMakeWindow());
  document.getElementById('edit-character-btn')?.addEventListener('click', () => {
    const slug = els.selectedSkin()?.value;
    if (slug) openMakeWindow({ edit: slug });
  });

  document.getElementById('open-sprite-editor-btn').addEventListener('click', () => {
    const invoke = window.__TAURI__?.core?.invoke;
    const slug = els.selectedSkin()?.value || '';
    if (invoke) invoke('open_sprite_editor', { slug })
      .catch(e => console.error('[SpriteEditor]', e));
  });

  document.getElementById('open-setup-wizard-btn')?.addEventListener('click', () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    invoke('open_panel_window', {
      label: 'setup-wizard',
      url: 'setup-wizard.html',
      title: 'Welcome to Dr. Vibe',
      width: 560,
      height: 640,
      resizable: false,
      decorations: false,
    }).catch(e => console.error('[SetupWizard]', e));
  });

  document.getElementById('coding-app-add-btn').addEventListener('click', () => { addCodingApp(); debouncedSave(); });
  document.getElementById('coding-app-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCodingApp(); debouncedSave(); }
  });

  checkHooksStatus();

  document.getElementById('hooks-install-btn')?.addEventListener('click', () => applyHooksSwitch(true));
  els.claudeHooksEnabled()?.addEventListener('change', async () => {
    debouncedSave();
    await applyHooksSwitch(els.claudeHooksEnabled().checked);
  });

  els.trackClaudeRepos()?.addEventListener('change', () => { updateTrackClaudeDesc(); debouncedSave(); });

  document.getElementById('project-folder-add-btn').addEventListener('click', () => { addProjectFolder(); debouncedSave(); });
  document.getElementById('project-folder-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addProjectFolder(); debouncedSave(); }
  });
  document.getElementById('project-folder-browse-btn')?.addEventListener('click', async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    const selected = await invoke('pick_folder').catch(() => null);
    if (!selected) return;
    const input = document.getElementById('project-folder-input');
    if (input) input.value = selected;
    addProjectFolder();
    debouncedSave();
  });

  els.mouseNudgeSpeed().addEventListener('input', () => {
    document.getElementById('mouse-nudge-speed-label').textContent = els.mouseNudgeSpeed().value;
    debouncedSave();
  });

  els.autoStartEnabled()?.addEventListener('change', async (e) => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    if (e.target.checked) {
      await invoke('plugin:autostart|enable').catch(console.error);
    } else {
      await invoke('plugin:autostart|disable').catch(console.error);
    }
    debouncedSave();
  });
  els.mouseNudgeEnabled().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.breakMode().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.momentumMeterEnabled()?.addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.walkingEnabled().addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.gitTrackingEnabled()?.addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
  els.gitCommitReminders()?.addEventListener('change', () => { updateConditionalRows(); debouncedSave(); });
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

  // Skin selection is now handled by card clicks (onSkinCardClick) — no select listener needed.

  // Auto-save on any select or checkbox change
  document.querySelectorAll('.tab-body select, .tab-body input[type="checkbox"]').forEach(el => {
    el.addEventListener('change', debouncedSave);
  });

  document.getElementById('create-character-btn')?.addEventListener('click', () => openMakeWindow());

  // Sync active class on notify badges/chips when toggled
  document.querySelectorAll('.notify-badge, .notify-chip').forEach(badge => {
    const cb = badge.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.addEventListener('change', () => badge.classList.toggle('active', cb.checked));
    }
  });

  // Submit to the Incubator — goes through Make your own Dr. Vibe, which
  // checks all 17 rows and the upload-rights box before submitting.
  document.getElementById('gallery-submit-btn')?.addEventListener('click', () => {
    const slug = els.selectedSkin()?.value;
    openMakeWindow(slug ? { edit: slug } : {});
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('gallery-modal');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
      } else {
        closeWindow();
      }
    }
  });

  // ── Get More Skins — opens the skins page in the external browser ────────
  const importStatus = document.getElementById('skin-import-status');

  function setImportStatus(msg, type = '') {
    if (!importStatus) return;
    importStatus.textContent = msg;
    importStatus.className = type;
    if (msg && type === 'success') setTimeout(() => { importStatus.textContent = ''; importStatus.className = ''; }, 3500);
  }

  const getMoreBtn = document.getElementById('skin-get-more-btn');
  if (getMoreBtn) {
    getMoreBtn.addEventListener('click', async () => {
      const url = `${SITE_URL}/skins`;
      await openUrl(url);
    });
  }

  // ── Theme toggle ─────────────────────────────────────────────────────────
  const shThemeIcon = document.getElementById('sh-theme-icon');
  if (shThemeIcon) {
    const initTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    shThemeIcon.textContent = initTheme === 'light' ? '☾' : '☀';
  }
  document.getElementById('sh-theme-btn')?.addEventListener('click', () => {
    const html    = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('drvibe-theme', next);
    const icon = document.getElementById('sh-theme-icon');
    if (icon) icon.textContent = next === 'light' ? '☾' : '☀';
    // Broadcast to all other open windows
    try { window.__TAURI__?.event?.emit('theme-changed', { theme: next }); } catch (_) {}
  });

  // Listen for theme changes broadcast from other windows
  try {
    const listen = window.__TAURI__?.event?.listen;
    if (listen) {
      listen('theme-changed', (event) => {
        const theme = event?.payload?.theme;
        if (theme === 'dark' || theme === 'light') {
          localStorage.setItem('drvibe-theme', theme);
          document.documentElement.setAttribute('data-theme', theme);
          const icon = document.getElementById('sh-theme-icon');
          if (icon) icon.textContent = theme === 'dark' ? '☀' : '☾';
        }
      });
    }
  } catch (_) {}

  // ── Header "Connect Account" → jump to Community tab ─────────────────────
  document.getElementById('sh-connect-btn')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="community"]')?.click();
  });

  // ── Community tab link buttons ───────────────────────────────────────────
  async function openExternal(url) {
    await openUrl(url);
  }

  // Vibe Points "Open the Machines" button (VP is earned, never bought)
  document.getElementById('comm-vp-shop-btn')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}${WebRoutes.machines()}`);
  });

  // Vibe Points history collapsible toggle
  document.getElementById('comm-vp-history-toggle')?.addEventListener('click', (e) => {
    const panel = document.getElementById('comm-vp-history');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(isOpen));
    e.currentTarget.textContent = isOpen ? 'Hide recent activity ▴' : 'Show recent activity ▾';
  });

  // Gate (unauthenticated) link buttons
  document.getElementById('community-profile-btn')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}${discordUsername ? WebRoutes.profile(discordUsername) : WebRoutes.me()}`);
  });
  document.getElementById('community-leaderboard-btn')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}/leaderboards`);
  });
  document.getElementById('community-shrine-btn')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}/leaderboards/streak`);
  });
  document.getElementById('community-gallery-btn')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}/skins`);
  });

  // Authenticated community link buttons (-auth suffix)
  document.getElementById('community-profile-btn-auth')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}${discordUsername ? WebRoutes.profile(discordUsername) : WebRoutes.me()}`);
  });
  document.getElementById('community-leaderboard-btn-auth')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}/leaderboards`);
  });
  document.getElementById('community-shrine-btn-auth')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}/leaderboards/streak`);
  });
  document.getElementById('community-gallery-btn-auth')?.addEventListener('click', () => {
    openExternal(`${SITE_URL}/skins`);
  });

  // ── skins-changed (Make your own Dr. Vibe saved, renamed, wore or deleted one)
  // Refresh the grid without saving: the main window already wears `wearing`.
  window.__TAURI__?.event?.listen?.('skins-changed', async (event) => {
    const wearing = event?.payload?.wearing || els.selectedSkin()?.value || 'dr-vibe-default';
    await populateSkins(wearing);
    selectSkinCard(wearing);
    checkSkinEligibility(wearing).catch(() => {});
  });

  // ── skin-installed event (fired by deep link handler in Rust) ────────────
  if (window.__TAURI__?.event) {
    window.__TAURI__.event.listen('skin-installed', async (event) => {
      const payload = event?.payload;
      const slug = typeof payload === 'string' ? payload : payload?.slug;
      const updated = typeof payload === 'object' && payload ? !!payload.updated : false;
      if (!slug) return;
      invalidateInventory(); // skin install may change ownership
      await populateSkins(slug);
      selectSkinCard(slug);
      checkSkinEligibility(slug).catch(() => {});
      debouncedSave();
      let displayName = slug;
      try {
        const invoke = window.__TAURI__?.core?.invoke;
        if (invoke) {
          const animJson = await invoke('read_skin_anim', { name: slug });
          if (animJson) {
            const meta = JSON.parse(animJson);
            if (meta.name) displayName = meta.name;
          }
        }
      } catch {}
      setImportStatus(`"${displayName}" ${updated ? 'updated' : 'installed'}!`, 'success');
      try {
        const { emitTo } = window.__TAURI__.event;
        await emitTo('main', 'community-skin-installed', { slug, updated: !!updated });
      } catch {
        // ignore cross-window emit failures
      }
    });

    window.__TAURI__.event.listen('skin-install-error', (event) => {
      const { error } = event.payload;
      setImportStatus(`Install failed: ${error}`, 'error');
    });
  }

  // ── Delete skin ───────────────────────────────────────────────────────────
  const skinDeleteBtn = document.getElementById('skin-delete-btn');
  if (skinDeleteBtn) {
    let deleteConfirmPending = false;
    let deleteConfirmTimer = null;
    skinDeleteBtn.addEventListener('click', async () => {
      if (!deleteConfirmPending) {
        deleteConfirmPending = true;
        skinDeleteBtn.textContent = 'Confirm?';
        skinDeleteBtn.style.color = '#f87171';
        skinDeleteBtn.style.borderColor = '#7a3030';
        deleteConfirmTimer = setTimeout(() => {
          deleteConfirmPending = false;
          skinDeleteBtn.textContent = 'Delete';
          skinDeleteBtn.style.color = '';
          skinDeleteBtn.style.borderColor = '';
        }, 2500);
        return;
      }
      clearTimeout(deleteConfirmTimer);
      deleteConfirmPending = false;
      skinDeleteBtn.textContent = 'Delete';
      skinDeleteBtn.style.color = '';
      skinDeleteBtn.style.borderColor = '';
      const skinName = els.selectedSkin().value;
      if (!skinName) return;
      const displayName = document.getElementById('skin-detail-name')?.textContent || skinName;
      try {
        const invoke = window.__TAURI__.core.invoke;
        await invoke('delete_skin', { name: skinName });
        await populateSkins('dr-vibe-default');
        selectSkinCard('dr-vibe-default');
        checkSkinEligibility('dr-vibe-default').catch(() => {});
        debouncedSave();
        setImportStatus(`"${displayName}" deleted.`, 'success');
      } catch (err) {
        setImportStatus(String(err), 'error');
      }
    });
  }

  // ── Gallery Account: connect / disconnect ────────────────────────────────
  // Opens drvibe.io/connect — the player signs in with GitHub or Discord there,
  // and the site redirects back via dr-vibe://auth-callback?token=...&username=...
  for (const id of ['account-connect-btn', 'account-connect-discord-btn']) {
    const btn = document.getElementById(id);
    btn?.addEventListener('click', async () => {
      // Rust opens /connect with a PKCE challenge (API.md §2).
      try { await window.__TAURI__?.core?.invoke('start_device_link', { provider: btn.dataset.provider }); }
      catch (e) { console.error('[account] could not start linking:', e); }
    });
  }

  const accountDisconnectBtn = document.getElementById('account-disconnect-btn');
  if (accountDisconnectBtn) {
    accountDisconnectBtn.addEventListener('click', async () => {
      apiToken       = null;
      discordUsername    = null;
      discordDisplayName = null;
      discordAvatarUrl   = null;
      try {
        const invoke = window.__TAURI__?.core?.invoke;
        if (invoke) await invoke('disconnect_profile');
      } catch { /* ignore */ }
      renderAccountStatus();
    });
  }

  // ── account-profile-updated (Rust, the poll saw a new name or picture) ─
  if (window.__TAURI__?.event) {
    window.__TAURI__.event.listen('account-profile-updated', (event) => {
      const { username, displayName, avatarUrl } = event.payload || {};
      if (!apiToken || !username) return;
      discordUsername    = username;
      discordDisplayName = displayName || null;
      discordAvatarUrl   = avatarUrl   || null;
      renderAccountStatus();
    });
  }

  // ── account-linked (Rust, after the dr-vibe://auth/callback code exchange) ─
  if (window.__TAURI__?.event) {
    window.__TAURI__.event.listen('account-linked', async (event) => {
      const { username, displayName, avatarUrl } = event.payload || {};
      apiToken           = true;
      discordUsername    = username    || null;
      discordDisplayName = displayName || null;
      discordAvatarUrl   = avatarUrl   || null;
      // The token is in the OS keyring (Rust); just update the UI.
      renderAccountStatus();
      // The Inventory section still shows the signed-out prompt: fetch the collection.
      refreshInventorySection();
      // Auto-navigate to Community tab so the user sees their connected state immediately
      document.querySelector('.tab-btn[data-tab="community"]')?.click();
      try {
        const { emitTo } = window.__TAURI__.event;
        await emitTo('main', 'community-account-connected', { username: discordUsername });
      } catch {
        // ignore cross-window emit failures
      }
    });
  }

  // Reload account when the window regains focus — handles the case where the
  // auth callback fired while this window wasn't actively receiving events.
  // Rust writes directly to the store, so loadAccount() will pick it up here.
  // Inventory is intentionally NOT refreshed here — it's fetched on settings
  // open and via the explicit refresh button. Auto-refreshing on every focus
  // raced with in-flight fetches and produced duplicate cards.
  window.addEventListener('focus', () => {
    loadAccount().catch(() => {});
  });

  // --- Developer mode: Ctrl+Shift+A reveals the toggle (debug builds only) ---
  const tbAdminToggle = document.getElementById('tb-admin-toggle');
  document.addEventListener('keydown', (e) => {
    if (IS_DEV && e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      if (tbAdminToggle) {
        const visible = tbAdminToggle.style.display === 'flex';
        tbAdminToggle.style.display = visible ? 'none' : 'flex';
      }
    }
  });

  // Skin search box + Clear button — filters the skin grid by name/slug
  const skinSearchInput = document.getElementById('skin-search-input');
  const skinSearchClear = document.getElementById('skin-search-clear');
  if (skinSearchInput) {
    skinSearchInput.addEventListener('input', () => {
      _skinFilterText = skinSearchInput.value || '';
      filterSkinGrid();
    });
  }
  if (skinSearchClear) {
    skinSearchClear.addEventListener('click', () => {
      _skinFilterText = '';
      _skinFilterCat = '';
      if (skinSearchInput) skinSearchInput.value = '';
      const catBar = document.getElementById('skin-cat-bar');
      if (catBar) {
        catBar.querySelectorAll('.skin-cat').forEach(b => b.classList.remove('active'));
        catBar.querySelector('.skin-cat[data-cat=""]')?.classList.add('active');
      }
      filterSkinGrid();
    });
  }

  // Admin mode toggle
  const adminToggle = document.getElementById('admin-mode-toggle');
  if (adminToggle) {
    adminToggle.addEventListener('change', () => {
      adminMode = IS_DEV && adminToggle.checked;
      applyAdminGate();
      // Re-render skin grid to show/hide My Skins section
      populateSkins(els.selectedSkin().value).catch(() => {});
      // Re-evaluate skin eligibility (gallery submit, edit character buttons)
      checkSkinEligibility(els.selectedSkin().value).catch(() => {});
      debouncedSave();
    });
  }

  // Dev server override radios — save on change and show restart banner
  // when the value differs from what we loaded with.
  const devServerBanner = document.getElementById('dev-server-restart-banner');
  document.querySelectorAll('input[name="dev-server"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      debouncedSave();
      if (devServerBanner) {
        devServerBanner.style.display = (radio.value === _initialDevServerOverride) ? 'none' : 'block';
      }
    });
  });

  // "Apply" button — hot-swaps the active web server without restarting:
  //   1. Flush the new override to the settings store (localStorage + tauri store)
  //   2. Tell Rust to update its runtime web_base_url lock
  //   3. Clear the Discord auth token — auth is cryptographically bound to
  //      the old env's HMAC secret and cannot transfer to the new server
  //   4. Reload this window's config.js WEB_BASE binding so any subsequent
  //      fetches from the settings window hit the new URL
  //   5. Fire a cross-window 'server-switched' event so the main window
  //      reloads its WEB_BASE and re-checks the account link
  //   6. Update the admin panel UI: new "current:" readout, hide banner,
  //      refresh account state (will now show disconnected)
  document.getElementById('dev-server-restart-btn')?.addEventListener('click', async () => {
    const newOverride = document.querySelector('input[name="dev-server"]:checked')?.value || 'auto';

    // 1. Flush pending debounced save so the store has the new override.
    try {
      await saveSettings();
    } catch (e) {
      console.error('[admin] saveSettings before server switch failed:', e);
    }

    let newUrl = null;
    try {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) {
        console.warn('[admin] Tauri invoke not available — cannot switch server');
        return;
      }

      // 2. Update Rust's runtime web_base_url and get back the resolved URL.
      try {
        newUrl = await invoke('set_web_base_override', { overrideValue: newOverride });
      } catch (e) {
        console.error('[admin] set_web_base_override failed:', e);
        return;
      }

      // 3. Clear Discord auth (token + profile) — cannot reuse across envs.
      try { await invoke('disconnect_profile'); }
      catch (e) { console.error('[admin] disconnect_profile failed:', e); }

      // 4. Reload WEB_BASE in this settings window.
      try {
        const { reloadWebBase } = await import('./core/config.js');
        reloadWebBase();
      } catch (e) {
        console.error('[admin] reloadWebBase in settings window failed:', e);
      }

      // 5. Broadcast to the main window so it reloads WEB_BASE, reconnects
      //    re-checks the account link and refreshes server-dependent UI.
      try {
        const { emitTo } = window.__TAURI__.event;
        await emitTo('main', 'server-switched', { newUrl, override: newOverride });
      } catch (e) {
        console.error('[admin] emitTo main failed:', e);
      }
    } catch (e) {
      console.error('[admin] server switch flow failed:', e);
    }

    // 6. Update admin panel UI.
    _initialDevServerOverride = newOverride;
    const banner = document.getElementById('dev-server-restart-banner');
    if (banner) banner.style.display = 'none';
    const current = document.getElementById('dev-server-current');
    if (current && newUrl) current.textContent = `current: ${newUrl}`;

    // Refresh account card in this window — now disconnected.
    try { await loadAccount(); } catch (e) { console.error('[admin] loadAccount refresh failed:', e); }
  });

}

// --- Privacy tab ---
// Privacy settings are owned by the main window (PrivacySync), which sends
// them to the site only when changed. This tab shows them and forwards edits.
const PRIVACY_FIELDS = {
  profileVisibility:    { id: 'privacy-visibility', kind: 'select' },
  showProjectNames:     { id: 'privacy-project-names', kind: 'check' },
  showOnVibeMap:        { id: 'privacy-vibe-map', kind: 'check' },
  appearInLeaderboards: { id: 'privacy-leaderboards', kind: 'check' },
  visitsFrom:           { id: 'privacy-visits', kind: 'select' },
};

async function loadPrivacyTab() {
  const saved = (await readSection('privacy')) || {};
  const settings = { ...PRIVACY_DEFAULTS, ...(saved.settings || {}) };
  for (const [key, f] of Object.entries(PRIVACY_FIELDS)) {
    const el = document.getElementById(f.id);
    if (!el) continue;
    if (f.kind === 'check') el.checked = !!settings[key];
    else el.value = settings[key];
  }
  renderPrivacyStatus(saved.pending);
  renderWhatDrVibeSees(document.getElementById('privacy-what-sees'), { linked: !!apiToken });
  const crash = document.getElementById('privacy-error-reports');
  if (crash) crash.checked = await getErrorReportsEnabled();
}

function renderPrivacyStatus(pending) {
  const el = document.getElementById('privacy-status');
  if (!el) return;
  if (!pending) el.textContent = '';
  else el.textContent = apiToken
    ? 'Saved here; sending to drvibe.io…'
    : 'Saved here. Sent to drvibe.io when you join the community.';
}

function setupPrivacyTab() {
  for (const [key, f] of Object.entries(PRIVACY_FIELDS)) {
    document.getElementById(f.id)?.addEventListener('change', (e) => {
      const value = f.kind === 'check' ? e.target.checked : e.target.value;
      try {
        window.__TAURI__?.event?.emitTo?.('main', 'privacy-changed', { [key]: value });
      } catch (err) {
        console.error('[privacy] failed to forward change:', err);
      }
      renderPrivacyStatus(true);
      // Re-read once main has had a moment to store (and maybe send) it.
      setTimeout(() => loadPrivacyTab().catch(() => {}), 1500);
    });
  }
  els.hideWhenPresenting()?.addEventListener('change', debouncedSave);
  els.shareWeeklyRecap()?.addEventListener('change', debouncedSave);
  document.getElementById('privacy-error-reports')?.addEventListener('change', async (e) => {
    try {
      e.target.checked = await setErrorReportsEnabled(e.target.checked);
    } catch (err) {
      console.error('[privacy] crash report switch failed:', err);
      e.target.checked = await getErrorReportsEnabled();
    }
  });

  document.getElementById('privacy-policy-btn')?.addEventListener('click', () => openUrl(`${SITE_URL}${WebRoutes.privacy()}`));
  document.getElementById('privacy-terms-btn')?.addEventListener('click', () => openUrl(`${SITE_URL}${WebRoutes.terms()}`));

  let lastSyncBody = '';
  document.getElementById('privacy-last-sync-btn')?.addEventListener('click', async () => {
    const box = document.getElementById('privacy-last-sync');
    const meta = document.getElementById('privacy-last-sync-meta');
    const pre = document.getElementById('privacy-last-sync-body');
    if (!box || !meta || !pre) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    let rec = null;
    try { rec = await window.__TAURI__?.core?.invoke?.('get_last_sync'); } catch { rec = null; }
    box.style.display = '';
    if (!rec?.body) {
      meta.textContent = apiToken ? 'Nothing has been sent yet. The first sync runs a few minutes after you start coding.' : 'Nothing has been sent. Dr. Vibe syncs only after you join the community.';
      pre.textContent = '';
      lastSyncBody = '';
      return;
    }
    lastSyncBody = rec.body;
    meta.textContent = `${rec.endpoint} — ${new Date(rec.sentAt).toLocaleString()}`;
    pre.textContent = formatSyncBody(rec.body);
  });
  document.getElementById('privacy-last-sync-copy')?.addEventListener('click', async () => {
    if (!lastSyncBody) return;
    try { await navigator.clipboard.writeText(lastSyncBody); } catch { /* clipboard unavailable */ }
  });
}

/** Pretty-print the exact JSON body; long strings (the sprite PNG) are shortened for reading. */
function formatSyncBody(body) {
  try {
    return JSON.stringify(JSON.parse(body), (_k, val) =>
      (typeof val === 'string' && val.length > 200)
        ? `${val.slice(0, 60)}… (${val.length - 60} more characters — use Copy full payload)`
        : val, 2);
  } catch {
    return body;
  }
}

// --- Init ---
try {
  setupListeners();
  setupPrivacyTab();
  // Sync WEB_BASE/SITE_URL with whatever Rust resolved at startup —
  // honors DR_VIBE_WEB_BASE_URL set by `npm run dev:prod` etc. — then load.
  syncWebBaseFromRust()
    .catch(e => console.error('syncWebBaseFromRust failed:', e))
    .then(() => loadAccount()
      .catch(e => console.error('Account load failed:', e))
      .then(() => loadSettings().catch(e => console.error('Settings load failed:', e)))
      .then(() => loadPrivacyTab().catch(e => console.error('Privacy load failed:', e))));

  // If the main window opened settings specifically for auth, jump to Community tab
  const pendingTab = localStorage.getItem('drvibe-open-tab');
  if (pendingTab) {
    localStorage.removeItem('drvibe-open-tab');
    // Defer until after tab setup so the click lands on a ready tab
    setTimeout(() => document.querySelector(`.tab-btn[data-tab="${pendingTab}"]`)?.click(), 0);
  }
} catch (e) {
  console.error('Settings init failed:', e);
}
