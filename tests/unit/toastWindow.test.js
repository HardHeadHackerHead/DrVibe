// The toast manager is the only thing that closes a toast window: it hides it
// at once and destroys it a second later. A toast destroyed while Rust was
// answering its own close call crashed the app (WebView2, 2.0.6).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('toast windows', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete window.__TAURI__;
  });

  it('a closed toast is hidden now and destroyed later', async () => {
    vi.useFakeTimers();
    const handlers = {};
    const win = { label: 'toast-item-1-1', hide: vi.fn(async () => {}), destroy: vi.fn(async () => {}) };
    window.__TAURI__ = {
      core: { invoke: vi.fn(async () => {}) },
      event: { listen: vi.fn(async (name, fn) => { handlers[name] = fn; }) },
      window: {
        getAllWindows: async () => [],
        currentMonitor: async () => null,
        primaryMonitor: async () => null,
        Window: { getByLabel: async (label) => (label === win.label ? win : null) },
      },
    };
    vi.resetModules();
    await import('../../src/toast-window.js');
    await vi.waitFor(() => expect(handlers['toast-item-close']).toBeTypeOf('function'));

    await handlers['toast-item-close']({ payload: { label: win.label } });
    expect(win.hide).toHaveBeenCalledOnce();
    expect(win.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(win.destroy).toHaveBeenCalledOnce();
  });

  it('a toast never closes its own window', () => {
    const item = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'toast-item.js'), 'utf8');
    expect(item).not.toMatch(/currentWindow\.(close|destroy)\(/);
  });
});
