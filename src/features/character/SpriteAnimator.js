// Dr. Vibe - Sprite Animation System
// Enhanced with squash/stretch, breathing, sway, blink, shadow, transition
// effects, per-frame timing, and idle personality flourishes.

import { eventBus, Events } from '../../core/EventBus.js';
import {
  SPRITE_CONFIG,
  ANIMATIONS,
  SQUASH_STRETCH,
  IDLE_MICRO_MOTION,
  TRANSITION_EFFECT,
  IDLE_FLOURISHES,
} from '../../config/animations.js';
import {
  BASE_SKIN_PALETTE,
  SKIN_TONE_CATEGORIES,
  SKIN_TONE_PRESETS,
  getDefaultTone,
} from '../../config/skinTones.js';

// States that receive idle micro-movements (breathing, sway, blink).
const IDLE_STATES = new Set(['idle', 'coding', 'thinking', 'focused', 'tired', 'concerned']);

// Enhanced color palette — richer, warmer, more depth than plain rectangles.
const PAL = {
  skin:       '#fdd8b0',   // warm golden skin
  skinShade:  '#e8b888',   // cheek/side shadow
  skinDark:   '#d4a878',   // neck shadow, deep creases
  hair:       '#b8b8c8',   // silver with blue tint
  hairHi:     '#d0d0dc',   // silver highlights
  hairDk:     '#9898a8',   // hair shadow
  coat:       '#f5f5fa',   // ghost white lab coat
  coatShade:  '#dde0ea',   // cool shadow fold
  coatDark:   '#c0c4d0',   // deep fold / hem
  eye:        '#2a2a3a',   // near-black pupils
  eyeHi:      '#ffffff',   // eye highlight sparkle
  gogFrame:   '#3a3a4a',   // dark goggle frames
  gogLens:    '#5ce0ff',   // bright cyan lenses
  gogGlint:   '#a0f0ff',   // lens highlight
  mouth:      '#c07060',   // warm lip color
  mouthOpen:  '#8b4040',   // open mouth interior
  pants:      '#3a3a50',   // dark blue-gray
  pantsHi:    '#4a4a60',   // slight trouser highlight
  shoes:      '#2a2a35',   // dark shoes
  shoeHi:     '#3a3a45',   // shoe highlight
};

