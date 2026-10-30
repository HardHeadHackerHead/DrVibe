// Dr. Vibe - Toast Window Manager
// This window is a headless 1px orchestrator: it receives toast-show events,
// creates one Tauri window per toast via the create_toast_window Rust command,
// tracks the stack, and repositions windows as toasts are added or removed.

const WIN_W   = 350;  // logical px — toast width never changes
const MARGIN  = 12;   // logical px — gap from screen edge
const TASKBAR = 48;   // logical px — clearance for Windows taskbar
const GAP     = 10;   // logical px — gap between stacked toasts

let monitor         = null;
let currentPosition = 'bottom-right';
// Use a session-unique prefix so label collisions with orphaned windows
// from a previous manager reload (live-server, etc.) are impossible.
const sessionId     = Date.now();
let toastCounter    = 0;

// label → { height }  (logical px, updated when toast-item-ready fires)
const stack = new Map();

// ─── Monitor ─────────────────────────────────────────────────────────────────

async function refreshMonitor() {
  const { currentMonitor, primaryMonitor } = window.__TAURI__.window;
  try   { monitor = await currentMonitor();  } catch {}
  if (!monitor) try { monitor = await primaryMonitor(); } catch {}
}

// ─── Stack positioning ───────────────────────────────────────────────────────

// Convert a logical size/position to physical pixels for setPosition calls.
function toPhysical(v) {
  return Math.round(v * (monitor?.scaleFactor || 1));
}

// Recalculate and apply the physical position of every window in the stack.
async function repositionStack() {
  if (!monitor || stack.size === 0) return;

  const sf      = monitor.scaleFactor || 1;
  const screenW = monitor.size.width;
  const screenH = monitor.size.height;
  const offX    = monitor.position?.x || 0;
  const offY    = monitor.position?.y || 0;

  const isTop   = currentPosition.startsWith('top');
  const isLeft  = currentPosition.includes('left');
  const isCenter = currentPosition.includes('center');

  // X (physical)
  let x;
  if (isCenter) {
    x = offX + Math.round((screenW - WIN_W * sf) / 2);
  } else if (isLeft) {
    x = offX + Math.round(MARGIN * sf);
  } else {
    x = offX + screenW - Math.round(WIN_W * sf) - Math.round(MARGIN * sf);
  }

  // Anchor Y (physical) — the edge the stack grows away from
  const edgeMargin = Math.round((MARGIN + (isTop ? 0 : TASKBAR)) * sf);
  let y = isTop
    ? offY + edgeMargin
    : offY + screenH - edgeMargin;

  const { Window: TauriWindow } = window.__TAURI__.window;
  const gapPx = Math.round(GAP * sf);

  const entries = Array.from(stack.entries()); // insertion order = oldest first

  for (let i = 0; i < entries.length; i++) {
    // For bottom positions: oldest at bottom, each new toast pushes previous ones up.
    // We iterate in reverse so index 0 (oldest) ends up at the bottom.
    const idx = isTop ? i : entries.length - 1 - i;
    const [label, entry] = entries[idx];
    const hPx = Math.round(entry.height * sf);

    if (!isTop) y -= hPx;

    const win = await TauriWindow.getByLabel(label);
    if (win) {
      try { await win.setPosition({ type: 'Physical', x, y }); } catch {}
    }

    if (isTop) { y += hPx + gapPx; }
    else       { y -= gapPx; }
  }
}

