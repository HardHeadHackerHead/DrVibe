// Dr. Vibe - Speech Bubble Window Logic
// Runs inside the separate transparent speech bubble window.
// Receives events from the main window to show/hide speech.

const bubble = document.getElementById('speech-bubble');
const textEl = document.getElementById('speech-bubble-text');
const tipEl = document.getElementById('speech-bubble-tip');
const dismissBtn = document.getElementById('speech-bubble-dismiss');

let dismissTimer = null;
let currentWindow = null;

async function setClickThrough(ignore) {
  try {
    if (currentWindow) {
      await currentWindow.setIgnoreCursorEvents(ignore);
    }
  } catch (e) {
    // Ignore
  }
}

function showBubble(text, tip, durationMs) {
  textEl.textContent = text;
  tipEl.textContent = tip;
  bubble.classList.remove('hidden');

  // Re-trigger animation by removing and re-adding the element
  bubble.style.animation = 'none';
  bubble.offsetHeight; // force reflow
  bubble.style.animation = '';

  // Allow clicks on the bubble (dismiss button)
  setClickThrough(false);

  clearTimeout(dismissTimer);
  if (durationMs > 0) {
    dismissTimer = setTimeout(hideBubble, durationMs);
  }
}

function hideBubble() {
  bubble.classList.add('hidden');
  clearTimeout(dismissTimer);

  // Make window click-through when bubble is hidden
  setClickThrough(true);

  // Notify main window that speech was dismissed
  try {
    const { emitTo } = window.__TAURI__.event;
    emitTo('main', 'speech-dismissed', {});
  } catch (e) {
    // Ignore if main window isn't available
  }
}

// Dismiss button
dismissBtn.addEventListener('click', hideBubble);

// Listen for events from the main window
async function init() {
  if (!window.__TAURI__) {
    console.log('Speech bubble: Tauri not available');
    return;
  }

  const { listen } = window.__TAURI__.event;
  currentWindow = window.__TAURI__.window.getCurrentWindow();

  // Start click-through since bubble is hidden initially
  await setClickThrough(true);

  // Main window tells us to show ourselves (after positioning)
  await listen('speech-init', async () => {
    try {
      await currentWindow.show();
    } catch (e) {
      // Ignore
    }
  });

  // Show speech bubble
  await listen('speech-show', (event) => {
    const { text, tip, durationMs } = event.payload;
    showBubble(text, tip, durationMs || 20000);
  });

  // Hide speech bubble
  await listen('speech-hide', () => {
    hideBubble();
  });

  // Reposition this window (called when main window moves)
  await listen('speech-reposition', async (event) => {
    const { x, y } = event.payload;
    try {
      await currentWindow.setPosition({ type: 'Physical', x: Math.round(x), y: Math.round(y) });
    } catch (e) {
      // Ignore positioning errors
    }
  });
}

init();
