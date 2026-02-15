// Dr. Vibe - Sprite Animation System

export class SpriteAnimator {
  constructor(canvas, frameWidth, frameHeight, scale = 1) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.scale = scale;

    // Set canvas size based on scale
    this.canvas.width = frameWidth * scale;
    this.canvas.height = frameHeight * scale;

    // Disable image smoothing for crisp pixel art
    this.ctx.imageSmoothingEnabled = false;

    this.spriteSheet = null;
    this.animations = {};
    this.currentAnimation = null;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.isPlaying = false;
    this.loop = true;

    // Callback when animation completes (if not looping)
    this.onComplete = null;
  }

  async loadSpriteSheet(path) {
    return new Promise((resolve, reject) => {
      this.spriteSheet = new Image();
      this.spriteSheet.onload = () => {
        console.log(`Sprite sheet loaded: ${path}`);
        resolve();
      };
      this.spriteSheet.onerror = (e) => {
        console.log(`Sprite sheet not found, using placeholder: ${path}`);
        // Create a placeholder sprite sheet
        this.createPlaceholderSprites();
        resolve();
      };
      this.spriteSheet.src = path;
    });
  }

  createPlaceholderSprites() {
    // Create an in-memory canvas for placeholder sprites
    const placeholderCanvas = document.createElement('canvas');
    const cols = 4; // Max frames per animation
    const rows = 6; // Number of animation states

    placeholderCanvas.width = this.frameWidth * cols;
    placeholderCanvas.height = this.frameHeight * rows;

    const ctx = placeholderCanvas.getContext('2d');

    // Define colors for each state
    const stateColors = [
      ['#4a90d9', '#5ba3ec', '#4a90d9'], // idle - blue
      ['#4ade80', '#22c55e', '#15803d', '#4ade80'], // coding - green
      ['#facc15', '#eab308', '#facc15'], // thinking - yellow
      ['#9ca3af', '#6b7280', '#9ca3af'], // tired - gray
      ['#f472b6', '#ec4899', '#a855f7', '#f472b6'], // excited - pink/purple
      ['#f87171', '#ef4444', '#f87171']  // alert - red
    ];

    // Draw placeholder sprites
    for (let row = 0; row < rows; row++) {
      const colors = stateColors[row];
      for (let col = 0; col < colors.length; col++) {
        this.drawPlaceholderCharacter(ctx, col, row, colors[col], row);
      }
    }

    // Use the canvas directly as the sprite source (no conversion needed)
    this.spriteSheet = placeholderCanvas;
    console.log('Placeholder sprites created', placeholderCanvas.width, 'x', placeholderCanvas.height);
  }

  drawPlaceholderCharacter(ctx, col, row, color, animState) {
    const x = col * this.frameWidth;
    const y = row * this.frameHeight;
    const w = this.frameWidth;
    const h = this.frameHeight;

    // Clear frame
    ctx.clearRect(x, y, w, h);

    // Animation offset for bobbing/movement
    const bounce = Math.sin(col * 0.8) * 2;
    const baseY = y + 4 + bounce;

    // Body (lab coat)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 8, baseY + 12, 16, 14);

    // Lab coat shadow
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x + 8, baseY + 20, 16, 6);

    // Head
    ctx.fillStyle = '#ffe4c4';
    ctx.fillRect(x + 10, baseY + 4, 12, 10);

    // Hair (wild, spiky)
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(x + 8, baseY + 2, 4, 4);
    ctx.fillRect(x + 12, baseY, 3, 4);
    ctx.fillRect(x + 16, baseY + 1, 3, 3);
    ctx.fillRect(x + 19, baseY + 2, 3, 4);

    // Goggles on forehead
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(x + 10, baseY + 4, 5, 3);
    ctx.fillRect(x + 16, baseY + 4, 5, 3);
    ctx.fillStyle = '#87ceeb';
    ctx.fillRect(x + 11, baseY + 5, 3, 1);
    ctx.fillRect(x + 17, baseY + 5, 3, 1);

    // Eyes
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(x + 12, baseY + 9, 2, 2);
    ctx.fillRect(x + 17, baseY + 9, 2, 2);

    // Mouth (varies by state)
    ctx.fillStyle = '#4a4a4a';
    if (animState === 4) { // excited - big smile
      ctx.fillRect(x + 13, baseY + 12, 6, 1);
      ctx.fillRect(x + 14, baseY + 13, 4, 1);
    } else if (animState === 3) { // tired - frown
      ctx.fillRect(x + 14, baseY + 13, 4, 1);
      ctx.fillRect(x + 13, baseY + 12, 1, 1);
      ctx.fillRect(x + 18, baseY + 12, 1, 1);
    } else { // normal smile
      ctx.fillRect(x + 14, baseY + 12, 4, 1);
    }

    // Arms based on state
    ctx.fillStyle = '#ffffff';
    if (animState === 4) { // excited - arms up
      ctx.fillRect(x + 4, baseY + 8 - bounce, 4, 8);
      ctx.fillRect(x + 24, baseY + 8 - bounce, 4, 8);
    } else if (animState === 1) { // coding - typing gesture
      const armOffset = col % 2 === 0 ? 0 : 2;
      ctx.fillRect(x + 4, baseY + 14 + armOffset, 4, 8);
      ctx.fillRect(x + 24, baseY + 14 - armOffset, 4, 8);
    } else if (animState === 2) { // thinking - hand on chin
      ctx.fillRect(x + 4, baseY + 14, 4, 8);
      ctx.fillRect(x + 20, baseY + 10, 4, 6);
      ctx.fillStyle = '#ffe4c4';
      ctx.fillRect(x + 20, baseY + 10, 3, 3);
    } else { // default arms down
      ctx.fillRect(x + 4, baseY + 14, 4, 8);
      ctx.fillRect(x + 24, baseY + 14, 4, 8);
    }


  }

  defineAnimation(name, row, frameCount, frameDuration) {
    this.animations[name] = {
      row,
      frameCount,
      frameDuration
    };
  }

  play(name, loop = true) {
    if (!this.animations[name]) {
      console.warn(`Animation '${name}' not found`);
      return;
    }

    if (this.currentAnimation === name && this.isPlaying) {
      return; // Already playing this animation
    }

    this.currentAnimation = name;
    this.currentFrame = 0;
    this.frameTimer = 0;
    this.loop = loop;
    this.isPlaying = true;
  }

  stop() {
    this.isPlaying = false;
  }

  update(deltaTime) {
    if (!this.isPlaying || !this.currentAnimation) return;

    const anim = this.animations[this.currentAnimation];
    this.frameTimer += deltaTime;

    if (this.frameTimer >= anim.frameDuration) {
      this.frameTimer = 0;
      this.currentFrame++;

      if (this.currentFrame >= anim.frameCount) {
        if (this.loop) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = anim.frameCount - 1;
          this.isPlaying = false;
          if (this.onComplete) {
            this.onComplete();
          }
        }
      }
    }

    this.render();
  }

  render() {
    if (!this.spriteSheet || !this.currentAnimation) return;

    const anim = this.animations[this.currentAnimation];

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Calculate source position in sprite sheet
    const srcX = this.currentFrame * this.frameWidth;
    const srcY = anim.row * this.frameHeight;

    // Draw sprite scaled
    this.ctx.drawImage(
      this.spriteSheet,
      srcX, srcY, this.frameWidth, this.frameHeight,
      0, 0, this.canvas.width, this.canvas.height
    );
  }
}
