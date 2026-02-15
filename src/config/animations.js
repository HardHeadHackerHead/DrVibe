// Dr. Vibe - Animation configuration

export const SPRITE_CONFIG = {
  frameWidth: 32,
  frameHeight: 32,
  scale: 4,
  skinsDir: 'assets/sprites/skins/',
  defaultSkin: 'dr-vibe-default',
  getSkinPath(skinName) {
    return `${this.skinsDir}${skinName}.png`;
  },
};

// Animation definitions with behavior metadata.
// behavior: 'loop' | 'autoRevert' | 'timeoutToIdle' | 'oneShot'
//   loop          — play forever, no auto-revert
//   autoRevert    — play for `duration` ms, then revert to contextual state
//   timeoutToIdle — play for `duration` ms, then revert to idle
//   oneShot       — play once through frames, then stop
//
// frameDurations (optional): per-frame timing array.  When present, overrides
//   the scalar `frameDuration` so key poses can be held longer and in-betweens
//   can snap through quickly (the classic "timing & spacing" principle).
export const ANIMATIONS = {
  idle:        { row: 0, frameCount: 3, frameDuration: 300, frameDurations: [400, 200, 400],
                 behavior: 'loop', placeholderColor: '#4a90d9' },
  coding:      { row: 1, frameCount: 4, frameDuration: 200, frameDurations: [250, 150, 250, 150],
                 behavior: 'loop', placeholderColor: '#4ade80' },
  thinking:    { row: 2, frameCount: 3, frameDuration: 400, frameDurations: [500, 300, 500],
                 behavior: 'timeoutToIdle', placeholderColor: '#facc15', duration: 120000 },
  tired:       { row: 3, frameCount: 3, frameDuration: 500, frameDurations: [600, 400, 600],
                 behavior: 'loop', placeholderColor: '#9ca3af' },
  excited:     { row: 4, frameCount: 4, frameDuration: 150, frameDurations: [120, 100, 120, 180],
                 behavior: 'autoRevert', placeholderColor: '#f472b6', duration: 3000 },
  alert:       { row: 5, frameCount: 3, frameDuration: 250, frameDurations: [300, 180, 300],
                 behavior: 'loop', placeholderColor: '#f87171' },
  libraryCard: { row: 9, frameCount: 4, frameDuration: 250, frameDurations: [350, 200, 300, 350],
                 behavior: 'autoRevert', placeholderColor: '#fbbf24', duration: 5000 },
  presenting:  { row: 15, frameCount: 3, frameDuration: 350, frameDurations: [300, 250, 500],
                 behavior: 'oneShot', placeholderColor: '#2dd4bf' },
  concerned:   { row: 14, frameCount: 3, frameDuration: 400, frameDurations: [500, 300, 500],
                 behavior: 'loop', placeholderColor: '#f59e0b' },
  focused:     { row: 13, frameCount: 2, frameDuration: 600, frameDurations: [700, 500],
                 behavior: 'loop', placeholderColor: '#6366f1' },
  coverEyes:   { row: 11, frameCount: 3, frameDuration: 400, frameDurations: [350, 500, 350],
                 behavior: 'loop', placeholderColor: '#a78bfa' },
  thumbsUp:    { row: 10, frameCount: 3, frameDuration: 300, frameDurations: [200, 250, 450],
                 behavior: 'autoRevert', placeholderColor: '#4ade80', duration: 5000, loop: false },
  celebrating: { row: 12, frameCount: 4, frameDuration: 150, frameDurations: [180, 120, 120, 200],
                 behavior: 'autoRevert', placeholderColor: '#f472b6', duration: 2000, loop: false },
  beaker:      { row: 8,  frameCount: 3, frameDuration: 350, frameDurations: [300, 350, 450],
                 behavior: 'autoRevert', placeholderColor: '#67e8f9', duration: 5000 },
  stretching:  { row: 7,  frameCount: 4, frameDuration: 300, frameDurations: [250, 200, 400, 350],
                 behavior: 'loop', placeholderColor: '#f97316' },
  walkRight:   { row: 6,  frameCount: 4, frameDuration: 150, behavior: 'loop', placeholderColor: '#60a5fa' },
  walkLeft:    { row: 6,  frameCount: 4, frameDuration: 150, behavior: 'loop', placeholderColor: '#60a5fa', flipH: true },
};

// Transition restrictions (default-allow model).
// If a state is not listed here, it can be entered from any other state.
// allowedFrom: only these source states may transition into this state.
export const TRANSITION_RESTRICTIONS = {
  thinking: { allowedFrom: ['idle', 'coding', 'excited', 'libraryCard', 'celebrating', 'tired', 'alert'] },
  walkRight: { allowedFrom: ['idle'] },
  walkLeft:  { allowedFrom: ['idle'] },
};

