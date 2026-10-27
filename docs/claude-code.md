# Claude Code integration

Dr. Vibe follows what [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
does in your projects through Claude Code's
[hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). The hooks only write a
local log, and only inside the repos Dr. Vibe tracks; nothing from it leaves your
computer.

## What gets installed

The integration is controlled by **Follow Claude Code** (in the setup wizard's *What
Dr. Vibe watches* step and Settings → Tracking), which is off until you switch it on.
Nothing is installed before setup is finished. While it's on, every time Dr. Vibe
starts it:

1. Checks for a `~/.claude` folder. Without one, Claude Code isn't installed and Dr.
   Vibe stops here: it never creates Claude Code's folder or settings for you.
2. Copies `claude-code-hook.sh` (and a `claude-code-hook.cmd` fallback) from the app to
   `~/.dr-vibe/`, so the hook path stays the same across updates and reinstalls, and
   writes `install-marker` (the path of the Dr. Vibe app) next to it.
3. Adds one hook entry per event to `~/.claude/settings.json`. Other hooks you have are
   left alone, and repeated installs replace Dr. Vibe's own entries instead of
   duplicating them. The file is written to a temporary file and renamed into place,
   and the previous version is kept as `settings.json.bak`.

| Claude Code event | Matcher | Logged as |
| --- | --- | --- |
| `PostToolUse` | `Write`, `Edit`, `NotebookEdit` | `file_changed` (tool, file path) |
| `PostToolUse` | `Bash` | `command_run` (no command text) |
| `SessionStart` | | `session_start` |
| `SessionEnd` | | `session_end` |
| `Stop` | | `response_complete` |

Each entry looks like this (the path is your home folder, in the form bash expects):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit|Bash",
        "hooks": [{ "type": "command", "command": "/c/Users/you/.dr-vibe/claude-code-hook.sh", "timeout": 10 }]
      }
    ]
  }
}
```

## What the hook records

The script reads the JSON Claude Code passes on stdin, picks out the event name, tool
name, file path, session ID and working folder, and, when that folder is inside a repo
listed in `~/.dr-vibe/tracked.txt` (the repos Dr. Vibe tracks, kept up to date by the
app), appends one line to `~/.dr-vibe/claude-code-events.jsonl`:

```json
{"ts":1761234567000,"event":"file_changed","tool":"Edit","file":"C:\\code\\pixel-forge\\src\\render.ts","session":"…","cwd":"…"}
```

Outside a tracked repo it writes nothing. The one exception is *Also track the repos
Claude Code works in* (Settings → Tracking, off by default, needs *Follow Claude
Code*): then `tracked.txt` starts with `#discover`, and a session that starts elsewhere
notes only its `session_start` line with the folder, so Dr. Vibe can track that repo
too. Repos remembered this way are forgotten after 90 days unseen.

The script also does nothing while tracking is paused (`~/.dr-vibe/paused-until`), or
once `~/.dr-vibe/install-marker` or the app it names is gone, so an uninstalled Dr.
Vibe leaves no logging behind.

It doesn't record prompts, Claude's replies, command text, file contents or files
Claude only reads. The log rotates to `claude-code-events.jsonl.old` at 5 MB. The
script needs only bash (no `jq`) and always exits 0, so it can't block Claude Code.

## What Dr. Vibe does with it

`src/features/activity/ClaudeCodeTracker.js` reads new lines every 3 seconds and:

- feeds file changes into the momentum heat bar (without hooks, Claude's edits don't
  move it)
- comments on **hotspot** files edited again and again, **rewrite sprees**, **new files**
  and edits that span many folders
- spots **fix-test-fix loops** and celebrates when a run finally comes back clean
- sums up each session when it ends: files changed, top language, most-edited file
- tracks time you and Claude are both active (`AIPairTracker.js`) and marks
  pair-programming milestones
- names the project after the folder each session started in

## Checking and repairing

Settings → **Tracking** → **Claude Code** shows whether the hooks are in place.
**Install / Fix** rewrites them; restart Claude Code afterwards so it reloads its
settings.

On Windows, Claude Code runs hooks through bash, so you need Git for Windows (which
Claude Code requires anyway). On macOS and Linux the system bash is used.

If the heat bar stays cold while Claude is editing:

1. Check the status in Settings → Tracking.
2. Look for new lines in `~/.dr-vibe/claude-code-events.jsonl` while Claude edits a file.
3. Check that the repo shows up under Settings → Tracking → Git Repos: the hook logs
   nothing outside the tracked repos. Add the project folder there, or switch on *Also
   track the repos Claude Code works in* so the repo a session starts in is tracked (a
   worktree counts as its main repo). A temp, app-data or system folder is never
   tracked.
4. Check that tracking isn't paused (tray → Pause tracking).

## Turning it off

Switch **Follow Claude Code** off in Settings → Tracking. Dr. Vibe removes every hook
group whose command points at `claude-code-hook.sh` or `claude-code-hook.cmd` from
`~/.claude/settings.json`, leaves the rest of the file alone, and doesn't add them back
at the next start. It also deletes the log, its `.old` copy, the scripts and the lists
in `~/.dr-vibe/`. Restart Claude Code to make it reload. Switching it on again
reinstalls them.

Settings → Privacy → *Delete all local data* does the same, and so does uninstalling:
the uninstaller removes the hooks and `~/.dr-vibe/` (an update leaves them in place).

### When Dr. Vibe isn't running

While the switch is on, the hooks stay in place when you quit Dr. Vibe. That's
harmless: the script makes no network calls, only appends a line to the local log
(rotated to `.old` at 5 MB, so at most about 10 MB on disk), and exits 0 straight away,
within Claude Code's 10-second hook timeout. When Dr. Vibe starts again it picks up the
log where it left off.

## Codex and other agents

OpenAI's Codex CLI and other agents aren't tracked. Dr. Vibe uses the `claude` or
`codex` CLI only when you ask it to generate a Dr. Vibe in *Make your own Dr. Vibe*
(it prefers Claude Code when both are installed). Antigravity is detected from its
window, which makes Dr. Vibe levitate.
