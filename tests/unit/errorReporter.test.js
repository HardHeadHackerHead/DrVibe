import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PER_MINUTE, MAX_PER_PAGE, REPEAT_WINDOW_MS, getErrorReportsEnabled, installErrorReporter, reportError, setErrorReportsEnabled,
  uninstallErrorReporter,
} from '../../src/core/errorReporter.js';
import { CRASH_REPORTS, renderWhatDrVibeSees } from '../../src/ui/WhatDrVibeSees.js';

function setup() {
  const sent = [];
  let now = 0;
  installErrorReporter({ send: (r) => sent.push(r), now: () => now });
  return { sent, tick: (ms) => (now += ms) };
}

afterEach(() => {
  uninstallErrorReporter();
  delete window.__TAURI__;
});

describe('desktop JS error reporter', () => {
  it('hands window errors and rejections to Rust as desktop-js', () => {
    const { sent } = setup();
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('sprite is null'), message: 'sprite is null' }));
    const rejection = new Event('unhandledrejection');
    rejection.reason = new Error('poll failed');
    window.dispatchEvent(rejection);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ source: 'desktop-js', message: 'TypeError: sprite is null' });
    expect(sent[0].stack).toContain('sprite is null');
    expect(sent[1].message).toBe('Error: poll failed');
  });

  it('dedupes and throttles', () => {
    const { sent, tick } = setup();
    const err = new Error('loop');
    expect(reportError(err)).toBe(true);
    expect(reportError(err)).toBe(false);
    tick(REPEAT_WINDOW_MS + 1);
    expect(reportError(err)).toBe(true);
    for (let i = 0; i < 10; i++) reportError(new Error(`e${i}`));
    expect(sent.length).toBeLessThanOrEqual(MAX_PER_MINUTE + 1);
    for (let m = 0; m < 10; m++) {
      tick(61_000);
      for (let i = 0; i < 5; i++) reportError(new Error(`m${m}-${i}`));
    }
    expect(sent).toHaveLength(MAX_PER_PAGE);
  });

  it('ignores noise and never throws', () => {
    installErrorReporter({ send: () => { throw new Error('ipc down'); } });
    expect(reportError(new Error('ResizeObserver loop limit exceeded'))).toBe(false);
    expect(reportError(null)).toBe(false);
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  it('uses the error_report command and the privacy switch commands', async () => {
    const invoke = vi.fn(async (cmd, args) => (cmd === 'error_reports_get_enabled' ? false : args?.enabled ?? true));
    window.__TAURI__ = { core: { invoke } };
    installErrorReporter();
    reportError(new Error('via tauri'));
    expect(invoke).toHaveBeenCalledWith('error_report', { report: expect.objectContaining({ source: 'desktop-js', message: 'Error: via tauri' }) });
    expect(await getErrorReportsEnabled()).toBe(false);
    expect(await setErrorReportsEnabled(false)).toBe(false);
    expect(invoke).toHaveBeenCalledWith('error_reports_set_enabled', { enabled: false });
  });

  it('defaults to on without Tauri', async () => {
    expect(await getErrorReportsEnabled()).toBe(true);
  });

  it('is listed in "What Dr. Vibe sees"', () => {
    const el = document.createElement('div');
    renderWhatDrVibeSees(el);
    expect(el.textContent).toContain('Crash reports');
    expect(el.textContent).toContain(CRASH_REPORTS[0].slice(0, 30));
  });
});
