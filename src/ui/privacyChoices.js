// Dr. Vibe — the privacy choices, worded once.
//
// The setup wizard ("What Dr. Vibe watches", "What Dr. Vibe sends", "Who
// can see it") and Settings (Tracking, Privacy) show the same choices with
// the same label, one-line description (`short`), longer text behind
// "More" (`help`) and setting key, so a choice made in one place reads the
// same in the other. `store` says where the value lives:
//   settings  the `settings` section (Settings.js DEFAULT_SETTINGS)
//   privacy   the `privacy` section, sent with PUT /privacy (PrivacySync)
//   errors    the crash report switch Rust owns (error_reports.rs)

import { PRIVACY_DEFAULTS } from '../core/api/contract.js';

/** Step 4 "What Dr. Vibe watches": stays on this computer. */
export const WATCH_CHOICES = Object.freeze([
  {
    key: 'gitTrackingEnabled', store: 'settings', kind: 'check', default: true,
    label: 'Git tracking',
    short: 'Branches and commits in your repos, for cheers and reminders.',
    help: 'Branch, recent commit messages and the number of changed files in the repos Dr. Vibe tracks, for commit cheers and reminders. Stays on this computer.',
  },
  {
    key: 'claudeCodeHooksEnabled', store: 'settings', kind: 'check', default: false, needsClaude: true,
    label: 'Follow Claude Code',
    short: 'Adds hooks that note which files Claude edits. Never your prompts.',
    help: 'Adds 4 hooks to Claude Code’s settings (~/.claude/settings.json). In the repos Dr. Vibe tracks they note which files Claude writes or edits, that it ran a command (never the command) and when sessions start and stop, in ~/.dr-vibe on this computer. Never prompts, replies or code. Off removes the hooks and that log.',
  },
  {
    key: 'trackClaudeRepos', store: 'settings', kind: 'check', default: false, needsClaude: true, requires: 'claudeCodeHooksEnabled',
    label: 'Also track the repos Claude Code works in',
    short: 'Adds a repo when a Claude Code session starts in it.',
    help: 'When a Claude Code session starts in a repo Dr. Vibe doesn’t track yet, its folder is noted so that repo is tracked too. Needs Follow Claude Code.',
  },
  {
    key: 'hideWhenPresenting', store: 'settings', kind: 'check', default: true,
    label: 'Hide Dr. Vibe while I share my screen',
    short: 'Hides him during screen shares and fullscreen apps.',
    help: 'Checks the titles of open windows every few seconds to spot Zoom, Teams, Meet or OBS sharing and fullscreen apps. Visits and toasts wait. Nothing is stored or sent.',
  },
]);

/** Step 6 "What Dr. Vibe sends": each switch stops the data on this computer. */
export const SEND_CHOICES = Object.freeze([
  {
    key: 'showProjectNames', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.showProjectNames,
    label: 'Send my project name',
    short: 'The folder name of the repo you’re in. Never a path.',
    help: 'The folder name of the tracked git repo you are in, shown on your profile while you code. Never a window title or a path.',
  },
  {
    key: 'shareActivityTimes', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.shareActivityTimes,
    label: 'Send my activity times',
    short: 'When you code and commit. Off sends none of it.',
    help: 'Which hours of the day you code, the days you committed, the dates of past streaks and when each achievement unlocked. Off sends none of these, and unlock dates only to the day. Activity events that earn Vibe Points still carry their time, rounded to the minute: the daily limits need it.',
  },
  {
    key: 'shareCodingNow', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.shareCodingNow,
    label: 'Send when I’m coding right now',
    short: 'Lets friends see you’re coding. Off always says “not coding”.',
    help: 'Lets friends see that you are coding now. Off always sends “not coding”, with no live session length or momentum.',
  },
  {
    key: 'shareWeeklyRecap', store: 'settings', kind: 'check', default: true,
    label: 'Share my weekly recap',
    short: 'Last week’s totals as a card. You see the first one before it posts.',
    help: 'Once a week: last week’s coding time, active days, files created and changed, longest session and streak, for a share card and a feed post. Never project names. You see the first card before it is posted. Not sent while your profile is private.',
  },
  {
    key: 'errorReports', store: 'errors', kind: 'check', default: false, always: true,
    label: 'Send crash reports',
    short: 'Error text and app version, paths removed. Works without an account.',
    help: 'When Dr. Vibe hits an error: the error text and app version, with folder paths, web addresses and keys removed first, sent to drvibe.io only. Kept 30 days. Sent even if you never join.',
  },
]);

