// Dr. Vibe - Dashboard Window
// Consolidates all tracked stats into a tabbed dashboard interface.
// Reads persisted data from Tauri stores, receives live data from main window.

import { ACHIEVEMENTS, ACHIEVEMENT_LIST } from './features/achievements/AchievementDefinitions.js';
import { LANGUAGE_COLORS, MILESTONES } from './features/skills/SkillTracker.js';
import { METRICS } from './features/personalBest/PersonalBestTracker.js';

const STREAK_MILESTONES = [7, 14, 21, 30, 50, 100, 200, 365];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  return new Date().toISOString().split('T')[0];
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

function el(id) {
  return document.getElementById(id);
}

// ---- Store Loading ----

import { readSections } from './core/DatabaseReader.js';

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

  return {
    achievements,
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
};

let currentRange = 7;

// ---- Tab System ----

function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = el('tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });
}

// ---- Overview Tab ----

function renderOverview() {
  const streak = liveData.streakData || allData.streak;
  const momentum = liveData.momentum;
  const session = liveData.sessionStats;

  // Hero: Streak
  el('hero-streak').textContent = streak.current || 0;
  el('hero-streak-level').textContent = getStreakLevel(streak.current || 0);

  // Hero: Momentum
  const mVal = momentum.momentum || 0;
  el('hero-momentum').textContent = mVal;
  const mBar = el('hero-momentum-bar');
  mBar.style.width = mVal + '%';
  mBar.style.backgroundColor = getMomentumColor(momentum.level);

  // Hero: Hydration
  el('hero-hydration').textContent = liveData.hydrationCount || 0;

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
    const iso = d.toISOString().split('T')[0];
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

function renderAchievements() {
  const grid = el('achievement-grid');
  if (!grid) return;

  const achs = Object.values(allData.achievements);
  const unlocked = achs.filter(a => a.unlocked).length;
  el('ach-counter').textContent = `${unlocked} / ${achs.length}`;

  grid.innerHTML = achs.map(a => {
    const cls = a.unlocked ? 'unlocked' : 'locked';
    const progressPct = a.maxProgress > 1 ? Math.min((a.progress / a.maxProgress) * 100, 100) : (a.unlocked ? 100 : 0);
    const dateStr = a.unlockedAt ? formatFullDate(new Date(a.unlockedAt).toISOString().split('T')[0]) : '';

    return `
      <div class="achievement-card ${cls}">
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-title">${a.title}</div>
        <div class="ach-desc">${a.description}</div>
        ${a.maxProgress > 1 ? `
          <div class="progress-bar" style="margin-bottom: 4px;">
            <div class="progress-fill ${a.unlocked ? 'gold' : ''}" style="width: ${progressPct}%;"></div>
          </div>
          <div style="font-size: 9px; color: #808080;">${a.progress} / ${a.maxProgress}</div>
        ` : ''}
        ${a.unlocked && dateStr ? `<div class="ach-date">${dateStr}</div>` : ''}
      </div>`;
  }).join('');
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
  const cutoffISO = cutoffDate.toISOString().split('T')[0];

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

// ---- Wellness Tab ----

function renderWellness() {
  const streak = liveData.streakData || allData.streak;
  const settings = allData.settings;

  // Hydration
  el('wellness-hydration').textContent = liveData.hydrationCount || 0;

  // Streak
  el('wellness-streak-current').textContent = streak.current || 0;
  el('wellness-streak-max').textContent = streak.max || 0;
  el('wellness-streak-start').textContent = streak.startDate ? formatFullDate(streak.startDate) : '--';

  // Next milestone
  const nextMilestone = STREAK_MILESTONES.find(m => m > (streak.current || 0));
  if (nextMilestone) {
    const prevMilestone = STREAK_MILESTONES[STREAK_MILESTONES.indexOf(nextMilestone) - 1] || 0;
    const progress = ((streak.current - prevMilestone) / (nextMilestone - prevMilestone)) * 100;
    el('wellness-next-milestone').textContent = `Next milestone: ${nextMilestone} days`;
    el('wellness-milestone-progress').style.width = Math.min(progress, 100) + '%';
  } else {
    el('wellness-next-milestone').textContent = 'All milestones reached!';
    el('wellness-milestone-progress').style.width = '100%';
  }

  // Milestone badges
  const milestonesEl = el('wellness-milestones');
  const reached = streak.milestonesReached || [];
  milestonesEl.innerHTML = STREAK_MILESTONES.map(m => {
    const isReached = reached.includes(m);
    const cls = isReached ? 'reached' : 'upcoming';
    return `<span class="milestone-badge ${cls}">${m}d</span>`;
  }).join('');

  // Wellness features
  const features = [
    { icon: '&#x1F4A7;', name: 'Hydration Reminders', key: 'hydrationEnabled' },
    { icon: '&#x1F440;', name: 'Eye Strain (20-20-20)', key: 'eyeStrainEnabled' },
    { icon: '&#x1F9D8;', name: 'Posture Reminders', key: 'postureReminderEnabled' },
    { icon: '&#x23F0;', name: 'Overwork Prevention', key: 'overworkPreventionEnabled' },
    { icon: '&#x1F3E0;', name: 'Work-Life Boundaries', key: 'boundaryAwarenessEnabled' },
    { icon: '&#x1F4AA;', name: 'Encouragement', key: 'encouragementEnabled' },
    { icon: '&#x1F634;', name: 'Fatigue Detection', key: 'fatigueDetectionEnabled' },
    { icon: '&#x1F914;', name: 'Stuck Detection', key: 'stuckDetectionEnabled' },
  ];

  const featuresEl = el('wellness-features');
  featuresEl.innerHTML = features.map(f => {
    const enabled = settings[f.key] !== false && settings[f.key] !== undefined;
    const statusCls = enabled ? 'on' : 'off';
    const statusText = enabled ? 'On' : 'Off';
    return `
      <div class="wellness-feature">
        <span class="wf-icon">${f.icon}</span>
        <span class="wf-name">${f.name}</span>
        <span class="wf-status ${statusCls}">${statusText}</span>
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
  if (activeTab === 'wellness') renderWellness();
}

// ---- Render All ----

function renderAll() {
  renderOverview();
  renderAchievements();
  renderSkills();
  renderHistory();
  renderWellness();
}

// ---- Init ----

async function init() {
  initTabs();
  initRangeToggle();

  try {
    const loaded = await loadAllData();
    allData.achievements = loaded.achievements;
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
