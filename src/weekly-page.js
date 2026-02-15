// Dr. Vibe - Standalone Weekly Report Page
// Loads weekly summary data from unified database and renders the report.

import { readSection, writeKey } from './core/DatabaseReader.js';

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

// --- Format helpers ---

function formatSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// --- Encouraging messages (same as WeeklySummary.js) ---

const ENCOURAGING_MESSAGES = [
  { threshold: 0, messages: [
    "Every expert was once a beginner. This week is a fresh start!",
    "Rest is part of the process. Ready when you are!",
  ]},
  { threshold: 1, messages: [
    "You showed up! That's what matters most.",
    "One step at a time. You're building something great.",
  ]},
  { threshold: 60, messages: [
    "Nice work this week! You're building momentum.",
    "Steady progress! Every minute of practice counts.",
  ]},
  { threshold: 300, messages: [
    "Solid week! You're in a great rhythm.",
    "Impressive dedication! Your skills are growing.",
  ]},
  { threshold: 600, messages: [
    "What a productive week! You should be proud.",
    "You're on fire! Your commitment is inspiring.",
  ]},
];

function getEncouragement(totalMinutes) {
  let pool = ENCOURAGING_MESSAGES[0].messages;
  for (const tier of ENCOURAGING_MESSAGES) {
    if (totalMinutes >= tier.threshold) {
      pool = tier.messages;
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// --- State ---

let summaryData = null;
let goals = null;

// --- Load data from stores ---

async function loadData() {
  const saved = await readSection('weeklySummary');
  goals = saved?.goals || null;

  // Populate goal form with current values
  if (goals) {
    const hoursInput = document.getElementById('weekly-goal-hours');
    const daysInput = document.getElementById('weekly-goal-days');
    if (hoursInput && goals.codingHours) hoursInput.value = goals.codingHours;
    if (daysInput && goals.activeDays) daysInput.value = goals.activeDays;
  }
}

// --- Listen for data from main window ---

async function setupListener() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.listen('weekly-data', (event) => {
      summaryData = event.payload;
      render();
    });
  } catch (e) {
    console.log('Failed to set up weekly data listener:', e);
  }
}

async function requestData() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'weekly-request-data');
  } catch (e) {
    console.log('Failed to request weekly data:', e);
  }
}

// --- Render ---

function render() {
  if (!summaryData) return;
  const s = summaryData;

  // Week label
  const weekLabelEl = document.getElementById('weekly-week-label');
  if (weekLabelEl) weekLabelEl.textContent = s.weekLabel || '';

  // Encouragement
  const encourageEl = document.getElementById('weekly-encouragement');
  if (encourageEl) {
    encourageEl.textContent = s.encouragement || getEncouragement(Math.floor((s.totalSeconds || 0) / 60));
  }

  // Coding time
  const codingTimeEl = document.getElementById('weekly-coding-time');
  if (codingTimeEl) codingTimeEl.textContent = formatSeconds(s.totalSeconds || 0);

  // Active days
  const activeDaysEl = document.getElementById('weekly-active-days');
  if (activeDaysEl) activeDaysEl.textContent = `${s.activeDays || 0} / 7`;

  // Files
  const filesEl = document.getElementById('weekly-files');
  if (filesEl) {
    const total = (s.totalFilesCreated || 0) + (s.totalFilesModified || 0);
    filesEl.textContent = `${total} files`;
  }

  // Longest session
  const longestEl = document.getElementById('weekly-longest-session');
  if (longestEl) longestEl.textContent = formatSeconds(s.longestSessionSeconds || 0);

  // Streak
  const streakEl = document.getElementById('weekly-streak');
  if (streakEl) {
    streakEl.textContent = (s.streak === 0 || !s.streak) ? 'New start!' : `${s.streak} days`;
  }

  // Projects
  const projectsEl = document.getElementById('weekly-projects');
  if (projectsEl) {
    projectsEl.textContent = (s.projects && s.projects.length > 0)
      ? s.projects.join(', ')
      : 'No projects tracked yet';
  }

  // Daily chart
  renderDailyChart(s.dailyBreakdown || []);

  // Goals
  renderGoals(s.goalStatus);
}

function renderDailyChart(dailyBreakdown) {
  const container = document.getElementById('weekly-daily-chart');
  if (!container) return;
  container.innerHTML = '';

  if (dailyBreakdown.length === 0) {
    container.innerHTML = '<span style="font-size:9px;color:#555;font-style:italic">No data yet</span>';
    return;
  }

  const maxSeconds = Math.max(...dailyBreakdown.map(d => d.codingSeconds || 0), 1);

  for (const day of dailyBreakdown) {
    const dayEl = document.createElement('div');
    dayEl.className = 'weekly-day-bar';

    const barContainer = document.createElement('div');
    barContainer.className = 'weekly-bar-container';

    const bar = document.createElement('div');
    bar.className = 'weekly-bar-fill';
    const pct = ((day.codingSeconds || 0) / maxSeconds) * 100;
    bar.style.height = `${Math.max(pct, 2)}%`;
    if ((day.codingSeconds || 0) > 0) {
      bar.classList.add('active');
    }

    barContainer.appendChild(bar);

    const label = document.createElement('span');
    label.className = 'weekly-day-label';
    try {
      label.textContent = new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
    } catch {
      label.textContent = day.date ? day.date.slice(8, 10) : '?';
    }

    dayEl.appendChild(barContainer);
    dayEl.appendChild(label);
    container.appendChild(dayEl);
  }
}

