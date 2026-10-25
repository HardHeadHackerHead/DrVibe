// Dr. Vibe - Dashboard Window
// Consolidates all tracked stats into a tabbed dashboard interface.
// Reads persisted data from Tauri stores, receives live data from main window.

import { ACHIEVEMENT_LIST, MASTERY_TRACK_LIST } from './features/achievements/AchievementDefinitions.js';
import { LANGUAGE_COLORS, MILESTONES } from './features/skills/SkillTracker.js';
import { METRICS } from './features/personalBest/PersonalBestTracker.js';
import { initTheme } from './core/theme.js';
import { mountCommunityTab } from './ui/CommunityTab.js';
import { openUrl } from './core/openUrl.js';
import { WEB_BASE, syncWebBaseFromRust } from './core/config.js';
import { WebRoutes } from './core/api/endpoints.js';
import { installErrorReporter } from './core/errorReporter.js';

installErrorReporter();
initTheme();

const STREAK_MILESTONES = [7, 14, 21, 30, 50, 100, 200, 365];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CATEGORY_ORDER = [
  'milestone', 'streak', 'momentum', 'session', 'timer',
  'focus', 'wellness', 'skills', 'personal_best',
  'community', 'git', 'time', 'resilience', 'variety', 'endurance',
];
const CATEGORY_META = {
  milestone: { label: 'Milestones', color: '#facc15' },
  streak: { label: 'Streak', color: '#fb923c' },
  momentum: { label: 'Momentum', color: '#ef4444' },
  session: { label: 'Session', color: '#4ade80' },
  timer: { label: 'Timer', color: '#60a5fa' },
  focus: { label: 'Focus', color: '#6366f1' },
  wellness: { label: 'Wellness', color: '#2dd4bf' },
  skills: { label: 'Skills', color: '#a78bfa' },
  personal_best: { label: 'Personal Best', color: '#fb923c' },
  community: { label: 'Community', color: '#f472b6' },
  git: { label: 'Git', color: '#94a3b8' },
  time: { label: 'Time', color: '#22d3ee' },
  resilience: { label: 'Resilience', color: '#84cc16' },
  variety: { label: 'Variety', color: '#c084fc' },
  endurance: { label: 'Endurance', color: '#f59e0b' },
};
const MASTERY_LEVEL_NAMES = ['Rookie', 'Builder', 'Adept', 'Expert', 'Master'];

// ---- Helpers ----

function formatSeconds(s) {
  if (!s || s <= 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getTodayISO() {
  return localDay();
}

function getMomentumColor(level) {
  const colors = { cold: '#808080', warming: '#60a5fa', flowing: '#4ade80', hot: '#fb923c', fire: '#ef4444' };
  return colors[level] || '#808080';
}

function getStreakLevel(current) {
  if (current >= 100) return 'Legendary';
  if (current >= 30) return 'Fire';
  if (current >= 14) return 'Hot';
  if (current >= 7) return 'Warming';
  if (current >= 1) return 'Starting';
  return 'None';
}

function toTitleCase(s) {
  return String(s || '')
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getCategoryMeta(category) {
  return CATEGORY_META[category] || {
    label: toTitleCase(category),
    color: '#6b7280',
  };
}

function getMasteryLevelName(level) {
  if (!level || level <= 0) return 'Unranked';
  const idx = Math.max(0, Math.min(level - 1, MASTERY_LEVEL_NAMES.length - 1));
  return MASTERY_LEVEL_NAMES[idx];
}

function el(id) {
  return document.getElementById(id);
}

// ---- Store Loading ----

import { readSections } from './core/DatabaseReader.js';
import { localDay } from './core/localDay.js';

async function loadAllData() {
  const data = await readSections(
    'achievements', 'skills', 'streak', 'personalBest', 'session', 'settings'
  );

  // Achievements: merge definitions with saved state
  const achState = data.achievements?.state || {};
  const achievements = {};
  for (const def of ACHIEVEMENT_LIST) {
    const saved = achState[def.id];
    achievements[def.id] = {
      ...def,
      unlocked: saved?.unlocked || false,
      unlockedAt: saved?.unlockedAt || null,
      progress: saved?.progress ?? 0,
    };
  }

  // Mastery tracks: merge definitions with saved state
  const masteryState = data.achievements?.masteryState || {};
  const mastery = {};
  for (const def of MASTERY_TRACK_LIST) {
    const saved = masteryState[def.id] || {};
    const level = Math.max(0, Math.min(Number(saved.level) || 0, def.levels.length));
    const progress = Math.max(0, Number(saved.progress) || 0);
    const maxLevel = def.levels.length;
    const nextThreshold = level < maxLevel ? def.levels[level] : null;
    const currentThreshold = level > 0 ? def.levels[level - 1] : 0;
    const range = nextThreshold === null ? 1 : Math.max(1, nextThreshold - currentThreshold);
    const levelProgress = nextThreshold === null
      ? 1
      : Math.min(1, Math.max(0, (progress - currentThreshold) / range));

    mastery[def.id] = {
      ...def,
      trackType: 'mastery',
      progress,
      level,
      maxLevel,
      levelName: getMasteryLevelName(level),
      nextThreshold,
      currentThreshold,
      levelProgress,
      isMaxLevel: level >= maxLevel,
      lastLeveledAt: saved.lastLeveledAt || null,
    };
  }

  return {
    achievements,
    mastery,
    skills: data.skills || {},
    streak: data.streak || {
      current: 0, max: 0, lastCodingDate: null, startDate: null,
      milestonesReached: [], previousStreak: 0,
    },
    personalBests: {
      bests: data.personalBest?.bests || {},
      history: data.personalBest?.history || [],
    },
    sessionHistory: data.session?.history || [],
    settings: data.settings || {},
  };
}

// ---- State ----

let allData = {
  achievements: {},
  mastery: {},
  skills: {},
  streak: {},
  personalBests: { bests: {}, history: [] },
  sessionHistory: [],
  settings: {},
};

let liveData = {
  sessionStats: null,
  momentum: { momentum: 0, level: 'cold', filesActive: 0, recentEvents: 0 },
  hydrationCount: 0,
  streakData: null,
  streakShown: null, // StreakDisplay.get(): { current, longest, includesGithub, source, githubHint }
  eventHistory: [],
  stateTimeline: [],
  vibePoints: null,
  vibePointsLifetime: null,
  quests: null,
};

const STATE_COLORS = {
  idle:        '#4a90d9',
  coding:      '#4ade80',
  thinking:    '#facc15',
  tired:       '#9ca3af',
  excited:     '#f472b6',
  alert:       '#f87171',
  focused:     '#6366f1',
  concerned:   '#f59e0b',
  coverEyes:   '#a78bfa',
  stretching:  '#f97316',
  beaker:      '#67e8f9',
  thumbsUp:    '#4ade80',
  celebrating: '#f472b6',
  presenting:  '#2dd4bf',
  libraryCard: '#fbbf24',
  levitating:  '#a78bfa',
  walkRight:   '#60a5fa',
  walkLeft:    '#60a5fa',
};

let currentRange = 7;
let currentEventFilter = 'all';
let achievementSearchQuery = '';
let achievementStatusFilter = 'all'; // all | unlocked | in_progress | locked
let achievementTrackFilter = 'all'; // all | classic | mastery
const achievementCollapsedGroups = {};

// ---- Tab System ----

let communityTab = null;

function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = el('tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
      if (btn.dataset.tab === 'community') communityTab?.start();
      else communityTab?.stop();
    });
  });
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesAchievementStatus(achievement, filter) {
  if (filter === 'unlocked') return !!achievement.unlocked;
  if (filter === 'in_progress') return !achievement.unlocked && (Number(achievement.progress) || 0) > 0;
  if (filter === 'locked') return !achievement.unlocked && (Number(achievement.progress) || 0) <= 0;
  return true;
}

