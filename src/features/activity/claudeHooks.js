// Dr. Vibe - Claude Code hooks switch
// Applies the "Claude Code" setting (Settings → Tracking): on installs the
// hooks in ~/.claude/settings.json, off removes them. Shared by the main
// window (at launch) and the settings window (when the switch changes).

/** Error the Rust installer returns when there is no ~/.claude folder. */
export const CLAUDE_CODE_NOT_FOUND = 'claude_code_not_found';

/**
 * @param {boolean} enabled  the claudeCodeHooksEnabled setting
 * @param {(cmd: string) => Promise<unknown>} invoke  Tauri invoke
 * @param {{ onLaunch?: boolean }} [opts]  at launch, "off" leaves the user's
 *   Claude Code settings untouched (they were removed when it was switched off)
 * @returns {Promise<{ installed: boolean, notFound?: boolean, error?: string }>}
 */
export async function applyClaudeHooksSetting(enabled, invoke, { onLaunch = false } = {}) {
  if (!enabled) {
    if (onLaunch) return { installed: false };
    try {
      await invoke('uninstall_claude_code_hooks');
      return { installed: false };
    } catch (e) {
      return { installed: false, error: String(e) };
    }
  }
  try {
    await invoke('install_claude_code_hooks');
    return { installed: true };
  } catch (e) {
    const error = String(e);
    return { installed: false, notFound: error.includes(CLAUDE_CODE_NOT_FOUND), error };
  }
}