// Easing helpers
function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
function easeOutBack(t) { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

export class SpriteAnimator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frameWidth = SPRITE_CONFIG.frameWidth;
    this.frameHeight = SPRITE_CONFIG.frameHeight;
    this.scale = SPRITE_CONFIG.scale;

    // Set canvas size based on scale
    this.canvas.width = this.frameWidth * this.scale;
    this.canvas.height = this.frameHeight * this.scale;

    // Disable image smoothing for crisp pixel art
    this.ctx.imageSmoothingEnabled = false;

    this.spriteSheet = null;
    this.frames = {};  // Pre-sliced frame canvases keyed by animation name
    this.animations = {};
    this.currentAnimation = null;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.isPlaying = false;
    this.loop = true;
    this.needsRender = true;

    this.onComplete = null;

    // --- Effect state ---
    this.effectTime = 0;           // continuous time accumulator (ms)
    this.transform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

    // Blink
    this._blinkTimer = this._randomBlinkInterval();
    this._blinkActive = false;
    this._blinkElapsed = 0;

    // Transition squash/stretch
    this._transitionActive = false;
    this._transitionElapsed = 0;
    this._transitionDuration = TRANSITION_EFFECT.duration;

    // Idle flourishes
    this._flourishTimer = this._randomFlourishInterval();
    this._activeFlourish = null;
    this._flourishElapsed = 0;

    // Screen shake (set externally, e.g. by CelebrationEffect)
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;

    // Skin tone palette swap
    this._skinTone = 'medium-light';
    this._skinSwapMap = null;
  }

  async init(skinName, skinTone) {
    // Load animations from config
    for (const [name, config] of Object.entries(ANIMATIONS)) {
      this.defineAnimation(name, config.row, config.frameCount, config.frameDuration, config.frameDurations);
    }

    // Store initial skin tone
    this._skinTone = skinTone || 'default';

    // Load the selected skin (or default)
    const skin = skinName || SPRITE_CONFIG.defaultSkin;
    await this.loadSkin(skin);

    // Listen for skin and skin tone changes at runtime
    eventBus.on(Events.SETTINGS_CHANGED, ({ key, value }) => {
      if (key === 'selectedSkin') {
        this.loadSkin(value);
      } else if (key === 'selectedSkinTone') {
        this._skinTone = value;
        this._skinSwapMap = null; // invalidate cached map
        this.preSliceFrames();
        this.needsRender = true;
      }
    });
  }

  // Load a skin by name — loads from skins directory, falls back to procedural
  async loadSkin(skinName) {
    this._currentSkin = skinName;
    this._skinSwapMap = null; // invalidate cached swap map for new skin
    const path = SPRITE_CONFIG.getSkinPath(skinName);
    await this._loadSpriteSheetFromPath(path);
    this.preSliceFrames();
    this.needsRender = true;
    console.log(`Skin loaded: ${skinName}`);
  }

  // Build a Map of base skin RGB → target tone RGB for palette swapping.
  // Returns null if no swap is needed (tone matches base or category is 'none').
  _buildSkinSwapMap() {
    if (this._skinSwapMap !== undefined && this._skinSwapMap !== null) return this._skinSwapMap;

    const category = SKIN_TONE_CATEGORIES[this._currentSkin] || 'none';
    if (category === 'none') { this._skinSwapMap = null; return null; }

    const presets = SKIN_TONE_PRESETS[category];
    if (!presets) { this._skinSwapMap = null; return null; }

    // Find the preset — fall back to the first one in the category
    const toneKey = this._skinTone || getDefaultTone(this._currentSkin);
    const preset = presets[toneKey] || presets[Object.keys(presets)[0]];
    if (!preset) { this._skinSwapMap = null; return null; }

    const base = BASE_SKIN_PALETTE;
    const pack = (r, g, b) => (r << 16) | (g << 8) | b;

    // Skip swap if the preset matches the base palette exactly
    if (preset.skin[0] === base.skin[0] && preset.skin[1] === base.skin[1] && preset.skin[2] === base.skin[2]) {
      this._skinSwapMap = null;
      return null;
    }

    const map = new Map();
    map.set(pack(...base.skin), preset.skin);
    map.set(pack(...base.skinShade), preset.skinShade);
    map.set(pack(...base.skinDark), preset.skinDark);

    this._skinSwapMap = map;
    return map;
  }

  async _loadSpriteSheetFromPath(path) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.spriteSheet = img;
        console.log(`Sprite sheet loaded: ${path}`);
        resolve();
      };
      img.onerror = () => {
        console.log(`Sprite sheet not found, using placeholder: ${path}`);
        this.createPlaceholderSprites();
        resolve();
      };
      img.src = path;
    });
  }

  // Extract every frame into its own canvas using getImageData (pixel-perfect,
  // no interpolation). Clear the top and bottom pixel rows of each frame to
  // eliminate any content that bleeds across row boundaries in the spritesheet.
  preSliceFrames() {
    if (!this.spriteSheet) return;

    // Stamp the full spritesheet onto a temp canvas so we can read pixel data
    const tempCanvas = document.createElement('canvas');
    const w = this.spriteSheet.naturalWidth || this.spriteSheet.width;
    const h = this.spriteSheet.naturalHeight || this.spriteSheet.height;
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCtx.drawImage(this.spriteSheet, 0, 0);

    for (const [name, anim] of Object.entries(this.animations)) {
      this.frames[name] = [];
      for (let i = 0; i < anim.frameCount; i++) {
        const srcX = i * this.frameWidth;
        const srcY = anim.row * this.frameHeight;

        // getImageData gives exact pixel values — zero interpolation
        const imageData = tempCtx.getImageData(srcX, srcY, this.frameWidth, this.frameHeight);
        const data = imageData.data;
        const stride = this.frameWidth * 4;

        // Apply skin tone palette swap (if a non-default tone is selected)
        const swapMap = this._buildSkinSwapMap();
        if (swapMap) {
          for (let p = 0; p < data.length; p += 4) {
            if (data[p + 3] === 0) continue; // skip transparent
            const key = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
            const replacement = swapMap.get(key);
            if (replacement) {
              data[p]     = replacement[0];
              data[p + 1] = replacement[1];
              data[p + 2] = replacement[2];
            }
          }
        }

        // Clear top 3 pixel rows (removes bleed from the row above)
        const topRowsToClear = 3;
        for (let row = 0; row < topRowsToClear; row++) {
          const rowStart = row * stride;
          for (let b = rowStart; b < rowStart + stride; b++) data[b] = 0;
        }

        // Clear bottom pixel rows (removes bleed into the row below)
        const bottomRowsToClear = 4;
        for (let row = 0; row < bottomRowsToClear; row++) {
          const rowStart = (this.frameHeight - 1 - row) * stride;
          for (let b = rowStart; b < rowStart + stride; b++) data[b] = 0;
        }

        // Write the cleaned data into an isolated frame canvas
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = this.frameWidth;
        frameCanvas.height = this.frameHeight;
        const frameCtx = frameCanvas.getContext('2d');
        frameCtx.putImageData(imageData, 0, 0);

        // If this animation has flipH, mirror the frame horizontally
        const config = ANIMATIONS[name];
        if (config && config.flipH) {
          const flippedCanvas = document.createElement('canvas');
          flippedCanvas.width = this.frameWidth;
          flippedCanvas.height = this.frameHeight;
          const flippedCtx = flippedCanvas.getContext('2d');
          flippedCtx.translate(this.frameWidth, 0);
          flippedCtx.scale(-1, 1);
          flippedCtx.drawImage(frameCanvas, 0, 0);
          this.frames[name].push(flippedCanvas);
        } else {
          this.frames[name].push(frameCanvas);
        }
      }
    }

    console.log('Sprite frames pre-sliced');
  }

  createPlaceholderSprites() {
    const animEntries = Object.entries(this.animations);
    const maxCols = Math.max(...animEntries.map(([, a]) => a.frameCount));
    const rows = Math.max(...animEntries.map(([, a]) => a.row)) + 1;

    const placeholderCanvas = document.createElement('canvas');
    placeholderCanvas.width = this.frameWidth * maxCols;
    placeholderCanvas.height = this.frameHeight * rows;

    const ctx = placeholderCanvas.getContext('2d');

    for (const [name, anim] of animEntries) {
      const config = ANIMATIONS[name];
      const color = config.placeholderColor || '#888888';
      for (let col = 0; col < anim.frameCount; col++) {
        this.drawPlaceholderCharacter(ctx, col, anim.row, color, anim.row);
      }
    }

    this.spriteSheet = placeholderCanvas;
    console.log('Placeholder sprites created');
  }

  // -----------------------------------------------------------------------
  // Drawing helpers — shared character parts for consistent proportions.
  //
  // NEW CHARACTER LAYOUT (from baseY):
  //   +0      hair spike tips
  //   +1      hair main volume
  //   +2      head top / goggle strap
  //   +3-4    goggle frames & lenses (with glint)
  //   +5      forehead skin
  //   +6      brow area
  //   +7-8    EYES (2px tall)
  //   +9      cheek / nose
  //   +10-11  mouth area
  //   +12     chin / neck
  //   +13     collar / shoulders
  //   +14-20  lab coat body (7px)
  //   +21-23  legs (3px dark pants)
  //   +24     shoes
  //   +25     ground shadow
  //   +26-27  state glow
  // -----------------------------------------------------------------------

  // Draw the full base body shared by all standing states.
  // Omits face (eyes/mouth/brows) and arms — those are state-specific.
  _drawCharBase(ctx, x, by, color, gogglesDown = false) {
    // --- Shoes ---
    ctx.fillStyle = PAL.shoes;
    ctx.fillRect(x + 11, by + 24, 4, 1);   // left
    ctx.fillRect(x + 17, by + 24, 4, 1);   // right
    ctx.fillStyle = PAL.shoeHi;
    ctx.fillRect(x + 11, by + 24, 1, 1);   // left highlight
    ctx.fillRect(x + 17, by + 24, 1, 1);   // right highlight

    // --- Legs (dark trousers) ---
    ctx.fillStyle = PAL.pants;
    ctx.fillRect(x + 12, by + 21, 3, 3);   // left
    ctx.fillRect(x + 17, by + 21, 3, 3);   // right
    ctx.fillStyle = PAL.pantsHi;
    ctx.fillRect(x + 12, by + 21, 1, 2);   // left crease highlight
    ctx.fillRect(x + 17, by + 21, 1, 2);   // right crease highlight

    // --- Lab coat body ---
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 9, by + 13, 14, 8);   // main coat
    // Collar V-shape
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 14, by + 13, 1, 2);
    ctx.fillRect(x + 17, by + 13, 1, 2);
    // Collar opening (skin visible)
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 15, by + 13, 2, 1);
    // Center button line
    ctx.fillStyle = PAL.coatDark;
    ctx.fillRect(x + 16, by + 15, 1, 5);
    // Left pocket
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 10, by + 16, 3, 2);
    // Lower coat shadow
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 9, by + 18, 14, 2);
    // Coat hem
    ctx.fillStyle = PAL.coatDark;
    ctx.fillRect(x + 10, by + 20, 12, 1);

    // --- Neck ---
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 14, by + 12, 4, 1);

    // --- Head ---
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 11, by + 3, 10, 9);   // main face (rows 3-11)
    // Cheek shadows (sides of face)
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 11, by + 6, 1, 5);
    ctx.fillRect(x + 20, by + 6, 1, 5);
    // Chin definition
    ctx.fillStyle = PAL.skinDark;
    ctx.fillRect(x + 13, by + 11, 6, 1);

    // --- Hair ---
    // Spike tips (asymmetric for personality)
    ctx.fillStyle = PAL.hair;
    ctx.fillRect(x + 9,  by, 2, 1);        // left spike
    ctx.fillRect(x + 13, by, 3, 1);        // center spike (widest)
    ctx.fillRect(x + 19, by, 2, 1);        // right spike
    // Main hair volume
    ctx.fillRect(x + 9,  by + 1, 14, 1);
    // Lower hair meets head
    ctx.fillRect(x + 10, by + 2, 12, 1);
    // Highlights
    ctx.fillStyle = PAL.hairHi;
    ctx.fillRect(x + 11, by + 1, 2, 1);
    ctx.fillRect(x + 17, by + 1, 2, 1);
    // Dark edge
    ctx.fillStyle = PAL.hairDk;
    ctx.fillRect(x + 9,  by + 2, 1, 1);
    ctx.fillRect(x + 21, by + 2, 1, 1);

    // --- Goggles ---
    if (gogglesDown) {
      // Goggles pulled down OVER eyes (focused state)
      ctx.fillStyle = PAL.gogFrame;
      ctx.fillRect(x + 11, by + 7, 4, 2);
      ctx.fillRect(x + 17, by + 7, 4, 2);
      ctx.fillRect(x + 15, by + 7, 2, 1);   // bridge
      ctx.fillStyle = '#6366f1';              // indigo tint
      ctx.fillRect(x + 12, by + 7, 2, 1);
      ctx.fillRect(x + 18, by + 7, 2, 1);
      ctx.fillStyle = '#818cf8';              // lens glow
      ctx.fillRect(x + 12, by + 8, 2, 1);
      ctx.fillRect(x + 18, by + 8, 2, 1);
    } else {
      // Goggles on FOREHEAD (normal position)
      ctx.fillStyle = PAL.gogFrame;
      ctx.fillRect(x + 11, by + 3, 4, 2);
      ctx.fillRect(x + 17, by + 3, 4, 2);
      ctx.fillRect(x + 15, by + 3, 2, 1);   // bridge
      // Lenses
      ctx.fillStyle = PAL.gogLens;
      ctx.fillRect(x + 12, by + 3, 2, 1);
      ctx.fillRect(x + 18, by + 3, 2, 1);
      // Glint (1px sparkle on each lens — key detail!)
      ctx.fillStyle = PAL.gogGlint;
      ctx.fillRect(x + 12, by + 3, 1, 1);
      ctx.fillRect(x + 18, by + 3, 1, 1);
    }
  }

  // Draw eyes. style: 'normal','wide','tired','squint','lookUp','lookDown','sparkle'
  _drawEyes(ctx, x, by, style) {
    const L = x + 13;  // left eye X
    const R = x + 17;  // right eye X

    switch (style) {
      case 'normal':
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L, by + 7, 2, 2);
        ctx.fillRect(R, by + 7, 2, 2);
        ctx.fillStyle = PAL.eyeHi;
        ctx.fillRect(L, by + 7, 1, 1);
        ctx.fillRect(R, by + 7, 1, 1);
        break;

      case 'wide':
        // Taller eyes — surprise / alert
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L, by + 6, 2, 3);
        ctx.fillRect(R, by + 6, 2, 3);
        ctx.fillStyle = PAL.eyeHi;
        ctx.fillRect(L, by + 6, 1, 1);
        ctx.fillRect(R, by + 6, 1, 1);
        break;

      case 'tired':
        // Half-closed, droopy — just bottom row, no highlight
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L, by + 8, 2, 1);
        ctx.fillRect(R, by + 8, 2, 1);
        // Eyelid shadow above
        ctx.fillStyle = PAL.skinShade;
        ctx.fillRect(L, by + 7, 2, 1);
        ctx.fillRect(R, by + 7, 2, 1);
        break;

      case 'squint':
        // Happy squint ^_^ (celebrating)
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L,     by + 8, 1, 1);  // left outer low
        ctx.fillRect(L + 1, by + 7, 1, 1);  // left inner high
        ctx.fillRect(R,     by + 7, 1, 1);  // right inner high
        ctx.fillRect(R + 1, by + 8, 1, 1);  // right outer low
        break;

      case 'lookUp':
        // Shifted up — thinking / pondering
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L, by + 6, 2, 2);
        ctx.fillRect(R, by + 6, 2, 2);
        // Highlight top-right (looking up-right)
        ctx.fillStyle = PAL.eyeHi;
        ctx.fillRect(L + 1, by + 6, 1, 1);
        ctx.fillRect(R + 1, by + 6, 1, 1);
        break;

      case 'lookDown':
        // Shifted down — reading
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L, by + 8, 2, 2);
        ctx.fillRect(R, by + 8, 2, 2);
        ctx.fillStyle = PAL.eyeHi;
        ctx.fillRect(L, by + 8, 1, 1);
        ctx.fillRect(R, by + 8, 1, 1);
        break;

      case 'sparkle':
        // Extra sparkly — excited, double highlights
        ctx.fillStyle = PAL.eye;
        ctx.fillRect(L, by + 7, 2, 2);
        ctx.fillRect(R, by + 7, 2, 2);
        ctx.fillStyle = PAL.eyeHi;
        ctx.fillRect(L, by + 7, 1, 1);       // top-left
        ctx.fillRect(L + 1, by + 8, 1, 1);   // bottom-right
        ctx.fillRect(R, by + 7, 1, 1);
        ctx.fillRect(R + 1, by + 8, 1, 1);
        break;
    }
  }

  // Draw mouth. style: 'smile','grin','frown','o','neutral','open','smirk'
  _drawMouth(ctx, x, by, style) {
    switch (style) {
      case 'smile':
        // Gentle U-shape smile
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 14, by + 10, 4, 1);   // upper lip
        ctx.fillRect(x + 15, by + 11, 2, 1);   // center dips = U = smile
        break;

      case 'grin':
        // Wide open grin
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 13, by + 10, 6, 1);   // wide top
        ctx.fillStyle = PAL.mouthOpen;
        ctx.fillRect(x + 14, by + 11, 4, 1);   // open interior
        break;

      case 'frown':
        // Inverted U — sad/tired
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 14, by + 11, 4, 1);   // lower lip
        ctx.fillRect(x + 13, by + 10, 1, 1);   // left corner up
        ctx.fillRect(x + 18, by + 10, 1, 1);   // right corner up
        break;

      case 'o':
        // Small O — surprise
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 15, by + 10, 2, 1);
        ctx.fillStyle = PAL.mouthOpen;
        ctx.fillRect(x + 15, by + 11, 2, 1);
        break;

      case 'neutral':
        // Straight line — focused / calm
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 14, by + 10, 4, 1);
        break;

      case 'open':
        // Big open mouth — stretching "ahh"
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 14, by + 10, 4, 1);
        ctx.fillStyle = PAL.mouthOpen;
        ctx.fillRect(x + 14, by + 11, 4, 1);
        break;

      case 'smirk':
        // Asymmetric confident smile
        ctx.fillStyle = PAL.mouth;
        ctx.fillRect(x + 14, by + 10, 4, 1);
        ctx.fillRect(x + 17, by + 9, 1, 1);   // right corner lifted
        break;
    }
  }

  // Draw eyebrows. style: 'worried','angry','raised'
  _drawBrows(ctx, x, by, style) {
    ctx.fillStyle = PAL.eye;
    switch (style) {
      case 'worried':
        // Angled inward-down (concern)
        ctx.fillRect(x + 12, by + 5, 3, 1);
        ctx.fillRect(x + 13, by + 6, 2, 1);   // left slopes down-in
        ctx.fillRect(x + 17, by + 5, 3, 1);
        ctx.fillRect(x + 17, by + 6, 2, 1);   // right slopes down-in
        break;
      case 'raised':
        // Lifted up — surprise
        ctx.fillRect(x + 12, by + 5, 3, 1);
        ctx.fillRect(x + 17, by + 5, 3, 1);
        break;
    }
  }

  // Default arms at sides with visible hands.
  _drawArmsDown(ctx, x, by) {
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 5, by + 14, 3, 6);    // left arm
    ctx.fillRect(x + 24, by + 14, 3, 6);   // right arm
    // Hands (skin at end of sleeves)
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 5, by + 19, 3, 2);    // left hand
    ctx.fillRect(x + 24, by + 19, 3, 2);   // right hand
    // Coat sleeve shadow
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 5, by + 17, 3, 1);
    ctx.fillRect(x + 24, by + 17, 3, 1);
  }

  drawPlaceholderCharacter(ctx, col, row, color, animState) {
    const x = col * this.frameWidth;
    const y = row * this.frameHeight;

    ctx.clearRect(x, y, this.frameWidth, this.frameHeight);

    // Per-state bounce (subtle for standing, dramatic for celebrating)
    let bounce = col % 2 === 0 ? 0 : 1;
    if (animState === 12) {
      const jumpOffsets = [0, -2, -3, 0];
      bounce = jumpOffsets[col] || 0;
    } else if (animState === 4) {
      const excitedBounce = [0, -1, 0, 1];
      bounce = excitedBounce[col] || 0;
    }
    const by = y + 3 + bounce;

    // Walking — completely separate character
    if (animState === 6) {
      this.drawWalkingCharacter(ctx, x, by, col, color);
      return;
    }

    // Cover Eyes — completely separate character
    if (animState === 11) {
      this.drawCoverEyesCharacter(ctx, x, by, col, color);
      return;
    }

    // --- Draw shared base body (legs, coat, head, hair, goggles) ---
    this._drawCharBase(ctx, x, by, color, animState === 13);

    // --- State-specific face + arms ---
    switch (animState) {
      case 0: // idle
        this._drawEyes(ctx, x, by, 'normal');
        this._drawMouth(ctx, x, by, 'smile');
        this._drawArmsDown(ctx, x, by);
        break;

      case 1: { // coding
        this._drawEyes(ctx, x, by, 'normal');
        this._drawMouth(ctx, x, by, 'neutral');
        // Typing arms — alternating offset
        const armOff = col % 2 === 0 ? 0 : 1;
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 5, by + 14 + armOff, 3, 5);
        ctx.fillRect(x + 24, by + 14 - armOff, 3, 5);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 5, by + 18 + armOff, 3, 2);
        ctx.fillRect(x + 24, by + 18 - armOff, 3, 2);
        break;
      }

      case 2: // thinking
        this._drawEyes(ctx, x, by, 'lookUp');
        this._drawMouth(ctx, x, by, 'neutral');
        // Left arm at side, right hand on chin
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 5, by + 14, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 5, by + 19, 3, 2);
        // Right arm raised to chin
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 21, by + 10, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 21, by + 9, 3, 2);
        break;

      case 3: // tired
        this._drawEyes(ctx, x, by, 'tired');
        this._drawMouth(ctx, x, by, 'frown');
        // Droopy arms — slightly lower and limp
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 5, by + 15, 3, 6);
        ctx.fillRect(x + 24, by + 15, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 5, by + 20, 3, 2);
        ctx.fillRect(x + 24, by + 20, 3, 2);
        break;

      case 4: // excited
        this._drawEyes(ctx, x, by, 'sparkle');
        this._drawMouth(ctx, x, by, 'grin');
        // Arms raised outward
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 3, by + 9, 3, 7);
        ctx.fillRect(x + 26, by + 9, 3, 7);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 3, by + 8, 3, 2);
        ctx.fillRect(x + 26, by + 8, 3, 2);
        break;

      case 5: // alert
        this._drawEyes(ctx, x, by, 'wide');
        this._drawBrows(ctx, x, by, 'raised');
        this._drawMouth(ctx, x, by, 'o');
        // Arms slightly out, tense
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 4, by + 13, 3, 6);
        ctx.fillRect(x + 25, by + 13, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 4, by + 18, 3, 2);
        ctx.fillRect(x + 25, by + 18, 3, 2);
        break;

      case 7: // stretching
        this._drawEyes(ctx, x, by, 'lookUp');
        if (col >= 2) {
          this._drawMouth(ctx, x, by, 'open');
        } else {
          this._drawMouth(ctx, x, by, 'smile');
        }
        // Arms overhead — rising through frames
        if (col === 0) {
          this._drawArmsDown(ctx, x, by);
        } else if (col === 1) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 4, by + 8, 3, 8);
          ctx.fillRect(x + 25, by + 8, 3, 8);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 4, by + 7, 3, 2);
          ctx.fillRect(x + 25, by + 7, 3, 2);
        } else if (col === 2) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 6, by + 2, 3, 10);
          ctx.fillRect(x + 23, by + 2, 3, 10);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 7, by, 2, 3);
          ctx.fillRect(x + 23, by, 2, 3);
        } else {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 7, by + 2, 3, 10);
          ctx.fillRect(x + 22, by + 2, 3, 10);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 8, by, 2, 3);
          ctx.fillRect(x + 22, by, 2, 3);
        }
        break;

      case 8: // beaker
        this._drawEyes(ctx, x, by, 'normal');
        this._drawMouth(ctx, x, by, col === 2 ? 'grin' : 'smile');
        // Left arm at side
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 5, by + 14, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 5, by + 19, 3, 2);
        // Right arm holds beaker — rises through frames
        if (col === 0) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 10, 3, 7);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 24, by + 9, 3, 2);
          // Beaker at chest
          ctx.fillStyle = '#67e8f9';
          ctx.fillRect(x + 25, by + 5, 4, 5);
          ctx.fillStyle = '#e0f2fe';
          ctx.fillRect(x + 25, by + 5, 4, 1);
        } else if (col === 1) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 6, 3, 9);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 24, by + 5, 3, 2);
          // Beaker raised
          ctx.fillStyle = '#67e8f9';
          ctx.fillRect(x + 25, by + 1, 4, 5);
          ctx.fillStyle = '#e0f2fe';
          ctx.fillRect(x + 25, by + 1, 4, 1);
          // Bubbles
          ctx.fillStyle = '#a5f3fc';
          ctx.fillRect(x + 26, by, 1, 1);
          ctx.fillRect(x + 28, by + 1, 1, 1);
        } else {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 8, 5, 4);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 28, by + 8, 3, 2);
          // Beaker extended
          ctx.fillStyle = '#67e8f9';
          ctx.fillRect(x + 27, by + 3, 4, 5);
          ctx.fillStyle = '#e0f2fe';
          ctx.fillRect(x + 27, by + 3, 4, 1);
          ctx.fillStyle = '#a5f3fc';
          ctx.fillRect(x + 28, by + 1, 1, 1);
          ctx.fillRect(x + 30, by + 2, 1, 1);
        }
        break;

      case 9: // libraryCard
        this._drawEyes(ctx, x, by, col === 0 ? 'lookDown' : 'normal');
        this._drawMouth(ctx, x, by, col >= 2 ? 'grin' : 'smile');
        if (col <= 1) {
          // Both hands hold book
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 6, by + 12, 3, 5);
          ctx.fillRect(x + 23, by + 12, 3, 5);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(x + 10, by + 12, 12, 6);
          ctx.fillStyle = '#d97706';
          ctx.fillRect(x + 10, by + 17, 12, 1);
        } else {
          // Book extended
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 3, by + 10, 3, 5);
          ctx.fillRect(x + 24, by + 10, 3, 7);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 3, by + 9, 3, 2);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(x + 24, by + 3, 6, 7);
          ctx.fillStyle = '#d97706';
          ctx.fillRect(x + 24, by + 9, 6, 1);
        }
        break;

      case 10: // thumbsUp
        this._drawEyes(ctx, x, by, 'sparkle');
        this._drawMouth(ctx, x, by, 'smirk');
        // Left arm at side
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 5, by + 14, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 5, by + 19, 3, 2);
        if (col === 0) {
          // Wind-up: right arm pulled back
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 15, 3, 5);
        } else {
          // Thumbs up!
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 6, 3, 10);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 24, by + 4, 3, 3);
          ctx.fillRect(x + 25, by + 2, 2, 3);   // thumb extended
          if (col === 2) {
            // Sparkle near thumb
            ctx.fillStyle = '#facc15';
            ctx.fillRect(x + 28, by + 2, 1, 1);
            ctx.fillRect(x + 27, by + 1, 1, 1);
            ctx.fillRect(x + 29, by + 1, 1, 1);
            ctx.fillRect(x + 27, by + 3, 1, 1);
            ctx.fillRect(x + 29, by + 3, 1, 1);
          }
        }
        break;

      case 12: // celebrating
        this._drawEyes(ctx, x, by, col >= 2 ? 'squint' : 'sparkle');
        this._drawMouth(ctx, x, by, col >= 2 ? 'grin' : 'grin');
        // Rosy cheeks when celebrating
        ctx.fillStyle = '#f0a0a0';
        ctx.globalAlpha = 0.4;
        ctx.fillRect(x + 12, by + 9, 2, 1);
        ctx.fillRect(x + 18, by + 9, 2, 1);
        ctx.globalAlpha = 1;
        // Victory arms — rise through frames
        if (col === 0) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 7, by + 14, 3, 5);
          ctx.fillRect(x + 22, by + 14, 3, 5);
        } else if (col === 1) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 4, by + 8, 3, 8);
          ctx.fillRect(x + 25, by + 8, 3, 8);
        } else if (col === 2) {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 4, by + 4, 3, 9);
          ctx.fillRect(x + 25, by + 4, 3, 9);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 4, by + 2, 3, 3);
          ctx.fillRect(x + 25, by + 2, 3, 3);
        } else {
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 4, by + 5, 3, 9);
          ctx.fillRect(x + 25, by + 5, 3, 9);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 4, by + 3, 3, 3);
          ctx.fillRect(x + 25, by + 3, 3, 3);
        }
        break;

      case 13: // focused (goggles down — eyes covered by goggles in _drawCharBase)
        this._drawMouth(ctx, x, by, 'neutral');
        // Crossed arms
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 8, by + 14, 16, 3);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 6, by + 14, 3, 2);
        ctx.fillRect(x + 23, by + 14, 3, 2);
        break;

      case 14: // concerned
        this._drawEyes(ctx, x, by, 'normal');
        this._drawBrows(ctx, x, by, 'worried');
        this._drawMouth(ctx, x, by, 'frown');
        if (col === 0) {
          // Hand on chin (worried pose)
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 5, by + 14, 3, 6);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 5, by + 19, 3, 2);
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 21, by + 10, 3, 6);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 21, by + 9, 3, 2);
        } else if (col === 1) {
          // Hands clasped
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 10, by + 14, 3, 4);
          ctx.fillRect(x + 19, by + 14, 3, 4);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 13, by + 14, 6, 2);
        } else {
          // Arm reaching out
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 5, by + 14, 3, 6);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 5, by + 19, 3, 2);
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 12, 5, 3);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 28, by + 12, 3, 2);
        }
        break;

      case 15: // presenting
        this._drawEyes(ctx, x, by, 'normal');
        this._drawMouth(ctx, x, by, 'smirk');
        if (col === 0) {
          // Reaching behind
          this._drawArmsDown(ctx, x, by);
        } else if (col === 1) {
          // Revealing clipboard
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 5, by + 14, 3, 6);
          ctx.fillStyle = PAL.skin;
          ctx.fillRect(x + 5, by + 19, 3, 2);
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 24, by + 10, 3, 7);
          // Clipboard
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(x + 25, by + 3, 6, 7);
          ctx.fillStyle = PAL.coatDark;
          ctx.fillRect(x + 26, by + 5, 4, 1);
          ctx.fillRect(x + 26, by + 7, 3, 1);
        } else {
          // Display pose — clipboard held forward
          ctx.fillStyle = PAL.coat;
          ctx.fillRect(x + 6, by + 10, 3, 5);
          ctx.fillRect(x + 23, by + 10, 3, 5);
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(x + 9, by + 3, 14, 9);
          ctx.fillStyle = PAL.coatDark;
          ctx.fillRect(x + 11, by + 5, 10, 1);
          ctx.fillRect(x + 11, by + 7, 10, 1);
          ctx.fillRect(x + 11, by + 9, 7, 1);
        }
        break;

      default: // fallback — same as idle
        this._drawEyes(ctx, x, by, 'normal');
        this._drawMouth(ctx, x, by, 'smile');
        this._drawArmsDown(ctx, x, by);
        break;
    }
  }

  // Cover Eyes — Dr. Vibe covering his eyes with his hands (eye strain break)
  // Cover Eyes — uses new proportions with legs, richer palette.
  drawCoverEyesCharacter(ctx, x, by, col, color) {
    // Draw shared base (shadow, glow, shoes, legs, coat, neck, head, hair, goggles)
    this._drawCharBase(ctx, x, by, color, false);

    if (col === 0) {
      // Frame 1 — hands rising: squinting eyes, arms coming up
      // Squinting eyes
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(x + 13, by + 8, 2, 1);
      ctx.fillRect(x + 17, by + 8, 2, 1);
      // Grimace
      this._drawMouth(ctx, x, by, 'neutral');
      // Arms rising toward face
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 10, 3, 7);
      ctx.fillRect(x + 24, by + 10, 3, 7);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 7, by + 8, 3, 3);
      ctx.fillRect(x + 22, by + 8, 3, 3);

    } else if (col === 1) {
      // Frame 2 — hands fully covering eyes
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 10, by + 6, 12, 4);   // hands over eyes
      // Finger gaps
      ctx.fillStyle = PAL.skinShade;
      ctx.fillRect(x + 13, by + 6, 1, 4);
      ctx.fillRect(x + 16, by + 6, 1, 4);
      ctx.fillRect(x + 19, by + 6, 1, 4);
      // Relaxed mouth
      this._drawMouth(ctx, x, by, 'neutral');
      // Arms up to face
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 8, 5, 8);
      ctx.fillRect(x + 22, by + 8, 5, 8);

    } else {
      // Frame 3 — peeking through fingers
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 10, by + 6, 12, 4);   // hands still over eyes
      // Wider finger gaps (peeking)
      ctx.fillStyle = PAL.skinShade;
      ctx.fillRect(x + 12, by + 6, 1, 4);
      ctx.fillRect(x + 16, by + 6, 1, 4);
      ctx.fillRect(x + 20, by + 6, 1, 4);
      // Left eye peeking through gap
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(x + 13, by + 7, 2, 2);
      ctx.fillStyle = PAL.eyeHi;
      ctx.fillRect(x + 13, by + 7, 1, 1);
      // Relieved smile
      this._drawMouth(ctx, x, by, 'smile');
      // Arms up to face
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 8, 5, 8);
      ctx.fillRect(x + 22, by + 8, 5, 8);
    }
  }

  // Walking — Dr. Vibe strolling with natural gait cycle (4-frame walk: contact/pass/contact/pass)
  drawWalkingCharacter(ctx, x, baseY, col, color) {
    const isContact = col === 0 || col === 2;   // feet on ground
    const bobY = isContact ? 1 : 0;             // slight dip on contact
    const by = baseY + 3 + bobY;                // match standing baseY offset
    const leanX = isContact ? 1 : 0;            // body lean on contact

    // --- Shoes (animated stride) ---
    ctx.fillStyle = PAL.shoes;
    if (col === 0) {
      // Right foot forward, left foot back
      ctx.fillRect(x + 18 + leanX, by + 24, 4, 1);
      ctx.fillRect(x + 10 + leanX, by + 24, 3, 1);
    } else if (col === 1) {
      // Passing — feet close together
      ctx.fillRect(x + 12, by + 24, 4, 1);
      ctx.fillRect(x + 17, by + 24, 4, 1);
    } else if (col === 2) {
      // Left foot forward, right foot back
      ctx.fillRect(x + 10 + leanX, by + 24, 4, 1);
      ctx.fillRect(x + 19 + leanX, by + 24, 3, 1);
    } else {
      // Passing — feet close together
      ctx.fillRect(x + 12, by + 24, 4, 1);
      ctx.fillRect(x + 17, by + 24, 4, 1);
    }
    // Shoe highlights
    ctx.fillStyle = PAL.shoeHi;
    if (col === 0) {
      ctx.fillRect(x + 18 + leanX, by + 24, 1, 1);
      ctx.fillRect(x + 10 + leanX, by + 24, 1, 1);
    } else if (col === 2) {
      ctx.fillRect(x + 10 + leanX, by + 24, 1, 1);
      ctx.fillRect(x + 19 + leanX, by + 24, 1, 1);
    } else {
      ctx.fillRect(x + 12, by + 24, 1, 1);
      ctx.fillRect(x + 17, by + 24, 1, 1);
    }

    // --- Legs (walking stride) ---
    ctx.fillStyle = PAL.pants;
    if (col === 0) {
      // Right leg forward, left leg back
      ctx.fillRect(x + 17 + leanX, by + 21, 3, 3);
      ctx.fillRect(x + 12 + leanX, by + 21, 3, 3);
      // Crease highlights
      ctx.fillStyle = PAL.pantsHi;
      ctx.fillRect(x + 17 + leanX, by + 21, 1, 2);
    } else if (col === 1) {
      // Passing — legs together
      ctx.fillRect(x + 13, by + 21, 3, 3);
      ctx.fillRect(x + 17, by + 21, 3, 3);
      ctx.fillStyle = PAL.pantsHi;
      ctx.fillRect(x + 13, by + 21, 1, 2);
      ctx.fillRect(x + 17, by + 21, 1, 2);
    } else if (col === 2) {
      // Left leg forward, right leg back
      ctx.fillRect(x + 12 + leanX, by + 21, 3, 3);
      ctx.fillRect(x + 17 + leanX, by + 21, 3, 3);
      ctx.fillStyle = PAL.pantsHi;
      ctx.fillRect(x + 12 + leanX, by + 21, 1, 2);
    } else {
      // Passing — legs together
      ctx.fillRect(x + 13, by + 21, 3, 3);
      ctx.fillRect(x + 17, by + 21, 3, 3);
      ctx.fillStyle = PAL.pantsHi;
      ctx.fillRect(x + 13, by + 21, 1, 2);
      ctx.fillRect(x + 17, by + 21, 1, 2);
    }

    // --- Lab coat body ---
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 9 + leanX, by + 13, 14, 8);
    // Collar V-shape
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 14 + leanX, by + 13, 1, 2);
    ctx.fillRect(x + 17 + leanX, by + 13, 1, 2);
    // Collar opening (skin visible)
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 15 + leanX, by + 13, 2, 1);
    // Center button line
    ctx.fillStyle = PAL.coatDark;
    ctx.fillRect(x + 16 + leanX, by + 15, 1, 5);
    // Left pocket
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 10 + leanX, by + 16, 3, 2);
    // Lower coat shadow (sways with motion)
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 9 + leanX, by + 18, 14, 2);
    // Coat hem
    ctx.fillStyle = PAL.coatDark;
    ctx.fillRect(x + 10 + leanX, by + 20, 12, 1);

    // --- Neck ---
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 14 + leanX, by + 12, 4, 1);

    // --- Head ---
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 11 + leanX, by + 3, 10, 9);
    // Cheek shadows
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 11 + leanX, by + 6, 1, 5);
    ctx.fillRect(x + 20 + leanX, by + 6, 1, 5);
    // Chin
    ctx.fillStyle = PAL.skinDark;
    ctx.fillRect(x + 13 + leanX, by + 11, 6, 1);

    // --- Hair (bounces on contact) ---
    const hb = isContact ? 0 : -1;  // hair bounce
    ctx.fillStyle = PAL.hair;
    ctx.fillRect(x + 9 + leanX,  by + hb, 2, 1);      // left spike
    ctx.fillRect(x + 13 + leanX, by + hb, 3, 1);      // center spike
    ctx.fillRect(x + 19 + leanX, by + hb, 2, 1);      // right spike
    ctx.fillRect(x + 9 + leanX,  by + 1 + hb, 14, 1); // main volume
    ctx.fillRect(x + 10 + leanX, by + 2 + hb, 12, 1); // lower hair
    // Highlights
    ctx.fillStyle = PAL.hairHi;
    ctx.fillRect(x + 11 + leanX, by + 1 + hb, 2, 1);
    ctx.fillRect(x + 17 + leanX, by + 1 + hb, 2, 1);
    // Dark edge
    ctx.fillStyle = PAL.hairDk;
    ctx.fillRect(x + 9 + leanX,  by + 2 + hb, 1, 1);
    ctx.fillRect(x + 21 + leanX, by + 2 + hb, 1, 1);

    // --- Goggles on forehead (bounce with hair) ---
    ctx.fillStyle = PAL.gogFrame;
    ctx.fillRect(x + 11 + leanX, by + 3 + hb, 4, 2);
    ctx.fillRect(x + 17 + leanX, by + 3 + hb, 4, 2);
    ctx.fillRect(x + 15 + leanX, by + 3 + hb, 2, 1);  // bridge
    ctx.fillStyle = PAL.gogLens;
    ctx.fillRect(x + 12 + leanX, by + 3 + hb, 2, 1);
    ctx.fillRect(x + 18 + leanX, by + 3 + hb, 2, 1);
    ctx.fillStyle = PAL.gogGlint;
    ctx.fillRect(x + 12 + leanX, by + 3 + hb, 1, 1);
    ctx.fillRect(x + 18 + leanX, by + 3 + hb, 1, 1);

    // --- Eyes — looking in walk direction (shifted 1px forward) ---
    ctx.fillStyle = PAL.eye;
    ctx.fillRect(x + 14 + leanX, by + 7, 2, 2);
    ctx.fillRect(x + 18 + leanX, by + 7, 2, 2);
    // Highlights shifted in walk direction
    ctx.fillStyle = PAL.eyeHi;
    ctx.fillRect(x + 14 + leanX, by + 7, 1, 1);
    ctx.fillRect(x + 18 + leanX, by + 7, 1, 1);

    // --- Mouth — confident smirk while walking ---
    ctx.fillStyle = PAL.mouth;
    ctx.fillRect(x + 14 + leanX, by + 10, 4, 1);
    if (!isContact) {
      // Slight uptick on pass frames (bounce feels cheerful)
      ctx.fillRect(x + 17 + leanX, by + 9, 1, 1);
    }

    // --- Arms (counter-swing to legs) ---
    if (col === 0) {
      // Left arm forward, right arm back
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 4, by + 12, 3, 7);
      ctx.fillRect(x + 3, by + 14, 2, 4);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 3, by + 17, 3, 2);
      // Right arm back (shorter visible)
      ctx.fillStyle = PAL.coatShade;
      ctx.fillRect(x + 24, by + 15, 3, 5);
      ctx.fillStyle = PAL.skinShade;
      ctx.fillRect(x + 24, by + 19, 3, 2);
    } else if (col === 1) {
      // Arms at sides (passing position)
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillRect(x + 24, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      ctx.fillRect(x + 24, by + 19, 3, 2);
    } else if (col === 2) {
      // Right arm forward, left arm back
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 25, by + 12, 3, 7);
      ctx.fillRect(x + 27, by + 14, 2, 4);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 27, by + 17, 3, 2);
      // Left arm back (shorter visible)
      ctx.fillStyle = PAL.coatShade;
      ctx.fillRect(x + 5, by + 15, 3, 5);
      ctx.fillStyle = PAL.skinShade;
      ctx.fillRect(x + 5, by + 19, 3, 2);
    } else {
      // Arms at sides (passing position)
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillRect(x + 24, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      ctx.fillRect(x + 24, by + 19, 3, 2);
    }
  }

  defineAnimation(name, row, frameCount, frameDuration, frameDurations) {
    this.animations[name] = { row, frameCount, frameDuration, frameDurations };
  }

  play(name, loop = true) {
    if (!this.animations[name]) {
      console.warn(`Animation '${name}' not found`);
      return;
    }

    if (this.currentAnimation === name && this.isPlaying) {
      return;
    }

    this.currentAnimation = name;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.loop = loop;
    this.isPlaying = true;
    this.needsRender = true;

    // Trigger transition squash/stretch
    this._triggerTransition();

    eventBus.emit(Events.CHARACTER_ANIMATION_START, { animation: name });
  }

  stop() {
    this.isPlaying = false;
  }

  // --- Transition squash/stretch ---

  _triggerTransition() {
    this._transitionActive = true;
    this._transitionElapsed = 0;
  }

  _updateTransition(dt) {
    if (!this._transitionActive) return;

    this._transitionElapsed += dt;
    const t = Math.min(this._transitionElapsed / this._transitionDuration, 1);

    if (t >= 1) {
      this._transitionActive = false;
      return;
    }

    const cfg = TRANSITION_EFFECT;

    // Three-phase: squash (0-0.3), stretch (0.3-0.6), settle (0.6-1.0)
    let sx, sy;
    if (t < 0.3) {
      // Squash phase
      const p = easeInOutSine(t / 0.3);
      sx = 1 + (cfg.squashScaleX - 1) * p;
      sy = 1 + (cfg.squashScaleY - 1) * p;
    } else if (t < 0.6) {
      // Stretch phase
      const p = easeInOutSine((t - 0.3) / 0.3);
      sx = cfg.squashScaleX + (cfg.stretchScaleX - cfg.squashScaleX) * p;
      sy = cfg.squashScaleY + (cfg.stretchScaleY - cfg.squashScaleY) * p;
    } else {
      // Settle phase
      const p = easeOutBack((t - 0.6) / 0.4);
      sx = cfg.stretchScaleX + (1 - cfg.stretchScaleX) * p;
      sy = cfg.stretchScaleY + (1 - cfg.stretchScaleY) * p;
    }

    this.transform.scaleX *= sx;
    this.transform.scaleY *= sy;
  }

  // --- Blink system ---

  _updateBlink(dt) {
    // Only blink in idle-ish states
    if (!IDLE_STATES.has(this.currentAnimation)) return;

    if (this._blinkActive) {
      this._blinkElapsed += dt;
      if (this._blinkElapsed >= IDLE_MICRO_MOTION.blink.duration) {
        this._blinkActive = false;
        this._blinkTimer = this._randomBlinkInterval();
        this.needsRender = true;
      }
    } else {
      this._blinkTimer -= dt;
      if (this._blinkTimer <= 0) {
        this._blinkActive = true;
        this._blinkElapsed = 0;
        this.needsRender = true;
      }
    }
  }

  _randomBlinkInterval() {
    const cfg = IDLE_MICRO_MOTION.blink;
    return cfg.minInterval + Math.random() * (cfg.maxInterval - cfg.minInterval);
  }

  // --- Idle flourishes ---

  _updateFlourishes(dt) {
    if (!IDLE_FLOURISHES.enabled) return;
    if (!IDLE_STATES.has(this.currentAnimation)) {
      this._flourishTimer = this._randomFlourishInterval();
      this._activeFlourish = null;
      return;
    }

    if (this._activeFlourish) {
      this._flourishElapsed += dt;
      const action = this._activeFlourish;
      const t = Math.min(this._flourishElapsed / action.duration, 1);

      switch (action.name) {
        case 'lookAround': {
          // Eyes shift: left (0-0.3), right (0.3-0.7), center (0.7-1.0)
          if (t < 0.3) {
            this.transform.offsetX += -1.5 * easeInOutSine(t / 0.3);
          } else if (t < 0.7) {
            this.transform.offsetX += -1.5 + 3.0 * easeInOutSine((t - 0.3) / 0.4);
          } else {
            this.transform.offsetX += 1.5 * (1 - easeInOutSine((t - 0.7) / 0.3));
          }
          break;
        }
        case 'adjustGoggles': {
          // Quick head tilt + squash
          const p = Math.sin(t * Math.PI);
          this.transform.offsetY += -1.5 * p;
          this.transform.scaleX *= 1 + 0.02 * p;
          this.transform.scaleY *= 1 - 0.02 * p;
          break;
        }
        case 'tapFoot': {
          // Rhythmic Y bounce (3 taps)
          const tapCount = 3;
          const tapPhase = (t * tapCount) % 1;
          const tapBounce = Math.sin(tapPhase * Math.PI) * 1.5;
          this.transform.offsetY -= tapBounce;
          break;
        }
        case 'smallWave': {
          // Brief offset right (simulates hand raise)
          const p = Math.sin(t * Math.PI);
          this.transform.offsetX += 1.0 * p;
          this.transform.offsetY -= 1.5 * p;
          break;
        }
      }

      if (t >= 1) {
        this._activeFlourish = null;
        this._flourishTimer = this._randomFlourishInterval();
      }

      this.needsRender = true;
    } else {
      this._flourishTimer -= dt;
      if (this._flourishTimer <= 0) {
        this._activeFlourish = this._pickRandomFlourish();
        this._flourishElapsed = 0;
      }
    }
  }

  _pickRandomFlourish() {
    const actions = IDLE_FLOURISHES.actions;
    const totalWeight = actions.reduce((sum, a) => sum + a.weight, 0);
    let r = Math.random() * totalWeight;
    for (const action of actions) {
      r -= action.weight;
      if (r <= 0) return action;
    }
    return actions[actions.length - 1];
  }

  _randomFlourishInterval() {
    return IDLE_FLOURISHES.minInterval +
      Math.random() * (IDLE_FLOURISHES.maxInterval - IDLE_FLOURISHES.minInterval);
  }

  // --- Core update (replaces old update) ---

  update(deltaTime) {
    // Advance continuous effect clock
    this.effectTime += deltaTime;

    // Reset transforms each frame — effects layer on top
    this.transform.scaleX = 1;
    this.transform.scaleY = 1;
    this.transform.offsetX = 0;
    this.transform.offsetY = 0;

    // Update sub-systems
    this._updateBlink(deltaTime);
    this._updateFlourishes(deltaTime);

    // Squash & stretch (animation-aware)
    this._applySquashStretch();

    // Idle micro-movements (breathing + sway)
    this._applyIdleMicroMotion();

    // Transition effect (on top of everything)
    this._updateTransition(deltaTime);

    // Any effect that changed transforms requires a re-render
    const transformChanged =
      this.transform.scaleX !== 1 || this.transform.scaleY !== 1 ||
      Math.abs(this.transform.offsetX) > 0.01 || Math.abs(this.transform.offsetY) > 0.01 ||
      this.shakeOffsetX !== 0 || this.shakeOffsetY !== 0;

    if (transformChanged) this.needsRender = true;

    // Frame advancement
    if (this.isPlaying && this.currentAnimation) {
      const anim = this.animations[this.currentAnimation];
      this.frameTimer += deltaTime;

      // Use per-frame duration if available, otherwise scalar
      const currentFrameDuration = anim.frameDurations
        ? anim.frameDurations[this.currentFrame % anim.frameDurations.length]
        : anim.frameDuration;

      while (this.frameTimer >= currentFrameDuration) {
        this.frameTimer -= currentFrameDuration;
        this.currentFrame++;
        this.needsRender = true;

        if (this.currentFrame >= anim.frameCount) {
          if (this.loop) {
            this.currentFrame = 0;
          } else {
            this.currentFrame = anim.frameCount - 1;
            this.isPlaying = false;
            this.frameTimer = 0;
            eventBus.emit(Events.CHARACTER_ANIMATION_COMPLETE, { animation: this.currentAnimation });
            if (this.onComplete) {
              this.onComplete();
            }
            break;
          }
        }
      }
    }

    // Only redraw when needed
    if (this.needsRender) {
      this.render();
      this.needsRender = false;
    }
  }

  // --- Squash & stretch ---

  _applySquashStretch() {
    const profile = SQUASH_STRETCH[this.currentAnimation];
    if (!profile) return;

    const t = this.effectTime / 1000;  // seconds
    const phase = t * profile.speed * Math.PI * 2;

    // Sine-wave based oscillation
    const sy = 1 + Math.sin(phase) * profile.scaleY;
    const sx = 1 - Math.sin(phase) * profile.scaleX;  // opposite to Y (volume preservation)

    this.transform.scaleX *= sx;
    this.transform.scaleY *= sy;
  }

  // --- Idle micro-movements ---

  _applyIdleMicroMotion() {
    if (!IDLE_STATES.has(this.currentAnimation)) return;

    const t = this.effectTime;  // ms

    // Breathing — slow Y oscillation
    const breathPhase = (t / IDLE_MICRO_MOTION.breathing.period) * Math.PI * 2;
    const breathAmount = Math.sin(breathPhase) * IDLE_MICRO_MOTION.breathing.scaleY;
    this.transform.scaleY *= 1 + breathAmount;

    // Sway — slow horizontal drift
    const swayPhase = (t / IDLE_MICRO_MOTION.sway.period) * Math.PI * 2;
    this.transform.offsetX += Math.sin(swayPhase) * IDLE_MICRO_MOTION.sway.offsetX;
  }

  // --- Render with transforms ---

  render() {
    if (!this.currentAnimation) return;

    const frames = this.frames[this.currentAnimation];
    if (!frames || !frames[this.currentFrame]) return;

    const cw = this.canvas.width;
    const ch = this.canvas.height;

    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.imageSmoothingEnabled = false;

    // Draw blink overlay (skin-colored bar over eye region) — we'll composite
    // it after the main sprite so we prepare a flag here.
    const shouldBlink = this._blinkActive && IDLE_STATES.has(this.currentAnimation)
      && this.currentAnimation !== 'focused'  // goggles cover eyes
      && this.currentAnimation !== 'coverEyes';

    this.ctx.save();

    // Anchor transforms at bottom-center (feet stay planted)
    const anchorX = cw / 2 + this.transform.offsetX + this.shakeOffsetX;
    const anchorY = ch * 0.92 + this.shakeOffsetY;

    this.ctx.translate(anchorX, anchorY);
    this.ctx.scale(this.transform.scaleX, this.transform.scaleY);
    this.ctx.translate(-cw / 2, -ch * 0.92);

    // Draw the sprite frame
    this.ctx.drawImage(
      frames[this.currentFrame],
      0, 0, this.frameWidth, this.frameHeight,
      0, 0, cw, ch
    );

    // Blink overlay — draw skin-colored rectangle over eye area
    if (shouldBlink) {
      this.ctx.fillStyle = PAL.skin;
      // New layout: by = y+3, eyes at by+7 → Y=10 from frame top
      // Eyes span x+13 to x+19 (width 7), height 2px
      const eyeY = (10 / this.frameHeight) * ch;
      const eyeH = (2 / this.frameHeight) * ch;
      const eyeX = (13 / this.frameWidth) * cw;
      const eyeW = (6 / this.frameWidth) * cw;   // spans both eyes (13..19)
      this.ctx.fillRect(eyeX, eyeY, eyeW, eyeH);
    }

    this.ctx.restore();

    // Reset shake (consumed each frame)
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }

}