function matchesAchievementSearch(achievement, query) {
  if (!query) return true;
  const categoryLabel = getCategoryMeta(achievement.category).label;
  const haystack = normalizeSearchText([
    achievement.title,
    achievement.description,
    achievement.category,
    categoryLabel,
  ].join(' '));
  return haystack.includes(query);
}

function matchesMasteryStatus(track, filter) {
  if (filter === 'unlocked') return !!track.isMaxLevel;
  if (filter === 'in_progress') return !track.isMaxLevel && (Number(track.progress) || 0) > 0;
  if (filter === 'locked') return (Number(track.progress) || 0) <= 0;
  return true;
}

function matchesMasterySearch(track, query) {
  if (!query) return true;
  const categoryLabel = getCategoryMeta(track.category).label;
  const haystack = normalizeSearchText([
    track.title,
    track.description,
    track.category,
    categoryLabel,
    track.unit,
  ].join(' '));
  return haystack.includes(query);
}

function syncAchievementControlsUI() {
  const searchEl = el('ach-search');
  if (searchEl && searchEl.value !== achievementSearchQuery) {
    searchEl.value = achievementSearchQuery;
  }

  const statusSelect = el('ach-status-select');
  if (statusSelect && statusSelect.value !== achievementStatusFilter) {
    statusSelect.value = achievementStatusFilter;
  }

  const trackSelect = el('ach-track-select');
  if (trackSelect && trackSelect.value !== achievementTrackFilter) {
    trackSelect.value = achievementTrackFilter;
  }
}

function setupAchievementsControls() {
  const tabEl = el('tab-achievements');
  if (!tabEl) return;

  const searchEl = el('ach-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      achievementSearchQuery = searchEl.value || '';
      renderAchievements();
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!searchEl.value) return;
      searchEl.value = '';
      achievementSearchQuery = '';
      renderAchievements();
    });
  }

  const statusSelect = el('ach-status-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      achievementStatusFilter = statusSelect.value || 'all';
      renderAchievements();
    });
  }

  const trackSelect = el('ach-track-select');
  if (trackSelect) {
    trackSelect.addEventListener('change', () => {
      achievementTrackFilter = trackSelect.value || 'all';
      renderAchievements();
    });
  }

  const clearBtn = el('ach-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      achievementSearchQuery = '';
      achievementStatusFilter = 'all';
      achievementTrackFilter = 'all';
      renderAchievements();
    });
  }

  tabEl.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-ach-toggle]');
    if (toggleBtn) {
      const groupKey = toggleBtn.getAttribute('data-ach-toggle');
      if (!groupKey) return;
      achievementCollapsedGroups[groupKey] = !achievementCollapsedGroups[groupKey];
      renderAchievements();
    }
  });
}

// ---- Overview Tab ----

