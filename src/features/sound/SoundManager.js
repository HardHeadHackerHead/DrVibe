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
  // Animal voices
  doggy: {
    baseFreq: 780, freqRange: 280, bendAmount: 180,
    syllableMs: 22, gapMs: 10, count: 7,
    waves: ['square', 'triangle'],
    filterFreq: 3800, filterQ: 2.5,
    formants: [750, 900, 680, 820, 700],
    vibrato: 0, vibratoDepth: 0,
  },
  lion: {
    baseFreq: 85, freqRange: 55, bendAmount: 35,
    syllableMs: 130, gapMs: 65, count: 4,
    waves: ['sawtooth', 'triangle'],
    filterFreq: 550, filterQ: 4,
    formants: [140, 240, 190, 170, 210],
    vibrato: 3, vibratoDepth: 9,
  },
};

// --- Phoneme data for Animalese-style text-to-sound synthesis ---
// Vowel F1/F2 formant pairs (Hz, based on human phonetics).
// Both are scaled at runtime by preset.baseFreq / 350 so every voice
// preserves vowel contrast while staying in its own register.
const PHONEME_VOWELS = {
  a: { f1: 800, f2: 1200 },
  e: { f1: 600, f2: 1800 },
  i: { f1: 300, f2: 2200 },
  o: { f1: 500, f2:  900 },
  u: { f1: 300, f2:  900 },
};

