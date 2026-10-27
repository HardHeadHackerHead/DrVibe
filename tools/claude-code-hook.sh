#!/bin/bash
# Dr. Vibe - Claude Code Integration Hook
# Notes file changes, commands and session events from Claude Code in a
# JSONL log that Dr. Vibe reads. Never prompts, responses, commands or code.
#
# Installed by Dr. Vibe (Settings → Tracking → Follow Claude Code), which
# keeps these files next to this script in ~/.dr-vibe:
#   install-marker   path of the Dr. Vibe app; gone (or app gone) = do nothing
#   tracked.txt      the repos Dr. Vibe tracks, one per line; the first line
#                    "#discover" also notes the folder a session starts in
#   paused-until     present while tracking is paused (unix seconds, 0 = until resumed)
# Outside a tracked repo nothing is written.

DIR="$HOME/.dr-vibe"
LOG_FILE="$DIR/claude-code-events.jsonl"
MAX_LOG_SIZE=5242880  # 5MB - rotate when exceeded

# Dr. Vibe uninstalled (marker or app gone): stay silent.
[ -f "$DIR/install-marker" ] || exit 0
APP_PATH=$(head -n 1 "$DIR/install-marker" 2>/dev/null)
[ -n "$APP_PATH" ] && [ -e "$APP_PATH" ] || exit 0

# Tracking paused.
if [ -f "$DIR/paused-until" ]; then
  UNTIL=$(head -n 1 "$DIR/paused-until" 2>/dev/null)
  case "$UNTIL" in ''|*[!0-9]*) UNTIL=0 ;; esac
  if [ "$UNTIL" -eq 0 ] || [ "$(date +%s)" -lt "$UNTIL" ]; then
    exit 0
  fi
fi

INPUT=$(cat)

# One JSON string field, still JSON-escaped exactly as Claude Code sent it,
# so it can be written back between quotes as-is. Escaped quotes and
# backslashes inside the value are part of the match, never its end.
extract() {
  local re="\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
  if [[ "$INPUT" =~ $re ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# The comparison form of a path (as Dr. Vibe writes tracked.txt): forward
# slashes, no trailing slash, and lowercase for Windows drive paths.
normalize() {
  local p="$1"
  p="${p//\\\\/\/}"   # JSON-escaped backslash (two chars) → /
  p="${p//\\//}"      # a single backslash → /
  if [[ "$p" =~ ^/([a-zA-Z])/(.*)$ ]]; then
    p="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
  fi
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  if [[ "$p" =~ ^[a-zA-Z]: ]]; then
    p=$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')
  fi
  printf '%s' "$p"
}

EVENT=$(extract "hook_event_name")
TOOL=$(extract "tool_name")
FILE_PATH=$(extract "file_path")
SESSION_ID=$(extract "session_id")
CWD=$(extract "cwd")

# Is `path` inside one of the tracked repos? (0 = yes)
DISCOVER=0
inside_tracked() {
  local key root
  [ -f "$DIR/tracked.txt" ] && [ -n "$1" ] || return 1
  key=$(normalize "$1")
  while IFS= read -r root || [ -n "$root" ]; do
    root="${root%$'\r'}"
    [ -n "$root" ] && [ "$root" != "#discover" ] || continue
    if [ "$key" = "$root" ] || [ "${key#"$root"/}" != "$key" ]; then
      return 0
    fi
  done < "$DIR/tracked.txt"
  return 1
}
if [ -f "$DIR/tracked.txt" ] && [ "$(head -n 1 "$DIR/tracked.txt" | tr -d '\r')" = "#discover" ]; then
  DISCOVER=1
fi

# A file edit counts where the file is (wherever the session runs); any
# other event where the session runs.
case "$EVENT:$TOOL" in
  PostToolUse:Write|PostToolUse:Edit|PostToolUse:NotebookEdit)
    TARGET="$FILE_PATH"
    case "$TARGET" in
      /*|[A-Za-z]:*|\\\\*) ;;
      *) [ -n "$TARGET" ] && TARGET="$CWD/$TARGET" ;;
    esac
    ;;
  *) TARGET="$CWD" ;;
esac

if ! inside_tracked "$TARGET"; then
  # "Also track the repos Claude Code works in": the folder a session starts
  # in, and nothing else, so Dr. Vibe can offer to track that repo.
  if [ "$DISCOVER" -eq 1 ] && [ "$EVENT" = "SessionStart" ] && [ -n "$CWD" ]; then
    :
  else
    exit 0
  fi
fi

# Rotate log if too large
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_SIZE" ]; then
  mv "$LOG_FILE" "$LOG_FILE.old"
fi

TIMESTAMP=$(date +%s)000

case "$EVENT" in
  PostToolUse)
    case "$TOOL" in
      Write|Edit|NotebookEdit)
        if [ -n "$FILE_PATH" ]; then
          printf '{"ts":%s,"event":"file_changed","tool":"%s","file":"%s","session":"%s","cwd":"%s"}\n' \
            "$TIMESTAMP" "$TOOL" "$FILE_PATH" "$SESSION_ID" "$CWD" >> "$LOG_FILE"
        fi
        ;;
      Bash)
        printf '{"ts":%s,"event":"command_run","tool":"Bash","session":"%s","cwd":"%s"}\n' \
          "$TIMESTAMP" "$SESSION_ID" "$CWD" >> "$LOG_FILE"
        ;;
    esac
    ;;
  SessionStart)
    printf '{"ts":%s,"event":"session_start","session":"%s","cwd":"%s"}\n' \
      "$TIMESTAMP" "$SESSION_ID" "$CWD" >> "$LOG_FILE"
    ;;
  SessionEnd)
    printf '{"ts":%s,"event":"session_end","session":"%s","cwd":"%s"}\n' \
      "$TIMESTAMP" "$SESSION_ID" "$CWD" >> "$LOG_FILE"
    ;;
  Stop)
    printf '{"ts":%s,"event":"response_complete","session":"%s","cwd":"%s"}\n' \
      "$TIMESTAMP" "$SESSION_ID" "$CWD" >> "$LOG_FILE"
    ;;
esac

exit 0