// Timing constants for non-animation concerns only.
export const TIMING = {
  activityPollMs: 3000,          // 3 seconds
  idleAfterCodingMs: 30000,      // 30 seconds
  stretchingDurationMs: 10000,   // 10 seconds (matches posture countdown)
};

// ---------------------------------------------------------------------------
// Dynamic animation effects — applied as real-time canvas transforms on top
// of the sprite frames for fluid, organic motion.
// ---------------------------------------------------------------------------

// Per-animation squash & stretch profiles.
// scaleX/scaleY are multiplicative modifiers applied every frame using a sine
// wave keyed to the animation's own frame index.
export const SQUASH_STRETCH = {
  idle:        { scaleX: 0.01,  scaleY: 0.02,  speed: 0.8  },  // gentle breathing
  coding:      { scaleX: 0.005, scaleY: 0.01,  speed: 1.2  },  // subtle typing pulse
  thinking:    { scaleX: 0.008, scaleY: 0.015, speed: 0.6  },  // slow pondering
  tired:       { scaleX: 0.005, scaleY: 0.025, speed: 0.4  },  // heavy breathing
  excited:     { scaleX: 0.03,  scaleY: 0.06,  speed: 3.0  },  // bouncy
  alert:       { scaleX: 0.02,  scaleY: 0.03,  speed: 2.0  },  // vibrating urgency
  celebrating: { scaleX: 0.04,  scaleY: 0.08,  speed: 3.5  },  // exaggerated bounce
  focused:     { scaleX: 0.003, scaleY: 0.008, speed: 0.5  },  // very calm
  concerned:   { scaleX: 0.01,  scaleY: 0.015, speed: 1.0  },  // nervous energy
  stretching:  { scaleX: 0.02,  scaleY: 0.04,  speed: 1.5  },  // full body stretch
  beaker:      { scaleX: 0.01,  scaleY: 0.015, speed: 1.0  },  // gentle sway
  libraryCard: { scaleX: 0.008, scaleY: 0.012, speed: 0.8  },  // calm presentation
  thumbsUp:    { scaleX: 0.015, scaleY: 0.025, speed: 1.5  },  // confident bob
  presenting:  { scaleX: 0.01,  scaleY: 0.02,  speed: 1.0  },  // steady
  coverEyes:   { scaleX: 0.005, scaleY: 0.01,  speed: 0.7  },  // tight, tense
  walkRight:   { scaleX: 0.015, scaleY: 0.03,  speed: 2.5  },  // walk bounce
  walkLeft:    { scaleX: 0.015, scaleY: 0.03,  speed: 2.5  },  // walk bounce
};

// Idle micro-movement configuration.
// These are layered on top of the squash/stretch when the character is in
// specific resting states (idle, coding, thinking, focused, tired).
export const IDLE_MICRO_MOTION = {
  breathing: {
    scaleY: 0.018,       // amplitude of the Y breathing oscillation
    period: 3000,        // ms for one full breath cycle
  },
  sway: {
    offsetX: 0.8,        // max pixels of horizontal sway (at render scale)
    period: 5000,        // ms for one full sway cycle
  },
  blink: {
    minInterval: 2500,   // ms minimum between blinks
    maxInterval: 6000,   // ms maximum between blinks
    duration: 120,       // ms the eyes stay closed
  },
};

// Transition effect settings — brief squash/stretch played when switching
// between character states for organic feel.
export const TRANSITION_EFFECT = {
  duration: 180,         // ms for the full squash→stretch→settle sequence
  squashScaleY: 0.88,    // Y scale at deepest squash (< 1 = compressed)
  squashScaleX: 1.12,    // X scale at deepest squash (> 1 = widened)
  stretchScaleY: 1.06,   // Y scale at peak stretch
  stretchScaleX: 0.96,   // X scale at peak stretch
};

// Shadow configuration.
export const SHADOW_CONFIG = {
  baseWidth: 0.5,        // fraction of canvas width
  baseHeight: 3,         // pixels (at render scale)
  baseAlpha: 0.15,       // base opacity
  yPosition: 0.92,       // fraction of canvas height for shadow Y
  breathScale: 0.04,     // how much shadow width oscillates with breathing
  bounceScale: 0.12,     // how much shadow changes with squash/stretch
};

// Random idle personality flourishes.
// These trigger at random intervals while in idle/resting states.
export const IDLE_FLOURISHES = {
  enabled: true,
  minInterval: 20000,    // ms minimum between flourishes
  maxInterval: 50000,    // ms maximum between flourishes
  actions: [
    { name: 'lookAround',    weight: 3, duration: 1200 },  // eyes shift L→R→center
    { name: 'adjustGoggles',  weight: 2, duration: 800  },  // small head tilt + squash
    { name: 'tapFoot',        weight: 2, duration: 1500 },  // rhythmic Y bounce
    { name: 'smallWave',      weight: 1, duration: 1000 },  // brief hand raise
  ],
};
