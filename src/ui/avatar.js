// Dr. Vibe — remote profile pictures with a fallback.
//
// Pictures come from Discord or GitHub (the site's `avatarUrl`). A link can
// go stale (the player changed their picture) or be blocked offline, so an
// <img> that fails to load hides itself and the initials show instead.

/** Two-letter initials for a name, or '?'. */
export function initialsFor(name) {
  const s = typeof name === 'string' ? name.trim().replace(/^@/, '') : '';
  return s ? s.slice(0, 2).toUpperCase() : '?';
}

/** Whether a URL may be put in an <img> (http or https only). */
export function isAvatarUrl(url) {
  return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url);
}

/**
 * Shows `url` in `img`, or the initials in `fallbackEl` when there is no URL
 * or it fails to load. Either element may be null.
 * @param {HTMLImageElement|null} img
 * @param {HTMLElement|null} fallbackEl
 * @param {{ url?: string|null, name?: string|null, show?: boolean }} opts
 *   `show: false` (signed out) shows '?' and no picture.
 */
export function setAvatar(img, fallbackEl, { url = null, name = null, show = true } = {}) {
  const showInitials = () => {
    if (img) img.style.display = 'none';
    if (fallbackEl) {
      fallbackEl.style.display = '';
      fallbackEl.textContent = show ? initialsFor(name) : '?';
    }
  };
  if (!show || !isAvatarUrl(url) || !img) {
    if (img) {
      img.onerror = null;
      img.removeAttribute('src');
    }
    showInitials();
    return;
  }
  img.referrerPolicy = 'no-referrer';
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.loading = 'lazy';
  img.setAttribute('loading', 'lazy');
  img.alt = name || '';
  img.onerror = () => {
    img.onerror = null;
    showInitials();
  };
  img.onload = () => {
    img.style.display = 'block';
    if (fallbackEl) fallbackEl.style.display = 'none';
  };
  if (img.getAttribute('src') !== url) img.src = url;
  img.style.display = 'block';
  if (fallbackEl) fallbackEl.style.display = 'none';
}
