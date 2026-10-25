// Dr. Vibe — draws a Dr. Vibe's finish (shimmer, foil, prismatic, crowned)
// over its own sprite frames, on the same canvas as SpriteAnimator.
//
// The looks follow the website's CSS finishes:
//   shimmer    every color cycles round the wheel (hue-rotate 0→360 over 3 s,
//              saturate 1.4–1.8) with a pink↔cyan glow
//   foil       real colors; a diagonal rainbow band sweeps over the sprite's
//              own pixels every 2.4 s; soft pink glow
//   prismatic  real colors; a rainbow one-art-pixel outline, a soft spinning
//              halo behind and a few twinkling pixel sparkles
//   crowned    the season's #1: gold-tinted, a gold glow, a glint and a
//              small pixel crown on the head
// The foil band and the prismatic halo carry the season accent
// (config/finishes.js).
//
// Cost: the companion runs all day, so nothing is allocated per frame. The
// offscreen canvases, gradients and glow colors are made once (or when the
// size, frame or season changes); per-frame work is a handful of drawImage
// calls plus, for shimmer/crowned, a color matrix over the 32×32 frame
// (1,024 pixels) that only reruns when the frame or the quantised step
// changes. GameLoop already stops when the window is hidden. With
// prefers-reduced-motion every finish holds still and asks for no redraws.

import { seasonAccent } from '../../config/finishes.js';

export const FINISH_EFFECTS = Object.freeze(['shimmer', 'foil', 'prismatic', 'crowned']);

/** The effect to draw for a finish, or null for none (or a tier this build doesn't know). */
export function finishEffect(finish) {
  const tier = finish && typeof finish === 'object' ? finish.tier : null;
  return FINISH_EFFECTS.includes(tier) ? tier : null;
}

// ── Timing (ms) ──────────────────────────────────────────────────────────
const SHIMMER_PERIOD = 3000;
const FOIL_PERIOD = 2400;     // sweep for the first 60%, then rest
const HALO_PERIOD = 6000;
const TWINKLE_PERIOD = 1800;
const CROWN_PERIOD = 3200;
const STEPS = 48;             // shimmer/crowned color steps per cycle (~16/s)

// ── Colors ───────────────────────────────────────────────────────────────
const PINK = [244, 114, 182];
const CYAN = [0, 240, 255];
const GOLD = [255, 210, 74];
const AMBER = [255, 170, 0];
const OUTLINE = [['#ffe24f', 0, 1], ['#8a7bff', 0, -1], ['#ff4fd8', 1, 0], ['#4fe6ff', -1, 0]];

const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const wave = (i) => (1 - Math.cos((i / STEPS) * Math.PI * 2)) / 2; // 0 → 1 → 0 over a cycle

// Glow colors per step, built once.
const SHIMMER_GLOW = Array.from({ length: STEPS }, (_, i) => rgba(mix(PINK, CYAN, wave(i)), 0.9));
const CROWN_GLOW = Array.from({ length: STEPS }, (_, i) => rgba(mix(GOLD, AMBER, wave(i)), 0.85));
const FOIL_GLOW = rgba(PINK, 0.55);

// Sparkles: [x, y] in art pixels from the frame's top-left, and a delay.
const SPARKLES = [[2, 6, 0], [27, 12, 600], [4, 25, 1200], [24, 1, 900]];
// Pixel crown, 5×3 art pixels: g = gold, d = shade, j = jewel.
const CROWN = ['g.g.g', 'gdjdg', 'ddddd'];
const CROWN_COLORS = { g: '#ffd23f', d: '#e09a00', j: '#ff4fd8' };

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const mod = (t, p) => ((t % p) + p) % p;

// ── Color matrices (CSS filter-effects definitions), row-major 3×3 ──────

function hueRotate(deg, out) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  out[0] = 0.213 + c * 0.787 - s * 0.213; out[1] = 0.715 - c * 0.715 - s * 0.715; out[2] = 0.072 - c * 0.072 + s * 0.928;
  out[3] = 0.213 - c * 0.213 + s * 0.143; out[4] = 0.715 + c * 0.285 + s * 0.140; out[5] = 0.072 - c * 0.072 - s * 0.283;
  out[6] = 0.213 - c * 0.213 - s * 0.787; out[7] = 0.715 - c * 0.715 + s * 0.715; out[8] = 0.072 + c * 0.928 + s * 0.072;
  return out;
}

