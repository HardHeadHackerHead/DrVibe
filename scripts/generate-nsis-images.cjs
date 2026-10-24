// Generate branded NSIS installer images themed with Dr. Vibe.
//
// Outputs:
//   src-tauri/nsis/sidebar.bmp  164 x 314  Welcome / Finish page
//   src-tauri/nsis/header.bmp   150 x  57  page header banner
//
// Source: src/assets/sprites/dr-vibe-classic.png (sprite sheet, 32x32 frames).
// Frame (col 0, row 0) is the canonical idle pose. We crop it, upscale
// nearest-neighbor for crisp pixel-art, and composite onto a dark "lab" panel.

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const root = path.join(__dirname, '..');
const spritePath = path.join(root, 'src', 'assets', 'sprites', 'dr-vibe-classic.png');
const nsisDir = path.join(root, 'src-tauri', 'nsis');

const FRAME_SIZE = 32;
const BG = '#1a1d24';
const ACCENT = '#5dd6c8';
const TEXT = '#ffffff';
const SUBTEXT = '#9aa3b2';
const RULE = '#2d3340';

fs.mkdirSync(nsisDir, { recursive: true });

function pickFrame(sheet, col, row) {
  const c = createCanvas(FRAME_SIZE, FRAME_SIZE);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(
    sheet,
    col * FRAME_SIZE, row * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE,
    0, 0, FRAME_SIZE, FRAME_SIZE,
  );
  return c;
}

// Convert a Canvas to a 24-bit BMP buffer (BGR, bottom-up, 4-byte row padding).
// NSIS reliably renders classic 24-bit BMPs; PNG-in-BMP support is uneven.
function canvasToBmp(canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, width, height);

  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + padding;
  const pixelSize = stride * height;
  const fileSize = 14 + 40 + pixelSize;

  const buf = Buffer.alloc(fileSize);
  let o = 0;

  buf.write('BM', o); o += 2;
  buf.writeUInt32LE(fileSize, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(54, o); o += 4;

  buf.writeUInt32LE(40, o); o += 4;
  buf.writeInt32LE(width, o); o += 4;
  buf.writeInt32LE(height, o); o += 4;
  buf.writeUInt16LE(1, o); o += 2;
  buf.writeUInt16LE(24, o); o += 2;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(pixelSize, o); o += 4;
  buf.writeInt32LE(2835, o); o += 4;
  buf.writeInt32LE(2835, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;

  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      buf[o++] = data[i + 2]; // B
      buf[o++] = data[i + 1]; // G
      buf[o++] = data[i + 0]; // R
    }
    for (let p = 0; p < padding; p++) buf[o++] = 0;
  }

  return buf;
}

function drawDrVibe(ctx, frame, dx, dy, size) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame, 0, 0, FRAME_SIZE, FRAME_SIZE, dx, dy, size, size);
}

async function generateSidebar(sheet) {
  const W = 164;
  const H = 314;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Vertical gradient panel
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#222633');
  grad.addColorStop(1, '#0f1117');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Faint grid lines for "lab" feel
  ctx.strokeStyle = 'rgba(93, 214, 200, 0.06)';
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 12) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  // Dr. Vibe — frame (0,0), upscaled 5x = 160px, centered horizontally
  const idle = pickFrame(sheet, 0, 0);
  const SPRITE = 160;
  const sx = Math.round((W - SPRITE) / 2);
  const sy = 40;

  // Soft glow behind sprite
  const glow = ctx.createRadialGradient(W / 2, sy + SPRITE / 2, 10, W / 2, sy + SPRITE / 2, 110);
  glow.addColorStop(0, 'rgba(93, 214, 200, 0.18)');
  glow.addColorStop(1, 'rgba(93, 214, 200, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, sy - 20, W, SPRITE + 40);

  drawDrVibe(ctx, idle, sx, sy, SPRITE);

  // Title
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Dr. Vibe', W / 2, sy + SPRITE + 30);

  // Accent rule
  ctx.fillStyle = ACCENT;
  ctx.fillRect((W - 36) / 2, sy + SPRITE + 40, 36, 2);

  // Subtitle
  ctx.fillStyle = SUBTEXT;
  ctx.font = '11px "Segoe UI", Arial, sans-serif';
  ctx.fillText('Your Coding Companion', W / 2, sy + SPRITE + 60);

  fs.writeFileSync(path.join(nsisDir, 'sidebar.bmp'), canvasToBmp(canvas));
  console.log('  sidebar.bmp  164x314');
}

async function generateHeader(sheet) {
  const W = 150;
  const H = 57;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Accent stripe on right edge
  ctx.fillStyle = ACCENT;
  ctx.fillRect(W - 2, 0, 2, H);

  // Sprite — small idle frame on the left
  const idle = pickFrame(sheet, 0, 0);
  const SPRITE = 40;
  drawDrVibe(ctx, idle, 8, Math.round((H - SPRITE) / 2), SPRITE);

  // Title
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Dr. Vibe', 56, 26);

  // Hairline
  ctx.fillStyle = RULE;
  ctx.fillRect(56, 32, 60, 1);

  // Subtitle
  ctx.fillStyle = SUBTEXT;
  ctx.font = '10px "Segoe UI", Arial, sans-serif';
  ctx.fillText('Coding Companion', 56, 46);

  fs.writeFileSync(path.join(nsisDir, 'header.bmp'), canvasToBmp(canvas));
  console.log('  header.bmp   150x57');
}

(async () => {
  if (!fs.existsSync(spritePath)) {
    console.error(`[generate-nsis-images] sprite not found at ${spritePath}`);
    process.exit(1);
  }
  const sheet = await loadImage(spritePath);
  console.log('Generating NSIS installer images...');
  await generateSidebar(sheet);
  await generateHeader(sheet);
  console.log('Done.');
})().catch((err) => {
  console.error('[generate-nsis-images] failed:', err);
  process.exit(1);
});
