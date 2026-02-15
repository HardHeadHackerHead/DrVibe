// Dr. Vibe - Standalone Personal Bests Page
// Loads bests/history from unified database and receives live session data from main.

import { METRICS } from './features/personalBest/PersonalBestTracker.js';
import { readSection } from './core/DatabaseReader.js';

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

// --- State ---

let bests = {};
let history = [];
let currentSession = null;
let selectedMetric = null;

// --- Metric icons ---

const ICONS = {
  longestSession: '\u23F1',   // stopwatch
  mostFiles: '\uD83D\uDCC1', // folder
  longestStreak: '\uD83D\uDD25', // fire
  bestMomentum: '\u26A1',    // lightning
};

// --- Load from store ---

async function loadStore() {
  const saved = await readSection('personalBest');
  if (saved) {
    bests = saved.bests || {};
    history = saved.history || [];
  }
}

// --- Listen for live data from main ---

async function setupListener() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.listen('personal-bests-data', (event) => {
      currentSession = event.payload;
      render();
    });
  } catch (e) {
    console.log('Failed to set up personal-bests data listener:', e);
  }
}

async function requestData() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'personal-bests-request-data');
  } catch (e) {
    console.log('Failed to request personal-bests data:', e);
  }
}

// --- Render ---

function render() {
  const grid = document.getElementById('personal-best-grid');
  const historyContainer = document.getElementById('personal-best-history');
  if (!grid) return;

  // Build current values from session data
  const current = {};
  if (currentSession) {
    const totalFiles = (currentSession.filesCreated || 0) + (currentSession.filesModified || 0);
    current.longestSession = {
      value: currentSession.codingSeconds || 0,
      formatted: METRICS.longestSession.format(currentSession.codingSeconds || 0),
    };
    current.mostFiles = {
      value: totalFiles,
      formatted: METRICS.mostFiles.format(totalFiles),
    };
    current.longestStreak = {
      value: currentSession.streak || 0,
      formatted: METRICS.longestStreak.format(currentSession.streak || 0),
    };
    current.bestMomentum = {
      value: currentSession.peakMomentum || 0,
      formatted: METRICS.bestMomentum.format(currentSession.peakMomentum || 0),
    };
  }

  grid.innerHTML = Object.entries(METRICS).map(([key, def]) => {
    const best = bests[key] || { value: 0, date: null };
    const cur = current[key] || { value: 0, formatted: def.format(0) };
    const bestValue = best.value || 0;
    const bestFormatted = bestValue > 0 ? def.format(bestValue) : '--';

    const isNewBest = cur.value > 0 && cur.value >= bestValue && bestValue > 0;
    const pct = bestValue > 0 ? Math.min((cur.value / bestValue) * 100, 100) : 0;

    return `
      <div class="pb-card${isNewBest ? ' pb-record' : ''}" data-metric="${key}">
        <div class="pb-card-header">
          <span class="pb-icon">${ICONS[key]}</span>
          <span class="pb-label">${def.label}</span>
        </div>
        <div class="pb-values">
          <div class="pb-current">
            <span class="pb-value-number">${cur.formatted}</span>
            <span class="pb-value-label">now</span>
          </div>
          <div class="pb-vs">vs</div>
          <div class="pb-best">
            <span class="pb-value-number pb-best-number">${bestFormatted}</span>
            <span class="pb-value-label">best</span>
          </div>
        </div>
        <div class="pb-progress-bar">
          <div class="pb-progress-fill${isNewBest ? ' pb-record-fill' : ''}" style="width: ${pct}%"></div>
        </div>
        ${best.date ? `<span class="pb-date">Set ${best.date}</span>` : ''}
      </div>
    `;
  }).join('');

  // Add click handlers for history toggle
  grid.querySelectorAll('.pb-card').forEach(card => {
    card.addEventListener('click', () => {
      const metric = card.dataset.metric;
      toggleHistory(metric);
    });
  });

  // Render history
  if (selectedMetric) {
    renderHistory(selectedMetric);
  } else if (historyContainer) {
    historyContainer.innerHTML = '<span class="pb-history-hint">Click a metric to see history</span>';
  }
}

function toggleHistory(metric) {
  if (selectedMetric === metric) {
    selectedMetric = null;
  } else {
    selectedMetric = metric;
  }
  render();
}

function renderHistory(metric) {
  const historyContainer = document.getElementById('personal-best-history');
  if (!historyContainer) return;

  const def = METRICS[metric];
  const metricHistory = history
    .filter(h => h.metric === metric)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (metricHistory.length === 0) {
    historyContainer.innerHTML = `<span class="pb-history-empty">No history yet for ${def.label}</span>`;
    return;
  }

  // Show last 10 entries as a bar chart
  const recent = metricHistory.slice(-10);
  const maxVal = Math.max(...recent.map(h => h.value), 1);

  const barsHtml = recent.map(h => {
    const heightPct = Math.max((h.value / maxVal) * 100, 4);
    return `
      <div class="pb-history-bar-wrapper" title="${h.date}: ${def.format(h.value)}">
        <div class="pb-history-bar" style="height: ${heightPct}%"></div>
        <span class="pb-history-bar-label">${h.date.slice(5)}</span>
      </div>
    `;
  }).join('');

  historyContainer.innerHTML = `
    <span class="pb-history-title">${def.label} History</span>
    <div class="pb-history-chart">${barsHtml}</div>
  `;
}

// --- Event listeners ---

document.getElementById('personal-best-close').addEventListener('click', closeWindow);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWindow();
});

// --- Init ---

async function init() {
  await loadStore();
  await setupListener();
  await requestData();

  // Initial render with store data (before live data arrives)
  render();

  // Periodically re-request for live updates
  setInterval(requestData, 5000);
}

init();
