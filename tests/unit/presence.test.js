// PresenceGuard hides Dr. Vibe during screen shares / fullscreen apps and
// Notifier holds toasts until it ends.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PresenceGuard } from '../../src/features/presence/PresenceGuard.js';
import { Notifier } from '../../src/features/notifications/Notifier.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

function makeCharacter(visible = true) {
  const c = {
    visible,
    isVisible: vi.fn(async () => c.visible),
    hide: vi.fn(async () => { c.visible = false; }),
    show: vi.fn(async () => { c.visible = true; }),
  };
  return c;
}

const settings = (values = {}) => ({ get: (k) => values[k] });

afterEach(() => { eventBus.clear(); vi.useRealTimers(); });

describe('PresenceGuard', () => {
  it('hides on a screen share and shows again when it ends', async () => {
    const character = makeCharacter();
    const guard = new PresenceGuard({ settings: settings(), character });
    const started = vi.fn();
    eventBus.on(Events.PRESENTING_STARTED, started);

    await guard.apply({ presenting: true, reason: 'screen_share', app: 'Zoom' });
    expect(character.hide).toHaveBeenCalledTimes(1);
    expect(guard.holding).toBe(true);
    expect(started).toHaveBeenCalledWith({ reason: 'screen_share', app: 'Zoom' });

    await guard.apply({ presenting: false });
    expect(character.show).toHaveBeenCalledTimes(1);
    expect(guard.holding).toBe(false);
  });

  it('does nothing when the player turned the setting off', async () => {
    const character = makeCharacter();
    const guard = new PresenceGuard({ settings: settings({ hideWhenPresenting: false }), character });
    await guard.apply({ presenting: true, reason: 'fullscreen', app: 'game' });
    expect(character.hide).not.toHaveBeenCalled();
    expect(guard.holding).toBe(false);
  });

  it('does not re-show a Dr. Vibe the player hid from the tray', async () => {
    const character = makeCharacter(false);
    const guard = new PresenceGuard({ settings: settings(), character });
    await guard.apply({ presenting: true, reason: 'fullscreen' });
    await guard.apply({ presenting: false });
    expect(character.show).not.toHaveBeenCalled();
  });
});

describe('Notifier holds toasts while presenting', () => {
  it('queues during a share and plays them after', async () => {
    vi.useFakeTimers();
    const emitTo = vi.fn();
    window.__TAURI__.event.emitTo = emitTo;
    const notifier = new Notifier(settings());
    notifier.init();
    let holding = true;
    notifier.holdWhile(() => holding);

    notifier.send('One', 'body', 'achievement');
    notifier.send('Two', 'body', 'achievement');
    expect(emitTo).not.toHaveBeenCalled();

    holding = false;
    eventBus.emit(Events.PRESENTING_ENDED, {});
    await vi.advanceTimersByTimeAsync(5000);
    const titles = emitTo.mock.calls.filter(c => c[1] === 'toast-show').map(c => c[2].title);
    expect(titles).toEqual(['One', 'Two']);
    delete window.__TAURI__.event.emitTo;
  });
});
