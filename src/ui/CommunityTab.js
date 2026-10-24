// Dr. Vibe — dashboard Community tab: your rank, rank change, friends coding
// now with a Visit button each, and recent visits with Wave back.
//
// API.md has no separate community endpoint: rank and friends come from the
// last `POST /desktop/sync` response, which the main window keeps and pushes
// here with the dashboard's live data (`communityFromSync` in contract.js).
// Recent visits are read when the tab opens (`GET /me/visits`). Visits and
// wave backs go through desktopApi.sendVisit (`POST /visits`, signed).

import { desktopApi } from '../core/api/client.js';
import { VISIT_PRESETS, visitErrorMessage, parseVisitList } from '../core/api/contract.js';
import { WebRoutes } from '../core/api/endpoints.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function rankChangeLabel(change) {
  if (!change) return { text: 'no change', cls: 'flat' };
  return change > 0 ? { text: `▲ ${change}`, cls: 'up' } : { text: `▼ ${Math.abs(change)}`, cls: 'down' };
}

const WAVE_BACK_MS = 24 * 3600 * 1000; // the server's wave-back window

function visitRow(v, now) {
  const who = `${esc(v.displayName || v.username)} <span class="comm-muted">@${esc(v.username)}</span>`;
  const what = [
    v.isWaveBack ? 'waved back' : 'visited',
    v.preset ? `"${esc(VISIT_PRESETS[v.preset])}"` : '',
    v.outcome === 'missed' ? 'while you were away' : '',
  ].filter(Boolean).join(' ');
  const canWave = !v.isWaveBack && v.createdAt && now - Date.parse(v.createdAt) < WAVE_BACK_MS;
  return `
      <div class="comm-friend comm-visit">
        <div class="comm-friend-info">
          <div class="comm-friend-name">${who}</div>
          <div class="comm-muted">${what}</div>
        </div>
        ${canWave ? `<button class="comm-btn" data-action="wave" data-username="${esc(v.username)}" data-visit-id="${esc(v.id)}">Wave back</button>` : ''}
      </div>`;
}

/**
 * Render the tab body. Pure DOM so it can be tested.
 * @param {HTMLElement} root
 * @param {{ state: 'unlinked'|'loading'|'ready', community?: import('../core/api/contract.js').CommunitySnapshot,
 *   visits?: ReturnType<typeof parseVisitList>, now?: number }} view
 */
