// Dr. Vibe - Toast Notification Window
// Manages the transparent overlay that displays in-app toast notifications.

const MAX_TOASTS = 4;
const EXIT_DURATION_MS = 250;

const container = document.getElementById('toast-container');
let toastId = 0;
let currentPosition = 'bottom-right';
let currentWindow = null;
let getCurrentMonitor = null;
let getPrimaryMonitor = null;

// Category icons
const CATEGORY_ICONS = {
  break:       '\u2615',  // coffee
  hydration:   '\uD83D\uDCA7', // droplet
  posture:     '\uD83E\uDDD8', // person in lotus
  eyestrain:   '\uD83D\uDC41\uFE0F', // eye
  fatigue:     '\uD83D\uDE34', // sleeping face
  stuck:       '\uD83E\uDD14', // thinking
  overwork:    '\u26A0\uFE0F',  // warning
  achievement: '\uD83C\uDFC6', // trophy
  boundary:    '\uD83C\uDF05', // sunset
  work:        '\uD83D\uDCBB', // laptop
  default:     '\uD83D\uDC9A', // green heart
};

function createToastElement(title, body, category, durationMs) {
  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast cat-${category || 'default'}`;
  el.dataset.toastId = id;
  el.style.setProperty('--duration', `${durationMs}ms`);

  const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.default;

  el.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon">${icon}</span>
      <span class="toast-title">${escapeHtml(title)}</span>
      <button class="toast-close" aria-label="Dismiss">&times;</button>
    </div>
    ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ''}
    <div class="toast-footer">
      <span class="toast-brand">Dr. Vibe</span>
    </div>
    <div class="toast-progress-container">
      <div class="toast-progress"></div>
    </div>
  `;

  // Close button handler
  const closeBtn = el.querySelector('.toast-close');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissToast(el);
  });

  // Auto-dismiss after duration
  const timer = setTimeout(() => dismissToast(el), durationMs);
  el.dataset.timer = timer;

  return el;
}

function dismissToast(el) {
  if (!el || el.classList.contains('exit')) return;
  clearTimeout(Number(el.dataset.timer));
  el.classList.add('exit');
  setTimeout(() => {
    el.remove();
    hideWindowIfEmpty();
  }, EXIT_DURATION_MS);
}

function hideWindowIfEmpty() {
  if (container.children.length === 0) {
    hideWindow();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Window visibility ---
async function showWindow() {
  try {
    if (currentWindow) {
      console.log('Toast: showing window');
      await currentWindow.show();
    } else {
      console.warn('Toast: cannot show - no window handle');
    }
  } catch (e) {
    console.error('Toast: failed to show window', e);
  }
}

async function hideWindow() {
  try {
    if (currentWindow) {
      // Re-enable click-through before hiding
      await setClickThrough(true);
      await currentWindow.hide();
    }
  } catch (e) {
    console.error('Toast: failed to hide window', e);
  }
}

// --- Click-through when no toasts visible ---
async function setClickThrough(ignore) {
  try {
    if (currentWindow) {
      await currentWindow.setIgnoreCursorEvents(ignore);
    }
  } catch (e) {
    // Ignore
  }
}

// --- Positioning ---
async function repositionWindow(position) {
  try {
    if (!currentWindow) {
      console.warn('Toast: no window handle available');
      return;
    }

    currentPosition = position || currentPosition;

    // Try currentMonitor first, fall back to primaryMonitor
    // (currentMonitor can fail if window is hidden or at 0,0)
    let monitor = null;
    try {
      monitor = await getCurrentMonitor();
    } catch (e) {
      console.warn('Toast: currentMonitor failed, trying primaryMonitor');
    }

    if (!monitor && getPrimaryMonitor) {
      try {
        monitor = await getPrimaryMonitor();
      } catch (e) {
        console.warn('Toast: primaryMonitor also failed');
      }
    }

    if (!monitor) {
      console.error('Toast: could not get any monitor info');
      return;
    }

    const { width: screenW, height: screenH } = monitor.size;
    const scaleFactor = monitor.scaleFactor || 1;
    const winW = 350;
    const winH = 250;

    // Calculate physical position (Tauri uses physical pixels for setPosition)
    // Account for monitor position offset for multi-monitor setups
    const monitorX = monitor.position?.x || 0;
    const monitorY = monitor.position?.y || 0;
    const margin = Math.round(12 * scaleFactor);
    let x = 0, y = 0;

    switch (currentPosition) {
      case 'top-left':
        x = monitorX + margin;
        y = monitorY + margin;
        break;
      case 'top-center':
        x = monitorX + Math.round((screenW - winW * scaleFactor) / 2);
        y = monitorY + margin;
        break;
      case 'top-right':
        x = monitorX + screenW - Math.round(winW * scaleFactor) - margin;
        y = monitorY + margin;
        break;
      case 'bottom-left':
        x = monitorX + margin;
        y = monitorY + screenH - Math.round(winH * scaleFactor) - margin;
        break;
      case 'bottom-center':
        x = monitorX + Math.round((screenW - winW * scaleFactor) / 2);
        y = monitorY + screenH - Math.round(winH * scaleFactor) - margin;
        break;
      case 'bottom-right':
      default:
        x = monitorX + screenW - Math.round(winW * scaleFactor) - margin;
        y = monitorY + screenH - Math.round(winH * scaleFactor) - margin;
        break;
    }

    // Update container CSS direction based on position
    container.classList.remove('position-top', 'position-left');
    if (currentPosition && currentPosition.startsWith('top')) {
      container.classList.add('position-top');
    }
    if (currentPosition && currentPosition.includes('left')) {
      container.classList.add('position-left');
    }

    console.log(`Toast: repositioning to ${currentPosition} at (${x}, ${y})`);
    await currentWindow.setPosition({ type: 'Physical', x: Math.round(x), y: Math.round(y) });
  } catch (e) {
    console.error('Toast: failed to reposition', e);
  }
}

// --- Tauri event listeners ---
async function init() {
  if (!window.__TAURI__) {
    console.log('Toast: Tauri not available');
    return;
  }

  console.log('Toast: initializing window...');

  const { listen } = window.__TAURI__.event;
  const windowModule = window.__TAURI__.window;
  currentWindow = windowModule.getCurrentWindow();
  getCurrentMonitor = windowModule.currentMonitor;
  getPrimaryMonitor = windowModule.primaryMonitor;

  console.log('Toast: window handle acquired:', currentWindow ? 'yes' : 'no');

  // Start click-through and hidden
  await setClickThrough(true);

  // Position on startup with default position
  await repositionWindow('bottom-right');

  await listen('toast-show', async (event) => {
    console.log('Toast: received toast-show event', event.payload);
    const { title, body, category, durationMs } = event.payload;
    const duration = durationMs || 10000;

    // Limit max visible toasts
    while (container.children.length >= MAX_TOASTS) {
      dismissToast(container.firstElementChild);
    }

    const el = createToastElement(title, body, category, duration);
    container.appendChild(el);

    // Ensure positioned correctly before showing
    await repositionWindow(currentPosition);
    // Disable click-through so users can interact with close button
    await setClickThrough(false);
    await showWindow();
  });

  await listen('toast-dismiss-all', () => {
    Array.from(container.children).forEach(el => dismissToast(el));
  });

  await listen('toast-reposition', async (event) => {
    const { position } = event.payload;
    await repositionWindow(position);
  });

  await listen('toast-init', async (event) => {
    const { position } = event.payload || {};
    await repositionWindow(position || 'bottom-right');
  });
}

init();