function renderGoals(goalStatus) {
  const goalsSection = document.getElementById('weekly-goals-section');
  if (!goalsSection) return;

  if (!goalStatus) {
    goalsSection.innerHTML = `
      <span class="weekly-section-label">Goals</span>
      <p class="weekly-no-goals">No goals set. Want to set some for next week?</p>
    `;
    return;
  }

  let html = '<span class="weekly-section-label">Goal Progress</span>';

  if (goalStatus.codingHoursGoal != null) {
    const actual = goalStatus.codingHoursActual;
    const goal = goalStatus.codingHoursGoal;
    const pct = Math.min((actual / goal) * 100, 100);
    const met = actual >= goal;
    html += `
      <div class="weekly-goal-row">
        <span class="weekly-goal-label">Coding: ${actual.toFixed(1)}h / ${goal}h ${met ? '&#10003;' : ''}</span>
        <div class="weekly-goal-bar">
          <div class="weekly-goal-fill ${met ? 'met' : ''}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }

  if (goalStatus.activeDaysGoal != null) {
    const actual = goalStatus.activeDaysActual;
    const goal = goalStatus.activeDaysGoal;
    const pct = Math.min((actual / goal) * 100, 100);
    const met = actual >= goal;
    html += `
      <div class="weekly-goal-row">
        <span class="weekly-goal-label">Active Days: ${actual} / ${goal} ${met ? '&#10003;' : ''}</span>
        <div class="weekly-goal-bar">
          <div class="weekly-goal-fill ${met ? 'met' : ''}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }

  goalsSection.innerHTML = html;
}

// --- Goal management ---

async function saveGoals() {
  const hoursInput = document.getElementById('weekly-goal-hours');
  const daysInput = document.getElementById('weekly-goal-days');
  const hoursVal = hoursInput ? parseFloat(hoursInput.value) : null;
  const daysVal = daysInput ? parseInt(daysInput.value, 10) : null;

  const newGoals = {};
  if (hoursVal && hoursVal > 0) newGoals.codingHours = hoursVal;
  if (daysVal && daysVal > 0) newGoals.activeDays = Math.min(daysVal, 7);

  if (Object.keys(newGoals).length === 0) return;

  goals = newGoals;
  await writeKey('weeklySummary', 'goals', goals);

  // Hide form
  const form = document.getElementById('weekly-goal-form');
  if (form) form.classList.add('hidden');

  // Re-request data to get updated goal status
  await requestData();
}

async function clearGoals() {
  goals = null;
  await writeKey('weeklySummary', 'goals', null);

  const form = document.getElementById('weekly-goal-form');
  if (form) form.classList.add('hidden');

  await requestData();
}

// --- Export to clipboard ---

async function exportMarkdown() {
  if (!summaryData) return;
  const s = summaryData;

  const hours = Math.floor((s.totalSeconds || 0) / 3600);
  const minutes = Math.floor(((s.totalSeconds || 0) % 3600) / 60);
  const longestH = Math.floor((s.longestSessionSeconds || 0) / 3600);
  const longestM = Math.floor(((s.longestSessionSeconds || 0) % 3600) / 60);

  let md = `## Weekly Report \u2014 ${s.weekLabel || 'This Week'}\n`;
  md += `- Coding: ${hours}h ${minutes}m\n`;
  md += `- Active days: ${s.activeDays || 0} / 7\n`;
  md += `- Files: ${(s.totalFilesCreated || 0) + (s.totalFilesModified || 0)}\n`;
  md += `- Longest session: ${longestH}h ${longestM}m\n`;
  md += `- Streak: ${s.streak || 0} days\n`;

  const exportBtn = document.getElementById('weekly-export');

  try {
    await navigator.clipboard.writeText(md);
    if (exportBtn) {
      exportBtn.textContent = 'Copied!';
      setTimeout(() => { exportBtn.textContent = 'Export'; }, 1500);
    }
  } catch {
    if (exportBtn) {
      exportBtn.textContent = 'Failed';
      setTimeout(() => { exportBtn.textContent = 'Export'; }, 1500);
    }
  }
}

// --- Toggle goal form ---

function toggleGoalForm() {
  const form = document.getElementById('weekly-goal-form');
  if (!form) return;
  form.classList.toggle('hidden');

  // Populate with current goals if opening
  if (!form.classList.contains('hidden') && goals) {
    const hoursInput = document.getElementById('weekly-goal-hours');
    const daysInput = document.getElementById('weekly-goal-days');
    if (hoursInput && goals.codingHours) hoursInput.value = goals.codingHours;
    if (daysInput && goals.activeDays) daysInput.value = goals.activeDays;
  }
}

// --- Event listeners ---

document.getElementById('weekly-close').addEventListener('click', closeWindow);
document.getElementById('weekly-set-goals').addEventListener('click', toggleGoalForm);
document.getElementById('weekly-export').addEventListener('click', exportMarkdown);
document.getElementById('weekly-goal-save').addEventListener('click', saveGoals);
document.getElementById('weekly-goal-clear').addEventListener('click', clearGoals);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWindow();
});

// --- Init ---

async function init() {
  await loadData();
  await setupListener();
  await requestData();

  // Periodically re-request for live updates
  setInterval(requestData, 10000);
}

init();