// Calculate the logical position for a new toast before we know its exact height.
// We use an estimate so the Rust command can create the window at roughly the
// right place; repositionStack() corrects it once the real height is known.
function estimatedPosition(estimatedH) {
  if (!monitor) return { x: 0, y: 0 };

  const sf      = monitor.scaleFactor || 1;
  const logW    = monitor.size.width  / sf;
  const logH    = monitor.size.height / sf;
  const offX    = (monitor.position?.x || 0) / sf;
  const offY    = (monitor.position?.y || 0) / sf;

  const isTop    = currentPosition.startsWith('top');
  const isLeft   = currentPosition.includes('left');
  const isCenter = currentPosition.includes('center');

  let x;
  if (isCenter) x = offX + (logW - WIN_W) / 2;
  else if (isLeft) x = offX + MARGIN;
  else x = offX + logW - WIN_W - MARGIN;

  // Stack offset: total logical height already occupied
  let stackH = 0;
  for (const { height } of stack.values()) stackH += height + GAP;

  let y;
  if (isTop) {
    y = offY + MARGIN + stackH;
  } else {
    y = offY + logH - MARGIN - TASKBAR - stackH - estimatedH;
  }

  return { x, y };
}

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handleToastShow(event) {
  const { title, body, category, durationMs, snoozeAction, url, viewLabel } = event.payload;

  const label = `toast-item-${sessionId}-${++toastCounter}`;
  const estimatedH = body ? 112.0 : 86.0;

  const params = new URLSearchParams({
    label,
    title:      title      || '',
    body:       body       || '',
    category:   category   || 'default',
    durationMs: String(durationMs || 10000),
    ...(snoozeAction ? { snoozeAction } : {}),
    ...(url ? { url } : {}),
    ...(url && viewLabel ? { viewLabel } : {}),
  });

  const { x, y } = estimatedPosition(estimatedH);

  try {
    await window.__TAURI__.core.invoke('create_toast_window', {
      label,
      urlPath: `toast-item.html?${params}`,
      x, y,
      width:  WIN_W,
      height: estimatedH,
    });
  } catch (e) {
    console.error('Toast manager: failed to create window', label, e);
    return;
  }

  stack.set(label, { height: estimatedH });
}

async function handleItemReady(event) {
  const { label, height } = event.payload;
  const entry = stack.get(label);
  if (!entry) return;

  entry.height = height;

  // Resize the window to the exact measured height, then reposition the stack.
  const { Window: TauriWindow } = window.__TAURI__.window;
  const win = await TauriWindow.getByLabel(label);
  if (win) {
    try { await win.setSize({ type: 'Logical', width: WIN_W, height }); } catch {}
    await repositionStack();
    // Make interactive — toast-item has already rendered and measured itself
    try { await win.setIgnoreCursorEvents(false); } catch {}
  } else {
    await repositionStack();
  }
}

// How long a hidden toast lives before it is destroyed: long enough for any
// call it made to be answered. Destroying a window while Rust answers one of
// its calls crashes the app (WebView2).
const DESTROY_DELAY_MS = 1000;

/** Hides a toast now (it stops blocking clicks) and destroys it a little later. */
async function retire(label) {
  const { Window: TauriWindow } = window.__TAURI__.window;
  const win = await TauriWindow.getByLabel(label);
  if (!win) return;
  try { await win.hide(); } catch {}
  setTimeout(() => { win.destroy().catch(() => {}); }, DESTROY_DELAY_MS);
}

async function handleItemClose(event) {
  const { label } = event.payload;
  stack.delete(label);
  await retire(label);
  await repositionStack();
}

async function handleDismissAll() {
  const labels = [...stack.keys()];
  stack.clear();
  for (const label of labels) await retire(label);
}

async function handleReposition(event) {
  const { position } = event.payload || {};
  if (position) currentPosition = position;
  await refreshMonitor();
  await repositionStack();
}

async function handleInit(event) {
  const { position } = event.payload || {};
  if (position) currentPosition = position;
  await refreshMonitor();
}

// ─── Stale window cleanup ───────────────────────────────────────────────────

// Safety net: periodically check for stale stack entries whose windows no
// longer exist (e.g. destroyed externally or the close event was lost).
async function cleanupStaleEntries() {
  if (stack.size === 0) return;

  const { Window: TauriWindow } = window.__TAURI__.window;
  let changed = false;

  for (const label of Array.from(stack.keys())) {
    const win = await TauriWindow.getByLabel(label);
    if (!win) {
      stack.delete(label);
      changed = true;
    }
  }

  if (changed) await repositionStack();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function init() {
  if (!window.__TAURI__) {
    console.log('Toast manager: Tauri not available');
    return;
  }

  // Destroy any orphaned toast-item windows left over from a previous
  // manager session (e.g. live-server reload or crash).
  try {
    const allWindows = await window.__TAURI__.window.getAllWindows();
    for (const win of allWindows) {
      if (win.label.startsWith('toast-item-')) {
        try { await win.destroy(); } catch {}
      }
    }
  } catch {}

  await refreshMonitor();

  const { listen } = window.__TAURI__.event;
  await listen('toast-show',       handleToastShow);
  await listen('toast-item-ready', handleItemReady);
  await listen('toast-item-close', handleItemClose);
  await listen('toast-dismiss-all', handleDismissAll);
  await listen('toast-reposition', handleReposition);
  await listen('toast-init',       handleInit);

  // Run stale-window cleanup every 5 seconds
  setInterval(cleanupStaleEntries, 5000);
}

init();
