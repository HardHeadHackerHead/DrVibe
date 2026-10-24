#!/bin/bash
# Dr. Vibe - Install Claude Code Hooks
# Copies the hook script to a stable location (~/.dr-vibe) and registers
# it with Claude Code. Safe to re-run: deduplicates existing Dr. Vibe
# hooks automatically so repeated installs/updates never create duplicates.

set -e

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_HOOK="$TOOLS_DIR/claude-code-hook.sh"
SOURCE_CMD="$TOOLS_DIR/claude-code-hook.cmd"
STABLE_DIR="$HOME/.dr-vibe"
STABLE_HOOK="$STABLE_DIR/claude-code-hook.sh"
STABLE_CMD="$STABLE_DIR/claude-code-hook.cmd"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Dr. Vibe - Claude Code Integration Installer"
echo "============================================="
echo ""

# --- 1. Deploy hook script to stable location ---
# The hook lives in ~/.dr-vibe, not inside the app bundle, so it survives
# the app being moved, updated, or reinstalled.
mkdir -p "$STABLE_DIR"

if [ ! -f "$SOURCE_HOOK" ]; then
  echo "ERROR: Hook script not found at: $SOURCE_HOOK"
  exit 1
fi

cp "$SOURCE_HOOK" "$STABLE_HOOK"
chmod +x "$STABLE_HOOK"
echo "Hook deployed to: $STABLE_HOOK"

# Deploy the Windows .cmd wrapper if available — Claude Code on Windows
# can't reliably tokenize `"C:/Program Files/Git/bin/bash.exe" "..."`, so the
# .cmd wrapper is registered as the hook command instead.
if [ -f "$SOURCE_CMD" ]; then
  cp "$SOURCE_CMD" "$STABLE_CMD"
  echo "Wrapper deployed to: $STABLE_CMD"
fi

# --- 2. Check for jq ---
if ! command -v jq &>/dev/null; then
  echo ""
  echo "ERROR: jq is required but not installed."
  echo "  Windows: winget install jqlang.jq"
  echo "  Mac:     brew install jq"
  echo "  Linux:   apt install jq  /  yum install jq"
  echo ""
  exit 1
fi

# --- 3. Build hook command ---
# Claude Code launches hooks through bash on every platform. On Windows that's
# /usr/bin/bash (Git Bash / MSYS), which interprets backslashes as escapes,
# so a Windows-native path mangles to "C:Usersyou..." (exit 127); a quoted
# bash.exe + arg form mis-tokenizes (exit 126). The form that survives both:
# an MSYS-style POSIX path with no spaces and no backslashes, executed via
# the script's #!/bin/bash shebang.
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  HOOK_CMD="$(cygpath -u "$STABLE_HOOK")"
else
  HOOK_CMD="$STABLE_HOOK"
fi

# --- 4. Ensure settings file exists ---
mkdir -p "$HOME/.claude"
if [ ! -f "$SETTINGS_FILE" ]; then
  echo "{}" > "$SETTINGS_FILE"
fi

# --- 5. Merge hooks, replacing any existing Dr. Vibe entries ---
# Identifies Dr. Vibe hooks by command fingerprint (claude-code-hook.sh) and
# legacy _dr_vibe marker. No extra fields added — Claude Code rejects unknown properties.
echo "Updating Claude Code settings: $SETTINGS_FILE"

UPDATED=$(jq --arg cmd "$HOOK_CMD" '
  def rm_dv: map(select(
    (.hooks | map(._dr_vibe // false) | any | not) and
    (.hooks | map(.command // "" | (contains("claude-code-hook.sh") or contains("claude-code-hook.cmd"))) | any | not)
  ));
  def dv_hook: {"type": "command", "command": $cmd, "timeout": 10};

  .hooks.PostToolUse = ((.hooks.PostToolUse // []) | rm_dv) + [{
    "matcher": "Write|Edit|NotebookEdit|Read|Bash",
    "hooks": [dv_hook]
  }] |
  .hooks.SessionStart = ((.hooks.SessionStart // []) | rm_dv) + [{"hooks": [dv_hook]}] |
  .hooks.SessionEnd   = ((.hooks.SessionEnd   // []) | rm_dv) + [{"hooks": [dv_hook]}] |
  .hooks.Stop         = ((.hooks.Stop         // []) | rm_dv) + [{"hooks": [dv_hook]}]
' "$SETTINGS_FILE")

echo "$UPDATED" > "$SETTINGS_FILE"

echo ""
echo "Installation complete!"
echo ""
echo "Hook script: $STABLE_HOOK"
echo "Event log:   $STABLE_DIR/claude-code-events.jsonl"
echo ""
echo "Restart Claude Code for hooks to take effect."
