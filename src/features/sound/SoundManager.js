// Dr. Vibe - Sound Manager
// Procedural character sound effects using the Web Audio API.
// Reaction sounds on CHARACTER_STATE_CHANGED, talk chatter on speech bubbles.

import { eventBus, Events } from '../../core/EventBus.js';

// States that should never play reaction sounds (too frequent / ambient)
const SILENT_STATES = new Set([
  'idle', 'coding', 'focused', 'walkRight', 'walkLeft',
]);

// Voice style presets — each defines the full personality of a character voice.
// baseFreq/freqRange: pitch center and variation
// syllableMs/gapMs: timing of each syllable
// waves: oscillator waveform rotation
// filterFreq/filterQ: lowpass warmth shaping
// formants: vowel-like frequency multipliers (cycles per syllable)
// vibrato/vibratoDepth: LFO wobble for organic feel
const VOICE_PRESETS = {
  mumble: {
    baseFreq: 350, freqRange: 200, bendAmount: 120,
    syllableMs: 55, gapMs: 30, count: 7,
    waves: ['sine', 'triangle'],
    filterFreq: 1800, filterQ: 2,
    formants: [270, 530, 730, 400, 640],
    vibrato: 4, vibratoDepth: 12,
  },
  squeaky: {
    baseFreq: 800, freqRange: 400, bendAmount: 250,
    syllableMs: 30, gapMs: 15, count: 9,
    waves: ['triangle', 'square'],
    filterFreq: 4000, filterQ: 1.5,
    formants: [600, 800, 950, 700, 850],
    vibrato: 0, vibratoDepth: 0,
  },
  gruff: {
    baseFreq: 140, freqRange: 80, bendAmount: 50,
    syllableMs: 80, gapMs: 40, count: 5,
    waves: ['sawtooth', 'triangle'],
    filterFreq: 900, filterQ: 3,
    formants: [200, 350, 280, 320, 250],
    vibrato: 2, vibratoDepth: 6,
  },
  alien: {
    baseFreq: 500, freqRange: 600, bendAmount: 400,
    syllableMs: 60, gapMs: 20, count: 8,
    waves: ['sine', 'sine'],
    filterFreq: 3500, filterQ: 5,
    formants: [300, 900, 500, 1100, 400],
    vibrato: 12, vibratoDepth: 40,
  },
  robot: {
    baseFreq: 200, freqRange: 50, bendAmount: 10,
    syllableMs: 50, gapMs: 20, count: 7,
    waves: ['square', 'square'],
    filterFreq: 2000, filterQ: 8,
    formants: [300, 320, 340, 310, 330],
    vibrato: 0, vibratoDepth: 0,
  },
  mystic: {
    baseFreq: 400, freqRange: 250, bendAmount: 150,
    syllableMs: 90, gapMs: 35, count: 6,
    waves: ['sine', 'triangle'],
    filterFreq: 2200, filterQ: 3,
    formants: [350, 600, 450, 700, 500],
    vibrato: 6, vibratoDepth: 20,
  },
  hyper: {
    baseFreq: 550, freqRange: 450, bendAmount: 300,
    syllableMs: 25, gapMs: 12, count: 12,
    waves: ['square', 'triangle', 'sawtooth'],
    filterFreq: 3500, filterQ: 2,
    formants: [400, 700, 500, 850, 600],
    vibrato: 0, vibratoDepth: 0,
  },
  retro: {
    baseFreq: 440, freqRange: 200, bendAmount: 0,
    syllableMs: 45, gapMs: 20, count: 8,
    waves: ['square', 'square'],
    filterFreq: 5000, filterQ: 0.5,
    formants: [262, 330, 392, 440, 523],
    vibrato: 0, vibratoDepth: 0,
  },
};