function renderOverview() {
  // The server's builder streak when the app has a fresh one, else local.
  const streak = liveData.streakShown || liveData.streakData || allData.streak;
  const momentum = liveData.momentum;
  const session = liveData.sessionStats;

  // Hero: Streak
  el('hero-streak').textContent = streak.current || 0;
  el('hero-streak-level').textContent = getStreakLevel(streak.current || 0);
  el('hero-streak-github').hidden = !(streak.source === 'server' && streak.includesGithub);
  el('hero-streak-gh-hint').hidden = !liveData.streakShown?.githubHint;

  // Hero: Momentum
  const mVal = momentum.momentum || 0;
  el('hero-momentum').textContent = mVal;
  const mBar = el('hero-momentum-bar');
  mBar.style.width = mVal + '%';
  mBar.style.backgroundColor = getMomentumColor(momentum.level);

  // Hero: Hydration
  el('hero-hydration').textContent = liveData.hydrationCount || 0;

  // Hero: Vibe Points
  const vp = liveData.vibePoints;
  const lifetime = liveData.vibePointsLifetime;
  if (vp !== null && vp !== undefined) {
    el('hero-vp').textContent = Number(vp).toLocaleString('en-US');
    if (lifetime && (lifetime.totalEarned !== null || lifetime.totalSpent !== null)) {
      const earned = (lifetime.totalEarned ?? 0).toLocaleString('en-US');
      const spent = (lifetime.totalSpent ?? 0).toLocaleString('en-US');
      el('hero-vp-sub').textContent = `+${earned} / -${spent}`;
    } else {
      el('hero-vp-sub').textContent = 'earn & spend';
    }
  } else {
    el('hero-vp').textContent = '—';
    el('hero-vp-sub').textContent = 'connect to view';
  }

  // Quests
  renderQuests();

  // Mastery progression (compact, overview card)
  renderMasteryOverview();

  // Today's session
  if (session) {
    el('today-coding-time').textContent = formatSeconds(session.codingSeconds);
    el('today-files').textContent = (session.filesCreated || 0) + (session.filesModified || 0);
    el('today-project').textContent = session.projectName || '--';
  }

  // Languages count
  const langCount = Object.keys(allData.skills).length;
  el('today-languages').textContent = langCount;

  // Personal bests
  renderPersonalBestsGrid('overview-bests', allData.personalBests.bests);

  // Weekly chart
  renderWeeklyChart();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderQuests() {
  const container = el('quests-card');
  if (!container) return;

  const quests = liveData.quests;

  // Not connected / offline / no data yet
  if (!Array.isArray(quests) || quests.length === 0) {
    container.innerHTML = `
      <div class="quests-empty" id="quests-empty">
        ${quests === null
          ? 'Join the community to see daily and weekly quests.'
          : 'No active quests right now. Check back tomorrow!'}
      </div>`;
    return;
  }

  // Sort: active first, then completed (unclaimed), then claimed last
  const sorted = [...quests].sort((a, b) => {
    const rank = (q) => q.claimed ? 2 : q.completed ? 0 : 1;
    return rank(a) - rank(b);
  });

  const html = sorted.map((q) => {
    const pct = Math.min(100, Math.round((q.progress / q.goalTarget) * 100));
    const periodClass = q.period === 'WEEKLY' ? 'weekly' : 'daily';
    const itemClass = q.claimed ? 'claimed' : (q.completed ? 'completed' : '');
    const fillClass = q.claimed ? 'claimed' : '';
    const claimBtn = q.completed && !q.claimed
      ? `<button class="quest-claim-btn" data-quest-id="${escapeHtml(q.userQuestId)}">Claim +${q.rewardVp} VP</button>`
      : '';
    const status = q.claimed
      ? '<span style="color: var(--muted); font-size: 10px;">Claimed ✓</span>'
      : '';
    return `
      <div class="quest-item ${itemClass}">
        <div class="quest-row-1">
          <div class="quest-title">
            <span class="quest-period-badge ${periodClass}">${q.period}</span>
            ${escapeHtml(q.title)}
          </div>
          <div class="quest-reward">+${q.rewardVp} VP</div>
        </div>
        <div class="quest-desc">${escapeHtml(q.description)}</div>
        <div class="quest-progress-row">
          <div class="quest-progress-bar">
            <div class="quest-progress-fill ${fillClass}" style="width: ${pct}%;"></div>
          </div>
          <div class="quest-progress-num">${q.progress}/${q.goalTarget}</div>
        </div>
        ${claimBtn || status}
      </div>`;
  }).join('');

  container.innerHTML = html;

  // Wire claim buttons — send an IPC event to main, which handles the POST
  // and re-pushes updated quest data back.
  container.querySelectorAll('.quest-claim-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const userQuestId = e.currentTarget.dataset.questId;
      if (!userQuestId) return;
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Claiming...';
      try {
        const { emitTo } = window.__TAURI__.event;
        await emitTo('main', 'dashboard-claim-quest', { userQuestId });
      } catch (err) {
        console.warn('[dashboard] claim failed:', err);
        e.currentTarget.disabled = false;
      }
    });
  });
}

