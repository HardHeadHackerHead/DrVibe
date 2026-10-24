// Dr. Vibe — open a link in the player's browser.
// Uses tauri-plugin-opener (exposed as window.__TAURI__.opener with
// withGlobalTauri). Falls back to window.open outside Tauri (tests, browser).

export async function openUrl(url) {
  if (!url) return;
  try {
    const opener = window.__TAURI__?.opener;
    if (opener?.openUrl) {
      await opener.openUrl(url);
      return;
    }
  } catch (e) {
    console.warn('[openUrl] opener failed, falling back to window.open:', e);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
