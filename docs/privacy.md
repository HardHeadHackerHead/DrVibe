# Privacy: what Dr. Vibe collects

Dr. Vibe has to watch what you do to react to it. This page lists everything it looks
at, where that is kept, and what leaves your computer. It describes app version 2.0.
The website's own policy is at [drvibe.io/privacy](https://drvibe.io/privacy).

The same lists appear in the app, in the setup wizard and under Settings → Privacy →
*What Dr. Vibe sees* (`src/ui/WhatDrVibeSees.js`). The sync payload itself is built in
`src-tauri/src/sync.rs`.

## Without an account

Nothing about your coding leaves your computer. The app makes these network calls and
no others:

| Call | When | What it sends |
| --- | --- | --- |
| Update check (`drvibe.io/api/v1/downloads/latest.json`) | 30 s after start, then every 4 hours | A normal HTTPS request: no account, no usage data |
| Crash reports (`POST drvibe.io/api/v1/errors`) | Shortly after start and every 30 minutes, only if something crashed | Error message, stack trace, app version and which window it happened in. Your home-folder path is replaced with `~` before it's queued. Kept 30 days. **Switch:** Settings → Privacy → *Send crash reports* (on by default; turning it off empties the queue) |

Things you start yourself also go online, of course: opening drvibe.io links,
installing a skin from the gallery, or generating a Dr. Vibe with your Claude Code or
Codex CLI (which talks to its own provider under your account).

## What stays on your computer

| What | Why | Where it's kept |
| --- | --- | --- |
| The title and process name of the focused window | To tell when you're coding and in which app or project | In memory |
| File changes inside the tracked repos, except build output (anything the repo's `.gitignore` ignores, `target/`, `node_modules/` and similar) | Momentum, files touched, languages | In memory; daily totals in the app data |
| Git details: branches, commit messages, changed files | Commit celebrations and reminders | In memory; counts and commit dates in the app data |
| Names and paths of the git repos it tracks: those Claude Code starts a session or edits files in while *Track repos Claude Code works in* is on (Settings → Tracking, on by default), those in the project folders you add, and the project open in your editor. A linked worktree counts as its main repo. Temp, app-data and system folders are never tracked. Nothing scans your drives | To watch those repos for commits and file changes | The app data. Never sent: the sync carries a repo count, not names or paths |
| Claude Code activity (tool, file path, session, folder), while *Follow Claude Code* is on | Heat bar and Claude Code reactions | `~/.dr-vibe/claude-code-events.jsonl` (rotated at 5 MB). See [claude-code.md](claude-code.md) |
| Antigravity activity | The levitating animation | In memory |
| Sessions, streaks, achievements, personal bests, time per language, break, hydration, posture and focus history | Dashboard and progress | `%APPDATA%\com.drvibe.companion\dr-vibe-data.json` |
| Your settings | | Same file |
| Skins you make or install | | `%APPDATA%\com.drvibe.companion\skins\` |

To remove everything, switch off *Follow Claude Code* first (it takes the hooks out of
`~/.claude/settings.json`; see [claude-code.md](claude-code.md#turning-it-off)), then
uninstall and delete `%APPDATA%\com.drvibe.companion`,
`%LOCALAPPDATA%\com.drvibe.companion` and `~/.dr-vibe`.

## When you link an account

Linking is optional (Settings → Account and community). Once linked, the app also sends:

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
- The current project name, **only** if you turn on *Show project names* (off by default)
- The app version

**Activity events** (`POST /api/v1/desktop/events`) that earn Vibe Points: a finished
pomodoro or focus session, a commit, a coding session starting, a wellness check, a
personal best, a streak day, a skill milestone. They carry the event type and a few
values (a focus session's length, a commit's hash so it's counted only once), never
file names, window titles or commit messages. Offline,
they wait in a capped queue on disk and send later.

**Weekly recap** (`POST /api/v1/me/recap`), once a week: last week's coding time,
active days, files created and changed, longest session and streak, for a share card
and a feed post. Never project names. Not sent while your profile is private.
**Switch:** *Share my weekly recap*.

**Privacy choices** (`PUT /api/v1/privacy`), only when you change one: profile
visibility, *Show project names*, *Show me on the Vibe Map*, *Appear in leaderboards*
and *Who can visit me*. Choices you make on the website are never overwritten by the
app.

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
- Commit messages or repository names (a commit's hash is sent with its event)
- Your Claude Code log
- Your computer's name or your login name
- Your location. The Vibe Map uses a city only if you opt in on the website

## Checking it yourself

Settings → Privacy → **Show my last sync** displays the exact body of the last sync
the server received, with a button to copy it.

## Your token

The per-device token is kept in Windows Credential Manager, never in a file or in the
app's web views. Every request that changes something is signed with it. Unlink in
Settings → Account and community, or revoke the device from the website; either way the
app forgets the token. See [security.md](security.md).

## Screen sharing

*Hide Dr. Vibe during screen shares and fullscreen apps* (on by default) hides him while
you present, and holds visits and notifications until you're done.
