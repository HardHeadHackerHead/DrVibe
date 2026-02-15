#!/bin/bash
# Dr. Vibe - Install Claude Code Hooks
# Adds Dr. Vibe tracking hooks to your Claude Code settings.
# Run this once to enable the integration.

set -e

SETTINGS_FILE="$HOME/.claude/settings.json"
HOOK_SCRIPT="$(cd "$(dirname "$0")" && pwd)/claude-code-hook.sh"
LOG_DIR="$HOME/.dr-vibe"

echo "Dr. Vibe - Claude Code Integration Installer"
echo "============================================="
echo ""

# Ensure hook script is executable
chmod +x "$HOOK_SCRIPT"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Ensure jq is available (needed by the hook script)
if ! command -v jq &>/dev/null; then
  echo "WARNING: jq is not installed. The hook script needs jq for JSON parsing."
  echo "  Install it: winget install jqlang.jq  (or: choco install jq)"
  echo ""
fi

# Ensure Claude settings directory exists
mkdir -p "$HOME/.claude"

# Build the hooks configuration
HOOK_CMD="bash \"$HOOK_SCRIPT\""

# The hooks config to merge
HOOKS_CONFIG=$(cat <<ENDJSON
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit|Read|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_CMD",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_CMD",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_CMD",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_CMD",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
ENDJSON
)

if [ -f "$SETTINGS_FILE" ]; then
  echo "Existing settings found at: $SETTINGS_FILE"

  if command -v jq &>/dev/null; then
    # Merge hooks into existing settings using jq
    MERGED=$(jq --argjson hooks "$(echo "$HOOKS_CONFIG" | jq '.hooks')" \
      '.hooks = (.hooks // {}) * $hooks' "$SETTINGS_FILE")
    echo "$MERGED" > "$SETTINGS_FILE"
    echo "Hooks merged into existing settings."
  else
    echo ""
    echo "Cannot auto-merge without jq. Please manually add the following to"
    echo "$SETTINGS_FILE under the \"hooks\" key:"
    echo ""
    echo "$HOOKS_CONFIG"
    echo ""
    exit 1
  fi
else
  echo "Creating new settings file at: $SETTINGS_FILE"
  echo "$HOOKS_CONFIG" > "$SETTINGS_FILE"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Hook script: $HOOK_SCRIPT"
echo "Event log:   $LOG_DIR/claude-code-events.jsonl"
echo ""
echo "Dr. Vibe will now track file changes made by Claude Code."
echo "Restart Claude Code for hooks to take effect."
