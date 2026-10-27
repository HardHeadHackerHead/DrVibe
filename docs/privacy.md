# Privacy: what Dr. Vibe collects

Dr. Vibe has to watch what you do to react to it. This page lists everything it looks
at, where that is kept, and what leaves your computer. It describes app version 2.0.
The website's own policy is at [drvibe.io/privacy](https://drvibe.io/privacy).

The same lists appear in the app, in the setup wizard and under Settings → Privacy →
*What Dr. Vibe sees* (`src/ui/WhatDrVibeSees.js`). The sync payload itself is built in
`src-tauri/src/sync.rs`.

## Your choices

The setup wizard asks before anything is watched or sent, in two steps: *What Dr. Vibe
watches* and *What Dr. Vibe sends*. Settings shows the same choices with the same words
(`src/ui/privacyChoices.js`), and Settings → Privacy → *Run setup again* goes through
the wizard once more. Skipping or closing the wizard saves none of its choices, so the
defaults below apply. Nothing is synced, no crash report is sent and no Claude Code
hook is installed before the wizard is finished or skipped.

| Choice | Default |
| --- | --- |
| *Git tracking* | On |
| *Follow Claude Code* (the hooks) | Off |
| *Also track the repos Claude Code works in* (needs the hooks) | Off |
| *Hide Dr. Vibe while I share my screen* | On |
| *Who can see my profile* | Public |
| *Show me on leaderboards* | On |
| *Send my project name* | Off |
| *Send my activity times* | On |
| *Send when I'm coding right now* | On |
| *Show me on the Vibe Map* | Off |
| *Who can visit me* | Followers |
| *Share my weekly recap* | On; the first card waits for you to approve it |
| *Send crash reports* | Off |
| *Sync my stats with drvibe.io* (once linked) | On |

**Pause tracking** (tray menu, or Settings → Privacy): for 1 hour, until tomorrow or
until you resume. While paused, Dr. Vibe stops reading window titles, watching folders,
polling git and reading the Claude Code log, and the hook script writes nothing. The
screen-share check keeps running so he still hides while you present. A pause survives
a restart.

## Without an account

Nothing about your coding leaves your computer. The app makes these network calls and
no others:

