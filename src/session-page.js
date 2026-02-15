// Dr. Vibe - Standalone Session Stats Page
// Requests session data from the main window and renders live stats.

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

// --- Element references ---
const els = {
  codingTime: () => document.getElementById('session-coding-time'),
  codingSub: () => document.getElementById('session-coding-sub'),
  filesCreated: () => document.getElementById('session-files-created'),
  filesModified: () => document.getElementById('session-files-modified'),
  streak: () => document.getElementById('session-streak'),
  streakSub: () => document.getElementById('session-streak-sub'),
  startTime: () => document.getElementById('session-start-time'),
  project: () => document.getElementById('session-project'),
  timeline: () => document.getElementById('session-timeline'),
  markers: () => document.getElementById('timeline-markers'),
  recentFiles: () => document.getElementById('recent-files-list'),
  codingRatioPct: () => document.getElementById('coding-ratio-pct'),
  codingRatioFill: () => document.getElementById('coding-ratio-fill'),
  summary: () => document.getElementById('session-summary'),
  summaryTotal: () => document.getElementById('summary-total'),
  summaryCoding: () => document.getElementById('summary-coding'),
  summaryIdle: () => document.getElementById('summary-idle'),
  tooltip: () => document.getElementById('timeline-tooltip'),
  tooltipType: () => document.getElementById('tooltip-type'),
  tooltipTime: () => document.getElementById('tooltip-time'),
  tooltipDuration: () => document.getElementById('tooltip-duration'),
};

