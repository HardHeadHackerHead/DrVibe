// Dr. Vibe — the privacy choices, worded once.
//
// The setup wizard ("What Dr. Vibe watches", "What Dr. Vibe sends") and
// Settings (Tracking, Privacy) show the same choices with the same label,
// help text and setting key, so a choice made in one place reads the same
// in the other. `store` says where the value lives:
//   settings  the `settings` section (Settings.js DEFAULT_SETTINGS)
//   privacy   the `privacy` section, sent with PUT /privacy (PrivacySync)
//   errors    the crash report switch Rust owns (error_reports.rs)

import { PRIVACY_DEFAULTS } from '../core/api/contract.js';

/** Step 3 "What Dr. Vibe watches": stays on this computer. */
export const WATCH_CHOICES = Object.freeze([
  {
    key: 'gitTrackingEnabled', store: 'settings', kind: 'check', default: true,
    label: 'Git tracking',
    help: 'Branch, recent commit messages and the number of changed files in the repos Dr. Vibe tracks, for commit cheers and reminders. Stays on this computer.',
  },
  {
    key: 'claudeCodeHooksEnabled', store: 'settings', kind: 'check', default: false, needsClaude: true,
    label: 'Follow Claude Code',
    help: 'Adds 4 hooks to Claude Code’s settings (~/.claude/settings.json). In the repos Dr. Vibe tracks they note which files Claude writes or edits, that it ran a command (never the command) and when sessions start and stop, in ~/.dr-vibe on this computer. Never prompts, replies or code. Off removes the hooks and that log.',
  },
  {
    key: 'trackClaudeRepos', store: 'settings', kind: 'check', default: false, needsClaude: true, requires: 'claudeCodeHooksEnabled',
    label: 'Also track the repos Claude Code works in',
    help: 'When a Claude Code session starts in a repo Dr. Vibe doesn’t track yet, its folder is noted so that repo is tracked too. Needs Follow Claude Code.',
  },
  {
    key: 'hideWhenPresenting', store: 'settings', kind: 'check', default: true,
    label: 'Hide Dr. Vibe while I share my screen',
    help: 'Checks the titles of open windows every few seconds to spot Zoom, Teams, Meet or OBS sharing and fullscreen apps. Visits and toasts wait. Nothing is stored or sent.',
  },
]);

/** Step 5 "What Dr. Vibe sends": each switch stops the data on this computer. */
export const SEND_CHOICES = Object.freeze([
  {
    key: 'profileVisibility', store: 'privacy', kind: 'select', default: PRIVACY_DEFAULTS.profileVisibility,
    options: [['public', 'Public'], ['followers', 'Followers'], ['private', 'Private']],
    label: 'Who can see my profile',
    help: 'Your profile page on drvibe.io: your Dr. Vibe, streaks, achievements and coding time.',
  },
  {
    key: 'appearInLeaderboards', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.appearInLeaderboards,
    label: 'Show me on leaderboards',
    help: 'Your rank by coding hours, next to other players.',
  },
  {
    key: 'showProjectNames', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.showProjectNames,
    label: 'Send my project name',
    help: 'The folder name of the tracked git repo you are in, shown on your profile while you code. Never a window title or a path.',
  },
  {
    key: 'shareActivityTimes', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.shareActivityTimes,
    label: 'Send my activity times',
    help: 'Which hours of the day you code, the days you committed, the dates of past streaks and when each achievement unlocked. Off sends none of these, and unlock dates only to the day. Activity events that earn Vibe Points still carry their time, rounded to the minute: the daily limits need it.',
  },
  {
    key: 'shareCodingNow', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.shareCodingNow,
    label: 'Send when I’m coding right now',
    help: 'Lets friends see that you are coding now. Off always sends “not coding”.',
  },
  {
    key: 'allowSearchIndexing', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.allowSearchIndexing,
    label: 'Let search engines index my profile',
    help: 'Whether Google and other search engines may list your public profile page. Off asks them not to.',
  },
  {
    key: 'showOnVibeMap', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.showOnVibeMap,
    label: 'Show me on the Vibe Map',
    help: 'Your city only, worked out by drvibe.io from your connection. Never a precise location.',
  },
  {
    key: 'visitsFrom', store: 'privacy', kind: 'select', default: PRIVACY_DEFAULTS.visitsFrom,
    options: [['everyone', 'Everyone'], ['followers', 'Followers'], ['nobody', 'Nobody']],
    label: 'Who can visit me',
    help: 'Other players’ Dr. Vibes walking onto your desktop with a preset message.',
  },
  {
    key: 'shareWeeklyRecap', store: 'settings', kind: 'check', default: true,
    label: 'Share my weekly recap',
    help: 'Once a week: last week’s coding time, active days, files created and changed, longest session and streak, for a share card and a feed post. Never project names. You see the first card before it is posted. Not sent while your profile is private.',
  },
  {
    key: 'errorReports', store: 'errors', kind: 'check', default: false,
    label: 'Send crash reports',
    help: 'When Dr. Vibe hits an error: the error text and app version, with folder paths, web addresses and keys removed first, sent to drvibe.io only. Kept 30 days. Sent even if you never join.',
  },
]);