function renderMasteryOverview() {
  const container = el('mastery-card');
  if (!container) return;

  const tracks = Object.values(allData.mastery || {});
  if (tracks.length === 0) {
    container.innerHTML = '<div class="mastery-empty">No mastery tracks active yet.</div>';
    return;
  }

  // Sort: highest level first, then by progress toward next level (desc).
  const sorted = [...tracks].sort((a, b) => {
    const levelDiff = (b.level || 0) - (a.level || 0);
    if (levelDiff !== 0) return levelDiff;
    return (b.progress || 0) - (a.progress || 0);
  });

  const html = sorted.map((track) => {
    const levels = Array.isArray(track.levels) ? track.levels : [];
    const level = Number(track.level || 0);
    const progress = Number(track.progress || 0);
    const majorLevels = Array.isArray(track.majorLevels) ? track.majorLevels : [];

    // Cumulative threshold to hit the NEXT level.
    // track.levels is the flat list [L1, L2, L3, L4, L5].
    const isMaxed = level >= levels.length;
    const nextThreshold = isMaxed ? (levels[levels.length - 1] ?? 0) : (levels[level] ?? 0);
    const currentBase = level > 0 ? (levels[level - 1] ?? 0) : 0;
    const segmentProgress = Math.max(0, progress - currentBase);
    const segmentSize = Math.max(1, nextThreshold - currentBase);
    const pct = isMaxed ? 100 : Math.min(100, Math.round((segmentProgress / segmentSize) * 100));

    const isMajor = majorLevels.includes(level) && level > 0;
    const fillClass = isMaxed ? 'maxed' : '';
    const levelClass = isMajor || isMaxed ? 'major' : '';
    const levelLabel = isMaxed
      ? `MAX · LVL ${level}`
      : level > 0
        ? `LVL ${level}`
        : 'locked';

    const icon = track.icon ? `<span class="mastery-track-icon">${track.icon}</span>` : '';
    const title = escapeHtml(track.title || track.id || 'Mastery');
    const unit = escapeHtml(track.unit || '');
    const progressLabel = isMaxed
      ? `${progress.toLocaleString()} ${unit}`
      : `${progress.toLocaleString()} / ${nextThreshold.toLocaleString()} ${unit}`;

    return `
      <div class="mastery-track">
        <div class="mastery-track-row">
          <div class="mastery-track-title">${icon}${title}</div>
          <div class="mastery-track-level ${levelClass}">${levelLabel}</div>
        </div>
        <div class="mastery-progress-row">
          <div class="mastery-progress-bar">
            <div class="mastery-progress-fill ${fillClass}" style="width: ${pct}%;"></div>
          </div>
          <div class="mastery-progress-num">${progressLabel}</div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;
}

function renderPersonalBestsGrid(containerId, bests) {
  const container = el(containerId);
  if (!container) return;

  let html = '';
  for (const [key, meta] of Object.entries(METRICS)) {
    const best = bests[key];
    const value = best?.value ? meta.format(best.value) : '--';
    const date = best?.date ? formatDate(best.date) : '';
    html += `
      <div class="pb-card">
        <div class="pb-label">${meta.label}</div>
        <div class="pb-value">${value}</div>
        ${date ? `<div class="pb-date">${date}</div>` : ''}
      </div>`;
  }
  container.innerHTML = html;
}

function renderWeeklyChart() {
  const container = el('weekly-chart');
  if (!container) return;

  const today = new Date();
  const todayISO = getTodayISO();
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = localDay(d);
    const entry = allData.sessionHistory.find(h => h.date === iso);
    days.push({
      label: DAY_NAMES[d.getDay()],
      seconds: entry?.codingSeconds || 0,
      isToday: iso === todayISO,
    });
  }

  // Add current session's coding time to today
  if (liveData.sessionStats?.codingSeconds) {
    const todayEntry = days.find(d => d.isToday);
    if (todayEntry) {
      todayEntry.seconds += liveData.sessionStats.codingSeconds;
    }
  }

  const maxSeconds = Math.max(...days.map(d => d.seconds), 1);

  container.innerHTML = days.map(d => {
    const heightPct = Math.max((d.seconds / maxSeconds) * 100, 2);
    const cls = d.isToday ? 'day-bar today' : 'day-bar';
    const title = formatSeconds(d.seconds);
    return `
      <div class="day-bar-wrapper">
        <div class="${cls}" style="height: ${heightPct}%;" title="${title}"></div>
        <div class="day-label">${d.label}</div>
      </div>`;
  }).join('');
}

// ---- Achievements Tab ----

function buildAchievementCard(achievement, categoryLabel) {
  const cls = achievement.unlocked ? 'unlocked' : 'locked';
  const progress = Math.max(0, Number(achievement.progress) || 0);
  const maxProgress = Math.max(1, Number(achievement.maxProgress) || 1);
  const progressPct = maxProgress > 1
    ? Math.round(Math.min((progress / maxProgress) * 100, 100))
    : (achievement.unlocked ? 100 : 0);
  const dateStr = achievement.unlockedAt
    ? new Date(achievement.unlockedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return `
    <div class="achievement-card ${cls}">
      <div class="ach-head">
        <div class="ach-title-wrap">
          <div class="ach-icon">${achievement.icon}</div>
          <div>
            <div class="ach-title">${achievement.title}</div>
            <div class="ach-sub">${categoryLabel}</div>
          </div>
        </div>
      </div>
      <div class="ach-desc">${achievement.description}</div>
      <div class="ach-progress">
        ${maxProgress > 1 ? `
          <div class="progress-bar">
            <div class="progress-fill ${achievement.unlocked ? 'gold' : ''}" style="width: ${progressPct}%;"></div>
          </div>
          <div class="ach-progress-meta">
            <span>${progress} / ${maxProgress}</span>
            <span>${progressPct}%</span>
          </div>
        ` : ''}
        ${achievement.unlocked && dateStr ? `<div class="ach-date">Unlocked ${dateStr}</div>` : ''}
      </div>
    </div>`;
}

function getAchievementProgressRatio(achievement) {
  const maxProgress = Math.max(1, Number(achievement.maxProgress) || 1);
  const progress = Math.max(0, Number(achievement.progress) || 0);
  if (achievement.unlocked) return 1;
  if (maxProgress <= 1) return 0;
  return Math.min(progress / maxProgress, 1);
}

function buildClosestUnlockItem(entry) {
  const achievement = entry.achievement;
  const pct = Math.round(Math.max(0, Math.min(entry.ratio * 100, 100)));
  const label = getCategoryMeta(achievement.category).label;
  const detail = entry.maxProgress > 1
    ? `${entry.progress} / ${entry.maxProgress}`
    : 'One action unlock';
  const remaining = entry.maxProgress > 1
    ? `${entry.remaining} remaining`
    : 'Do it once to unlock';

  return `
    <div class="ach-closest-item">
      <div class="ach-closest-head">
        <div class="ach-title-wrap">
          <div class="ach-icon">${achievement.icon}</div>
          <div>
            <div class="ach-title">${achievement.title}</div>
            <div class="ach-sub">${label}</div>
          </div>
        </div>
        <span class="ach-closest-pct">${pct}%</span>
      </div>
      <div class="ach-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${pct}%;"></div>
        </div>
        <div class="ach-progress-meta">
          <span>${detail}</span>
          <span>${remaining}</span>
        </div>
      </div>
    </div>`;
}

function buildMasteryCard(track) {
  const level = Math.max(0, Number(track.level) || 0);
  const maxLevel = Math.max(1, Number(track.maxLevel) || (track.levels?.length || 1));
  const progress = Math.max(0, Number(track.progress) || 0);
  const nextThreshold = track.nextThreshold ?? (level < maxLevel ? track.levels?.[level] ?? null : null);
  const currentThreshold = track.currentThreshold ?? (level > 0 ? track.levels?.[level - 1] ?? 0 : 0);
  const range = nextThreshold === null ? 1 : Math.max(1, nextThreshold - currentThreshold);
  const pct = nextThreshold === null
    ? 100
    : Math.round(Math.max(0, Math.min(((progress - currentThreshold) / range) * 100, 100)));
  const levelName = level > 0 ? (track.levelName || getMasteryLevelName(level)) : 'Unranked';
  const categoryLabel = getCategoryMeta(track.category).label;
  const status = nextThreshold === null
    ? 'Max level reached'
    : `${Math.max(0, nextThreshold - progress)} ${track.unit} to next level`;

  return `
    <div class="achievement-card mastery-card ${track.isMaxLevel ? 'unlocked' : ''}">
      <div class="ach-head">
        <div class="ach-title-wrap">
          <div class="ach-icon">${track.icon}</div>
          <div>
            <div class="ach-title">${track.title}</div>
            <div class="ach-sub">${categoryLabel}</div>
          </div>
        </div>
        <span class="ach-level ${track.isMaxLevel ? 'max' : ''}">Lvl ${level} ${levelName}</span>
      </div>
      <div class="ach-desc">${track.description}</div>
      <div class="ach-progress">
        <div class="progress-bar">
          <div class="progress-fill ${track.isMaxLevel ? 'gold' : ''}" style="width: ${pct}%;"></div>
        </div>
        <div class="ach-progress-meta">
          <span>${progress} ${track.unit}</span>
          <span>${nextThreshold === null ? 'MAX' : `Lv ${level + 1} @ ${nextThreshold}`}</span>
        </div>
        <div class="ach-date">${status}</div>
      </div>
    </div>`;
}

function renderAchievements() {
  const groupsEl = el('achievement-groups');
  if (!groupsEl) return;

  syncAchievementControlsUI();

  const achs = Object.values(allData.achievements || {});
  const masteryTracksAll = Object.values(allData.mastery || {});
  const query = normalizeSearchText(achievementSearchQuery);
  const showClassic = achievementTrackFilter !== 'mastery';
  const showMastery = achievementTrackFilter !== 'classic';

  const filteredClassic = achs.filter((achievement) => (
    matchesAchievementStatus(achievement, achievementStatusFilter)
    && matchesAchievementSearch(achievement, query)
  ));
  const filteredMastery = masteryTracksAll.filter((track) => (
    matchesMasteryStatus(track, achievementStatusFilter)
    && matchesMasterySearch(track, query)
  ));

  const unlockedCount = achs.filter(a => a.unlocked).length;
  const inProgressCount = achs.filter(a => !a.unlocked && (a.progress || 0) > 0).length;
  const masteryActiveCount = masteryTracksAll.filter(t => (t.level || 0) > 0).length;

  const groupedAll = new Map();
  for (const achievement of achs) {
    const key = achievement.category || 'other';
    if (!groupedAll.has(key)) groupedAll.set(key, []);
    groupedAll.get(key).push(achievement);
  }

  const orderIndex = new Map(CATEGORY_ORDER.map((k, i) => [k, i]));
  const sortCategoryKeys = (keys) => keys.sort((a, b) => {
    const ai = orderIndex.has(a) ? orderIndex.get(a) : Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.has(b) ? orderIndex.get(b) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return getCategoryMeta(a).label.localeCompare(getCategoryMeta(b).label);
  });

  const allCategories = sortCategoryKeys([...groupedAll.keys()]);
  const categoryProgress = allCategories.map((category) => {
    const entries = groupedAll.get(category) || [];
    const unlocked = entries.filter(a => a.unlocked).length;
    const pct = entries.length > 0 ? Math.round((unlocked / entries.length) * 100) : 0;
    return { category, meta: getCategoryMeta(category), unlocked, total: entries.length, pct };
  });
  const categoriesComplete = categoryProgress.filter(c => c.total > 0 && c.unlocked >= c.total).length;

  const counterEl = el('ach-counter');
  if (counterEl) counterEl.textContent = `${unlockedCount} / ${achs.length}`;

  const groupedFiltered = new Map();
  for (const achievement of filteredClassic) {
    const key = achievement.category || 'other';
    if (!groupedFiltered.has(key)) groupedFiltered.set(key, []);
    groupedFiltered.get(key).push(achievement);
  }
  const categories = sortCategoryKeys([...groupedFiltered.keys()]);

  const summaryEl = el('ach-summary');
  const visibleClassic = showClassic ? filteredClassic.length : 0;
  const visibleMastery = showMastery ? filteredMastery.length : 0;
  const statusLabelMap = {
    all: 'all',
    unlocked: 'unlocked',
    in_progress: 'in progress',
    locked: 'locked',
  };
  if (summaryEl) {
    summaryEl.innerHTML = `
      <span class="ach-pill"><b>${unlockedCount}</b>unlocked</span>
      <span class="ach-pill"><b>${inProgressCount}</b>in progress</span>
      <span class="ach-pill"><b>${categoriesComplete}/${categoryProgress.length || 0}</b>categories complete</span>
      <span class="ach-pill"><b>${masteryActiveCount}</b>mastery tracks active</span>
      <span class="ach-pill"><b>${visibleClassic + visibleMastery}</b>showing (${statusLabelMap[achievementStatusFilter] || 'all'})</span>
    `;
  }

  if (achs.length === 0 && masteryTracksAll.length === 0) {
    groupsEl.innerHTML = '<div class="empty-state">No achievements available yet.</div>';
    return;
  }

  const closestUnlocks = filteredClassic
    .filter(a => !a.unlocked)
    .map((achievement) => {
      const maxProgress = Math.max(1, Number(achievement.maxProgress) || 1);
      const progress = Math.max(0, Number(achievement.progress) || 0);
      const ratio = getAchievementProgressRatio(achievement);
      const started = maxProgress > 1 && progress > 0;
      const remaining = maxProgress > 1 ? Math.max(0, maxProgress - progress) : 1;
      return { achievement, ratio, progress, maxProgress, started, remaining };
    })
    .sort((a, b) => {
      if (a.ratio !== b.ratio) return b.ratio - a.ratio;
      if (a.started !== b.started) return a.started ? -1 : 1;
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return a.achievement.title.localeCompare(b.achievement.title);
    })
    .slice(0, 3);

  const closestSection = showClassic ? `
    <section class="achievement-group" id="ach-section-closest">
      <div class="achievement-group-header">
        <div class="achievement-group-title-wrap">
          <span class="achievement-group-dot" style="background:#4ade80;"></span>
          <span class="achievement-group-title">Top 3 Closest Unlocks</span>
        </div>
      </div>
      ${closestUnlocks.length > 0
        ? `<div class="ach-closest-list">${closestUnlocks.map(buildClosestUnlockItem).join('')}</div>`
        : '<div class="empty-state">No locked achievements match the current filters.</div>'}
    </section>` : '';

  const completionSection = (showClassic && categoryProgress.length > 0) ? `
    <section class="achievement-group" id="ach-section-completion">
      <div class="achievement-group-header">
        <div class="achievement-group-title-wrap">
          <span class="achievement-group-dot" style="background:#22d3ee;"></span>
          <span class="achievement-group-title">Category Completion</span>
        </div>
      </div>
      <div class="ach-category-list">
        ${categoryProgress.map((group) => `
          <div class="ach-category-item">
            <span class="achievement-group-dot" style="background:${group.meta.color};"></span>
            <span class="ach-category-name">${group.meta.label}</span>
            <span class="ach-category-progress">${group.unlocked}/${group.total}</span>
            <span class="ach-category-pct">${group.pct}%</span>
          </div>
        `).join('')}
      </div>
    </section>` : '';

  const categorySections = showClassic ? categories.map((category) => {
    const meta = getCategoryMeta(category);
    const entries = groupedFiltered.get(category)
      .slice()
      .sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        const ap = (a.maxProgress || 1) > 1 ? (a.progress || 0) / a.maxProgress : (a.unlocked ? 1 : 0);
        const bp = (b.maxProgress || 1) > 1 ? (b.progress || 0) / b.maxProgress : (b.unlocked ? 1 : 0);
        if (ap !== bp) return bp - ap;
        return a.title.localeCompare(b.title);
      });
    const groupUnlocked = entries.filter(a => a.unlocked).length;
    const groupPct = entries.length > 0 ? Math.round((groupUnlocked / entries.length) * 100) : 0;
    const groupKey = `classic:${category}`;
    if (!(groupKey in achievementCollapsedGroups)) {
      achievementCollapsedGroups[groupKey] = entries.length > 0 && groupUnlocked === entries.length;
    }
    const collapsed = !!achievementCollapsedGroups[groupKey];
    const sectionId = `ach-category-${category}`;

    return `
      <section class="achievement-group ${collapsed ? 'is-collapsed' : ''}" id="${sectionId}">
        <div class="achievement-group-header">
          <div class="achievement-group-title-wrap">
            <span class="achievement-group-dot" style="background:${meta.color};"></span>
            <span class="achievement-group-title">${meta.label}</span>
          </div>
          <div class="achievement-group-right">
            <span class="achievement-group-counter">${groupUnlocked} / ${entries.length}</span>
            <button class="ach-collapse-btn" data-ach-toggle="${groupKey}" title="${collapsed ? 'Expand section' : 'Collapse section'}">${collapsed ? '&#x25B8;' : '&#x25BE;'}</button>
          </div>
        </div>
        <div class="achievement-group-meter">
          <div class="achievement-group-meter-fill" style="width:${groupPct}%; background:${meta.color};"></div>
        </div>
        <div class="achievement-grid">
          ${entries.map(a => buildAchievementCard(a, meta.label)).join('')}
        </div>
      </section>`;
  }).join('') : '';

  const noClassicMatchesSection = showClassic && filteredClassic.length === 0 ? `
    <section class="achievement-group">
      <div class="empty-state">No classic achievements match your current search/filter.</div>
    </section>` : '';

  const masterySections = filteredMastery
    .slice()
    .sort((a, b) => {
      const aLevel = Number(a.level) || 0;
      const bLevel = Number(b.level) || 0;
      if (aLevel !== bLevel) return bLevel - aLevel;

      const aProgress = Number(a.levelProgress) || 0;
      const bProgress = Number(b.levelProgress) || 0;
      if (aProgress !== bProgress) return bProgress - aProgress;

      const ai = orderIndex.has(a.category) ? orderIndex.get(a.category) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b.category) ? orderIndex.get(b.category) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;

      return a.title.localeCompare(b.title);
    });

  const masterySection = showMastery ? `
    <section class="achievement-group" id="ach-section-mastery">
      <div class="achievement-group-header">
        <div class="achievement-group-title-wrap">
          <span class="achievement-group-dot" style="background:#a78bfa;"></span>
          <span class="achievement-group-title">Mastery Tracks</span>
        </div>
        <span class="achievement-group-counter">${masterySections.filter(t => t.isMaxLevel).length} maxed</span>
      </div>
      ${masterySections.length > 0
        ? `<div class="achievement-grid">${masterySections.map(buildMasteryCard).join('')}</div>`
        : '<div class="empty-state">No mastery tracks match your current search/filter.</div>'}
    </section>` : '';

  groupsEl.innerHTML = [
    closestSection,
    completionSection,
    noClassicMatchesSection,
    categorySections,
    masterySection,
  ]
    .filter(Boolean)
    .join('');
}

// ---- Skills Tab ----

function renderSkills() {
  const list = el('skill-list');
  if (!list) return;

  const skills = allData.skills;
  const entries = Object.entries(skills)
    .map(([lang, data]) => ({ lang, ...data }))
    .sort((a, b) => (b.totalSeconds || 0) - (a.totalSeconds || 0));

  el('skill-counter').textContent = `${entries.length} language${entries.length !== 1 ? 's' : ''}`;

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No language data yet. Start coding to track skills!</div>';
    return;
  }

  const maxSeconds = entries[0]?.totalSeconds || 1;

  list.innerHTML = entries.map(s => {
    const color = LANGUAGE_COLORS[s.lang] || '#a0a0a0';
    const barPct = Math.max((s.totalSeconds / maxSeconds) * 100, 2);
    const time = formatSeconds(s.totalSeconds);

    // Find next milestone
    const milestoneIdx = s.lastMilestoneIndex ?? -1;
    const nextMilestone = MILESTONES[milestoneIdx + 1];
    const currentMilestone = milestoneIdx >= 0 ? MILESTONES[milestoneIdx] : null;
    let milestoneText = '';
    let milestonePct = 0;

    if (nextMilestone) {
      const base = currentMilestone ? currentMilestone.seconds : 0;
      milestonePct = Math.min(((s.totalSeconds - base) / (nextMilestone.seconds - base)) * 100, 100);
      milestoneText = `Next: ${nextMilestone.label}`;
    } else if (MILESTONES.length > 0) {
      milestonePct = 100;
      milestoneText = `Max milestone reached!`;
    }

    return `
      <div class="skill-item">
        <div class="skill-header">
          <div class="skill-name">
            <span class="skill-dot" style="background: ${color};"></span>
            ${s.lang}
          </div>
          <div class="skill-time">${time}</div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${barPct}%; background: ${color};"></div>
        </div>
        ${milestoneText ? `
          <div class="skill-milestone">${milestoneText}</div>
        ` : ''}
      </div>`;
  }).join('');
}

// ---- History Tab ----

function renderHistory() {
  const history = allData.sessionHistory
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - currentRange);
  const cutoffISO = localDay(cutoffDate);

  const filtered = history.filter(h => h.date >= cutoffISO);

  // Summary
  const totalSeconds = filtered.reduce((sum, h) => sum + (h.codingSeconds || 0), 0);
  const totalFiles = filtered.reduce((sum, h) => sum + (h.filesCreated || 0) + (h.filesModified || 0), 0);
  const activeDays = filtered.filter(h => (h.codingSeconds || 0) > 0).length;

  const summaryEl = el('history-summary');
  summaryEl.innerHTML = `
    <div class="summary-stat">
      <div class="s-value">${formatSeconds(totalSeconds)}</div>
      <div class="s-label">Total Time</div>
    </div>
    <div class="summary-stat">
      <div class="s-value">${totalFiles}</div>
      <div class="s-label">Files Touched</div>
    </div>
    <div class="summary-stat">
      <div class="s-value">${activeDays}</div>
      <div class="s-label">Active Days</div>
    </div>`;

  // Day list
  const listEl = el('history-list');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No session history for this period.</div>';
  } else {
    listEl.innerHTML = filtered.map(h => {
      const files = (h.filesCreated || 0) + (h.filesModified || 0);
      const projects = h.projects?.join(', ') || '';
      return `
        <div class="history-day">
          <div class="day-date">${formatDate(h.date)}</div>
          <div class="day-time">${formatSeconds(h.codingSeconds)}</div>
          <div class="day-files">${files} file${files !== 1 ? 's' : ''}</div>
          ${projects ? `<div class="day-projects">${projects}</div>` : ''}
        </div>`;
    }).join('');
  }

  // Personal bests
  renderPersonalBestsGrid('history-bests', allData.personalBests.bests);
}

function initRangeToggle() {
  const toggle = el('range-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;

    toggle.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRange = parseInt(btn.dataset.range, 10);
    renderHistory();
  });
}

// ---- Events Tab ----

function formatEventTime(timestamp) {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const d = new Date(timestamp);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function initEventFilter() {
  const filterEl = el('events-filter');
  if (!filterEl) return;

  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    filterEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentEventFilter = btn.dataset.filter;
    renderEvents();
  });
}

function formatSegmentDuration(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function renderMoodTimeline() {
  const wrap = el('mood-timeline-wrap');
  const bar = el('mood-timeline');
  if (!wrap || !bar) return;

  const timeline = liveData.stateTimeline;
  if (!timeline || timeline.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  const totalMs = timeline[timeline.length - 1].endTime - timeline[0].startTime;
  if (totalMs <= 0) {
    wrap.style.display = 'none';
    return;
  }

  bar.innerHTML = timeline.map(seg => {
    const dur = seg.endTime - seg.startTime;
    const color = STATE_COLORS[seg.state] || '#666';
    const label = `${seg.state} — ${formatSegmentDuration(dur)}`;
    return `<div class="timeline-seg" style="flex:${dur};background:${color};" title="${label}"></div>`;
  }).join('');
}

function renderEvents() {
  renderMoodTimeline();
  const listEl = el('events-list');
  const counterEl = el('events-counter');
  if (!listEl) return;

  const all = liveData.eventHistory;
  const filtered = currentEventFilter === 'all'
    ? all
    : all.filter(e => e.category === currentEventFilter);

  if (counterEl) {
    counterEl.textContent = `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No events yet this session.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(entry => {
    const timeStr = formatEventTime(entry.timestamp);
    const detailHtml = entry.detail
      ? `<div class="event-detail">${entry.detail}</div>`
      : '';
    const countBadge = (entry.count && entry.count > 1)
      ? `<span class="event-count">×${entry.count}</span>`
      : '';
    return `
      <div class="event-entry ${entry.category}">
        <span class="event-icon">${entry.icon}</span>
        <div class="event-body">
          <div class="event-message">${entry.message}${countBadge}</div>
          ${detailHtml}
        </div>
        <span class="event-time">${timeStr}</span>
      </div>`;
  }).join('');
}

// ---- Live Data ----

function setupLiveUpdates() {
  try {
    const { listen } = window.__TAURI__.event;
    listen('dashboard-live-data', (event) => {
      const payload = event.payload;
      if (payload.sessionStats) liveData.sessionStats = payload.sessionStats;
      if (payload.momentum) liveData.momentum = payload.momentum;
      if (payload.hydrationCount !== undefined) liveData.hydrationCount = payload.hydrationCount;
      if (payload.streakData) liveData.streakData = payload.streakData;
      if (payload.streakShown !== undefined) liveData.streakShown = payload.streakShown;
      if (Array.isArray(payload.achievements)) {
        const nextAchievements = {};
        for (const achievement of payload.achievements) {
          if (achievement?.id) nextAchievements[achievement.id] = achievement;
        }
        if (Object.keys(nextAchievements).length > 0) {
          allData.achievements = nextAchievements;
        }
      }
      if (Array.isArray(payload.mastery)) {
        const nextMastery = {};
        for (const track of payload.mastery) {
          if (track?.id) nextMastery[track.id] = track;
        }
        if (Object.keys(nextMastery).length > 0) {
          allData.mastery = nextMastery;
        }
      }
      if (payload.eventHistory) liveData.eventHistory = payload.eventHistory;
      if (payload.stateTimeline) liveData.stateTimeline = payload.stateTimeline;
      if (payload.vibePoints !== undefined) liveData.vibePoints = payload.vibePoints;
      if (payload.vibePointsLifetime !== undefined) liveData.vibePointsLifetime = payload.vibePointsLifetime;
      if (payload.quests !== undefined) liveData.quests = payload.quests;
      if (payload.community !== undefined) liveData.community = payload.community;
      if (payload.linked !== undefined) liveData.linked = payload.linked;
      updateLiveUI();
    });
  } catch (e) {
    console.log('Could not set up live updates:', e);
  }
}

async function requestLiveData() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'dashboard-request-data', {});
  } catch (e) {
    console.log('Could not request live data:', e);
  }
}