// Consonant category drives synthesis type: noise burst, click transient, nasal resonance, or smooth tone.
const PHONEME_CONSONANT_TYPE = {
  s: 'fricative', f: 'fricative', z: 'fricative', v: 'fricative', h: 'fricative', x: 'fricative',
  b: 'stop',      p: 'stop',      d: 'stop',      t: 'stop',      g: 'stop',
  k: 'stop',      c: 'stop',      q: 'stop',
  m: 'nasal',     n: 'nasal',
  l: 'liquid',    r: 'liquid',    w: 'liquid',
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
    // Per-skin overrides
    this._skinVoice = null;          // overrides talkVoice when a special skin is active
    this._skinSoundOverrides = null; // maps state names → generator functions for this skin
    this._activeSkin = '';           // tracks current skin for drag/bonus animation sounds
  }

  init(settings) {
    this.reactionsEnabled = settings.get('soundReactionsEnabled') || false;
    this.talkEnabled = settings.get('soundTalkEnabled') || false;
    this.volume = settings.get('soundVolume') ?? 50;
    this.talkVoice = settings.get('soundTalkVoice') || 'mumble';

    // Apply skin-specific voice/sounds for the initially loaded skin
    const initialSkin = settings.get('selectedSkin') || 'dr-vibe-default';
    this._applyActiveSkin(initialSkin);

    this._unsubs.push(
      eventBus.on(Events.CHARACTER_STATE_CHANGED, (data) => this._onStateChanged(data)),
      eventBus.on(Events.SETTINGS_CHANGED, (data) => this._onSettingsChanged(data)),
      eventBus.on(Events.FOCUS_MODE_STARTED, () => { this.suppressed = true; }),
      eventBus.on(Events.FOCUS_MODE_ENDED, () => { this.suppressed = false; }),
      eventBus.on(Events.SKIN_ANIMATIONS_CHANGED, ({ skin }) => { this._activeSkin = skin; }),
      eventBus.on(Events.BONUS_ANIMATION_STARTED, ({ animation }) => this._onBonusAnimationStarted(animation)),
      eventBus.on(Events.WINDOW_DRAG_START, () => this._onPickup()),
    );

    console.log('SoundManager initialized (reactions:', this.reactionsEnabled, 'talk:', this.talkEnabled, 'voice:', this.talkVoice, ')');
  }

  _applyActiveSkin(skinName) {
    if (skinName === 'dog') {
      this._skinVoice = 'doggy';
      this._skinSoundOverrides = {
        alert:       (ctx, dest) => this._soundDogBark(ctx, dest),
        excited:     (ctx, dest) => this._soundDogPant(ctx, dest),
        celebrating: (ctx, dest) => this._soundDogBark(ctx, dest),
        concerned:   (ctx, dest) => this._soundDogWhimper(ctx, dest),
        tired:       (ctx, dest) => this._soundDogWhimper(ctx, dest),
      };
    } else if (skinName === 'lion') {
      this._skinVoice = 'lion';
      this._skinSoundOverrides = {
        alert:       (ctx, dest) => this._soundLionGrowl(ctx, dest),
        excited:     (ctx, dest) => this._soundLionRoar(ctx, dest),
        celebrating: (ctx, dest) => this._soundLionRoar(ctx, dest),
        concerned:   (ctx, dest) => this._soundLionGrowl(ctx, dest),
        tired:       (ctx, dest) => this._soundLionPurr(ctx, dest),
      };
    } else {
      this._skinVoice = null;
      this._skinSoundOverrides = null;
    }
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
      case 'selectedSkin':
        this._applyActiveSkin(value);
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
    // Per-skin overrides take priority
    if (this._skinSoundOverrides?.[state]) {
      return this._skinSoundOverrides[state];
    }
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

  // --- Bonus animation and pickup sound handlers ---

  // Plays a sound synchronized with a bonus animation starting.
  _onBonusAnimationStarted(animation) {
    if (!this.reactionsEnabled || this.suppressed) return;
    const now = Date.now();
    if (now - this.lastPlayTime < this.minInterval) return;

    const soundMap = {
      bark:        (ctx, dest) => this._soundDogBark(ctx, dest),
      scratchEar:  (ctx, dest) => this._soundScratch(ctx, dest),
      sniffGround: (ctx, dest) => this._soundSniff(ctx, dest),
      yawn:        (ctx, dest) => this._soundYawn(ctx, dest),
      spin:        (ctx, dest) => this._soundSpin(ctx, dest),
      pounce:      (ctx, dest) => this._soundLionRoar(ctx, dest),
      shakeMane:   (ctx, dest) => this._soundLionGrowl(ctx, dest),
    };

    const generator = soundMap[animation];
    if (!generator) return;

    this._ensureContext();
    if (!this.audioContext) return;
    this.lastPlayTime = now;
    generator(this.audioContext, this.masterGain);
  }

  // Plays a pickup/surprise sound when the character is grabbed.
  _onPickup() {
    if (!this.reactionsEnabled || this.suppressed) return;
    this._ensureContext();
    if (!this.audioContext) return;

    if (this._activeSkin === 'dog') {
      this._soundDogYelp(this.audioContext, this.masterGain);
    } else if (this._activeSkin === 'lion') {
      this._soundLionDragGrowl(this.audioContext, this.masterGain);
    }
  }

  // --- Bonus animation sound generators ---

  _soundScratch(ctx, dest) {
    const now = ctx.currentTime;
    // Four quick raspy noise bursts — dry scratching texture
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.055;
      const bufSize = Math.floor(ctx.sampleRate * 0.04);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < bufSize; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufSize * 0.35));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass'; filt.frequency.value = 2200; filt.Q.value = 1;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      noise.connect(filt); filt.connect(gain); gain.connect(dest);
      noise.start(t);
    }
  }

  _soundSniff(ctx, dest) {
    const now = ctx.currentTime;
    // Two quick nasal inhale bursts
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.15;
      const bufSize = Math.floor(ctx.sampleRate * 0.1);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < bufSize; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.sin((j / bufSize) * Math.PI);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      noise.connect(filt); filt.connect(gain); gain.connect(dest);
      noise.start(t);
    }
  }

  _soundYawn(ctx, dest) {
    const now = ctx.currentTime;
    // Slow sawtooth that rises then falls — open-mouthed lion yawn
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 700; filt.Q.value = 1.5;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.linearRampToValueAtTime(130, now + 0.4);
    osc.frequency.linearRampToValueAtTime(65, now + 0.9);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.15);
    gain.gain.setValueAtTime(0.22, now + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 1.05);
  }

  _soundSpin(ctx, dest) {
    const now = ctx.currentTime;
    // Quick ascending whoosh — velocity and joy
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(1100, now + 0.18);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.22);
  }

  _soundDogYelp(ctx, dest) {
    const now = ctx.currentTime;
    // Sharp yelp — surprised by being picked up
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.13);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.16);
  }

  _soundLionDragGrowl(ctx, dest) {
    const now = ctx.currentTime;
    // Short irritated low growl — lion doesn't like being grabbed
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 400; filt.Q.value = 3;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.linearRampToValueAtTime(52, now + 0.2);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 28; lfoGain.gain.value = 11;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.26); lfo.stop(now + 0.26);
  }

  // --- Public: Animalese-style talk noise for speech bubbles ---
  // Parses the actual text into phoneme descriptors (vowels, fricatives, stops,
  // nasals, liquids) and synthesizes each one distinctly, so "hello" sounds
  // different from "goodbye" — vowel brightness, consonant texture, and sentence
  // intonation (rising for questions, falling for statements) all emerge from
  // the real characters in the text, not from a random syllable count.
  playChatNoise(text) {
    if (!this.talkEnabled || this.suppressed) return;
    this._ensureContext();
    if (!this.audioContext) return;

    const preset = VOICE_PRESETS[this._skinVoice || this.talkVoice] || VOICE_PRESETS.mumble;
    const ctx = this.audioContext;
    const dest = this.masterGain;
    const now = ctx.currentTime;

    const phonemes = this._textToPhonemeSequence(text, preset);
    if (!phonemes || !phonemes.length) return;

    // Cap at 20 phonemes to keep oscillator count reasonable
    const sequence = phonemes.slice(0, 20);
    const gap = preset.gapMs / 1000;

    // Shared lowpass filter for warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = preset.filterFreq;
    filter.Q.value = preset.filterQ;
    filter.connect(dest);

    let cursor = 0;

    for (let i = 0; i < sequence.length; i++) {
      const ph = sequence[i];
      // Micro-pause at word boundaries — gives rhythm without breaking flow
      const wordPause = ph.wordBreak ? 0.006 : 0;
      const start = now + cursor + wordPause;
      cursor += ph.dur + gap + wordPause;

      const baseFreq = Math.max(20, ph.f1 * ph.pitchMult);
      const gainAmt  = 0.15 * (ph.gainMult || 1.0);

      if (ph.type === 'fricative') {
        // High-pass filtered noise burst — 's', 'f', 'z', 'v', 'h', 'x'
        const bufSize = Math.floor(ctx.sampleRate * ph.dur);
        if (bufSize < 1) continue;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let j = 0; j < bufSize; j++) {
          data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufSize * 0.7));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        const hpFilt = ctx.createBiquadFilter();
        hpFilt.type = 'highpass';
        hpFilt.frequency.value = Math.min(preset.filterFreq * 1.4, 5000);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(gainAmt * 0.8, start);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, start + ph.dur);
        noise.connect(hpFilt); hpFilt.connect(noiseGain); noiseGain.connect(dest);
        noise.start(start);

      } else if (ph.type === 'stop') {
        // 5ms silence gap then a sharp transient — 'b', 'p', 't', 'd', 'g', 'k'
        const clickStart = start + 0.005;
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = preset.waves[i % preset.waves.length];
        osc.frequency.setValueAtTime(baseFreq * 1.3, clickStart);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.75, clickStart + ph.dur);
        oscGain.gain.setValueAtTime(0, clickStart);
        oscGain.gain.linearRampToValueAtTime(gainAmt * 0.9, clickStart + 0.004);
        oscGain.gain.exponentialRampToValueAtTime(0.001, clickStart + ph.dur);
        osc.connect(oscGain); oscGain.connect(filter);
        osc.start(clickStart); osc.stop(clickStart + ph.dur + 0.005);

      } else if (ph.type === 'nasal') {
        // Bandpass-resonant triangle wave — 'm', 'n' — nasal cavity resonance
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        const nasalFilt = ctx.createBiquadFilter();
        nasalFilt.type = 'bandpass';
        nasalFilt.frequency.value = Math.min(baseFreq * 0.75, 350);
        nasalFilt.Q.value = 6;
        osc.type = 'triangle';
        osc.frequency.value = baseFreq * 0.7;
        oscGain.gain.setValueAtTime(0, start);
        oscGain.gain.linearRampToValueAtTime(gainAmt * 0.75, start + ph.dur * 0.12);
        oscGain.gain.exponentialRampToValueAtTime(0.001, start + ph.dur);
        osc.connect(nasalFilt); nasalFilt.connect(oscGain); oscGain.connect(dest);
        osc.start(start); osc.stop(start + ph.dur + 0.005);

      } else {
        // Vowel / liquid / generic — tonal F1 oscillator + F2 bandpass resonance for vowels
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = preset.waves[i % preset.waves.length];

        // Pitch arc: slight rise then fall over the syllable
        osc.frequency.setValueAtTime(baseFreq, start);
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, baseFreq * (1.0 + (ph.pitchMult - 1) * 0.25 + 0.02)),
          start + ph.dur * 0.55
        );
        osc.frequency.linearRampToValueAtTime(
          Math.max(20, baseFreq * 0.96),
          start + ph.dur
        );

        // F2 second-formant resonance — only for true vowels
        if (ph.type === 'vowel') {
          const osc2 = ctx.createOscillator();
          const osc2Gain = ctx.createGain();
          const f2Filt = ctx.createBiquadFilter();
          f2Filt.type = 'bandpass';
          f2Filt.frequency.value = ph.f2 * ph.pitchMult;
          f2Filt.Q.value = 4;
          osc2.type = 'sine';
          osc2.frequency.value = ph.f2 * ph.pitchMult;
          osc2Gain.gain.setValueAtTime(0, start);
          osc2Gain.gain.linearRampToValueAtTime(gainAmt * 0.35, start + ph.dur * 0.1);
          osc2Gain.gain.exponentialRampToValueAtTime(0.001, start + ph.dur);
          osc2.connect(f2Filt); f2Filt.connect(osc2Gain); osc2Gain.connect(filter);
          osc2.start(start); osc2.stop(start + ph.dur + 0.005);
        }

        // Vibrato LFO
        if (preset.vibrato > 0) {
          const lfo = ctx.createOscillator();
          const lfoGain = ctx.createGain();
          lfo.type = 'sine';
          lfo.frequency.value = preset.vibrato;
          lfoGain.gain.value = preset.vibratoDepth;
          lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
          lfo.start(start); lfo.stop(start + ph.dur + 0.005);
        }

        // Amplitude envelope
        const attack = ph.dur * 0.1;
        oscGain.gain.setValueAtTime(0, start);
        oscGain.gain.linearRampToValueAtTime(gainAmt, start + attack);
        oscGain.gain.setValueAtTime(gainAmt * 0.82, start + ph.dur * 0.6);
        oscGain.gain.exponentialRampToValueAtTime(0.001, start + ph.dur);
        osc.connect(oscGain); oscGain.connect(filter);
        osc.start(start); osc.stop(start + ph.dur + 0.005);
      }
    }
  }

  // Converts a text string into an ordered array of phoneme descriptors.
  // Each descriptor drives one synthesis event in playChatNoise:
  //   { type, f1, f2, dur, pitchMult, gainMult, wordBreak }
  _textToPhonemeSequence(text, preset) {
    const raw = (text || '').trim();
    if (!raw) return null;

    // Detect sentence contour from trailing punctuation before stripping
    const tail = raw.slice(-5);
    let contour = 'flat';
    if (tail.includes('?'))                         contour = 'question';
    else if (tail.includes('!'))                    contour = 'exclaim';
    else if (tail.includes('.') || tail.includes(',')) contour = 'fall';

    // Strip to letters and spaces only
    const str = raw.toLowerCase().replace(/[^a-z ]/g, '');
    if (!str.trim()) return null;

    // Scale formant frequencies to this preset's register.
    // mumble (350Hz) is the reference — other presets scale proportionally,
    // preserving vowel contrast (i vs a) across all character voices.
    const scale   = preset.baseFreq / 350;
    const sylDur  = preset.syllableMs / 1000;
    const phonemes = [];
    let prevWasSpace = true; // treat start-of-text like a word boundary

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === ' ') { prevWasSpace = true; continue; }

      const wordBreak = prevWasSpace && phonemes.length > 0;
      prevWasSpace = false;

      if (PHONEME_VOWELS[ch]) {
        const v = PHONEME_VOWELS[ch];
        phonemes.push({
          type: 'vowel',
          f1: v.f1 * scale,
          // Cap F2 just below the filter cutoff so it doesn't get rolled off
          f2: Math.min(v.f2 * scale, preset.filterFreq * 0.92),
          dur: sylDur,
          pitchMult: 1.0,
          gainMult:  1.0,
          wordBreak,
        });
      } else {
        const ctype = PHONEME_CONSONANT_TYPE[ch] || 'generic';
        // Consonants are shorter than full vowels; stops are shortest
        const durScale = ctype === 'stop' ? 0.35 : ctype === 'fricative' ? 0.4 : 0.65;
        phonemes.push({
          type: ctype,
          f1: preset.baseFreq,
          f2: preset.baseFreq * 1.8,
          dur: sylDur * durScale,
          pitchMult: 1.0,
          gainMult:  ctype === 'nasal' ? 0.70 : ctype === 'liquid' ? 0.85 : 0.75,
          wordBreak,
        });
      }
    }

    if (!phonemes.length) return null;

    // Apply sentence-level pitch contour to the final 3 phonemes
    const tailCount = Math.min(3, phonemes.length);
    for (let i = 0; i < tailCount; i++) {
      const ph = phonemes[phonemes.length - tailCount + i];
      const t = tailCount > 1 ? i / (tailCount - 1) : 1; // 0 → 1 over the tail
      if (contour === 'question') {
        ph.pitchMult = 1.0 + t * 0.45;           // rising inflection
      } else if (contour === 'fall') {
        ph.pitchMult = 1.0 - t * 0.18;           // gentle falling close
      } else if (contour === 'exclaim') {
        ph.pitchMult = 1.1 + t * 0.2;            // punchy spike
        ph.gainMult  = (ph.gainMult || 1) * 1.25;
      }
    }

    return phonemes;
  }

  // --- Animal reaction sounds ---

  _soundDogBark(ctx, dest) {
    const now = ctx.currentTime;
    // Sharp noise burst (the attack "b") followed by a tonal vowel ("ark")
    const bufSize = Math.floor(ctx.sampleRate * 0.018);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    noise.connect(noiseGain); noiseGain.connect(dest);
    noise.start(now);

    // Tonal bark body — sharp rise then drop
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(580, now + 0.015);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.12);
    gain.gain.setValueAtTime(0, now + 0.015);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 2;
    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now + 0.015); osc.stop(now + 0.14);
  }

  _soundDogWhimper(ctx, dest) {
    const now = ctx.currentTime;
    // Two descending whine notes — "the sad puppy"
    [0, 0.14].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900 - i * 80, now + offset);
      osc.frequency.exponentialRampToValueAtTime(600 - i * 60, now + offset + 0.12);
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.13);
      osc.connect(gain); gain.connect(dest);
      osc.start(now + offset); osc.stop(now + offset + 0.14);
    });
  }

  _soundDogPant(ctx, dest) {
    const now = ctx.currentTime;
    // Three quick breathy bursts
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.09;
      const bufSize = Math.floor(ctx.sampleRate * 0.06);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < bufSize; j++) data[j] = (Math.random() * 2 - 1) * Math.sin((j / bufSize) * Math.PI);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 1200; filt.Q.value = 1.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      noise.connect(filt); filt.connect(gain); gain.connect(dest);
      noise.start(t);
    }
  }

  _soundLionRoar(ctx, dest) {
    const now = ctx.currentTime;
    // Deep rumble that builds then opens up
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 500; filt.Q.value = 3;

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.linearRampToValueAtTime(90, now + 0.1);
    osc.frequency.linearRampToValueAtTime(75, now + 0.35);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(120, now);
    osc2.frequency.linearRampToValueAtTime(85, now + 0.35);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.06);
    gain.gain.setValueAtTime(0.38, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    // LFO for growling texture
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 28;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

    osc.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now); osc2.start(now); lfo.start(now);
    osc.stop(now + 0.42); osc2.stop(now + 0.42); lfo.stop(now + 0.42);
  }

  _soundLionGrowl(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 4;

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.linearRampToValueAtTime(55, now + 0.22);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 22;
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.04);
    gain.gain.setValueAtTime(0.28, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.28); lfo.stop(now + 0.28);
  }

  _soundLionPurr(ctx, dest) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 350; filt.Q.value = 2;

    osc.type = 'triangle';
    osc.frequency.value = 28; // sub-bass rumble for purr

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 26; // purr cycle at 26Hz
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.setValueAtTime(0.18, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.37); lfo.stop(now + 0.37);
  }

  destroy() {
    for (const unsub of this._unsubs) {
      if (typeof unsub === 'function') unsub();
    }
    this._unsubs = [];
    this._closeContext();
  }
}
