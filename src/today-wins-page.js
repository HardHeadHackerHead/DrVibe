// Dr. Vibe - Standalone Today's Wins Page
// Receives live data from the main window. Supports quit flow integration.

async function closeWindow() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.close();
  } catch (e) {
    window.close();
  }
}

// --- State ---

let isQuitFlow = false;
let currentStats = null;

// --- Format helpers ---

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// --- Encouragement messages (matching TodayWinsPanel logic) ---

function getCodingMessage(seconds) {
  const hours = seconds / 3600;
  if (hours >= 4) return "What a powerhouse session! You were in the zone today.";
  if (hours >= 2) return "Solid work today! Consistency builds greatness.";
  if (hours >= 1) return "Great session! Every hour of practice counts.";
  if (seconds >= 1800) return "Nice work! You showed up and made progress.";
  if (seconds >= 300) return "You got started \u2014 that's the hardest part!";
  return "You showed up today. That counts for something!";
}

function getStreakMessage(streak) {
  if (streak >= 30) return `Incredible ${streak}-day streak! Unstoppable!`;
  if (streak >= 14) return `Amazing ${streak}-day streak! You're a machine!`;
  if (streak >= 7) return `You're on fire with a ${streak}-day streak!`;
  if (streak >= 3) return `Nice ${streak}-day streak going!`;
  if (streak === 1) return "Day 1 of a new streak \u2014 keep it going!";
  return "Every journey starts with day one.";
}

function getFilesMessage(created, modified) {
  const total = created + modified;
  if (created > 0 && modified > 0) return `Created ${created} and touched ${modified} files`;
  if (created > 0) return `Created ${created} new file${created > 1 ? 's' : ''}`;
  if (modified > 0) return `Touched ${modified} file${modified > 1 ? 's' : ''}`;
  return "Sometimes the best code is no code at all";
}

// --- Render ---

function render(stats) {
  currentStats = stats;

  // Title
  const titleEl = document.getElementById('today-wins-title');
  if (titleEl) titleEl.textContent = isQuitFlow ? "Today's Wins" : "Today's Wins So Far";

  // Main encouragement message
  const messageEl = document.getElementById('today-wins-message');
  if (messageEl) messageEl.textContent = getCodingMessage(stats.codingSeconds || 0);

  // Stats
  const timeEl = document.getElementById('today-wins-time');
  if (timeEl) timeEl.textContent = formatTime(stats.codingSeconds || 0);

  const filesEl = document.getElementById('today-wins-files');
  if (filesEl) filesEl.textContent = `${(stats.filesCreated || 0) + (stats.filesModified || 0)}`;

  const streakEl = document.getElementById('today-wins-streak');
  if (streakEl) streakEl.textContent = `${stats.streak || 0}`;

  // Project
  const projectEl = document.getElementById('today-wins-project');
  if (projectEl) {
    projectEl.textContent = stats.projectName ? `Working on: ${stats.projectName}` : '';
  }

  // Sub-encouragement
  const encourageEl = document.getElementById('today-wins-encouragement');
  if (encourageEl) {
    const parts = [];
    parts.push(getFilesMessage(stats.filesCreated || 0, stats.filesModified || 0));
    parts.push(getStreakMessage(stats.streak || 0));
    encourageEl.textContent = parts.join(' \u00B7 ');
  }
}

function updateButtons() {
  const doneBtn = document.getElementById('today-wins-done');
  const continueBtn = document.getElementById('today-wins-continue');

  if (doneBtn) doneBtn.style.display = isQuitFlow ? '' : 'none';
  if (continueBtn) continueBtn.textContent = isQuitFlow ? 'Keep going!' : 'Close';
}

// --- Clipboard ---

async function copyToClipboard() {
  if (!currentStats) return;
  const stats = currentStats;
  const copyBtn = document.getElementById('today-wins-copy');

  const lines = [];
  lines.push(`\uD83C\uDFC6 Today's Wins \u2014 ${new Date().toLocaleDateString()}`);
  lines.push('');
  lines.push(`\u23F1 Coded for ${formatTime(stats.codingSeconds || 0)}`);
  lines.push(`\uD83D\uDCC1 ${getFilesMessage(stats.filesCreated || 0, stats.filesModified || 0)}`);
  if (stats.projectName) lines.push(`\uD83D\uDCC2 Worked on: ${stats.projectName}`);
  if (stats.streak > 0) lines.push(`\uD83D\uDD25 ${stats.streak}-day streak`);
  lines.push('');
  lines.push(`\u2014 Dr. Vibe \uD83E\uDDD1\u200D\uD83D\uDD2C`);
  const text = lines.join('\n');

  try {
    await navigator.clipboard.writeText(text);
    if (copyBtn) {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    }
  } catch (e) {
    console.error('Failed to copy to clipboard:', e);
    if (copyBtn) {
      copyBtn.textContent = 'Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    }
  }
}

// --- Quit confirmation ---

async function confirmQuit() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'today-wins-quit-confirmed');
  } catch (e) {
    console.log('Failed to send quit confirmation:', e);
  }
}

// --- Cancel quit flow ---

async function cancelQuit() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'today-wins-quit-cancelled');
  } catch (e) {
    console.log('Failed to send quit cancellation:', e);
  }
  closeWindow();
}

// --- Event listeners ---

document.getElementById('today-wins-done').addEventListener('click', confirmQuit);
document.getElementById('today-wins-copy').addEventListener('click', copyToClipboard);
document.getElementById('today-wins-continue').addEventListener('click', () => {
  if (isQuitFlow) {
    cancelQuit();
  } else {
    closeWindow();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isQuitFlow) {
      cancelQuit();
    } else {
      closeWindow();
    }
  }
});

// --- Listen for data from main window ---

async function setupListener() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.listen('today-wins-data', (event) => {
      dataReceived = true;
      const payload = event.payload;
      if (payload.stats) {
        render(payload.stats);
      }
      if (payload.isQuitFlow !== undefined) {
        isQuitFlow = payload.isQuitFlow;
      }
      updateButtons();
    });
  } catch (e) {
    console.log('Failed to set up today-wins data listener:', e);
  }
}

async function requestData() {
  try {
    const { emitTo } = window.__TAURI__.event;
    await emitTo('main', 'today-wins-request-data');
  } catch (e) {
    console.log('Failed to request today-wins data:', e);
  }
}

// --- Init ---

let dataReceived = false;

async function init() {
  updateButtons();
  await setupListener();

  // Request data with retries - WebView2 on Windows can be slow to initialize
  // and the main window's push might arrive before our listener is ready
  await requestData();
  setTimeout(() => { if (!dataReceived) requestData(); }, 500);
  setTimeout(() => { if (!dataReceived) requestData(); }, 1200);
}

init();
