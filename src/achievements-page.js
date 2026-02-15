// Dr. Vibe - Standalone Achievement Gallery Page
// Loads achievement definitions and saved state from unified database

import { ACHIEVEMENT_LIST } from './features/achievements/AchievementDefinitions.js';
import { readSection } from './core/DatabaseReader.js';

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

function buildCard(def, state) {
  const isUnlocked = state.unlocked;

  const progressPct = def.maxProgress > 1
    ? Math.round((state.progress / def.maxProgress) * 100)
    : (isUnlocked ? 100 : 0);

  // Build progress bar HTML for multi-step achievements that are not yet unlocked
  let progressHtml = '';
  if (def.maxProgress > 1 && !isUnlocked) {
    progressHtml = `
      <div class="achievement-progress-bar">
        <div class="achievement-progress-fill" style="width: ${progressPct}%"></div>
      </div>
      <div class="achievement-progress-text">${state.progress} / ${def.maxProgress}</div>
    `;
  }

  // Build unlock date HTML
  let dateHtml = '';
  if (isUnlocked && state.unlockedAt) {
    const d = new Date(state.unlockedAt);
    dateHtml = `<div class="achievement-date">Achieved ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>`;
  }

  return `
    <div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'}">
      <div class="achievement-emblem">${def.icon}</div>
      <div class="achievement-info">
        <div class="achievement-title">${def.title}</div>
        <div class="achievement-desc">${def.description}</div>
        ${progressHtml}
        ${dateHtml}
      </div>
    </div>
  `;
}

async function loadAndRender() {
  const unlockedGrid = document.getElementById('unlocked-grid');
  const lockedGrid = document.getElementById('locked-grid');
  const counter = document.getElementById('achievement-counter');

  // Load saved achievement state from unified database
  const saved = await readSection('achievements');
  const achState = saved?.state || {};

  const unlockedCards = [];
  const lockedCards = [];

  for (const def of ACHIEVEMENT_LIST) {
    const state = achState[def.id] || { unlocked: false, unlockedAt: null, progress: 0 };

    if (state.unlocked) {
      unlockedCards.push(buildCard(def, state));
    } else {
      lockedCards.push(buildCard(def, state));
    }
  }

  unlockedGrid.innerHTML = unlockedCards.length > 0
    ? unlockedCards.join('')
    : '<div class="achievement-empty">No achievements unlocked yet</div>';

  lockedGrid.innerHTML = lockedCards.length > 0
    ? lockedCards.join('')
    : '<div class="achievement-empty">All achievements unlocked!</div>';

  // Update counter
  counter.textContent = `${unlockedCards.length} / ${ACHIEVEMENT_LIST.length}`;
}

// --- Event Listeners ---

document.getElementById('close-btn').addEventListener('click', closeWindow);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWindow();
});

// --- Init ---

loadAndRender();