function updateLiveUI() {
  // Only update the currently visible tab to avoid unnecessary DOM work
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;

  if (activeTab === 'overview') renderOverview();
  if (activeTab === 'achievements') renderAchievements();
  if (activeTab === 'events') renderEvents();
  if (activeTab === 'community') communityTab?.refresh();
}

// ---- Render All ----

function renderAll() {
  renderOverview();
  renderAchievements();
  renderSkills();
  renderHistory();
  renderEvents();
}

// ---- Init ----

async function init() {
  // Wire custom titlebar window controls
  document.getElementById('tb-close')?.addEventListener('click', async () => {
    try {
      await window.__TAURI__.window.getCurrentWindow().close();
    } catch (_) {
      window.close();
    }
  });
  // Titlebar drag — data-tauri-drag-region alone isn't reliable in panel windows
  document.querySelector('.titlebar')?.addEventListener('mousedown', (e) => {
    if (e.target.closest('.titlebar-controls')) return;
    if (e.buttons === 1) {
      try { window.__TAURI__.window.getCurrentWindow().startDragging(); } catch (_) {}
    }
  });

  await syncWebBaseFromRust();
  communityTab = mountCommunityTab(el('community-body'), {
    openUrl,
    siteBase: () => WEB_BASE,
    getView: () => ({ linked: !!liveData.linked, community: liveData.community ?? null }),
    startLink: () => window.__TAURI__?.core?.invoke('start_device_link', {}).catch(() => {}),
  });
  el('hero-streak-gh-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(`${WEB_BASE}${WebRoutes.accountSettings()}`);
  });
  el('hero-streak-gh-dismiss')?.addEventListener('click', async () => {
    el('hero-streak-gh-hint').hidden = true;
    if (liveData.streakShown) liveData.streakShown.githubHint = false;
    try {
      await window.__TAURI__.event.emitTo('main', 'dashboard-dismiss-github-hint', {});
    } catch (_) { /* main window gone */ }
  });
  initTabs();
  initRangeToggle();
  initEventFilter();
  setupAchievementsControls();

  try {
    const loaded = await loadAllData();
    allData.achievements = loaded.achievements;
    allData.mastery = loaded.mastery;
    allData.skills = loaded.skills;
    allData.streak = loaded.streak;
    allData.personalBests = loaded.personalBests;
    allData.sessionHistory = loaded.sessionHistory;
    allData.settings = loaded.settings;
  } catch (e) {
    console.log('Store loading failed, will rely on live data:', e);
  }

  renderAll();
  setupLiveUpdates();

  // Request live data, retry once if main window isn't ready yet
  await requestLiveData();
  setTimeout(() => requestLiveData(), 2000);
}

init().catch(console.error);