| Call | When | What it sends |
| --- | --- | --- |
| Update check (`drvibe.io/api/v1/downloads/latest.json`) | 30 s after start, then every 4 hours | A normal HTTPS request: no account, no usage data |
| Crash reports (`POST drvibe.io/api/v1/errors`) | Shortly after start and every 30 minutes, only if something crashed, and never before setup is finished or skipped | Error message, stack trace, app version and which window it happened in. Before a report is queued, every absolute path (drive, network, Unix or `~`) is cut to `<path>/` plus its file name, every web address to its scheme and host (Dr. Vibe's own bundled pages keep their path), and `dvd_` tokens are removed. Thrown values that aren't errors are not sent. Kept 30 days. **Switch:** Settings → Privacy → *Send crash reports* (off until you choose; turning it off empties the queue). The queue is shown under *What will be sent next* |

Things you start yourself also go online, of course: opening drvibe.io links,
installing a skin from the gallery, or generating a Dr. Vibe with your Claude Code or
Codex CLI (which sends your description to Anthropic or OpenAI under your account; a
one-time notice says so before the first run).

## What stays on your computer

| What | Why | Where it's kept |
| --- | --- | --- |
| The title and process name of the focused window | To tell when you're coding and in which app or project | In memory |
| How long ago your last keyboard or mouse input was (never what you typed or where you clicked) | To stop counting the editor's project when you step away or play a game | In memory |
| File changes inside the tracked repos, except build output (anything the repo's `.gitignore` ignores, `target/`, `node_modules/` and similar) | Momentum, files touched, languages | In memory; daily totals in the app data |
| Git details: branches, commit messages, changed files (never the remote URL or commit authors) | Commit celebrations and reminders | In memory; counts and commit dates in the app data |
| Names and paths of the git repos it tracks: those Claude Code starts a session in while *Also track the repos Claude Code works in* is on (Settings → Tracking, off by default, needs *Follow Claude Code*; forgotten after 90 days unseen), those in the project folders you add, and the project open in your editor while you use it (the editor in front within the last 2 minutes and keyboard or mouse input within the last 2 minutes). A linked worktree counts as its main repo. Temp, app-data and system folders are never tracked. Nothing scans your drives | To watch those repos for commits and file changes | The app data. Never sent: the sync carries a repo count, not names or paths |
| Claude Code activity (tool, path of a file written or edited, session, folder) in the repos it tracks, while *Follow Claude Code* is on | Heat bar and Claude Code reactions | `~/.dr-vibe/claude-code-events.jsonl` (rotated at 5 MB). See [claude-code.md](claude-code.md) |
| Antigravity activity | The levitating animation | In memory |
| Sessions, streaks, achievements, personal bests, time per language, break, hydration, posture and focus history | Dashboard and progress | `%APPDATA%\com.drvibe.companion\dr-vibe-data.json` |
| Your settings | | Same file |
| Skins you make or install | | `%APPDATA%\com.drvibe.companion\skins\` |

### Your local data

Settings → Privacy → *Your local data*:

- **Export my local data** saves one JSON file where you choose: the data store, the
  Claude Code files in `~/.dr-vibe` and any queued crash reports. Your device token is
  never in it.
- **Forget project history** drops project names from your daily history and the last
  files list.
- **Forget tracked repos** forgets the repos remembered from Claude Code (your project
  folders stay).
- **Delete all local data** removes everything except your skins: the data store, the
  Claude Code hooks and `~/.dr-vibe`, the crash report queue, the visitor cache and the
  generator's temporary files. It revokes and deletes the device token, then Dr. Vibe
  restarts into setup.
- **Delete my account on drvibe.io** opens your account settings
  ([drvibe.io/settings/account](https://drvibe.io/settings/account)).

Uninstalling also takes the hooks out of `~/.claude/settings.json` and removes
`~/.dr-vibe` (an update leaves them). To remove everything, use *Delete all local data*
or uninstall, then delete `%APPDATA%\com.drvibe.companion` and
`%LOCALAPPDATA%\com.drvibe.companion`.

## When you link an account

Linking is optional (Settings → Account and community). Once linked, the app also sends
what's below. **Sync my stats with drvibe.io** (on once linked) switched off keeps the
account linked but sends none of it: no sync, no activity events (they wait on your
computer), no poll, no acknowledgements, no recap and no privacy updates, until you
turn it back on.

**Profile sync** (`POST /api/v1/desktop/sync`), every 15 minutes and shortly after a
change:

- Coding time: total hours, the last 7 days, coding by hour of day, the current
  session's length
- Streaks: current, longest, milestones and past streaks
- Your longest session and top languages by hours
- Git totals: lifetime and session commit counts, the dates you committed, and how many
  repositories you've committed to (a count, never their names)
- Momentum: current, this session's peak and your all-time peak
- Achievements and mastery levels
- Your Dr. Vibe's look (skin, skin tone, which companion is equipped). For a skin you
  made yourself, the sprite sheet image too, so others can see it
- Whether you're coding right now
- The current project name, **only** if you turn on *Send my project name* (off by
  default), and only the folder name of a tracked git repo you're in
- The app version

The send switches stop data on your computer, before the body is built (`sync.rs`,
`apply_send_switches`); the fields stay in the body, empty, so the server still reads
it:

- *Send my activity times* off: coding by hour of day is all zeros, commit dates and
  past streaks are empty, and achievement unlock times are cut to the day (UTC).
  Activity events (below) still carry their time, rounded to the minute: the daily
  Vibe Point limits need it.
- *Send when I'm coding right now* off: always sends "not coding", with the current
  session's minutes and momentum as 0.
- *Let search engines index my profile* (on by default) is a website setting: the app
  shows it and sends it back unchanged, and never resets it.

**Activity events** (`POST /api/v1/desktop/events`) that earn Vibe Points: a finished
pomodoro or focus session, a commit, a coding session starting, a wellness check, a
personal best, a streak day, a skill milestone. They carry the event type, its time
rounded to the minute and a few values (a focus session's length; for a commit, a keyed
id so it's counted only once: the first 16 hex digits of an HMAC-SHA256 of the commit
hash keyed by your account's user ID, so the same commit counts once across your
computers; never the hash itself or the repo), never file names,
window titles or commit messages. Requests also carry your time zone, for the daily
limits. Offline, they wait in a capped queue on disk and send later.

**Weekly recap** (`POST /api/v1/me/recap`), once a week: last week's coding time,
active days, files created and changed, longest session and streak, for a share card
and a feed post. Never project names. Not sent while your profile is private. The first
one waits until you've seen its card and chosen to post it. **Switch:** *Share my weekly
recap*.

**Privacy choices** (`PUT /api/v1/privacy`), only when you change one (and when you
finish the setup's *What Dr. Vibe sends* step): *Who can see my profile*, *Send my
project name*, *Send my activity times*, *Send when I'm coding right now*, *Show me on
the Vibe Map*, *Show me on leaderboards* and *Who can visit me*. Choices you make on the
website are never overwritten by the app.

**The 60-second poll** (`GET /api/v1/desktop/poll`) asks for notifications, visits and
the Dr. Vibe you equipped on the site. It sends nothing about your activity; a quiet
minute costs one `304`.

**When linking**, the app sends a random install ID, the platform, the app version and
a generic device name ("Dr. Vibe on Windows"). It doesn't send your computer's name.

**Designs you submit** to the Incubator: the sprite sheet, its animation data, the name
and description you typed. Animation data records which tool made a design and the
prompt you gave it, never your login name; older designs that carried one have it
stripped before upload.

### Never sent

- Window titles, file names, file paths, file contents or code
- Commit messages, commit hashes or repository names (a commit's event carries a keyed
  id instead)
- Your Claude Code log
- Your computer's name or your login name
- Your location. The Vibe Map uses a city only if you opt in on the website

## Checking it yourself

Settings → Privacy → **What will be sent next** shows, before anything goes out, the
next sync body (built by the same Rust code that sends it), the activity events
waiting, the next weekly recap with its card, and any queued crash reports. Next to it,
**Show my last sync** displays the exact body of the last sync the server received,
with a button to copy it.

## Your token

The per-device token is kept in Windows Credential Manager, never in a file or in the
app's web views. Every request that changes something is signed with it. Unlink in
Settings → Account and community, or revoke the device from the website; either way the
app forgets the token. See [security.md](security.md).

## Screen sharing

*Hide Dr. Vibe while I share my screen* (on by default) hides him while you present or
use a fullscreen app, and holds visits and notifications until you're done. It checks
the titles of open windows every few seconds; nothing is stored or sent.
