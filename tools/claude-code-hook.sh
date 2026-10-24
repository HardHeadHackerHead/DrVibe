#!/bin/bash
# Dr. Vibe - Claude Code Integration Hook
# Captures file changes and session events from Claude Code
# and writes them to a JSONL log that Dr. Vibe reads.
#
# Install: Add hooks to ~/.claude/settings.json (see install-hooks.sh)

LOG_DIR="$HOME/.dr-vibe"
LOG_FILE="$LOG_DIR/claude-code-events.jsonl"
MAX_LOG_SIZE=5242880  # 5MB - rotate when exceeded

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Rotate log if too large
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_SIZE" ]; then
  mv "$LOG_FILE" "$LOG_FILE.old"
fi

# Read JSON input from stdin
INPUT=$(cat)

# Timestamp in milliseconds
TIMESTAMP=$(date +%s)000

# Extract JSON fields using bash string matching (no jq dependency)
# These patterns work on the single-line JSON that Claude Code sends.
extract() {
  local key="$1"
  local result=""
  # Match "key":"value" or "key": "value"
  if [[ "$INPUT" =~ \"$key\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    result="${BASH_REMATCH[1]}"
  fi
  echo "$result"
}

EVENT=$(extract "hook_event_name")
TOOL=$(extract "tool_name")
FILE_PATH=$(extract "file_path")
SESSION_ID=$(extract "session_id")
CWD=$(extract "cwd")

# NOTE: do NOT re-escape backslashes here. The regex `extract` above captures
# the JSON-escaped form from stdin (each Windows path separator is already two
# literal chars: `\\`), which is exactly the form we want to emit back into
# JSON. An earlier version doubled these to `\\\\`, which made consumers see
# `\\` per separator after JSON parse, polluting projectFolders and the
# momentum tracker's file map with malformed paths.

# Build the log entry based on event type
case "$EVENT" in
  PreToolUse|PostToolUse)
    case "$TOOL" in
      Write|Edit|NotebookEdit)
        if [ -n "$FILE_PATH" ]; then
          echo "{\"ts\":$TIMESTAMP,\"event\":\"file_changed\",\"tool\":\"$TOOL\",\"file\":\"$FILE_PATH\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\"}" >> "$LOG_FILE"
        fi
        ;;
      Read)
        if [ -n "$FILE_PATH" ]; then
          echo "{\"ts\":$TIMESTAMP,\"event\":\"file_read\",\"tool\":\"$TOOL\",\"file\":\"$FILE_PATH\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\"}" >> "$LOG_FILE"
        fi
        ;;
      Bash)
        echo "{\"ts\":$TIMESTAMP,\"event\":\"command_run\",\"tool\":\"Bash\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\"}" >> "$LOG_FILE"
        ;;
    esac
    ;;
  SessionStart)
    echo "{\"ts\":$TIMESTAMP,\"event\":\"session_start\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\"}" >> "$LOG_FILE"
    ;;
  SessionEnd)
    echo "{\"ts\":$TIMESTAMP,\"event\":\"session_end\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\"}" >> "$LOG_FILE"
    ;;
  Stop)
    echo "{\"ts\":$TIMESTAMP,\"event\":\"response_complete\",\"session\":\"$SESSION_ID\",\"cwd\":\"$CWD\"}" >> "$LOG_FILE"
    ;;
esac

exit 0
