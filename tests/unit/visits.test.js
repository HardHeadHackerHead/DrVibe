// VisitorController rules and the walk path.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { VisitorController, MAX_WALK_ONS_PER_HOUR, MAX_VISIT_WAIT_MS, VISIT_WATCHDOG_MS, visitSpeech } from '../../src/features/visits/VisitorController.js';
import { planVisitWalk, stepTowards } from '../../src/features/visits/visitPath.js';
import { eventBus, Events } from '../../src/core/EventBus.js';

const visit = (n, extra = {}) => ({ id: `v${n}`, preset: null, from: { id: `u${n}`, username: `user${n}` }, ...extra });

function make({ busy = false } = {}) {
  let now = 1_000_000;
  const state = { busy };
  const shown = [];
  const notes = [];
  eventBus.on(Events.NOTIFICATION_RECEIVED, ({ notification }) => notes.push(notification));
  const acks = [];
  const c = new VisitorController({
    ackVisit: vi.fn(async (id, outcome) => { acks.push([id, outcome]); }),
    isBusy: () => state.busy,
    showVisitor: vi.fn(async (p) => { shown.push(p); }),
    resolveSprite: vi.fn(async () => ({ localSkin: 'dr-vibe-default' })),
    getStage: vi.fn(async () => ({ scale: 100, size: { width: 128, height: 151 }, geometry: {} })),
    onArrive: vi.fn(),
    sendVisit: vi.fn(async () => ({ ok: true, status: 201 })),
    now: () => now,
  });
  c.init();
  return { c, state, shown, notes, acks, advance: (ms) => { now += ms; } };
}

afterEach(() => { eventBus.clear(); vi.useRealTimers(); });

describe('VisitorController', () => {
  it('plays one visit at a time and the next after the first is done', async () => {
    vi.useFakeTimers();
    const { c, shown } = make();
    eventBus.emit(Events.VISIT_RECEIVED, { visit: visit(1) });
    eventBus.emit(Events.VISIT_RECEIVED, { visit: visit(2) });
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.map(s => s.visit.id)).toEqual(['v1']);
    c.done();
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown.map(s => s.visit.id)).toEqual(['v1', 'v2']);
  });

  it('frees the stage when visitor-done never arrives', async () => {
    vi.useFakeTimers();
    const { shown, acks } = make();
    eventBus.emit(Events.VISIT_RECEIVED, { visit: visit(1) });
    eventBus.emit(Events.VISIT_RECEIVED, { visit: visit(2) });
    await vi.advanceTimersByTimeAsync(0);
    expect(shown.map(s => s.visit.id)).toEqual(['v1']);
    await vi.advanceTimersByTimeAsync(VISIT_WATCHDOG_MS + 3000);
    expect(shown.map(s => s.visit.id)).toEqual(['v1', 'v2']);
    expect(acks).toContainEqual(['v1', 'played']);
  });

  it('holds visits while busy and plays them at the next break', async () => {
    const { state, shown } = make({ busy: true });
    eventBus.emit(Events.VISIT_RECEIVED, { visit: visit(1) });
    await Promise.resolve();
    expect(shown).toHaveLength(0);
    state.busy = false;
    eventBus.emit(Events.TIMER_BREAK_START, {});
    await new Promise(r => setTimeout(r, 0));
    expect(shown).toHaveLength(1);
  });

  it('caps walk-ons at 5 per hour; extras are acked missed (the server notifies)', async () => {
    const { c, shown, acks } = make();
    for (let i = 1; i <= MAX_WALK_ONS_PER_HOUR + 2; i++) {
      c.enqueue(visit(i));
      await new Promise(r => setTimeout(r, 0));
      c._playing = null; // as if each walked off immediately
    }
    expect(shown).toHaveLength(MAX_WALK_ONS_PER_HOUR);
    expect(acks).toEqual([['v6', 'missed'], ['v7', 'missed']]);
  });

  it('acks a visit played once it walked off', async () => {
    vi.useFakeTimers();
    const { c, acks } = make();
    c.enqueue(visit(1));
    await vi.advanceTimersByTimeAsync(0);
    c.done();
    expect(acks).toEqual([['v1', 'played']]);
  });

  it('ignores a visit it already has (the poll repeats until acked)', async () => {
    const { c, shown } = make({ busy: true });
    c.enqueue(visit(1));
    c.enqueue(visit(1));
    expect(c.queueLength).toBe(1);
    expect(shown).toHaveLength(0);
  });

  it('acks visits that waited too long as missed', async () => {
    const { c, state, shown, acks, advance } = make({ busy: true });
    c.enqueue(visit(1, { preset: 'nice_streak' }));
    advance(MAX_VISIT_WAIT_MS + 1);
    state.busy = false;
    await c.tryPlay();
    expect(shown).toHaveLength(0);
    expect(acks).toEqual([['v1', 'missed']]);
  });

  it('test visits skip the busy rule', async () => {
    const { c, shown } = make({ busy: true });
    c.enqueue(visit(1, { test: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(shown).toHaveLength(1);
  });

  it('wave back sends a visit in reply', async () => {
    const { c } = make();
    await c.waveBack('u9', 'v9');
    expect(c._sendVisit).toHaveBeenCalledWith('u9', 'v9');
  });

  it('speech line uses presets only', () => {
    expect(visitSpeech(visit(1, { preset: 'keep_shipping' }))).toEqual({ text: '@user1 stopped by!', tip: 'Keep shipping!' });
    expect(visitSpeech(visit(1, { preset: 'free text!' }))).toEqual({ text: '@user1 stopped by!', tip: null });
    expect(visitSpeech(visit(1, { isWaveBack: true })).text).toBe('@user1 waved back!');
  });
});

describe('planVisitWalk', () => {
  it('enters from the roomier side, stands beside Dr. Vibe and exits the other way', () => {
    const p = planVisitWalk({ mainX: 1500, mainY: 900, width: 128, workX: 0, workWidth: 1920 });
    expect(p.side).toBe('left');
    expect(p.startX).toBe(-128);
    expect(p.standX).toBe(1500 - 128 - 4);
    expect(p.exitX).toBe(1920);
    expect(p.y).toBe(900);

    const q = planVisitWalk({ mainX: 100, mainY: 900, width: 128, workX: 0, workWidth: 1920 });
    expect(q.side).toBe('right');
    expect(q.startX).toBe(1920);
    expect(q.standX).toBe(100 + 128 + 4);
    expect(q.exitX).toBe(-128);
  });

  it('steps at walk speed without overshooting', () => {
    expect(stepTowards(0, 100, 1000)).toBe(60);
    expect(stepTowards(90, 100, 1000)).toBe(100);
    expect(stepTowards(100, 0, 500)).toBe(70);
  });
});