export function renderCommunity(root, view) {
  if (!root) return;
  if (view.state === 'unlinked') {
    root.innerHTML = `
      <div class="comm-empty">
        <div class="comm-empty-title">Join the community to see friends coding now</div>
        <p>Your rank, who is coding right now, and visits from other players' Dr. Vibes live here once you link GitHub or Discord. Dr. Vibe works the same without it.</p>
        <button class="comm-btn primary" data-action="join">Join the community</button>
      </div>`;
    return;
  }
  const visits = view.visits || [];
  const now = view.now ?? Date.now();
  const recent = visits.length === 0 ? '' : `
    <div class="section-header">Recent visits</div>
    <div class="comm-friends">${visits.map((v) => visitRow(v, now)).join('')}</div>`;
  if (view.state === 'loading' || !view.community) {
    root.innerHTML = `<div class="comm-empty"><p>Your rank and friends show up after the next sync (a few minutes after you start coding).</p></div>${recent}
    <div class="comm-status" data-role="status"></div>`;
    return;
  }

  const c = view.community;
  const change = rankChangeLabel(c.rankChange);
  const presetOptions = Object.entries(VISIT_PRESETS)
    .map(([key, text]) => `<option value="${esc(key)}">${esc(text)}</option>`).join('');
  const friends = c.friendsCodingNow.length === 0
    ? '<div class="comm-muted">No friends coding right now. Follow players on drvibe.io to see them here.</div>'
    : c.friendsCodingNow.map((f) => `
      <div class="comm-friend" data-username="${esc(f.username)}">
        <span class="comm-live-dot" title="Coding now"></span>
        <div class="comm-friend-info">
          <div class="comm-friend-name">${esc(f.displayName || f.username)} <span class="comm-muted">@${esc(f.username)}</span></div>
          <div class="comm-muted">${f.currentStreak ? `${f.currentStreak}-day streak` : 'coding now'}${f.project ? ` · ${esc(f.project)}` : ''}</div>
        </div>
        <select class="comm-preset" aria-label="Visit message">
          <option value="">Just wave</option>${presetOptions}
        </select>
        <button class="comm-btn" data-action="visit" data-username="${esc(f.username)}">Visit</button>
      </div>`).join('');

  root.innerHTML = `
    <div class="card comm-rank">
      <div>
        <div class="comm-label">Your rank · coding hours</div>
        <div class="comm-rank-value">${c.rank ? `#${c.rank}` : '—'}</div>
        ${c.rank ? '' : '<div class="comm-muted">Hidden from leaderboards (Settings → Privacy)</div>'}
      </div>
      <div class="comm-rank-change ${change.cls}">${change.text}</div>
      <button class="comm-btn" data-action="rankings">Rankings ↗</button>
    </div>
    <div class="section-header">Friends coding now${c.activeFriends ? ` · ${c.activeFriends} active` : ''}</div>
    <div class="comm-friends">${friends}</div>${recent}
    <div class="comm-status" data-role="status"></div>`;
}

/**
 * Wire the tab.
 * @param {HTMLElement} root
 * @param {{ openUrl: (u: string) => void, siteBase: () => string,
 *   getView: () => { linked: boolean, community: Object|null }, startLink?: () => void, api?: typeof desktopApi }} opts
 */
export function mountCommunityTab(root, { openUrl, siteBase, getView, startLink = () => {}, api = desktopApi }) {
  let lastKey = null;
  let visits = [];

  function refresh() {
    const { linked, community } = getView();
    const key = JSON.stringify([linked, community, visits]);
    if (key === lastKey) return; // keep a status line and selected presets
    lastKey = key;
    if (!linked) renderCommunity(root, { state: 'unlinked' });
    else renderCommunity(root, { state: community ? 'ready' : 'loading', community, visits });
  }

  /** Opening the tab reads the recent visits once. */
  async function start() {
    refresh();
    if (!getView().linked || !api.recentVisits) return;
    const r = await api.recentVisits();
    if (r.ok) {
      visits = parseVisitList(r.data);
      refresh();
    }
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'join') startLink();
    if (action === 'rankings') openUrl(`${siteBase()}${WebRoutes.community()}`);
    if (action === 'visit') {
      const row = btn.closest('.comm-friend');
      const preset = row?.querySelector('.comm-preset')?.value || null;
      const status = root.querySelector('[data-role="status"]');
      const username = btn.dataset.username;
      btn.disabled = true;
      const r = await api.sendVisit(username, preset);
      let msg;
      if (r.ok) {
        msg = r.data?.delivery === 'notification'
          ? `@${username} is away, so they'll get a notification instead.`
          : `Your Dr. Vibe is on the way to @${username}!`;
      } else {
        msg = visitErrorMessage(r, username);
      }
      if (status) status.textContent = msg;
      btn.textContent = r.ok ? 'Sent' : 'Visit';
      btn.disabled = !!r.ok;
    }
    if (action === 'wave') {
      const status = root.querySelector('[data-role="status"]');
      const username = btn.dataset.username;
      btn.disabled = true;
      const r = await api.sendVisit(username, null, btn.dataset.visitId);
      if (status) status.textContent = r.ok ? `You waved back at @${username}.` : visitErrorMessage(r, username);
      btn.textContent = r.ok ? 'Waved' : 'Wave back';
      btn.disabled = !!r.ok;
    }
  });

  return { refresh, start, stop() {} };
}
