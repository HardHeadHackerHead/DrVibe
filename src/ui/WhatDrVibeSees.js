// Dr. Vibe — "What Dr. Vibe sees": a plain-language list of what stays on
// this computer and what is sent when linked. Shown in the setup wizard and
// in Settings → Privacy. Keep it in step with the sync payload in
// src-tauri/src/sync.rs, the events in src/features/economy, the poll in
// src/core/PollClient.js and the switches in src/ui/privacyChoices.js.

export const STAYS_LOCAL = [
  'The name and title of the window in front, checked every few seconds, to tell when you are coding',
  'The titles of all open windows, checked every few seconds only to spot a screen share or a fullscreen app (if "Hide Dr. Vibe while I share my screen" is on). Nothing is stored',
  'How long since your last keyboard or mouse input (never what you typed), to tell whether you are using your editor',
  'File changes inside the repos Dr. Vibe tracks, and the last few file paths',
  'Git details in tracked repos: branches, commit messages and the number of changed files',
  'Where your tracked repos are: the ones in folders you add and, if "Also track the repos Claude Code works in" is on, the ones Claude Code starts sessions in (forgotten after 90 days unseen)',
  'With "Follow Claude Code" on: 4 hooks in Claude Code’s settings note, in tracked repos only, which files Claude writes or edits, that it ran a command (never the command) and when sessions start and stop, in ~/.dr-vibe. Never prompts, replies or code. Off removes the hooks and that log, and so does uninstalling',
  'Whether Antigravity is the app in front, from its window',
  'Your break, hydration, posture and focus history, and 90 days of coding time per day',
];

export const SENT_WHEN_LINKED = [
  'Coding time: today, the last 7 days and in total, your streaks and top languages by hours',
  'Totals: commit counts and the number of repos (never their names)',
  'Achievements, mastery levels and momentum',
  'Your Dr. Vibe look (skin and skin tone); for a skin you drew yourself, its picture',
  'With "Send my activity times" on: your coding time by hour of the day, the days you committed, past streak dates and when each achievement unlocked. Off sends none of these, and unlock dates only to the day',
  'With "Send when I’m coding right now" on: whether you are coding now. Off always sends “not coding”',
  'With "Send my project name" on: the folder name of the tracked git repo you are in. Never a window title or a path',
  'Activity events that earn Vibe Points (a commit, a finished pomodoro, a hydration check…), with their time rounded to the minute and, for a commit, a scrambled id (a keyed hash, not the commit’s hash) so it counts once. Never file, repo or window names',
  'Your time zone, so daily limits reset at your midnight',
  'A check-in every 60 seconds for news, visits and your equipped Dr. Vibe, so drvibe.io can tell when you are online',
  'Once a week, with "Share my weekly recap" on: last week’s totals for your recap card (coding time, active days, files created and changed, longest session and streak), never project names. You see the first card before it is posted',
  '"Sync my stats" off sends none of the above while you stay linked',
];

/** Sent whether or not you are linked, only if you turn crash reports on. */
export const CRASH_REPORTS = [
  'Crash reports, only if you turn them on: the error message, where in Dr. Vibe it happened, and the app version. Folder paths, web addresses and keys are removed first, and they go only to drvibe.io (no outside service). Kept 30 days. You can see what is queued in Settings → Privacy.',
];

export const NEVER_SENT = [
  'Window titles, file names or paths, repo names or paths, file contents or code, commit messages, branch names',
  'Your computer’s name or your login name (a linked device shows as “Dr. Vibe on Windows”)',
  'Your precise location (the Vibe Map uses a city only if you opt in)',
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