export class SoundManager {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.reactionsEnabled = false;
    this.talkEnabled = false;
    this.volume = 50;
    this.talkVoice = 'mumble';
    this.suppressed = false;
    this.lastPlayTime = 0;
    this.minInterval = 400;
    this._unsubs = [];
  }

  init(settings) {
    this.reactionsEnabled = settings.get('soundReactionsEnabled') || false;
    this.talkEnabled = settings.get('soundTalkEnabled') || false;
    this.volume = settings.get('soundVolume') ?? 50;
    this.talkVoice = settings.get('soundTalkVoice') || 'mumble';

    this._unsubs.push(
      eventBus.on(Events.CHARACTER_STATE_CHANGED, (data) => this._onStateChanged(data)),
      eventBus.on(Events.SETTINGS_CHANGED, (data) => this._onSettingsChanged(data)),
      eventBus.on(Events.FOCUS_MODE_STARTED, () => { this.suppressed = true; }),
      eventBus.on(Events.FOCUS_MODE_ENDED, () => { this.suppressed = false; }),
    );

    console.log('SoundManager initialized (reactions:', this.reactionsEnabled, 'talk:', this.talkEnabled, 'voice:', this.talkVoice, ')');
  }

  _onSettingsChanged({ key, value }) {
    switch (key) {
      case 'soundReactionsEnabled':
        this.reactionsEnabled = value;
        if (!value && !this.talkEnabled) this._closeContext();
        break;
      case 'soundTalkEnabled':
        this.talkEnabled = value;
        if (!value && !this.reactionsEnabled) this._closeContext();
        break;
      case 'soundVolume':
        this.volume = value;
        if (this.masterGain) this.masterGain.gain.value = this.volume / 100;
        break;
      case 'soundTalkVoice':
        this.talkVoice = value;
        break;
    }
  }

  _closeContext() {
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.masterGain = null;
    }
  }

  _onStateChanged({ current, previous }) {
    if (!this.reactionsEnabled || this.suppressed) return;
    if (SILENT_STATES.has(current)) return;

    const now = Date.now();
    if (now - this.lastPlayTime < this.minInterval) return;

    const generator = this._getGenerator(current);
    if (!generator) return;

    this._ensureContext();
    if (!this.audioContext) return;

    this.lastPlayTime = now;
    generator(this.audioContext, this.masterGain);
  }

  _ensureContext() {
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      return;
    }
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume / 100;
      this.masterGain.connect(this.audioContext.destination);
    } catch (e) {
      console.warn('SoundManager: failed to create AudioContext', e);
      this.audioContext = null;
    }
  }

  _getGenerator(state) {
    const generators = {
      excited:      (ctx, dest) => this._soundExcited(ctx, dest),
      celebrating:  (ctx, dest) => this._soundCelebrating(ctx, dest),
      alert:        (ctx, dest) => this._soundAlert(ctx, dest),
      concerned:    (ctx, dest) => this._soundConcerned(ctx, dest),
      tired:        (ctx, dest) => this._soundTired(ctx, dest),
      thinking:     (ctx, dest) => this._soundThinking(ctx, dest),
      beaker:       (ctx, dest) => this._soundBeaker(ctx, dest),
      stretching:   (ctx, dest) => this._soundStretching(ctx, dest),
      presenting:   (ctx, dest) => this._soundPresenting(ctx, dest),
      thumbsUp:     (ctx, dest) => this._soundThumbsUp(ctx, dest),
      coverEyes:    (ctx, dest) => this._soundCoverEyes(ctx, dest),
    };
    return generators[state] || null;
  }

  // --- Reaction Sound Generators ---

  _soundExcited(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(660, now + 0.08);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.12);
  }

  _soundCelebrating(ctx, dest) {
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const start = now + i * 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
      osc.connect(gain); gain.connect(dest);
      osc.start(start); osc.stop(start + 0.1);
    });
  }

  _soundAlert(ctx, dest) {
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 880;
      const start = now + i * 0.08;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.05);
      osc.connect(gain); gain.connect(dest);
      osc.start(start); osc.stop(start + 0.05);
    }
  }

  _soundConcerned(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(329.63, now);
    osc.frequency.linearRampToValueAtTime(261.63, now + 0.18);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.2);
  }

  _soundTired(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(165, now + 0.22);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.25);
  }

  _soundThinking(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 330;
    lfo.type = 'sine';
    lfo.frequency.value = 5;
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.03);
    gain.gain.setValueAtTime(0.12, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.18); lfo.stop(now + 0.18);
  }

  _soundBeaker(ctx, dest) {
    const now = ctx.currentTime;
    [400, 500, 600, 700].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.045;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.04);
      osc.connect(gain); gain.connect(dest);
      osc.start(start); osc.stop(start + 0.04);
    });
  }

  _soundStretching(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.18);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.2);
  }

  _soundPresenting(ctx, dest) {
    const now = ctx.currentTime;
    const notes = [
      { freq: 330, start: 0, dur: 0.06 },
      { freq: 440, start: 0.08, dur: 0.12 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = n.freq;
      const t = now + n.start;
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);
      osc.connect(gain); gain.connect(dest);
      osc.start(t); osc.stop(t + n.dur);
    }
  }

  _soundThumbsUp(ctx, dest) {
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.03;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    noise.connect(noiseGain); noiseGain.connect(dest);
    noise.start(now);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain); gain.connect(dest);
    osc.start(now + 0.02); osc.stop(now + 0.15);
  }

  _soundCoverEyes(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.18);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.2);
  }

  // --- Public: chattering "talk" noise for speech bubbles ---
  playChatNoise(text) {
    if (!this.talkEnabled || this.suppressed) return;

    this._ensureContext();
    if (!this.audioContext) return;

    const preset = VOICE_PRESETS[this.talkVoice] || VOICE_PRESETS.mumble;
    const ctx = this.audioContext;
    const dest = this.masterGain;
    const now = ctx.currentTime;
    const syllableDuration = preset.syllableMs / 1000;
    const gap = preset.gapMs / 1000;

    // Lowpass filter for warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = preset.filterFreq;
    filter.Q.value = preset.filterQ;
    filter.connect(dest);

    // Seeded random from text
    let seed = 0;
    for (let c = 0; c < (text || '').length; c++) {
      seed = ((seed << 5) - seed + (text || '').charCodeAt(c)) | 0;
    }
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed & 0x7fffffff) / 2147483647;
    };

    const baseSyllables = Math.round((text || '').length / 4);
    const syllableCount = Math.max(3, Math.min(14, baseSyllables || preset.count));

    for (let i = 0; i < syllableCount; i++) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      osc.type = preset.waves[i % preset.waves.length];

      // Formant-based frequency for vowel-like variation
      const formantShift = preset.formants[i % preset.formants.length] / 500;
      const freq = preset.baseFreq * formantShift + rand() * preset.freqRange * 0.5;
      const start = now + i * (syllableDuration + gap);

      osc.frequency.setValueAtTime(Math.max(20, freq), start);
      // Two-phase pitch contour
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, freq + (rand() - 0.5) * preset.bendAmount),
        start + syllableDuration * 0.7
      );
      osc.frequency.linearRampToValueAtTime(
        Math.max(20, freq * (0.9 + rand() * 0.2)),
        start + syllableDuration
      );

      // Vibrato (LFO)
      if (preset.vibrato > 0) {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = preset.vibrato;
        lfoGain.gain.value = preset.vibratoDepth;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start(start);
        lfo.stop(start + syllableDuration + 0.01);
      }

      // Smooth envelope
      const attack = syllableDuration * 0.12;
      const sustain = syllableDuration * 0.5;
      oscGain.gain.setValueAtTime(0, start);
      oscGain.gain.linearRampToValueAtTime(0.15, start + attack);
      oscGain.gain.setValueAtTime(0.15 * (0.7 + rand() * 0.3), start + attack + sustain);
      oscGain.gain.exponentialRampToValueAtTime(0.001, start + syllableDuration);

      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(start);
      osc.stop(start + syllableDuration + 0.01);
    }
  }

  destroy() {
    for (const unsub of this._unsubs) {
      if (typeof unsub === 'function') unsub();
    }
    this._unsubs = [];
    this._closeContext();
  }
}
