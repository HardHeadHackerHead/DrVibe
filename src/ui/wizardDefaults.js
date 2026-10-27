// Dr. Vibe — the values the setup wizard's privacy steps start from.
//
// A first run starts from the app defaults: Claude Code hooks off, crash
// reports off, the public community defaults the owner chose (profile
// public, leaderboards on, visits from followers, Vibe Map off, project
// name off) and the send switches on. "Run setup again" starts from what is
// saved. Skip and close save nothing, so these defaults are also what a
// skipped setup leaves.

import { WATCH_CHOICES, SEND_CHOICES, SYNC_CHOICE } from './privacyChoices.js';

/**
 * @param {Object} [saved]
 * @param {Object} [saved.settings]  the `settings` section
 * @param {Object} [saved.privacy]   privacy settings (contract.js buildPrivacyBody shape)
 * @param {boolean} [saved.errorReports]  the crash report switch
 * @returns {Object} key → value for every wizard choice
 */
export function wizardDefaults({ settings = {}, privacy = {}, errorReports = false } = {}) {
  const out = {};
  for (const c of [...WATCH_CHOICES, ...SEND_CHOICES, SYNC_CHOICE]) {
    let v;
    if (c.store === 'settings') v = settings[c.key];
    else if (c.store === 'privacy') v = privacy[c.key];
    else if (c.store === 'errors') v = errorReports;
    out[c.key] = v === undefined || v === null ? c.default : v;
  }
  // Hooks only count as chosen when explicitly true.
  out.claudeCodeHooksEnabled = settings.claudeCodeHooksEnabled === true;
  out.trackClaudeRepos = out.claudeCodeHooksEnabled && settings.trackClaudeRepos === true;
  out.errorReports = errorReports === true;
  return out;
}
