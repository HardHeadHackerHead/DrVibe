// Dr. Vibe — "What Dr. Vibe sees": a plain-language list of what stays on
// this computer and what is sent when linked. Shown in the setup wizard and
// in Settings → Privacy. Keep it in step with the sync payload in
// src-tauri/src/sync.rs and the poll in src/core/PollClient.js.

export const STAYS_LOCAL = [
  'The names and titles of the windows you use, to tell when you are coding',
  'File paths and file changes inside your project folders',
  'Git details: branches, commit messages and changed files',
  'Claude Code activity from its hooks (which files it reads and edits, never prompts or code), if Claude Code is switched on in Tracking',
  'Whether Antigravity is the app in front, from its window',
  'Your break, hydration, posture and focus history',
];

export const SENT_WHEN_LINKED = [
  'Coding time: today, the last 7 days, by hour of day, and your streaks',
  'Totals: commit counts and dates, number of repos (never their names), top languages by hours',
  'Achievements, mastery levels and momentum',
  'Your Dr. Vibe look (skin and skin tone) and whether you are coding right now',
  'The current project name, only if you turn on "Show project names"',
  'Activity events that earn Vibe Points (a commit, a finished pomodoro…), without file or window names',
  'Once a week, last week’s totals for your recap card: coding time, active days, files created and changed, longest session and streak, never project names (switch "Share my weekly recap" in Privacy)',
];

/** Sent whether or not you are linked, unless you turn off crash reports in Privacy. */
export const CRASH_REPORTS = [
  'When Dr. Vibe crashes: the error message, where in Dr. Vibe it happened, and the app version. Your home folder name is removed first, and it goes only to drvibe.io (no outside service). Kept 30 days.',
];

export const NEVER_SENT = [
  'Window titles, file names, file contents or code',
  'Your computer’s name or your login name (a linked device shows as “Dr. Vibe on Windows”)',
  'Your location (the Vibe Map uses a city only if you opt in)',
];

function list(items) {
  return `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
}

/** Render the explainer into `el`. `linked` tweaks the "sent" heading. */
export function renderWhatDrVibeSees(el, { linked = false } = {}) {
  if (!el) return;
  el.classList.add('wdvs');
  el.innerHTML = `
    <div class="wdvs-col">
      <div class="wdvs-head">Stays on this computer</div>
      ${list(STAYS_LOCAL)}
    </div>
    <div class="wdvs-col">
      <div class="wdvs-head">${linked ? 'Sent to drvibe.io (you are linked)' : 'Sent only if you join the community'}</div>
      ${list(SENT_WHEN_LINKED)}
    </div>
    <div class="wdvs-col">
      <div class="wdvs-head">Crash reports (switch in Settings → Privacy)</div>
      ${list(CRASH_REPORTS)}
    </div>
    <div class="wdvs-col">
      <div class="wdvs-head">Never sent</div>
      ${list(NEVER_SENT)}
    </div>`;
}
