// Dr. Vibe - Single Toast Item Window
// Each instance of this script runs in its own per-toast Tauri window.
// It renders one toast, resizes the window to fit, reports back to the
// manager (toast-window.js), then self-manages dismiss/snooze/drag.

import { openUrl } from './core/openUrl.js';
import { WEB_BASE as FALLBACK_URL } from './core/config.js';

const CATEGORY_ICONS = {
  break:       '\u2615',
  hydration:   '\uD83D\uDCA7',
  posture:     '\uD83E\uDDD8',
  eyestrain:   '\uD83D\uDC41\uFE0F',
  fatigue:     '\uD83D\uDE34',
  stuck:       '\uD83E\uDD14',
  overwork:    '\u26A0\uFE0F',
  achievement: '\uD83C\uDFC6',
  boundary:    '\uD83C\uDF05',
  work:        '\uD83D\uDCBB',
  trade:       '\uD83D\uDD04',
  community:   '\uD83D\uDC4B',
  economy:     '\u2728',
  default:     '\uD83D\uDC9A',
};

async function openInBrowser(url) {
  const target = url || FALLBACK_URL;
  await openUrl(target);
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const label       = params.get('label') || '';
  const title       = params.get('title') || '';
  const body        = params.get('body') || '';
  const category    = params.get('category') || 'default';
  const durationMs  = parseInt(params.get('durationMs') || '10000');
  const snoozeAction = params.get('snoozeAction') || null;
  const url         = params.get('url') || null;
  const viewLabel   = params.get('viewLabel') || 'View';

  // Build toast element
  const toast = document.createElement('div');
  toast.className = `toast cat-${category}`;
  toast.style.setProperty('--duration', `${durationMs}ms`);
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon">${CATEGORY_ICONS[category] || CATEGORY_ICONS.default}</span>
      <span class="toast-title">${escapeHtml(title)}</span>
      <button class="toast-close" aria-label="Dismiss">&times;</button>
    </div>
    ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ''}
    <div class="toast-footer">
      <span class="toast-brand">Dr. Vibe</span>
      <div class="toast-actions">
        ${snoozeAction ? `<button class="toast-snooze-btn">Snooze</button>` : ''}
        ${url ? `<button class="toast-view-btn">${escapeHtml(viewLabel)}</button>` : ''}
      </div>
    </div>
    <div class="toast-progress-container">
      <div class="toast-progress"></div>
    </div>
  `;
  document.body.appendChild(toast);

  if (!window.__TAURI__) return;

  const { getCurrentWindow } = window.__TAURI__.window;
  const { emitTo }           = window.__TAURI__.event;
  const currentWindow        = getCurrentWindow();

  // Measure the rendered height and resize window to fit exactly.
  // offsetHeight forces a synchronous layout — the toast's height is based on
  // its own padding/content, not the window height, so this is always accurate.
  const height = toast.offsetHeight;
  await currentWindow.setSize({ type: 'Logical', width: 350, height });

  // Tell the manager our actual pixel height so it can reposition the stack.
  await emitTo('toast', 'toast-item-ready', { label, height });

  // Auto-dismiss
  let timer = setTimeout(() => dismiss(), durationMs);

  // Pause timer on hover — use a safety cap so hover can't freeze a toast forever
  let hoverSafety = null;
  toast.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    const progress = toast.querySelector('.toast-progress');
    if (progress) progress.style.animationPlayState = 'paused';
    // Safety: dismiss after 60s even if mouseleave never fires
    clearTimeout(hoverSafety);
    hoverSafety = setTimeout(() => dismiss(), 60000);
  });
  toast.addEventListener('mouseleave', () => {
    clearTimeout(hoverSafety);
    const progress = toast.querySelector('.toast-progress');
    if (progress) progress.style.animationPlayState = 'running';
    // Remaining time approximation — just restart with a short duration
    timer = setTimeout(() => dismiss(), 3000);
  });

  // Close button
  toast.querySelector('.toast-close').addEventListener('click', e => {
    e.stopPropagation();
    dismiss();
  });

  // Snooze button
  if (snoozeAction) {
    const snoozeBtn = toast.querySelector('.toast-snooze-btn');
    snoozeBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      try { await emitTo('main', 'toast-snooze', { action: snoozeAction }); } catch {}
      dismiss();
    });
  }

  // View button — opens deep link in the user's default browser
  if (url) {
    const viewBtn = toast.querySelector('.toast-view-btn');
    viewBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      await openInBrowser(url);
      dismiss();
    });
  }

  // Drag to dismiss
  makeDraggable(toast, dismiss);

  let dismissed = false;
  async function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    clearTimeout(hoverSafety);

    // If the drag code already added .exit and ran its own animation,
    // close immediately. Otherwise play the CSS exit animation first.
    const alreadyExiting = toast.classList.contains('exit');
    if (!alreadyExiting) toast.classList.add('exit');

    const delay = alreadyExiting ? 0 : 250;
    setTimeout(async () => {
      // The manager hides and destroys this window. It never closes itself:
      // a window destroyed while its own close call is answered crashed the app.
      try { await emitTo('toast', 'toast-item-close', { label }); } catch {}
    }, delay);
  }
}

function makeDraggable(el, onDismiss) {
  let dragging = false, startX = 0, offsetX = 0, velX = 0, lastX = 0, lastT = 0;

  el.addEventListener('mousedown', e => {
    if (e.target.closest('.toast-close') || e.target.closest('.toast-snooze-btn') || e.target.closest('.toast-view-btn')) return;
    if (el.classList.contains('exit')) return;
    e.preventDefault();
    el.style.animation = 'none';
    el.style.opacity   = '1';
    el.style.transform = 'translateX(0) scale(1)';
    dragging = true;
    startX = lastX = e.clientX;
    lastT  = Date.now();
    offsetX = velX = 0;
    el.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  function onMove(e) {
    if (!dragging) return;
    const now = Date.now(), dt = now - lastT;
    if (dt > 0) velX = (e.clientX - lastX) / dt;
    lastX = e.clientX; lastT = now;
    offsetX = e.clientX - startX;
    el.style.transform = `translateX(${offsetX}px) rotate(${offsetX * 0.06}deg)`;
    el.style.opacity   = String(Math.max(0.25, 1 - Math.abs(offsetX) / 260));
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);

    if (Math.abs(velX) >= 0.45 || Math.abs(offsetX) >= 80) {
      const dir = velX !== 0 ? Math.sign(velX) : Math.sign(offsetX);
      el.classList.add('exit');
      el.style.transition = 'transform 0.32s cubic-bezier(0.2,0,0.6,0.2), opacity 0.28s ease';
      el.style.transform  = `translateX(${dir * 420}px) rotate(${dir * 18}deg) scale(0.85)`;
      el.style.opacity    = '0';
      setTimeout(() => onDismiss(), 320);
    } else {
      el.style.transition = 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease';
      el.style.transform  = 'translateX(0) scale(1)';
      el.style.opacity    = '1';
      setTimeout(() => { el.style.transition = el.style.transform = ''; }, 460);
    }
  }
}

init();