// --- Helpers ---
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatTimeShort(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// File extension to simple icon mapping
function fileIcon(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const icons = {
    js: '\u25B7', ts: '\u25B7', jsx: '\u25B7', tsx: '\u25B7',
    css: '\u25C6', scss: '\u25C6', less: '\u25C6',
    html: '\u25CB', vue: '\u25CB', svelte: '\u25CB',
    json: '\u25A1', yaml: '\u25A1', yml: '\u25A1', toml: '\u25A1',
    md: '\u25A0', txt: '\u25A0',
    rs: '\u2699', go: '\u2699', py: '\u2699', java: '\u2699', c: '\u2699', cpp: '\u2699',
  };
  return icons[ext] || '\u25AA';
}

function extractFileParts(fullPath) {
  const normalized = fullPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const name = parts.pop() || fullPath;
  // Show last 2 directory segments at most
  const dir = parts.slice(-2).join('/');
  return { name, dir };
}

// --- Render session data into the DOM ---
function render(stats) {
  const codingSecs = stats.codingSeconds;
  const hours = Math.floor(codingSecs / 3600);
  const minutes = Math.floor((codingSecs % 3600) / 60);
  let timeStr;
  if (hours > 0) {
    timeStr = `${hours}h ${minutes}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  // Streak
  let streakStr, streakSub;
  if (!stats.streak || stats.streak === 0) {
    streakStr = '0';
    streakSub = 'Start your streak today!';
  } else {
    streakStr = `${stats.streak}`;
    streakSub = stats.streak === 1 ? 'day' : 'days';
  }

  // Session start time
  let startStr = '--:--';
  if (stats.sessionStart) {
    startStr = formatTime(stats.sessionStart);
  }

  // Session elapsed
  const sessionSecs = stats.sessionStart ? Math.floor((Date.now() - stats.sessionStart) / 1000) : 0;
  const codingSub = sessionSecs > 0 ? `of ${formatDuration(sessionSecs)} elapsed` : '';

  // Coding ratio
  const ratio = sessionSecs > 0 ? Math.round((codingSecs / sessionSecs) * 100) : 0;

  // Project name
  const projectStr = stats.projectName || '';

  // Populate elements
  const codingTimeEl = els.codingTime();
  const codingSubEl = els.codingSub();
  const filesCreatedEl = els.filesCreated();
  const filesModifiedEl = els.filesModified();
  const streakEl = els.streak();
  const streakSubEl = els.streakSub();
  const startTimeEl = els.startTime();
  const projectEl = els.project();
  const timelineEl = els.timeline();
  const markersEl = els.markers();
  const recentFilesEl = els.recentFiles();
  const ratioPctEl = els.codingRatioPct();
  const ratioFillEl = els.codingRatioFill();
  const summaryEl = els.summary();

  if (codingTimeEl) codingTimeEl.textContent = timeStr;
  if (codingSubEl) codingSubEl.textContent = codingSub;
  if (filesCreatedEl) filesCreatedEl.textContent = stats.filesCreated;
  if (filesModifiedEl) filesModifiedEl.textContent = stats.filesModified;
  if (streakEl) streakEl.textContent = streakStr;
  if (streakSubEl) streakSubEl.textContent = streakSub;
  if (startTimeEl) startTimeEl.textContent = `Started ${startStr}`;
  if (projectEl) projectEl.textContent = projectStr;

  if (ratioPctEl) ratioPctEl.textContent = `${ratio}%`;
  if (ratioFillEl) ratioFillEl.style.width = `${ratio}%`;

  if (timelineEl) {
    renderTimeline(timelineEl, markersEl, stats.timeline, stats.sessionStart);
  }

  renderSummary(stats.timeline, stats.sessionStart);
  renderRecentFiles(recentFilesEl, stats.recentFiles);
}

// --- Render activity timeline bar with hover ---
function renderTimeline(container, markersContainer, timeline, sessionStart) {
  container.innerHTML = '';
  if (markersContainer) markersContainer.innerHTML = '';

  if (!timeline || timeline.length === 0) {
    container.innerHTML = '<span class="session-timeline-empty">No activity yet</span>';
    return;
  }

  const now = Date.now();
  const sessionDuration = now - sessionStart;

  if (sessionDuration <= 0) {
    container.innerHTML = '<span class="session-timeline-empty">No activity yet</span>';
    return;
  }

  // Build segments from timeline events
  const segments = [];
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    const nextTime = (i + 1 < timeline.length) ? timeline[i + 1].time : now;
    const startPct = ((entry.time - sessionStart) / sessionDuration) * 100;
    const widthPct = ((nextTime - entry.time) / sessionDuration) * 100;

    if (widthPct > 0.3) {
      segments.push({
        type: entry.type,
        startPct,
        widthPct,
        startTime: entry.time,
        endTime: nextTime,
        durationSecs: (nextTime - entry.time) / 1000,
      });
    }
  }

  // Render as a horizontal bar
  const bar = document.createElement('div');
  bar.className = 'session-timeline-bar';

  const tooltip = els.tooltip();

  for (const seg of segments) {
    const segEl = document.createElement('div');
    segEl.className = `session-timeline-segment ${seg.type}`;
    segEl.style.left = `${seg.startPct}%`;
    segEl.style.width = `${Math.min(seg.widthPct, 100 - seg.startPct)}%`;

    // Hover tooltip
    segEl.addEventListener('mouseenter', (e) => {
      showTooltip(e, seg);
    });
    segEl.addEventListener('mousemove', (e) => {
      positionTooltip(e);
    });
    segEl.addEventListener('mouseleave', () => {
      hideTooltip();
    });

    bar.appendChild(segEl);
  }

  container.appendChild(bar);

  // Render time markers
  if (markersContainer && timeline.length > 0) {
    const startMarker = document.createElement('span');
    startMarker.className = 'timeline-marker';
    startMarker.textContent = formatTimeShort(sessionStart);

    const nowMarker = document.createElement('span');
    nowMarker.className = 'timeline-marker';
    nowMarker.textContent = 'Now';

    markersContainer.appendChild(startMarker);

    // Add middle markers for longer sessions (> 30 min)
    const sessionMins = sessionDuration / 60000;
    if (sessionMins > 30) {
      const numMid = sessionMins > 120 ? 3 : sessionMins > 60 ? 2 : 1;
      for (let i = 1; i <= numMid; i++) {
        const t = sessionStart + (sessionDuration * i / (numMid + 1));
        const midMarker = document.createElement('span');
        midMarker.className = 'timeline-marker';
        midMarker.textContent = formatTimeShort(t);
        markersContainer.appendChild(midMarker);
      }
    }

    markersContainer.appendChild(nowMarker);
  }
}

// --- Tooltip ---
function showTooltip(e, seg) {
  const tooltip = els.tooltip();
  const typeEl = els.tooltipType();
  const timeEl = els.tooltipTime();
  const durationEl = els.tooltipDuration();

  if (!tooltip) return;

  const typeLabel = seg.type === 'coding' ? 'Coding' : 'Idle';
  if (typeEl) {
    typeEl.textContent = typeLabel;
    typeEl.className = `tooltip-type ${seg.type}`;
  }
  if (timeEl) {
    timeEl.textContent = `${formatTime(seg.startTime)} \u2013 ${formatTime(seg.endTime)}`;
  }
  if (durationEl) {
    durationEl.textContent = `Duration: ${formatDuration(seg.durationSecs)}`;
  }

  tooltip.classList.add('visible');
  positionTooltip(e);
}

function positionTooltip(e) {
  const tooltip = els.tooltip();
  if (!tooltip) return;

  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY - pad - tooltip.offsetHeight;

  // Keep tooltip in viewport
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) {
    x = e.clientX - pad - rect.width;
  }
  if (y < 0) {
    y = e.clientY + pad;
  }

  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  const tooltip = els.tooltip();
  if (tooltip) tooltip.classList.remove('visible');
}

// --- Summary ---
function renderSummary(timeline, sessionStart) {
  const summaryEl = els.summary();
  if (!summaryEl) return;

  if (!timeline || timeline.length === 0) {
    summaryEl.style.display = 'none';
    return;
  }

  const now = Date.now();
  let codingMs = 0;
  let idleMs = 0;

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    const nextTime = (i + 1 < timeline.length) ? timeline[i + 1].time : now;
    const duration = nextTime - entry.time;
    if (entry.type === 'coding') codingMs += duration;
    else idleMs += duration;
  }

  // Time before first timeline event
  if (timeline.length > 0 && timeline[0].time > sessionStart) {
    idleMs += timeline[0].time - sessionStart;
  }

  const totalSecs = (now - sessionStart) / 1000;
  const codingSecs = codingMs / 1000;
  const idleSecs = idleMs / 1000;

  const totalEl = els.summaryTotal();
  const codingEl = els.summaryCoding();
  const idleEl = els.summaryIdle();

  if (totalEl) totalEl.textContent = formatDuration(totalSecs);
  if (codingEl) codingEl.textContent = formatDuration(codingSecs);
  if (idleEl) idleEl.textContent = formatDuration(idleSecs);

  summaryEl.style.display = 'flex';
}

// --- Recent files ---
function renderRecentFiles(container, recentFiles) {
  if (!container) return;
  container.innerHTML = '';

  if (!recentFiles || recentFiles.length === 0) {
    container.innerHTML = '<li class="no-files">No file changes yet</li>';
    return;
  }

  for (const filePath of recentFiles) {
    const { name, dir } = extractFileParts(filePath);
    const li = document.createElement('li');
    li.className = 'recent-file-item';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'file-icon';
    iconSpan.textContent = fileIcon(filePath);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = name;

    li.appendChild(iconSpan);
    li.appendChild(nameSpan);

    if (dir) {
      const dirSpan = document.createElement('span');
      dirSpan.className = 'file-dir';
      dirSpan.textContent = dir;
      li.appendChild(dirSpan);
    }

    container.appendChild(li);
  }
}

// --- Request data from main window ---
async function requestData() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'session-request-data');
  } catch (e) {
    console.log('Failed to request session data:', e);
  }
}

// --- Listen for data from main window ---
async function setupListener() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.listen('session-data', (event) => {
      render(event.payload);
    });
  } catch (e) {
    console.log('Failed to set up session data listener:', e);
  }
}

// --- Event listeners ---
document.getElementById('session-close').addEventListener('click', closeWindow);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWindow();
});

// --- Init ---
async function init() {
  await setupListener();
  await requestData();

  // Periodically re-request data every 5 seconds for live updates
  setInterval(requestData, 5000);
}

init();
