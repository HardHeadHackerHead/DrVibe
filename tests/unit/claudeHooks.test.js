import { describe, it, expect, vi } from 'vitest';
import { applyClaudeHooksSetting, CLAUDE_CODE_NOT_FOUND } from '../../src/features/activity/claudeHooks.js';
import { DEFAULT_SETTINGS } from '../../src/features/settings/Settings.js';

describe('Claude Code hooks switch', () => {
  it('is off until chosen', () => {
    expect(DEFAULT_SETTINGS.claudeCodeHooksEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.trackClaudeRepos).toBe(false);
  });

  it('installs the hooks when on', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    expect(await applyClaudeHooksSetting(true, invoke)).toEqual({ installed: true });
    expect(invoke).toHaveBeenCalledWith('install_claude_code_hooks');
  });

  it('removes the hooks when switched off', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    expect(await applyClaudeHooksSetting(false, invoke)).toEqual({ installed: false });
    expect(invoke).toHaveBeenCalledWith('uninstall_claude_code_hooks');
    expect(invoke).not.toHaveBeenCalledWith('install_claude_code_hooks');
  });

  it('leaves Claude Code alone at launch when off', async () => {
    const invoke = vi.fn();
    expect(await applyClaudeHooksSetting(false, invoke, { onLaunch: true })).toEqual({ installed: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reinstalls at launch when on', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    await applyClaudeHooksSetting(true, invoke, { onLaunch: true });
    expect(invoke).toHaveBeenCalledWith('install_claude_code_hooks');
  });

  it('reports a missing Claude Code install instead of failing', async () => {
    const invoke = vi.fn().mockRejectedValue(CLAUDE_CODE_NOT_FOUND);
    const r = await applyClaudeHooksSetting(true, invoke);
    expect(r.installed).toBe(false);
    expect(r.notFound).toBe(true);
  });

  it('passes other install errors through', async () => {
    const invoke = vi.fn().mockRejectedValue('Cannot parse settings.json: bad');
    const r = await applyClaudeHooksSetting(true, invoke);
    expect(r).toMatchObject({ installed: false, notFound: false });
    expect(r.error).toContain('Cannot parse');
  });
});
