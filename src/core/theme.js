// Dr. Vibe - Centralized Theme Management
// Syncs the active theme across every open window via the Tauri global event bus.
// Usage:
//   import { initTheme, toggleTheme, setTheme } from './core/theme.js';
//   initTheme();   // call once at page init; applies saved theme + wires up listener

const STORAGE_KEY = 'drvibe-theme';
const EVENT_NAME  = 'theme-changed';

/** Return the currently active theme ('dark' | 'light'). */
export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'dark';
}

/** Apply a theme to the current document WITHOUT broadcasting. */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  _syncIcons(theme);
}

/**
 * Set the theme, persist it to localStorage, apply it to this window,
 * and broadcast to every other open window via the Tauri global event bus.
 */
export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  try {
    // Tauri v2 global emit — all windows listening with listen() will receive it
    window.__TAURI__?.event?.emit(EVENT_NAME, { theme });
  } catch (_) {
    // Browser dev mode — no Tauri, nothing to do
  }
}

/** Toggle dark ↔ light and return the new theme. */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/**
 * Call once during page init.
 * - Applies the saved theme immediately (complements the inline flash-prevention
 *   script already in <head>, in case JS loads before the attribute is set).
 * - Subscribes to `theme-changed` events emitted by other windows so the UI
 *   updates in real time whenever any window switches the theme.
 */
export function initTheme() {
  applyTheme(getTheme());

  try {
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return;
    listen(EVENT_NAME, (event) => {
      const theme = event?.payload?.theme;
      if (theme === 'dark' || theme === 'light') {
        localStorage.setItem(STORAGE_KEY, theme);
        applyTheme(theme);
      }
    });
  } catch (_) {
    // Browser dev mode — ignore
  }
}

/** Update ☀/☾ icons on any theme-toggle buttons present in the current page. */
function _syncIcons(theme) {
  const icon = theme === 'dark' ? '☀' : '☾';
  ['sh-theme-icon', 'tb-theme-icon'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = icon;
  });
}