function saturate(v, out) {
  out[0] = 0.213 + 0.787 * v; out[1] = 0.715 - 0.715 * v; out[2] = 0.072 - 0.072 * v;
  out[3] = 0.213 - 0.213 * v; out[4] = 0.715 + 0.285 * v; out[5] = 0.072 - 0.072 * v;
  out[6] = 0.213 - 0.213 * v; out[7] = 0.715 - 0.715 * v; out[8] = 0.072 + 0.928 * v;
  return out;
}

function sepia(k, out) {
  const j = 1 - k;
  out[0] = 0.393 + 0.607 * j; out[1] = 0.769 - 0.769 * j; out[2] = 0.189 - 0.189 * j;
  out[3] = 0.349 - 0.349 * j; out[4] = 0.686 + 0.314 * j; out[5] = 0.168 - 0.168 * j;
  out[6] = 0.272 - 0.272 * j; out[7] = 0.534 - 0.534 * j; out[8] = 0.131 + 0.869 * j;
  return out;
}

/** out = a × b (apply b first, then a, like `filter: b a`). */
function multiply(a, b, out) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

const _a = new Float32Array(9);
const _b = new Float32Array(9);

/** CSS `hue-rotate(deg) saturate(sat)` as one matrix. */
export function shimmerMatrix(deg, sat, out = new Float32Array(9)) {
  return multiply(saturate(sat, _a), hueRotate(deg, _b), out);
}

/** CSS `sepia(k) saturate(sat)` as one matrix: the crowned gold tint. */
export function goldMatrix(k, sat, out = new Float32Array(9)) {
  return multiply(saturate(sat, _a), sepia(k, _b), out);
}

function defaultReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  } catch {
    return null;
  }
}

function defaultCreateCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export class FinishRenderer {
  /**
   * @param {Object} [opts]
   * @param {boolean} [opts.reducedMotion]  fixed value (tests); default follows prefers-reduced-motion
   * @param {(w: number, h: number) => HTMLCanvasElement} [opts.createCanvas]
   */
  constructor({ reducedMotion, createCanvas = defaultCreateCanvas } = {}) {
    this._createCanvas = createCanvas;
    this._finish = null;
    this._effect = null;
    this._accent = null;
    if (typeof reducedMotion === 'boolean') {
      this._reduced = reducedMotion;
    } else {
      const mq = defaultReducedMotion();
      this._reduced = !!mq?.matches;
      mq?.addEventListener?.('change', (e) => { this._reduced = e.matches; });
    }

    // Lazily made, then reused.
    this._pixels = new WeakMap();   // frame → { data, top, headX }
    this._tint = null;              // frame-sized recolored copy
    this._tintImage = null;         // its ImageData
    this._tintFrame = null;
    this._tintStep = -1;
    this._matrix = new Float32Array(9);
    this._band = null;              // draw-sized foil/glint layer
    this._bandGradient = null;
    this._bandKind = null;          // what the gradient was made for
    this._bandAccent = null;
    this._sil = null;               // frame-sized silhouette scratch
    this._outline = null;           // (frame + 2)-sized rainbow outline
    this._outlineFrame = null;
    this._halo = null;
    this._haloAccent = null;
  }

  /** @param {import('../../core/api/contract.js').Finish|null} finish */
  setFinish(finish) {
    this._finish = finish || null;
    this._effect = finishEffect(finish);
    this._accent = this._effect ? seasonAccent(finish.seasonNumber) : null;
    this._tintFrame = null; // shimmer and crowned share the recolored copy
  }

  get effect() { return this._effect; }
  get reducedMotion() { return this._reduced; }
  set reducedMotion(v) { this._reduced = !!v; }

  /** True while the finish moves, so the caller must redraw every frame. */
  get animating() { return !!this._effect && !this._reduced; }

  /**
   * Draw `frame` (a sprite frame canvas) into `ctx` at (0, 0, w, h) in the
   * current transform, with the finish. With no finish this is one plain
   * drawImage. `timeMs` is a running clock; it is ignored with reduced motion.
   */
  draw(ctx, frame, w, h, timeMs = 0) {
    const fx = this._effect;
    if (!fx) {
      ctx.drawImage(frame, 0, 0, frame.width, frame.height, 0, 0, w, h);
      return;
    }
    const t = this._reduced ? null : timeMs;
    if (fx === 'shimmer') this._drawShimmer(ctx, frame, w, h, t);
    else if (fx === 'foil') this._drawFoil(ctx, frame, w, h, t);
    else if (fx === 'prismatic') this._drawPrismatic(ctx, frame, w, h, t);
    else this._drawCrowned(ctx, frame, w, h, t);
  }

  // ── Looks ─────────────────────────────────────────────────────────────

  _drawShimmer(ctx, frame, w, h, t) {
    const step = t === null ? 0 : Math.floor((mod(t, SHIMMER_PERIOD) / SHIMMER_PERIOD) * STEPS);
    if (this._needsRecolor(frame, step)) {
      this._recolor(frame, step, shimmerMatrix((step / STEPS) * 360, 1.4 + 0.4 * wave(step), this._matrix));
    }
    const px = w / frame.width;
    this._drawGlowing(ctx, this._tint, w, h, SHIMMER_GLOW[step], px * (1.5 + 0.5 * wave(step)));
  }

  _drawFoil(ctx, frame, w, h, t) {
    const px = w / frame.width;
    this._drawGlowing(ctx, frame, w, h, FOIL_GLOW, px * 1.25);
    // Band position: sweep left→right in the first 60% of the cycle, then rest off the sprite.
    let u = 0.5;
    if (t !== null) {
      const p = mod(t, FOIL_PERIOD) / FOIL_PERIOD;
      u = p < 0.6 ? easeInOutSine(p / 0.6) : 1;
    }
    this._drawBand(ctx, frame, w, h, 'foil', -0.5 * w + u * 2 * w);
  }

  _drawPrismatic(ctx, frame, w, h, t) {
    const px = w / frame.width;
    const halo = this._haloCanvas(w);
    ctx.save();
    ctx.translate(w / 2, h * 0.55);
    if (t !== null) ctx.rotate((mod(t, HALO_PERIOD) / HALO_PERIOD) * Math.PI * 2);
    ctx.globalAlpha = 0.45;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(halo, -halo.width / 2, -halo.height / 2);
    ctx.restore();

    const outline = this._outlineCanvas(frame);
    ctx.drawImage(outline, 0, 0, outline.width, outline.height, -px, -px, w + 2 * px, h + 2 * px);
    ctx.drawImage(frame, 0, 0, frame.width, frame.height, 0, 0, w, h);

    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < SPARKLES.length; i++) {
      const x = SPARKLES[i][0], y = SPARKLES[i][1], delay = SPARKLES[i][2];
      let alpha = 0.8, big = true;
      if (t !== null) {
        // steps(3) through 0% → 40% (1) → 70% (.5) → 100% (0), like the CSS twinkle
        const step = Math.floor((mod(t - delay, TWINKLE_PERIOD) / TWINKLE_PERIOD) * 3);
        if (step === 0) continue;
        alpha = step === 1 ? 0.85 : 0.55;
        big = step === 1;
      }
      ctx.globalAlpha = alpha;
      const sx = (x / frame.width) * w, sy = (y / frame.height) * h;
      if (big) {
        ctx.fillRect(sx + px, sy, px, 3 * px);
        ctx.fillRect(sx, sy + px, 3 * px, px);
      } else {
        ctx.fillRect(sx + px, sy + px, px, px);
      }
    }
    ctx.restore();
  }

  _drawCrowned(ctx, frame, w, h, t) {
    const step = t === null ? STEPS / 2 : Math.floor((mod(t, SHIMMER_PERIOD) / SHIMMER_PERIOD) * STEPS);
    if (this._needsRecolor(frame, step)) {
      this._recolor(frame, step, goldMatrix(0.35 + 0.25 * wave(step), 1.5, this._matrix));
    }
    const px = w / frame.width;
    this._drawGlowing(ctx, this._tint, w, h, CROWN_GLOW[step], px * (1.5 + 0.75 * wave(step)));
    let u = 0.5;
    if (t !== null) {
      const p = mod(t, CROWN_PERIOD) / CROWN_PERIOD;
      u = p < 0.5 ? easeInOutSine(p / 0.5) : 1;
    }
    this._drawBand(ctx, frame, w, h, 'crowned', -0.5 * w + u * 2 * w);

    // The crown sits on the head: its bottom row on the topmost opaque row.
    const { top, headX } = this._pixelsOf(frame);
    if (top < 0) return;
    const ox = headX - 2, oy = top - 2;
    for (let r = 0; r < CROWN.length; r++) {
      for (let c = 0; c < 5; c++) {
        const color = CROWN_COLORS[CROWN[r][c]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect((ox + c) * px, (oy + r) * px, px, px);
      }
    }
  }

  // ── Building blocks ───────────────────────────────────────────────────

  /** Draw a frame-sized image scaled to (w, h) with a soft glow of `color`. */
  _drawGlowing(ctx, img, w, h, color, blur) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
    ctx.restore();
  }

  /** `frame`'s pixels (read once) with the topmost opaque row and the head's center column. */
  _pixelsOf(frame) {
    let p = this._pixels.get(frame);
    if (p) return p;
    const fw = frame.width, fh = frame.height;
    const data = frame.getContext('2d').getImageData(0, 0, fw, fh).data;
    let top = -1, minX = fw, maxX = -1;
    for (let y = 0; y < fh && (top < 0 || y < top + 4); y++) {
      for (let x = 0; x < fw; x++) {
        if (data[(y * fw + x) * 4 + 3] === 0) continue;
        if (top < 0) top = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    p = { data, top, headX: top < 0 ? fw >> 1 : (minX + maxX) >> 1 };
    this._pixels.set(frame, p);
    return p;
  }

  /** Whether the recolored copy is stale for (frame, step); (re)makes the canvas when the size changes. */
  _needsRecolor(frame, step) {
    const fw = frame.width, fh = frame.height;
    if (!this._tint || this._tint.width !== fw || this._tint.height !== fh) {
      this._tint = this._createCanvas(fw, fh);
      this._tintImage = this._tint.getContext('2d').createImageData(fw, fh);
      this._tintFrame = null;
    }
    return this._tintFrame !== frame || this._tintStep !== step;
  }

  /** Recolor `frame` into this._tint through the 3×3 matrix `m`. */
  _recolor(frame, step, m) {
    const src = this._pixelsOf(frame).data;
    const out = this._tintImage.data;
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      out[i + 3] = a;
      if (a === 0) continue;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      out[i] = m[0] * r + m[1] * g + m[2] * b;
      out[i + 1] = m[3] * r + m[4] * g + m[5] * b;
      out[i + 2] = m[6] * r + m[7] * g + m[8] * b;
    }
    this._tint.getContext('2d').putImageData(this._tintImage, 0, 0);
    this._tintFrame = frame;
    this._tintStep = step;
  }

  /**
   * A diagonal band, clipped to the sprite's pixels, centered at x = `cx`,
   * laid over the sprite. Plain alpha rather than the site's color-dodge:
   * dodge turns a white lab coat solid white at 32 px.
   */
  _drawBand(ctx, frame, w, h, kind, cx) {
    const bw = Math.ceil(w), bh = Math.ceil(h);
    if (!this._band || this._band.width !== bw || this._band.height !== bh) {
      this._band = this._createCanvas(bw, bh);
      this._bandKind = null;
    }
    const b = this._band.getContext('2d');
    if (this._bandKind !== kind || this._bandAccent !== this._accent) {
      this._bandGradient = this._makeBandGradient(b, kind, w);
      this._bandKind = kind;
      this._bandAccent = this._accent;
    }
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bw, bh);
    b.imageSmoothingEnabled = false;
    b.drawImage(frame, 0, 0, frame.width, frame.height, 0, 0, w, h);
    // source-in: the band's colors, only where the sprite has pixels.
    b.globalCompositeOperation = 'source-in';
    b.translate(cx, h / 2);
    b.fillStyle = this._bandGradient;
    b.fillRect(-cx, -h / 2, bw, bh);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';

    const prev = ctx.globalAlpha;
    // Peak alpha stays low enough that the sprite's own colors read under the band.
    ctx.globalAlpha = prev * (kind === 'crowned' ? 0.7 : 0.5);
    ctx.drawImage(this._band, 0, 0, bw, bh, 0, 0, bw, bh);
    ctx.globalAlpha = prev;
  }

  /** Gradient along 115° (the CSS angle), centered on the origin; the foil stripe is about 35% of the sprite wide. */
  _makeBandGradient(b, kind, w) {
    const len = 1.6 * w;
    const dx = Math.sin((115 * Math.PI) / 180) * (len / 2);
    const dy = -Math.cos((115 * Math.PI) / 180) * (len / 2);
    const g = b.createLinearGradient(-dx, -dy, dx, dy);
    if (kind === 'crowned') {
      g.addColorStop(0, 'rgba(255,236,160,0)');
      g.addColorStop(0.4, 'rgba(255,236,160,0)');
      g.addColorStop(0.47, 'rgba(255,226,140,0.75)');
      g.addColorStop(0.5, 'rgba(255,255,240,0.95)');
      g.addColorStop(0.53, 'rgba(255,226,140,0.75)');
      g.addColorStop(0.6, 'rgba(255,236,160,0)');
      g.addColorStop(1, 'rgba(255,236,160,0)');
    } else {
      g.addColorStop(0, 'rgba(255,80,200,0)');
      g.addColorStop(0.39, 'rgba(255,80,200,0)');
      g.addColorStop(0.44, 'rgba(255,80,200,0.85)');
      g.addColorStop(0.48, 'rgba(255,240,120,0.85)');
      g.addColorStop(0.52, this._accent);
      g.addColorStop(0.56, 'rgba(120,140,255,0.85)');
      g.addColorStop(0.61, 'rgba(120,140,255,0)');
      g.addColorStop(1, 'rgba(120,140,255,0)');
    }
    return g;
  }

  /** Rainbow outline for `frame`: colored copies one art pixel out each way. Rebuilt per frame change. */
  _outlineCanvas(frame) {
    const fw = frame.width, fh = frame.height;
    if (!this._outline || this._outline.width !== fw + 2 || this._outline.height !== fh + 2) {
      this._outline = this._createCanvas(fw + 2, fh + 2);
      this._sil = this._createCanvas(fw, fh);
      this._outlineFrame = null;
    }
    if (this._outlineFrame === frame) return this._outline;
    const o = this._outline.getContext('2d');
    const s = this._sil.getContext('2d');
    o.clearRect(0, 0, fw + 2, fh + 2);
    for (const [color, dx, dy] of OUTLINE) {
      s.globalCompositeOperation = 'source-over';
      s.clearRect(0, 0, fw, fh);
      s.drawImage(frame, 0, 0);
      s.globalCompositeOperation = 'source-in';
      s.fillStyle = color;
      s.fillRect(0, 0, fw, fh);
      o.drawImage(this._sil, 1 + dx, 1 + dy);
    }
    s.globalCompositeOperation = 'source-over';
    this._outlineFrame = frame;
    return this._outline;
  }

  /** The soft rainbow halo (season accent in place of cyan), drawn once per size and season. */
  _haloCanvas(w) {
    const d = Math.max(2, Math.round(w * 1.15));
    if (this._halo && this._halo.width === d && this._haloAccent === this._accent) return this._halo;
    if (!this._halo || this._halo.width !== d) this._halo = this._createCanvas(d, d);
    const c = this._halo.getContext('2d');
    const r = d / 2;
    const colors = ['#ff4fd8', '#ffe24f', '#4fffb0', this._accent, '#8a7bff'];
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, d, d);
    if (typeof c.createConicGradient === 'function') {
      const g = c.createConicGradient(0, r, r);
      colors.forEach((col, i) => g.addColorStop(i / colors.length, col));
      g.addColorStop(1, colors[0]);
      c.fillStyle = g;
      c.fillRect(0, 0, d, d);
    } else {
      // Older webviews: wedges instead of a smooth conic sweep.
      const n = colors.length * 3;
      for (let i = 0; i < n; i++) {
        c.beginPath();
        c.moveTo(r, r);
        c.arc(r, r, r, (i / n) * Math.PI * 2, ((i + 1.05) / n) * Math.PI * 2);
        c.closePath();
        c.fillStyle = colors[Math.floor(i / 3)];
        c.fill();
      }
    }
    // Feather to transparent at the rim (the CSS blurs it by 26px).
    const fade = c.createRadialGradient(r, r, 0, r, r, r);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.45, 'rgba(0,0,0,0.8)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = fade;
    c.fillRect(0, 0, d, d);
    c.globalCompositeOperation = 'source-over';
    this._haloAccent = this._accent;
    return this._halo;
  }
}
