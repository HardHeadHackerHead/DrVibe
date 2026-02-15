// Dr. Vibe - Celebration Confetti Effect
// Canvas-based particle system for visual progress celebrations.
// Enhanced with sparkle shapes, trails, size variation over lifetime,
// screen shake, and improved burst patterns.

import { eventBus, Events } from '../../core/EventBus.js';

const COLORS = [
  '#4ade80', // green
  '#facc15', // yellow
  '#60a5fa', // blue
  '#fb923c', // orange
  '#f87171', // red
  '#a78bfa', // purple
  '#34d399', // emerald
  '#f472b6', // pink
  '#38bdf8', // sky
];

const PARTICLE_COUNT = 30;
const PARTICLE_LIFETIME_MS = 2800;
const GRAVITY = 0.06;
const WIND = 0.008;        // gentle horizontal drift
const TRAIL_LENGTH = 3;    // number of previous positions to draw

// Shape types
const SHAPE_SQUARE = 0;
const SHAPE_CIRCLE = 1;
const SHAPE_RECT = 2;
const SHAPE_SPARKLE = 3;   // 4-point star
const SHAPE_DIAMOND = 4;

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 7;
    this.vy = -(Math.random() * 5 + 2.5);
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.baseSize = Math.random() * 4 + 2;
    this.size = this.baseSize;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.25;
    this.life = 1.0;
    this.decay = 1 / (PARTICLE_LIFETIME_MS / 16);
    // More shape variety including sparkle and diamond
    this.shape = Math.floor(Math.random() * 5);

    // Trail — store previous positions
    this.trail = [];
  }

  update() {
    // Store position for trail
    if (this.trail.length >= TRAIL_LENGTH) {
      this.trail.shift();
    }
    this.trail.push({ x: this.x, y: this.y, size: this.size, alpha: this.life });

    this.x += this.vx;
    this.y += this.vy;
    this.vy += GRAVITY;
    this.vx += WIND;            // gentle wind drift
    this.vx *= 0.985;           // air friction
    this.rotation += this.rotationSpeed;
    this.life -= this.decay;

    // Size variation over lifetime: grow then shrink
    if (this.life > 0.7) {
      // Growing phase (0.7 - 1.0)
      const growT = (1 - this.life) / 0.3;
      this.size = this.baseSize * (0.4 + 0.8 * growT);
    } else if (this.life < 0.3) {
      // Shrinking phase (0 - 0.3)
      this.size = this.baseSize * (this.life / 0.3) * 1.2;
    } else {
      // Full size
      this.size = this.baseSize * 1.2;
    }
  }

  draw(ctx) {
    if (this.life <= 0) return;

    // Draw trail (faded previous positions)
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const trailAlpha = (i / this.trail.length) * 0.3 * Math.min(t.alpha, 1);
      if (trailAlpha < 0.02) continue;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.globalAlpha = trailAlpha;
      ctx.fillStyle = this.color;
      const trailSize = t.size * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, trailSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw main particle
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.globalAlpha = Math.min(this.life, 1);
    ctx.fillStyle = this.color;

    switch (this.shape) {
      case SHAPE_SQUARE:
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
        break;

      case SHAPE_CIRCLE:
        ctx.beginPath();
        ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case SHAPE_RECT:
        ctx.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
        break;

      case SHAPE_SPARKLE:
        // 4-point star
        this._drawSparkle(ctx, this.size);
        break;

      case SHAPE_DIAMOND:
        ctx.beginPath();
        ctx.moveTo(0, -this.size / 2);
        ctx.lineTo(this.size / 3, 0);
        ctx.lineTo(0, this.size / 2);
        ctx.lineTo(-this.size / 3, 0);
        ctx.closePath();
        ctx.fill();
        break;
    }

    ctx.restore();
  }

  _drawSparkle(ctx, size) {
    const outer = size / 2;
    const inner = size / 6;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 - Math.PI / 2;
      const midAngle = angle + Math.PI / 4;
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.lineTo(Math.cos(midAngle) * inner, Math.sin(midAngle) * inner);
    }
    ctx.closePath();
    ctx.fill();
  }
}

export class CelebrationEffect {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.animating = false;
    this.rafId = null;

    // Screen shake state — consumed by SpriteAnimator each frame
    this._shakeIntensity = 0;
    this._shakeDuration = 0;
    this._shakeElapsed = 0;
    this._animator = null;  // reference set during init
  }

  init(animator) {
    this._animator = animator || null;

    this.canvas = document.getElementById('celebration-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this._resize();

    eventBus.on(Events.CELEBRATION_TRIGGERED, () => this.burst());
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, () => this.burst());
    eventBus.on(Events.STREAK_MILESTONE, ({ milestone }) => {
      const count = Math.min(milestone, 7) * PARTICLE_COUNT;
      this.burst(count);
    });
  }

  _resize() {
    if (!this.canvas) return;
    const app = document.getElementById('app');
    if (app) {
      this.canvas.width = app.offsetWidth;
      this.canvas.height = app.offsetHeight;
    }
  }

  burst(count = PARTICLE_COUNT) {
    if (!this.canvas) return;
    this._resize();

    const cx = this.canvas.width / 2;
    const cy = this.canvas.height * 0.3;

    // Spawn particles in a slight spread pattern (not all from one point)
    for (let i = 0; i < count; i++) {
      const spreadX = (Math.random() - 0.5) * 20;
      const spreadY = (Math.random() - 0.5) * 10;
      this.particles.push(new Particle(cx + spreadX, cy + spreadY));
    }

    // Trigger screen shake
    this._startShake(2.5, 250);

    if (!this.animating) {
      this.animating = true;
      this._animate();
    }
  }

  _startShake(intensity, duration) {
    this._shakeIntensity = intensity;
    this._shakeDuration = duration;
    this._shakeElapsed = 0;
  }

  _updateShake(dt) {
    if (this._shakeDuration <= 0) return;

    this._shakeElapsed += dt;
    if (this._shakeElapsed >= this._shakeDuration) {
      this._shakeDuration = 0;
      this._shakeIntensity = 0;
      if (this._animator) {
        this._animator.shakeOffsetX = 0;
        this._animator.shakeOffsetY = 0;
      }
      return;
    }

    // Decay shake intensity over time
    const t = 1 - (this._shakeElapsed / this._shakeDuration);
    const intensity = this._shakeIntensity * t;

    if (this._animator) {
      this._animator.shakeOffsetX = (Math.random() - 0.5) * 2 * intensity;
      this._animator.shakeOffsetY = (Math.random() - 0.5) * 2 * intensity;
    }
  }

  _animate() {
    if (!this.ctx) return;

    const dt = 16;  // approximate frame time at ~60fps
    this._updateShake(dt);

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const p of this.particles) {
      p.update();
      p.draw(this.ctx);
    }

    // Remove dead particles
    this.particles = this.particles.filter(p => p.life > 0);

    if (this.particles.length > 0) {
      this.rafId = requestAnimationFrame(() => this._animate());
    } else {
      this.animating = false;
      this._shakeDuration = 0;
      this._shakeIntensity = 0;
      if (this._animator) {
        this._animator.shakeOffsetX = 0;
        this._animator.shakeOffsetY = 0;
      }
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.particles = [];
    this.animating = false;
    this._shakeDuration = 0;
    this._shakeIntensity = 0;
  }
}
