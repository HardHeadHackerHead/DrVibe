/**
 * Generate README showcase images from Dr. Vibe spritesheets.
 *
 * Extracts and scales up individual sprite frames to create:
 * - Hero image (character in multiple poses)
 * - Skin showcase grid
 * - Animation state previews
 *
 * Usage: node scripts/generate-readme-assets.cjs
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const SPRITE_SIZE = 32;
const SCALE = 6; // 32 * 6 = 192px per character
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'images');

// Animation rows from animations.js
const ANIMATIONS = {
  idle:        { row: 0, frameCount: 3 },
  coding:      { row: 1, frameCount: 4 },
  thinking:    { row: 2, frameCount: 3 },
  tired:       { row: 3, frameCount: 3 },
  excited:     { row: 4, frameCount: 4 },
  alert:       { row: 5, frameCount: 3 },
  walkRight:   { row: 6, frameCount: 4 },
  stretching:  { row: 7, frameCount: 4 },
  beaker:      { row: 8, frameCount: 3 },
  libraryCard: { row: 9, frameCount: 4 },
  thumbsUp:    { row: 10, frameCount: 3 },
  coverEyes:   { row: 11, frameCount: 3 },
  celebrating: { row: 12, frameCount: 4 },
  focused:     { row: 13, frameCount: 2 },
  concerned:   { row: 14, frameCount: 3 },
  presenting:  { row: 15, frameCount: 3 },
};

const SKINS = [
  'dr-vibe-default',
  'dr-vibe-classic',
  'dr-vibe-alien',
  'dr-vibe-arctic',
  'dr-vibe-bridgemind',
  'dr-vibe-cyberpunk',
  'dr-vibe-firefighter',
  'dr-vibe-madscientist',
  'dr-vibe-pirate',
  'dr-vibe-retro80s',
  'dr-vibe-tuxedo',
  'dr-vibe-wizard',
];

const SKINS_DIR = path.join(__dirname, '..', 'src', 'assets', 'sprites', 'skins');

function extractFrame(spriteImg, row, col, scale) {
  const size = SPRITE_SIZE * scale;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; // Crisp pixel art
  ctx.drawImage(
    spriteImg,
    col * SPRITE_SIZE, row * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE,
    0, 0, size, size
  );
  return canvas;
}

async function generateHeroImage() {
  console.log('Generating hero image...');
  const spriteImg = await loadImage(path.join(SKINS_DIR, 'dr-vibe-default.png'));

  // Show key poses: idle, coding, excited, celebrating, beaker, thumbsUp
  const poses = [
    { name: 'idle', row: 0, col: 0 },
    { name: 'coding', row: 1, col: 1 },
    { name: 'excited', row: 4, col: 0 },
    { name: 'celebrating', row: 12, col: 1 },
    { name: 'beaker', row: 8, col: 0 },
    { name: 'thumbsUp', row: 10, col: 2 },
  ];

  const heroScale = 8;
  const charSize = SPRITE_SIZE * heroScale;
  const padding = 30;
  const totalWidth = poses.length * charSize + (poses.length - 1) * padding + 80;
  const totalHeight = charSize + 120;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Background gradient (dark theme)
  const gradient = ctx.createLinearGradient(0, 0, totalWidth, 0);
  gradient.addColorStop(0, '#0d1117');
  gradient.addColorStop(0.5, '#161b22');
  gradient.addColorStop(1, '#0d1117');
  ctx.beginPath();
  ctx.fillStyle = gradient;
  ctx.roundRect(0, 0, totalWidth, totalHeight, 16);
  ctx.fill();

  // Subtle border
  ctx.beginPath();
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 2;
  ctx.roundRect(0, 0, totalWidth, totalHeight, 16);
  ctx.stroke();

  // Draw each pose
  ctx.imageSmoothingEnabled = false;
  const startX = 40;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    const x = startX + i * (charSize + padding);
    const y = 30;

    // Subtle glow behind character
    ctx.save();
    ctx.shadowColor = '#58a6ff';
    ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(88, 166, 255, 0.05)';
    ctx.fillRect(x, y, charSize, charSize);
    ctx.restore();

    ctx.drawImage(
      spriteImg,
      p.col * SPRITE_SIZE, p.row * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE,
      x, y, charSize, charSize
    );

    // Label
    ctx.fillStyle = '#8b949e';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, x + charSize / 2, y + charSize + 24);
  }

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'hero-poses.png'), buf);
  console.log('  -> hero-poses.png');
}

async function generateSkinShowcase() {
  console.log('Generating skin showcase...');

  const skinScale = 6;
  const charSize = SPRITE_SIZE * skinScale;
  const cols = 4;
  const rows = Math.ceil(SKINS.length / cols);
  const cellPadding = 16;
  const labelHeight = 28;
  const cellWidth = charSize + cellPadding * 2;
  const cellHeight = charSize + labelHeight + cellPadding * 2;
  const outerPad = 24;

  const totalWidth = cols * cellWidth + outerPad * 2;
  const totalHeight = rows * cellHeight + outerPad * 2;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.beginPath();
  ctx.fillStyle = '#0d1117';
  ctx.roundRect(0, 0, totalWidth, totalHeight, 16);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 2;
  ctx.roundRect(0, 0, totalWidth, totalHeight, 16);
  ctx.stroke();

  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < SKINS.length; i++) {
    const skinName = SKINS[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = outerPad + col * cellWidth + cellPadding;
    const y = outerPad + row * cellHeight + cellPadding;

    try {
      const img = await loadImage(path.join(SKINS_DIR, `${skinName}.png`));

      // Cell background
      ctx.beginPath();
      ctx.fillStyle = '#161b22';
      ctx.roundRect(x - 8, y - 8, charSize + 16, charSize + labelHeight + 16, 8);
      ctx.fill();

      // Draw idle frame (row 0, col 0)
      ctx.drawImage(
        img,
        0, 0, SPRITE_SIZE, SPRITE_SIZE,
        x, y, charSize, charSize
      );

      // Skin name label
      const displayName = skinName.replace('dr-vibe-', '');
      ctx.fillStyle = '#c9d1d9';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(displayName, x + charSize / 2, y + charSize + 18);
    } catch (err) {
      console.error(`  Failed to load ${skinName}: ${err.message}`);
    }
  }

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'skin-showcase.png'), buf);
  console.log('  -> skin-showcase.png');
}

async function generateAnimationStates() {
  console.log('Generating animation states preview...');
  const spriteImg = await loadImage(path.join(SKINS_DIR, 'dr-vibe-default.png'));

  // Show all 16 animation states with first frame
  const states = Object.entries(ANIMATIONS);
  const stateScale = 5;
  const charSize = SPRITE_SIZE * stateScale;
  const cols = 8;
  const rows = Math.ceil(states.length / cols);
  const cellPadding = 12;
  const labelHeight = 24;
  const cellWidth = charSize + cellPadding * 2;
  const cellHeight = charSize + labelHeight + cellPadding * 2;
  const outerPad = 20;

  const totalWidth = cols * cellWidth + outerPad * 2;
  const totalHeight = rows * cellHeight + outerPad * 2;

  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.fillStyle = '#0d1117';
  ctx.roundRect(0, 0, totalWidth, totalHeight, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 2;
  ctx.roundRect(0, 0, totalWidth, totalHeight, 12);
  ctx.stroke();

  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < states.length; i++) {
    const [name, anim] = states[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = outerPad + col * cellWidth + cellPadding;
    const y = outerPad + row * cellHeight + cellPadding;

    ctx.beginPath();
    ctx.fillStyle = '#161b22';
    ctx.roundRect(x - 4, y - 4, charSize + 8, charSize + labelHeight + 8, 6);
    ctx.fill();

    ctx.drawImage(
      spriteImg,
      0, anim.row * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE,
      x, y, charSize, charSize
    );

    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(name, x + charSize / 2, y + charSize + 16);
  }

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'animation-states.png'), buf);
  console.log('  -> animation-states.png');
}

async function generateFeatureIcons() {
  console.log('Generating feature highlight icons...');
  const spriteImg = await loadImage(path.join(SKINS_DIR, 'dr-vibe-default.png'));

  // Individual feature icons at large scale for inline use
  const icons = [
    { name: 'coding', row: 1, col: 1 },
    { name: 'celebrating', row: 12, col: 1 },
    { name: 'beaker', row: 8, col: 0 },
    { name: 'stretching', row: 7, col: 1 },
    { name: 'focused', row: 13, col: 0 },
    { name: 'thumbsUp', row: 10, col: 2 },
    { name: 'idle', row: 0, col: 0 },
  ];

  const iconScale = 8;
  const iconSize = SPRITE_SIZE * iconScale;

  for (const icon of icons) {
    const canvas = createCanvas(iconSize, iconSize);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      spriteImg,
      icon.col * SPRITE_SIZE, icon.row * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE,
      0, 0, iconSize, iconSize
    );
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(OUTPUT_DIR, `icon-${icon.name}.png`), buf);
  }
  console.log('  -> icon-*.png (7 icons)');
}

async function main() {
  // Ensure output dir exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Generating README assets...\n');

  await generateHeroImage();
  await generateSkinShowcase();
  await generateAnimationStates();
  await generateFeatureIcons();

  console.log('\nDone! Assets saved to docs/images/');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