/** Step 7 "Who can see it": what drvibe.io shows of what was sent. */
export const WHO_CHOICES = Object.freeze([
  {
    key: 'profileVisibility', store: 'privacy', kind: 'select', default: PRIVACY_DEFAULTS.profileVisibility,
    options: [['public', 'Public'], ['followers', 'Followers'], ['private', 'Private']],
    label: 'Who can see my profile',
    short: 'Your page on drvibe.io: your Dr. Vibe, streaks and coding time.',
    help: 'Your profile page on drvibe.io: your Dr. Vibe, streaks, achievements and coding time.',
  },
  {
    key: 'appearInLeaderboards', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.appearInLeaderboards,
    label: 'Show me on leaderboards',
    short: 'Your rank by coding hours, next to other players.',
    help: 'Your rank by coding hours, next to other players.',
  },
  {
    key: 'allowSearchIndexing', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.allowSearchIndexing,
    label: 'Let search engines index my profile',
    short: 'Whether Google and others may list your public profile.',
    help: 'Whether Google and other search engines may list your public profile page. Off asks them not to.',
  },
  {
    key: 'showOnVibeMap', store: 'privacy', kind: 'check', default: PRIVACY_DEFAULTS.showOnVibeMap,
    label: 'Show me on the Vibe Map',
    short: 'Your city only, never a precise location.',
    help: 'Your city only, worked out by drvibe.io from your connection. Never a precise location.',
  },
  {
    key: 'visitsFrom', store: 'privacy', kind: 'select', default: PRIVACY_DEFAULTS.visitsFrom,
    options: [['everyone', 'Everyone'], ['followers', 'Followers'], ['nobody', 'Nobody']],
    label: 'Who can visit me',
    short: 'Other players’ Dr. Vibes walking onto your desktop.',
    help: 'Other players’ Dr. Vibes walking onto your desktop with a preset message.',
  },
]);

/** "Sync my stats", shown once linked (Join step and Settings → Privacy). */
export const SYNC_CHOICE = Object.freeze({
  key: 'syncEnabled', store: 'settings', kind: 'check', default: true,
  label: 'Sync my stats with drvibe.io',
  short: 'Off keeps your account but sends nothing until you turn it on.',
  help: 'Off keeps your account linked but sends nothing (stats, activity events, online check-ins, recap) until you turn it back on. Earned events wait on this computer.',
});

export const ALL_CHOICES = Object.freeze([...WATCH_CHOICES, ...SEND_CHOICES, ...WHO_CHOICES, SYNC_CHOICE]);

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

/** The one-line description and the longer text behind "More". */
function describe(c, descClass) {
  const more = c.help && c.help !== c.short
    ? `<details class="choice-more"><summary>More</summary><div>${escapeHtml(c.help)}</div></details>`
    : '';
  return `<div class="${descClass}">${escapeHtml(c.short || c.help)}${more}</div>`;
}

/**
 * Render `choices` into `el`. `values` maps key → value; `onChange(key,
 * value)` fires on edits. `variant` 'wizard' draws cards, 'settings' rows.
 * `disabled(choice, values)` greys a row out. Returns an `update(values)`
 * that merges `values` into what is shown and refreshes the controls.
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
    ? `<div class="choice-card" data-choice-row="${c.key}"><div class="wcard-header"><div class="wcard-info"><div class="wcard-name">${escapeHtml(c.label)}</div>${describe(c, 'wcard-desc')}</div>${control(c)}</div></div>`
    : `<div class="choice-row" data-choice-row="${c.key}"><div class="toggle-row" style="margin-bottom:2px"><span>${escapeHtml(c.label)}</span>${control(c)}</div>${describe(c, 'section-desc choice-desc')}</div>`).join('');

  let current = { ...(values || {}) };
  const update = (next = {}) => {
    current = { ...current, ...next };
    for (const c of choices) {
      const input = el.querySelector(`[data-choice="${c.key}"]`);
      if (!input) continue;
      const v = current[c.key] ?? c.default;
      if (c.kind === 'check') input.checked = !!v;
      else input.value = v;
      const off = !!disabled(c, current);
      input.disabled = off;
      el.querySelector(`[data-choice-row="${c.key}"]`)?.classList.toggle('choice-disabled', off);
    }
  };
  el.addEventListener('change', (e) => {
    const key = e.target?.dataset?.choice;
    const c = choices.find((x) => x.key === key);
    if (!c) return;
    const value = c.kind === 'check' ? e.target.checked : e.target.value;
    current[key] = value;
    onChange(key, value);
  });
  update();
  return update;
}
