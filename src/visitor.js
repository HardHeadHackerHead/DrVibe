// Dr. Vibe — the visitor window.
//
// Another player's Dr. Vibe walks in from the screen edge along the taskbar,
// stops beside this player's Dr. Vibe, waves, stays about 20 seconds, waves
// again and walks off the other side. Clicking it opens a small menu:
// Wave back (sends a visit in return) or View profile.
//
// The main window's VisitorController decides when a visit plays and sends
// `visitor-play`; this window reports `visitor-arrived`, `visitor-done` and
// `visitor-wave-back` back to main.

import { SpriteAnimator } from './features/character/SpriteAnimator.js';
import { planVisitWalk, stepTowards } from './features/visits/visitPath.js';
import { openUrl } from './core/openUrl.js';
import { WEB_BASE, syncWebBaseFromRust } from './core/config.js';
import { WebRoutes } from './core/api/endpoints.js';
import { initTheme } from './core/theme.js';

initTheme();

const STAY_MS = 20_000;
const LEAVE_WAVE_MS = 1_000;
const MENU_GRACE_MS = 5_000;

const tauriWin = () => window.__TAURI__?.window?.getCurrentWindow?.();
const invoke = (...a) => window.__TAURI__?.core?.invoke?.(...a);
const emitToMain = (event, payload) => {
  try { window.__TAURI__?.event?.emitTo?.('main', event, payload); } catch { /* main gone */ }
};

const canvas = document.getElementById('visitor-canvas');
const nameTag = document.getElementById('name-tag');
const menu = document.getElementById('menu');
const btnWaveBack = document.getElementById('btn-wave-back');
const btnProfile = document.getElementById('btn-view-profile');

const animator = new SpriteAnimator(canvas);
let animatorReady = false;
let current = null; // { visit, path, x, phase }
let lastTick = 0;

async function ensureAnimator(scale, skinTone) {
  if (!animatorReady) {
    await animator.init('dr-vibe-default', skinTone, scale);
    animatorReady = true;
  } else {
    animator.applyCharacterScale(scale);
  }
  animator._skinTone = skinTone || 'default';
  animator._skinSwapMap = null;
}

async function loadSprite(sprite) {
  // A visitor wearing a finished copy shows it too (null for Lab Originals).
  animator.setFinish(sprite.localSkin ? null : sprite.finish || null);
  if (sprite.localSkin) {
    await animator.loadSkin(sprite.localSkin);
  } else if (sprite.pngBase64) {
    await animator.loadSkinData(`visitor-${sprite.slug || 'guest'}`, sprite.pngBase64, sprite.animJson || null);
  } else {
    await animator.loadSkin('dr-vibe-default');
  }
}

async function play(payload) {
  if (current) return; // one visitor at a time; main queues the rest
  const { visit, sprite, scale, geometry, size } = payload;
  await syncWebBaseFromRust();
  await ensureAnimator(scale, sprite?.skinTone);
  await loadSprite(sprite || {});

  const path = planVisitWalk(geometry);
  current = { visit, path, x: path.startX, phase: 'walk-in', menuOpen: false };
  const who = visit.from.displayName || visit.from.username;
  nameTag.textContent = `@${visit.from.username}`;
  nameTag.title = who;
  nameTag.hidden = false;
  btnWaveBack.disabled = !!visit.test;
  btnWaveBack.textContent = visit.test ? 'Wave back (test)' : 'Wave back';
  menu.classList.remove('open');

  await invoke('set_visitor_frame', {
    x: Math.round(path.startX), y: Math.round(path.y), width: size.width, height: size.height,
  });
  await tauriWin()?.show();
  animator.play(path.standX > path.startX ? 'walkRight' : 'walkLeft', true);
  lastTick = performance.now();
  requestAnimationFrame(tick);
}

function tick(now) {
  if (!current) return;
  const dt = Math.min(100, now - lastTick);
  lastTick = now;
  animator.update(dt);

  const c = current;
  const target = c.phase === 'walk-in' ? c.path.standX : c.phase === 'walk-out' ? c.path.exitX : null;
  if (target !== null) {
    c.x = stepTowards(c.x, target, dt);
    tauriWin()?.setPosition({ type: 'Physical', x: Math.round(c.x), y: Math.round(c.path.y) }).catch(() => {});
    if (c.x === target) {
      if (c.phase === 'walk-in') arrive();
      else return finish();
    }
  }
  requestAnimationFrame(tick);
}

function arrive() {
  const c = current;
  c.phase = 'stay';
  animator.play('idle', true);
  animator.wave();
  emitToMain('visitor-arrived', { visit: c.visit });
  c.leaveTimer = setTimeout(leave, STAY_MS);
}

function leave() {
  const c = current;
  if (!c) return;
  if (c.menuOpen) {
    c.leaveTimer = setTimeout(leave, MENU_GRACE_MS);
    return;
  }
  menu.classList.remove('open');
  animator.wave();
  c.phase = 'wave-out';
  setTimeout(() => {
    if (!current) return;
    current.phase = 'walk-out';
    animator.play(current.path.exitX > current.x ? 'walkRight' : 'walkLeft', true);
  }, LEAVE_WAVE_MS);
}

async function finish() {
  const visit = current?.visit;
  clearTimeout(current?.leaveTimer);
  current = null;
  nameTag.hidden = true;
  menu.classList.remove('open');
  await tauriWin()?.hide();
  emitToMain('visitor-done', { visitId: visit?.id ?? null });
}

canvas.addEventListener('click', () => {
  if (!current || current.phase !== 'stay') return;
  current.menuOpen = !menu.classList.contains('open');
  menu.classList.toggle('open', current.menuOpen);
});

btnWaveBack.addEventListener('click', () => {
  if (!current || current.visit.test) return;
  emitToMain('visitor-wave-back', { visitId: current.visit.id, toUsername: current.visit.from.username });
  btnWaveBack.disabled = true;
  btnWaveBack.textContent = 'Waved!';
  animator.wave();
});

btnProfile.addEventListener('click', () => {
  if (!current) return;
  openUrl(`${WEB_BASE}${WebRoutes.profile(current.visit.from.username)}`);
  current.menuOpen = false;
  menu.classList.remove('open');
});

// Main window asks us to clear out early (e.g. a screen share started).
window.__TAURI__?.event?.listen?.('visitor-dismiss', () => {
  if (current) finish();
});
window.__TAURI__?.event?.listen?.('visitor-play', (e) => {
  play(e.payload).catch((err) => {
    console.error('[visitor] play failed:', err);
    current = null;
    tauriWin()?.hide();
    emitToMain('visitor-done', { visitId: e.payload?.visit?.id ?? null, error: String(err) });
  });
});
emitToMain('visitor-ready', {});