/** "Sync my stats", shown once linked (Join step and Settings → Privacy). */
export const SYNC_CHOICE = Object.freeze({
  key: 'syncEnabled', store: 'settings', kind: 'check', default: true,
  label: 'Sync my stats with drvibe.io',
  help: 'Off keeps your account linked but sends nothing (stats, activity events, online check-ins, recap) until you turn it back on. Earned events wait on this computer.',
});

export const ALL_CHOICES = Object.freeze([...WATCH_CHOICES, ...SEND_CHOICES, SYNC_CHOICE]);

export function choiceByKey(key) {
  return ALL_CHOICES.find((c) => c.key === key) || null;
}

/** The label a value shows in a summary ("Followers", "on", "off"). */
export function describeValue(choice, value) {
  if (choice.kind === 'select') return (choice.options.find(([v]) => v === value) || [value, String(value)])[1];
  return value ? 'on' : 'off';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Render `choices` into `el`. `values` maps key → value; `onChange(key,
 * value)` fires on edits. `variant` 'wizard' draws cards, 'settings' rows.
 * Returns an `update(values)` that refreshes the controls.
 */
export function renderChoices(el, choices, values, onChange, { variant = 'settings', disabled = () => false } = {}) {
  if (!el) return () => {};
  const control = (c) => {
    const id = `choice-${c.key}`;
    if (c.kind === 'select') {
      const opts = c.options.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
      return `<select id="${id}" class="${variant === 'wizard' ? 'freq-select' : ''}" data-choice="${c.key}" aria-label="${escapeHtml(c.label)}">${opts}</select>`;
    }
    return `<label class="toggle"><input type="checkbox" id="${id}" data-choice="${c.key}" aria-label="${escapeHtml(c.label)}"><span class="track"></span></label>`;
  };
  el.innerHTML = choices.map((c) => variant === 'wizard'
    ? `<div class="choice-card" data-choice-row="${c.key}"><div class="wcard-header"><div class="wcard-info"><div class="wcard-name">${escapeHtml(c.label)}</div><div class="wcard-desc">${escapeHtml(c.help)}</div></div>${control(c)}</div></div>`
    : `<div class="choice-row" data-choice-row="${c.key}"><div class="toggle-row" style="margin-bottom:2px"><span>${escapeHtml(c.label)}</span>${control(c)}</div><div class="section-desc" style="margin:0 0 10px">${escapeHtml(c.help)}</div></div>`).join('');

  const update = (next) => {
    for (const c of choices) {
      const input = el.querySelector(`[data-choice="${c.key}"]`);
      if (!input) continue;
      const v = next[c.key] ?? c.default;
      if (c.kind === 'check') input.checked = !!v;
      else input.value = v;
      const off = !!disabled(c, next);
      input.disabled = off;
      el.querySelector(`[data-choice-row="${c.key}"]`)?.classList.toggle('choice-disabled', off);
    }
  };
  el.addEventListener('change', (e) => {
    const key = e.target?.dataset?.choice;
    const c = choices.find((x) => x.key === key);
    if (!c) return;
    onChange(key, c.kind === 'check' ? e.target.checked : e.target.value);
  });
  update(values || {});
  return update;
}
