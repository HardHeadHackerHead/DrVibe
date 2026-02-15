// Dr. Vibe - Standalone Skill Development Page
// Loads skill data from unified database and renders language progress

import { LANGUAGE_COLORS, MILESTONES } from './features/skills/SkillTracker.js';
import { readSection } from './core/DatabaseReader.js';

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

// --- Helpers ---

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function getNextMilestone(totalSeconds) {
  for (const milestone of MILESTONES) {
    if (totalSeconds < milestone.seconds) {
      return { seconds: milestone.seconds, label: milestone.label };
    }
  }
  return null;
}

// --- Load & Render ---

async function loadAndRender() {
  const listEl = document.getElementById('skill-list');
  const counter = document.getElementById('skill-counter');

  // Load skill data from unified database
  let skills = (await readSection('skills')) || {};

  const entries = Object.entries(skills);

  if (entries.length === 0) {
    listEl.innerHTML = '<div class="skill-empty">No skills tracked yet. Start coding to see your progress!</div>';
    counter.textContent = '0 languages';
    return;
  }

  // Sort by total time descending
  entries.sort((a, b) => b[1].totalSeconds - a[1].totalSeconds);

  // Find max for relative bar sizing
  const maxSeconds = entries[0][1].totalSeconds;

  listEl.innerHTML = '';

  for (const [language, data] of entries) {
    const totalSeconds = data.totalSeconds || 0;
    const sessionSeconds = data.sessionSeconds || 0;
    const color = LANGUAGE_COLORS[language] || '#a0a0a0';
    const barWidth = maxSeconds > 0 ? Math.max((totalSeconds / maxSeconds) * 100, 2) : 0;
    const totalStr = formatTime(totalSeconds);

    // Session time display
    let sessionHtml = '';
    if (sessionSeconds > 0) {
      sessionHtml = `<div class="skill-session">This session: <span style="color: ${color}">+${formatTime(sessionSeconds)}</span></div>`;
    }

    // Milestone progress
    const nextMilestone = getNextMilestone(totalSeconds);
    let milestoneHtml = '';
    if (nextMilestone) {
      const progress = Math.min((totalSeconds / nextMilestone.seconds) * 100, 100);
      milestoneHtml = `
        <div class="skill-milestone">
          <div class="skill-milestone-bar">
            <div class="skill-milestone-fill" style="width: ${progress}%; background: ${color}"></div>
          </div>
          <span class="skill-milestone-label">Next: ${nextMilestone.label}</span>
        </div>
      `;
    } else {
      milestoneHtml = '<div class="skill-milestone-complete">All milestones reached!</div>';
    }

    const card = document.createElement('div');
    card.className = 'skill-card';
    card.innerHTML = `
      <div class="skill-header">
        <span class="skill-language" style="color: ${color}">${language}</span>
        <span class="skill-time">${totalStr}</span>
      </div>
      <div class="skill-bar-container">
        <div class="skill-bar" style="width: ${barWidth}%; background: ${color}"></div>
      </div>
      ${sessionHtml}
      ${milestoneHtml}
    `;

    listEl.appendChild(card);
  }

  // Update counter
  const count = entries.length;
  counter.textContent = `${count} ${count === 1 ? 'language' : 'languages'}`;
}

// --- Export as Image ---

async function exportAsImage() {
  // Load skill data again for export
  const skills = (await readSection('skills')) || {};
  if (Object.keys(skills).length === 0) return;

  const entries = Object.entries(skills).sort((a, b) => b[1].totalSeconds - a[1].totalSeconds);
  if (entries.length === 0) return;

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const padding = 24;
    const rowHeight = 48;
    const barHeight = 12;
    const width = 400;
    const headerHeight = 50;
    const height = headerHeight + (entries.length * rowHeight) + padding * 2;

    canvas.width = width * 2; // 2x for retina
    canvas.height = height * 2;
    ctx.scale(2, 2);

    // Background
    ctx.fillStyle = '#1e1e1e';
    ctx.roundRect(0, 0, width, height, 12);
    ctx.fill();

    // Title
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 16px "Segoe UI", sans-serif';
    ctx.fillText('Skill Development', padding, padding + 20);

    ctx.fillStyle = '#a0a0a0';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillText(`${entries.length} languages tracked`, padding, padding + 38);

    const maxSeconds = entries[0][1].totalSeconds;
    const barMaxWidth = width - padding * 2 - 120;

    entries.forEach(([lang, data], i) => {
      const y = headerHeight + padding + (i * rowHeight);
      const color = LANGUAGE_COLORS[lang] || '#a0a0a0';
      const totalSeconds = data.totalSeconds || 0;

      // Language name
      ctx.fillStyle = color;
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.fillText(lang, padding, y + 14);

      // Time
      ctx.fillStyle = '#e0e0e0';
      ctx.font = '11px "Segoe UI", sans-serif';
      const timeStr = formatTime(totalSeconds);
      ctx.fillText(timeStr, width - padding - ctx.measureText(timeStr).width, y + 14);

      // Bar background
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.roundRect(padding, y + 22, barMaxWidth, barHeight, 4);
      ctx.fill();

      // Bar fill
      const barWidth = maxSeconds > 0 ? Math.max((totalSeconds / maxSeconds) * barMaxWidth, 4) : 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(padding, y + 22, barWidth, barHeight, 4);
      ctx.fill();
    });

    // Footer
    ctx.fillStyle = '#555';
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.fillText('Dr. Vibe - Skill Tracker', padding, height - 10);

    // Download
    const link = document.createElement('a');
    link.download = `dr-vibe-skills-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (e) {
    console.error('Skills export failed:', e);
  }
}

// --- Event Listeners ---

document.getElementById('close-btn').addEventListener('click', closeWindow);
document.getElementById('export-btn').addEventListener('click', exportAsImage);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWindow();
});

// --- Init ---

loadAndRender();
