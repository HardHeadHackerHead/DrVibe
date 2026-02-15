// Generate placeholder icons and sprite sheet for Dr. Vibe
// Run with: node scripts/generate-assets.js

const fs = require('fs');
const path = require('path');

// Simple PNG encoder (creates minimal valid PNG)
function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdr = createIHDRChunk(width, height);

  // IDAT chunk (image data)
  const idat = createIDATChunk(width, height, pixels);

  // IEND chunk
  const iend = createIENDChunk();

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createIHDRChunk(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;  // bit depth
  data[9] = 6;  // color type (RGBA)
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return createChunk('IHDR', data);
}

function createIDATChunk(width, height, pixels) {
  const zlib = require('zlib');

  // Create raw image data with filter bytes
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      rawData[offset++] = pixels[pixelIndex];     // R
      rawData[offset++] = pixels[pixelIndex + 1]; // G
      rawData[offset++] = pixels[pixelIndex + 2]; // B
      rawData[offset++] = pixels[pixelIndex + 3]; // A
    }
  }

  const compressed = zlib.deflateSync(rawData);
  return createChunk('IDAT', compressed);
}

function createIENDChunk() {
  return createChunk('IEND', Buffer.alloc(0));
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  const table = getCRCTable();

  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }

  return crc ^ 0xFFFFFFFF;
}

let crcTable = null;
function getCRCTable() {
  if (crcTable) return crcTable;

  crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c;
  }
  return crcTable;
}

// Color utilities
function hexToRGBA(hex, alpha = 255) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, alpha];
}

// Draw a filled rectangle
function fillRect(pixels, width, x, y, w, h, color) {
  const [r, g, b, a] = color;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px >= 0 && px < width && py >= 0) {
        const idx = (py * width + px) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = a;
      }
    }
  }
}

// Generate app icon (simple beaker/scientist icon)
function generateIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Background (transparent)
  pixels.fill(0);

  // Scale factor
  const s = size / 32;

  // Draw a simple beaker shape
  const white = [255, 255, 255, 255];
  const green = [74, 222, 128, 255];
  const gray = [100, 100, 100, 255];

  // Beaker body
  fillRect(pixels, size, Math.floor(8 * s), Math.floor(10 * s), Math.floor(16 * s), Math.floor(18 * s), white);

  // Beaker neck
  fillRect(pixels, size, Math.floor(12 * s), Math.floor(4 * s), Math.floor(8 * s), Math.floor(6 * s), white);

  // Green liquid
  fillRect(pixels, size, Math.floor(10 * s), Math.floor(16 * s), Math.floor(12 * s), Math.floor(10 * s), green);

  // Bubbles
  fillRect(pixels, size, Math.floor(12 * s), Math.floor(14 * s), Math.floor(2 * s), Math.floor(2 * s), green);
  fillRect(pixels, size, Math.floor(18 * s), Math.floor(18 * s), Math.floor(2 * s), Math.floor(2 * s), green);

  return createPNG(size, size, pixels);
}

// Generate sprite sheet
function generateSpriteSheet() {
  const frameWidth = 32;
  const frameHeight = 32;
  const cols = 4;
  const rows = 16; // Rows 0-15 (presenting animation at row 15)
  const width = frameWidth * cols;
  const height = frameHeight * rows;

  const pixels = new Uint8Array(width * height * 4);
  pixels.fill(0); // Transparent background

  // Colors
  const white = hexToRGBA('#ffffff');
  const shadow = hexToRGBA('#e0e0e0');
  const hair = hexToRGBA('#cccccc');
  const skin = hexToRGBA('#ffe4c4');
  const dark = hexToRGBA('#4a4a4a');
  const goggle = hexToRGBA('#87ceeb');

  // State colors for glow
  const stateColors = [
    hexToRGBA('#4a90d9', 80),  // idle - blue
    hexToRGBA('#4ade80', 80),  // coding - green
    hexToRGBA('#facc15', 80),  // thinking - yellow
    hexToRGBA('#9ca3af', 80),  // tired - gray
    hexToRGBA('#ec4899', 80),  // excited - pink
    hexToRGBA('#f87171', 80),  // alert - red
  ];

  const frameCounts = [3, 4, 3, 3, 4, 3];

  // Draw base animation rows (0-5)
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < frameCounts[row]; col++) {
      drawCharacterFrame(pixels, width, col * frameWidth, row * frameHeight, col, row, {
        white, shadow, hair, skin, dark, goggle,
        glow: stateColors[row]
      });
    }
  }

  // Draw libraryCard animation at row 9
  const libraryCardGlow = hexToRGBA('#fbbf24', 80); // warm gold
  const libraryCardColors = { white, shadow, hair, skin, dark, goggle, glow: libraryCardGlow };
  for (let col = 0; col < 4; col++) {
    drawLibraryCardFrame(pixels, width, col * frameWidth, 9 * frameHeight, col, libraryCardColors);
  }

  // Draw stretching animation at row 7
  const stretchingGlow = hexToRGBA('#f97316', 80); // orange
  const stretchingColors = { white, shadow, hair, skin, dark, goggle, glow: stretchingGlow };
  for (let col = 0; col < 4; col++) {
    drawStretchingFrame(pixels, width, col * frameWidth, 7 * frameHeight, col, stretchingColors);
  }

  // Draw beaker animation at row 8
  const beakerGlow = hexToRGBA('#67e8f9', 80); // cyan
  const beakerColors = { white, shadow, hair, skin, dark, goggle, glow: beakerGlow };
  for (let col = 0; col < 3; col++) {
    drawBeakerFrame(pixels, width, col * frameWidth, 8 * frameHeight, col, beakerColors);
  }

  // Draw presenting animation at row 15
  const presentingGlow = hexToRGBA('#2dd4bf', 80); // teal
  const sharedColors = { white, shadow, hair, skin, dark, goggle, glow: presentingGlow };
  for (let col = 0; col < 3; col++) {
    drawPresentingFrame(pixels, width, col * frameWidth, 15 * frameHeight, col, sharedColors);
  }

  // Draw thumbsUp animation at row 10
  const thumbsUpGlow = hexToRGBA('#4ade80', 80); // green
  const thumbsUpColors = { white, shadow, hair, skin, dark, goggle, glow: thumbsUpGlow };
  for (let col = 0; col < 3; col++) {
    drawThumbsUpFrame(pixels, width, col * frameWidth, 10 * frameHeight, col, thumbsUpColors);
  }

  // Draw coverEyes animation at row 11
  const coverEyesGlow = hexToRGBA('#a78bfa', 80); // soft purple
  const coverEyesColors = { white, shadow, hair, skin, dark, goggle, glow: coverEyesGlow };
  for (let col = 0; col < 3; col++) {
    drawCoverEyesFrame(pixels, width, col * frameWidth, 11 * frameHeight, col, coverEyesColors);
  }

  // Draw focused animation at row 13
  const focusedGlow = hexToRGBA('#6366f1', 80); // indigo
  const focusedColors = { white, shadow, hair, skin, dark, goggle, glow: focusedGlow };
  for (let col = 0; col < 2; col++) {
    drawFocusedFrame(pixels, width, col * frameWidth, 13 * frameHeight, col, focusedColors);
  }

  // Draw celebrating animation at row 12
  const celebratingGlow = hexToRGBA('#f472b6', 80); // pink
  const celebratingColors = { white, shadow, hair, skin, dark, goggle, glow: celebratingGlow };
  for (let col = 0; col < 4; col++) {
    drawCelebratingFrame(pixels, width, col * frameWidth, 12 * frameHeight, col, celebratingColors);
  }

  // Draw concerned animation at row 14
  const concernedGlow = hexToRGBA('#f59e0b', 80); // amber
  const concernedColors = { white, shadow, hair, skin, dark, goggle, glow: concernedGlow };
  for (let col = 0; col < 3; col++) {
    drawConcernedFrame(pixels, width, col * frameWidth, 14 * frameHeight, col, concernedColors);
  }

  // Draw walking animation at row 6
  const walkingGlow = hexToRGBA('#60a5fa', 80); // blue
  const walkingColors = { white, shadow, hair, skin, dark, goggle, glow: walkingGlow };
  for (let col = 0; col < 4; col++) {
    drawWalkingFrame(pixels, width, col * frameWidth, 6 * frameHeight, col, walkingColors);
  }

  return createPNG(width, height, pixels);
}

function drawCharacterFrame(pixels, width, offsetX, offsetY, frame, state, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;

  // Animation offset
  const bounce = Math.sin(frame * 0.8) * 2;
  const baseY = offsetY + 4 + Math.floor(bounce);

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);

  // Lab coat shadow
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair (wild, spiky)
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles on forehead
  fillRect(pixels, width, offsetX + 10, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 9, 2, 2, dark);

  // Mouth (varies by state)
  if (state === 4) { // excited - big smile
    fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
    fillRect(pixels, width, offsetX + 14, baseY + 13, 4, 1, dark);
  } else if (state === 3) { // tired - frown
    fillRect(pixels, width, offsetX + 14, baseY + 13, 4, 1, dark);
    fillRect(pixels, width, offsetX + 13, baseY + 12, 1, 1, dark);
    fillRect(pixels, width, offsetX + 18, baseY + 12, 1, 1, dark);
  } else { // normal smile
    fillRect(pixels, width, offsetX + 14, baseY + 12, 4, 1, dark);
  }

  // Arms based on state
  if (state === 4) { // excited - arms up
    const armBounce = Math.floor(bounce);
    fillRect(pixels, width, offsetX + 4, baseY + 8 - armBounce, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 8 - armBounce, 4, 8, white);
  } else if (state === 1) { // coding - typing gesture
    const armOffset = frame % 2 === 0 ? 0 : 2;
    fillRect(pixels, width, offsetX + 4, baseY + 14 + armOffset, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 14 - armOffset, 4, 8, white);
  } else if (state === 2) { // thinking - hand on chin
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 20, baseY + 10, 4, 6, white);
    fillRect(pixels, width, offsetX + 20, baseY + 10, 3, 3, skin);
  } else if (state === 5) { // alert - pointing at watch
    fillRect(pixels, width, offsetX + 4, baseY + 12, 6, 6, white);
    fillRect(pixels, width, offsetX + 24, baseY + 14, 4, 8, white);
    // Watch on wrist
    fillRect(pixels, width, offsetX + 5, baseY + 16, 4, 2, dark);
  } else { // default arms down
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 14, 4, 8, white);
  }

  // State indicator glow at feet
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "libraryCard" animation (row 9)
// Frame 0: Reading pose — holds book at chest, looking down
// Frame 1: Looking up — head tilts up from book, sharing a finding
// Frame 2: Card presented — one arm extends book forward, other gestures
// Frame 3: Nodding — head nods, card still extended, encouraging
function drawLibraryCardFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;
  const bookColor = hexToRGBA('#fbbf24'); // warm gold
  const bookShadow = hexToRGBA('#d97706'); // darker gold edge

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);

  // Lab coat shadow
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head — slight nod on frame 3
  const headOffset = (frame === 3) ? 1 : 0;
  fillRect(pixels, width, offsetX + 10, baseY + 4 + headOffset, 12, 10, skin);

  // Hair (wild, spiky)
  fillRect(pixels, width, offsetX + 8, baseY + 2 + headOffset, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY + headOffset, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1 + headOffset, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2 + headOffset, 3, 4, hair);

  // Goggles on forehead
  fillRect(pixels, width, offsetX + 10, baseY + 4 + headOffset, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4 + headOffset, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5 + headOffset, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5 + headOffset, 3, 1, goggle);

  // Eyes — looking down on frame 0, forward on frames 1-3
  if (frame === 0) {
    // Eyes looking down at book
    fillRect(pixels, width, offsetX + 12, baseY + 10 + headOffset, 2, 2, dark);
    fillRect(pixels, width, offsetX + 17, baseY + 10 + headOffset, 2, 2, dark);
  } else {
    // Eyes looking forward
    fillRect(pixels, width, offsetX + 12, baseY + 9 + headOffset, 2, 2, dark);
    fillRect(pixels, width, offsetX + 17, baseY + 9 + headOffset, 2, 2, dark);
  }

  // Mouth — content smile, wider on frames 2-3
  if (frame >= 2) {
    fillRect(pixels, width, offsetX + 13, baseY + 12 + headOffset, 6, 1, dark);
    fillRect(pixels, width, offsetX + 14, baseY + 13 + headOffset, 4, 1, dark);
  } else {
    fillRect(pixels, width, offsetX + 14, baseY + 12 + headOffset, 4, 1, dark);
  }

  // Arms + book per frame
  if (frame === 0) {
    // Reading pose: both arms in front, holding book at chest level
    fillRect(pixels, width, offsetX + 6, baseY + 12, 4, 6, white);
    fillRect(pixels, width, offsetX + 22, baseY + 12, 4, 6, white);
    // Book held at chest
    fillRect(pixels, width, offsetX + 10, baseY + 12, 12, 7, bookColor);
    fillRect(pixels, width, offsetX + 10, baseY + 18, 12, 1, bookShadow);
  } else if (frame === 1) {
    // Looking up: left hand still holds book, right arm relaxing
    fillRect(pixels, width, offsetX + 6, baseY + 12, 4, 6, white);
    fillRect(pixels, width, offsetX + 22, baseY + 14, 4, 6, white);
    // Book in left hand, slightly lowered
    fillRect(pixels, width, offsetX + 10, baseY + 14, 10, 6, bookColor);
    fillRect(pixels, width, offsetX + 10, baseY + 19, 10, 1, bookShadow);
  } else if (frame === 2) {
    // Card presented: right arm extends book forward, left arm gestures
    // Left arm gesturing outward ("look at this!")
    fillRect(pixels, width, offsetX + 2, baseY + 10, 4, 6, white);
    // Right arm extended forward with book
    fillRect(pixels, width, offsetX + 24, baseY + 10, 4, 8, white);
    // Book held forward by right hand
    fillRect(pixels, width, offsetX + 24, baseY + 4, 7, 8, bookColor);
    fillRect(pixels, width, offsetX + 24, baseY + 11, 7, 1, bookShadow);
  } else {
    // Nodding: same as frame 2 but head nods (headOffset applied above)
    fillRect(pixels, width, offsetX + 2, baseY + 10, 4, 6, white);
    fillRect(pixels, width, offsetX + 24, baseY + 10, 4, 8, white);
    // Book still extended
    fillRect(pixels, width, offsetX + 24, baseY + 4, 7, 8, bookColor);
    fillRect(pixels, width, offsetX + 24, baseY + 11, 7, 1, bookShadow);
  }

  // State indicator glow at feet (gold)
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "stretching" animation (row 7)
// Frame 0: Arms at sides — relaxed, head tilted
// Frame 1: Arms rising — lifting overhead, body straightening
// Frame 2: Full stretch — arms overhead, slight lean right
// Frame 3: Side stretch — arms overhead, lean left
function drawStretchingFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;

  const baseY = offsetY + 4;

  // Body lean offset for stretch frames
  const leanX = frame === 2 ? 1 : frame === 3 ? -1 : 0;

  // Body (lab coat) — elongates slightly on full stretch
  const bodyHeight = frame >= 2 ? 12 : 14;
  const bodyY = frame >= 2 ? baseY + 14 : baseY + 12;
  fillRect(pixels, width, offsetX + 8 + leanX, bodyY, 16, bodyHeight, white);

  // Lab coat shadow
  fillRect(pixels, width, offsetX + 8 + leanX, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10 + leanX, baseY + 4, 12, 10, skin);

  // Hair (wild, spiky)
  fillRect(pixels, width, offsetX + 8 + leanX, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12 + leanX, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16 + leanX, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19 + leanX, baseY + 2, 3, 4, hair);

  // Goggles on forehead
  fillRect(pixels, width, offsetX + 10 + leanX, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16 + leanX, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11 + leanX, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17 + leanX, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12 + leanX, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17 + leanX, baseY + 9, 2, 2, dark);

  // Mouth — relaxed open on full stretch, gentle smile otherwise
  if (frame >= 2) {
    // Open "ahh" mouth — relief expression
    fillRect(pixels, width, offsetX + 14 + leanX, baseY + 12, 4, 1, dark);
    fillRect(pixels, width, offsetX + 14 + leanX, baseY + 13, 4, 1, dark);
  } else {
    // Gentle smile
    fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
  }

  // Arms per frame
  if (frame === 0) {
    // Arms at sides, relaxed
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 14, 4, 8, white);
  } else if (frame === 1) {
    // Arms rising — halfway up
    fillRect(pixels, width, offsetX + 4, baseY + 8, 4, 10, white);
    fillRect(pixels, width, offsetX + 24, baseY + 8, 4, 10, white);
  } else if (frame === 2) {
    // Full stretch — arms overhead, lean right
    fillRect(pixels, width, offsetX + 6 + leanX, baseY + 2, 4, 12, white);
    fillRect(pixels, width, offsetX + 22 + leanX, baseY + 2, 4, 12, white);
    // Hands (skin color)
    fillRect(pixels, width, offsetX + 7 + leanX, baseY, 3, 3, skin);
    fillRect(pixels, width, offsetX + 23 + leanX, baseY, 3, 3, skin);
  } else {
    // Side stretch — arms overhead, lean left
    fillRect(pixels, width, offsetX + 8 + leanX, baseY + 2, 4, 12, white);
    fillRect(pixels, width, offsetX + 20 + leanX, baseY + 2, 4, 12, white);
    // Hands (skin color)
    fillRect(pixels, width, offsetX + 9 + leanX, baseY, 3, 3, skin);
    fillRect(pixels, width, offsetX + 21 + leanX, baseY, 3, 3, skin);
  }

  // State indicator glow at feet (orange)
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "beaker" animation (row 8)
// Frame 0: Holding beaker — right arm holds bubbling beaker at chest level
// Frame 1: Beaker raised — arm lifts beaker upward, bubbles above
// Frame 2: Offering gesture — beaker extended forward, head tilted
function drawBeakerFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;
  const beakerCyan = hexToRGBA('#67e8f9');
  const beakerRim = hexToRGBA('#e0f2fe');
  const bubble = hexToRGBA('#a5f3fc');

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);

  // Lab coat shadow
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair (wild, spiky)
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles on forehead
  fillRect(pixels, width, offsetX + 10, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 9, 2, 2, dark);

  // Mouth — friendly smile, wider on offering frame
  if (frame === 2) {
    fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
    fillRect(pixels, width, offsetX + 14, baseY + 13, 4, 1, dark);
  } else {
    fillRect(pixels, width, offsetX + 13, baseY + 12, 5, 1, dark);
  }

  // Arms + beaker per frame
  if (frame === 0) {
    // Holding beaker: left arm at side, right arm raised holding beaker at chest
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 10, 4, 8, white);
    // Beaker at chest level
    fillRect(pixels, width, offsetX + 25, baseY + 6, 4, 6, beakerCyan);
    fillRect(pixels, width, offsetX + 25, baseY + 6, 4, 1, beakerRim);
  } else if (frame === 1) {
    // Beaker raised: left arm at side, right arm lifts beaker upward
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 6, 4, 10, white);
    // Beaker raised up
    fillRect(pixels, width, offsetX + 25, baseY + 2, 4, 6, beakerCyan);
    fillRect(pixels, width, offsetX + 25, baseY + 2, 4, 1, beakerRim);
    // Bubbles
    fillRect(pixels, width, offsetX + 26, baseY, 1, 1, bubble);
    fillRect(pixels, width, offsetX + 28, baseY + 1, 1, 1, bubble);
  } else {
    // Offering gesture: left arm at side, right arm extends beaker forward
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 8, 6, 4, white);
    // Beaker extended forward
    fillRect(pixels, width, offsetX + 27, baseY + 4, 4, 6, beakerCyan);
    fillRect(pixels, width, offsetX + 27, baseY + 4, 4, 1, beakerRim);
    // Bubbles
    fillRect(pixels, width, offsetX + 28, baseY + 2, 1, 1, bubble);
    fillRect(pixels, width, offsetX + 30, baseY + 3, 1, 1, bubble);
  }

  // State indicator glow at feet (cyan)
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "presenting" animation (row 15)
// Frame 0: Reaching behind — right arm behind back
// Frame 1: Revealing — right arm forward with clipboard, slight lean
// Frame 2: Display pose — both hands hold clipboard toward viewer, proud smile
function drawPresentingFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;
  const clipboardWhite = hexToRGBA('#ffffff');
  const clipboardLine = hexToRGBA('#cccccc');

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);

  // Lab coat shadow
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair (wild, spiky)
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles on forehead
  fillRect(pixels, width, offsetX + 10, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 9, 2, 2, dark);

  // Mouth — proud smile on all frames (wider on frame 2)
  if (frame === 2) {
    // Big proud grin for the display pose
    fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
    fillRect(pixels, width, offsetX + 14, baseY + 13, 4, 1, dark);
  } else {
    // Normal smile for reaching/revealing
    fillRect(pixels, width, offsetX + 14, baseY + 12, 4, 1, dark);
  }

  // Arms + clipboard per frame
  if (frame === 0) {
    // Frame 1 — Reaching behind: left arm at side, right arm tucked behind back
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    // Right arm behind body (partially hidden — draw short stub visible behind torso)
    fillRect(pixels, width, offsetX + 23, baseY + 16, 3, 6, white);
  } else if (frame === 1) {
    // Frame 2 — Revealing: left arm at side, right arm swings forward with clipboard
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    // Right arm extended forward
    fillRect(pixels, width, offsetX + 24, baseY + 10, 4, 8, white);
    // Clipboard in right hand
    fillRect(pixels, width, offsetX + 25, baseY + 3, 6, 9, clipboardWhite);
    // Clipboard lines (text)
    fillRect(pixels, width, offsetX + 26, baseY + 5, 4, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 26, baseY + 7, 4, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 26, baseY + 9, 3, 1, clipboardLine);
  } else {
    // Frame 3 — Display pose: both arms forward, holding clipboard centered
    // Left arm reaching inward
    fillRect(pixels, width, offsetX + 5, baseY + 10, 4, 6, white);
    // Right arm reaching inward
    fillRect(pixels, width, offsetX + 23, baseY + 10, 4, 6, white);
    // Clipboard held front and center
    fillRect(pixels, width, offsetX + 9, baseY + 3, 14, 11, clipboardWhite);
    // Clipboard border (subtle)
    fillRect(pixels, width, offsetX + 9, baseY + 3, 14, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 9, baseY + 13, 14, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 9, baseY + 3, 1, 11, clipboardLine);
    fillRect(pixels, width, offsetX + 22, baseY + 3, 1, 11, clipboardLine);
    // Text lines on clipboard
    fillRect(pixels, width, offsetX + 11, baseY + 5, 10, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 11, baseY + 7, 10, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 11, baseY + 9, 8, 1, clipboardLine);
    fillRect(pixels, width, offsetX + 11, baseY + 11, 6, 1, clipboardLine);
  }

  // State indicator glow at feet (teal)
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "thumbsUp" animation (row 10)
// Frame 0: Arm rising — right arm coming up from side
// Frame 1: Thumb up — right arm raised, fist with thumb extended
// Frame 2: Hold pose — same thumb up with slight confident lean
function drawThumbsUpFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;
  const thumbSkin = hexToRGBA('#ffe4c4');

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles
  fillRect(pixels, width, offsetX + 10, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 9, 2, 2, dark);

  // Mouth — warm confident smile
  fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
  fillRect(pixels, width, offsetX + 14, baseY + 13, 3, 1, dark);

  // Arms per frame
  if (frame === 0) {
    // Right arm rising from side
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 10, 4, 8, white);
  } else if (frame === 1) {
    // Thumb up — right arm fully raised
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 4, 4, 12, white);
    // Fist
    fillRect(pixels, width, offsetX + 24, baseY + 2, 4, 4, thumbSkin);
    // Thumb pointing up
    fillRect(pixels, width, offsetX + 25, baseY, 2, 3, thumbSkin);
  } else {
    // Hold pose with slight lean
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 4, 4, 12, white);
    // Fist
    fillRect(pixels, width, offsetX + 24, baseY + 2, 4, 4, thumbSkin);
    // Thumb pointing up
    fillRect(pixels, width, offsetX + 25, baseY, 2, 3, thumbSkin);
    // Sparkle/star near thumb
    const sparkle = hexToRGBA('#facc15');
    fillRect(pixels, width, offsetX + 28, baseY + 1, 1, 1, sparkle);  // star center
    fillRect(pixels, width, offsetX + 27, baseY, 1, 1, sparkle);      // top-left
    fillRect(pixels, width, offsetX + 29, baseY, 1, 1, sparkle);      // top-right
    fillRect(pixels, width, offsetX + 27, baseY + 2, 1, 1, sparkle);  // bottom-left
    fillRect(pixels, width, offsetX + 29, baseY + 2, 1, 1, sparkle);  // bottom-right
  }

  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "coverEyes" animation (row 11)
// Frame 0: Hands rising — eyes squinting from strain, arms coming up
// Frame 1: Eyes covered — both hands fully across eyes with finger details
// Frame 2: Peeking — fingers spread, one eye peeking through
function drawCoverEyesFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;
  const fingerGap = hexToRGBA('#f0d0a8'); // slightly darker skin for finger gaps

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles pushed up onto forehead
  fillRect(pixels, width, offsetX + 10, baseY + 3, 5, 2, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 3, 5, 2, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 3, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 3, 3, 1, goggle);

  if (frame === 0) {
    // Frame 1 — Hands rising: eyes squinting, arms coming up
    fillRect(pixels, width, offsetX + 12, baseY + 8, 2, 1, dark);  // left eye squinting
    fillRect(pixels, width, offsetX + 18, baseY + 8, 2, 1, dark);  // right eye squinting

    // Small grimace (eye strain)
    fillRect(pixels, width, offsetX + 14, baseY + 12, 4, 1, dark);

    // Arms rising toward face
    fillRect(pixels, width, offsetX + 4, baseY + 10, 5, 8, white);   // left arm
    fillRect(pixels, width, offsetX + 23, baseY + 10, 5, 8, white);  // right arm
    fillRect(pixels, width, offsetX + 6, baseY + 8, 4, 3, skin);     // left hand
    fillRect(pixels, width, offsetX + 22, baseY + 8, 4, 3, skin);    // right hand

  } else if (frame === 1) {
    // Frame 2 — Eyes covered: hands fully over eyes
    fillRect(pixels, width, offsetX + 9, baseY + 7, 14, 4, skin);   // hands across eyes

    // Finger gap details
    fillRect(pixels, width, offsetX + 12, baseY + 7, 1, 4, fingerGap);
    fillRect(pixels, width, offsetX + 15, baseY + 7, 1, 4, fingerGap);
    fillRect(pixels, width, offsetX + 19, baseY + 7, 1, 4, fingerGap);

    // Relaxed mouth
    fillRect(pixels, width, offsetX + 14, baseY + 12, 4, 1, dark);

    // Arms up holding hands to face
    fillRect(pixels, width, offsetX + 4, baseY + 8, 6, 10, white);
    fillRect(pixels, width, offsetX + 22, baseY + 8, 6, 10, white);

  } else {
    // Frame 3 — Peeking: fingers spread, left eye visible
    fillRect(pixels, width, offsetX + 9, baseY + 7, 14, 4, skin);   // hands still over eyes

    // Finger gaps
    fillRect(pixels, width, offsetX + 11, baseY + 7, 1, 4, fingerGap);
    fillRect(pixels, width, offsetX + 15, baseY + 7, 1, 4, fingerGap);
    fillRect(pixels, width, offsetX + 20, baseY + 7, 1, 4, fingerGap);

    // Left eye peeking through gap
    fillRect(pixels, width, offsetX + 12, baseY + 8, 2, 2, dark);

    // Slight relieved smile
    fillRect(pixels, width, offsetX + 14, baseY + 12, 4, 1, dark);
    fillRect(pixels, width, offsetX + 15, baseY + 13, 2, 1, dark);

    // Arms up holding hands to face
    fillRect(pixels, width, offsetX + 4, baseY + 8, 6, 10, white);
    fillRect(pixels, width, offsetX + 22, baseY + 8, 6, 10, white);
  }

  // State indicator glow at feet
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "focused" animation (row 13)
// Frame 0: Deep concentration — head slightly down, hands together
// Frame 1: Same pose, subtle eye shift (minimal motion for calm focus)
function drawFocusedFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head — slightly lowered
  fillRect(pixels, width, offsetX + 10, baseY + 5, 12, 10, skin);

  // Hair
  fillRect(pixels, width, offsetX + 8, baseY + 3, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY + 1, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 2, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 3, 3, 4, hair);

  // Goggles — pulled down over eyes (focused = goggles on)
  fillRect(pixels, width, offsetX + 10, baseY + 7, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 7, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 8, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 8, 3, 1, goggle);

  // Eyes behind goggles — subtle shift between frames
  if (frame === 0) {
    fillRect(pixels, width, offsetX + 12, baseY + 10, 2, 2, dark);
    fillRect(pixels, width, offsetX + 17, baseY + 10, 2, 2, dark);
  } else {
    // Slight eye shift — looking at work
    fillRect(pixels, width, offsetX + 13, baseY + 10, 2, 2, dark);
    fillRect(pixels, width, offsetX + 18, baseY + 10, 2, 2, dark);
  }

  // Mouth — small, neutral, calm
  fillRect(pixels, width, offsetX + 15, baseY + 13, 2, 1, dark);

  // Arms — both brought in front, hands together (concentrated pose)
  fillRect(pixels, width, offsetX + 6, baseY + 14, 4, 6, white);
  fillRect(pixels, width, offsetX + 22, baseY + 14, 4, 6, white);
  // Hands together at center
  fillRect(pixels, width, offsetX + 10, baseY + 16, 12, 4, white);

  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "celebrating" animation (row 12)
// Frame 0: Wind up — crouches slightly, arms pulled in
// Frame 1: Jump — body raised 2px, arms shooting up
// Frame 2: Peak — body raised 3px, arms fully extended, wide open mouth (cheering)
// Frame 3: Landing — back down, arms still up in victory pose, beaming smile
function drawCelebratingFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;

  // Jump offsets: wind-up(0), jump(-2), peak(-3), landing(0)
  const jumpOffsets = [0, -2, -3, 0];
  const jumpY = jumpOffsets[frame];
  const baseY = offsetY + 4 + jumpY;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);

  // Lab coat shadow
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair (wild, spiky)
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles on forehead
  fillRect(pixels, width, offsetX + 10, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 9, 2, 2, dark);

  // Mouth — wide open cheering on peak/landing frames, big smile otherwise
  if (frame >= 2) {
    // Wide open cheering mouth
    fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
    fillRect(pixels, width, offsetX + 13, baseY + 13, 6, 2, dark);
  } else {
    // Big smile
    fillRect(pixels, width, offsetX + 13, baseY + 12, 6, 1, dark);
    fillRect(pixels, width, offsetX + 14, baseY + 13, 4, 1, dark);
  }

  // Arms per frame
  if (frame === 0) {
    // Wind up: arms pulled in tight
    fillRect(pixels, width, offsetX + 8, baseY + 14, 4, 6, white);
    fillRect(pixels, width, offsetX + 20, baseY + 14, 4, 6, white);
  } else if (frame === 1) {
    // Jump: arms shooting up
    fillRect(pixels, width, offsetX + 4, baseY + 8, 4, 10, white);
    fillRect(pixels, width, offsetX + 24, baseY + 8, 4, 10, white);
  } else if (frame === 2) {
    // Peak: arms fully extended overhead with hands
    fillRect(pixels, width, offsetX + 4, baseY + 4, 4, 10, white);
    fillRect(pixels, width, offsetX + 24, baseY + 4, 4, 10, white);
    fillRect(pixels, width, offsetX + 4, baseY + 2, 4, 3, skin);   // left hand
    fillRect(pixels, width, offsetX + 24, baseY + 2, 4, 3, skin);  // right hand
  } else {
    // Landing: arms still up in victory pose
    fillRect(pixels, width, offsetX + 4, baseY + 6, 4, 10, white);
    fillRect(pixels, width, offsetX + 24, baseY + 6, 4, 10, white);
    fillRect(pixels, width, offsetX + 4, baseY + 4, 4, 3, skin);   // left hand
    fillRect(pixels, width, offsetX + 24, baseY + 4, 4, 3, skin);  // right hand
  }

  // State indicator glow at feet (pink)
  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "concerned" animation (row 14)
// Frame 0: Noticing — head tilt, hand on chin, worried brows
// Frame 1: Worried — hands clasped in front, empathetic expression
// Frame 2: Gentle reach — one arm extends toward viewer, offering help
function drawConcernedFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;

  const baseY = offsetY + 4;

  // Body (lab coat)
  fillRect(pixels, width, offsetX + 8, baseY + 12, 16, 14, white);
  fillRect(pixels, width, offsetX + 8, baseY + 20, 16, 6, shadow);

  // Head
  fillRect(pixels, width, offsetX + 10, baseY + 4, 12, 10, skin);

  // Hair
  fillRect(pixels, width, offsetX + 8, baseY + 2, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12, baseY, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16, baseY + 1, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19, baseY + 2, 3, 4, hair);

  // Goggles
  fillRect(pixels, width, offsetX + 10, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16, baseY + 4, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11, baseY + 5, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17, baseY + 5, 3, 1, goggle);

  // Eyes
  fillRect(pixels, width, offsetX + 12, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 9, 2, 2, dark);

  // Worried eyebrows — angled down-inward
  fillRect(pixels, width, offsetX + 11, baseY + 7, 3, 1, dark);
  fillRect(pixels, width, offsetX + 17, baseY + 7, 3, 1, dark);

  // Mouth — slight frown
  fillRect(pixels, width, offsetX + 13, baseY + 13, 1, 1, dark);
  fillRect(pixels, width, offsetX + 14, baseY + 12, 4, 1, dark);
  fillRect(pixels, width, offsetX + 18, baseY + 13, 1, 1, dark);

  // Arms per frame
  if (frame === 0) {
    // Noticing: left arm normal, right hand on chin
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 20, baseY + 10, 4, 6, white);
    fillRect(pixels, width, offsetX + 20, baseY + 10, 3, 3, skin);
  } else if (frame === 1) {
    // Worried: hands clasped in front of chest
    fillRect(pixels, width, offsetX + 10, baseY + 14, 4, 6, white);
    fillRect(pixels, width, offsetX + 18, baseY + 14, 4, 6, white);
    fillRect(pixels, width, offsetX + 13, baseY + 14, 6, 3, skin);
  } else {
    // Gentle reach: left arm normal, right arm reaching out
    fillRect(pixels, width, offsetX + 4, baseY + 14, 4, 8, white);
    fillRect(pixels, width, offsetX + 24, baseY + 12, 6, 4, white);
    fillRect(pixels, width, offsetX + 28, baseY + 12, 3, 3, skin);
  }

  fillRect(pixels, width, offsetX + 6, baseY + 26, 20, 4, glow);
}

// Draw a single frame for the "walking" animation (row 6)
// Frame 0: contact  — right foot plants, left arm forward, body dips
// Frame 1: passing  — weight centered, legs cross, body rises
// Frame 2: contact  — left foot plants, right arm forward, body dips
// Frame 3: passing  — weight centered, legs cross, body rises
function drawWalkingFrame(pixels, width, offsetX, offsetY, frame, colors) {
  const { white, shadow, hair, skin, dark, goggle, glow } = colors;
  const shoe = hexToRGBA('#3a3a3a');
  const coatFold = hexToRGBA('#d0d0d0');
  const shadowSkin = hexToRGBA('#f5d4a4');
  const armShadow = hexToRGBA('#f0f0f0');
  const groundShadow = hexToRGBA('#000000', 40);

  // Walking bob: dip on contact frames (0,2), rise on passing frames (1,3)
  const isContact = frame === 0 || frame === 2;
  const bobY = isContact ? 1 : -1;
  const baseY = offsetY + 4 + bobY;

  // Slight body lean forward on contact
  const leanX = isContact ? 1 : 0;

  // --- Lab coat / body ---
  fillRect(pixels, width, offsetX + 8 + leanX, baseY + 12, 16, 12, white);

  // Lab coat lower hem — flares with motion
  if (frame === 0) {
    fillRect(pixels, width, offsetX + 7, baseY + 24, 18, 2, white);
    fillRect(pixels, width, offsetX + 8, baseY + 23, 17, 1, white);
  } else if (frame === 2) {
    fillRect(pixels, width, offsetX + 7, baseY + 24, 18, 2, white);
    fillRect(pixels, width, offsetX + 7, baseY + 23, 17, 1, white);
  } else {
    fillRect(pixels, width, offsetX + 8, baseY + 24, 16, 2, white);
  }

  // Lab coat shadow/fold
  fillRect(pixels, width, offsetX + 9 + leanX, baseY + 19, 14, 4, shadow);
  // Center button/line detail
  fillRect(pixels, width, offsetX + 15 + leanX, baseY + 14, 1, 8, coatFold);

  // --- Head ---
  fillRect(pixels, width, offsetX + 10 + leanX, baseY + 4, 12, 10, skin);

  // --- Hair (bounces on passing frames) ---
  const hairBounce = isContact ? 0 : -1;
  fillRect(pixels, width, offsetX + 8 + leanX, baseY + 2 + hairBounce, 4, 4, hair);
  fillRect(pixels, width, offsetX + 12 + leanX, baseY + hairBounce, 3, 4, hair);
  fillRect(pixels, width, offsetX + 16 + leanX, baseY + 1 + hairBounce, 3, 3, hair);
  fillRect(pixels, width, offsetX + 19 + leanX, baseY + 2 + hairBounce, 3, 4, hair);

  // --- Goggles (bounce with hair) ---
  fillRect(pixels, width, offsetX + 10 + leanX, baseY + 4 + hairBounce, 5, 3, dark);
  fillRect(pixels, width, offsetX + 16 + leanX, baseY + 4 + hairBounce, 5, 3, dark);
  fillRect(pixels, width, offsetX + 11 + leanX, baseY + 5 + hairBounce, 3, 1, goggle);
  fillRect(pixels, width, offsetX + 17 + leanX, baseY + 5 + hairBounce, 3, 1, goggle);

  // --- Eyes — looking in walk direction ---
  const eyeShift = 1;
  fillRect(pixels, width, offsetX + 12 + leanX + eyeShift, baseY + 9, 2, 2, dark);
  fillRect(pixels, width, offsetX + 17 + leanX + eyeShift, baseY + 9, 2, 2, dark);

  // --- Mouth — content walking smile ---
  fillRect(pixels, width, offsetX + 14 + leanX, baseY + 12, 4, 1, dark);
  // Smile curve on passing frames
  if (!isContact) {
    fillRect(pixels, width, offsetX + 17 + leanX, baseY + 11, 1, 1, dark);
  }

  // --- Arms — natural swing opposite to legs ---
  if (frame === 0) {
    // Left arm forward, right arm back
    fillRect(pixels, width, offsetX + 3, baseY + 12, 4, 6, white);
    fillRect(pixels, width, offsetX + 2, baseY + 14, 3, 4, white);
    fillRect(pixels, width, offsetX + 2, baseY + 17, 3, 2, skin); // hand

    fillRect(pixels, width, offsetX + 24, baseY + 15, 4, 5, armShadow); // behind body
    fillRect(pixels, width, offsetX + 24, baseY + 19, 3, 2, shadowSkin); // hand
  } else if (frame === 1) {
    // Arms at sides
    fillRect(pixels, width, offsetX + 4, baseY + 13, 4, 7, white);
    fillRect(pixels, width, offsetX + 24, baseY + 13, 4, 7, white);
    fillRect(pixels, width, offsetX + 4, baseY + 19, 3, 2, skin);
    fillRect(pixels, width, offsetX + 25, baseY + 19, 3, 2, skin);
  } else if (frame === 2) {
    // Right arm forward, left arm back
    fillRect(pixels, width, offsetX + 25, baseY + 12, 4, 6, white);
    fillRect(pixels, width, offsetX + 27, baseY + 14, 3, 4, white);
    fillRect(pixels, width, offsetX + 27, baseY + 17, 3, 2, skin); // hand

    fillRect(pixels, width, offsetX + 4, baseY + 15, 4, 5, armShadow); // behind body
    fillRect(pixels, width, offsetX + 5, baseY + 19, 3, 2, shadowSkin); // hand
  } else {
    // Arms at sides
    fillRect(pixels, width, offsetX + 4, baseY + 13, 4, 7, white);
    fillRect(pixels, width, offsetX + 24, baseY + 13, 4, 7, white);
    fillRect(pixels, width, offsetX + 4, baseY + 19, 3, 2, skin);
    fillRect(pixels, width, offsetX + 25, baseY + 19, 3, 2, skin);
  }

  // --- Legs with shoes ---
  if (frame === 0) {
    // Right leg forward (stride), left leg back (push-off)
    fillRect(pixels, width, offsetX + 17 + leanX, baseY + 25, 3, 3, dark);  // right thigh
    fillRect(pixels, width, offsetX + 19 + leanX, baseY + 27, 3, 2, dark);  // right shin
    fillRect(pixels, width, offsetX + 19 + leanX, baseY + 29, 4, 1, shoe);  // right foot

    fillRect(pixels, width, offsetX + 11 + leanX, baseY + 25, 3, 2, dark);  // left thigh
    fillRect(pixels, width, offsetX + 10 + leanX, baseY + 27, 3, 2, dark);  // left shin
    fillRect(pixels, width, offsetX + 9 + leanX, baseY + 28, 3, 1, shoe);   // left foot
  } else if (frame === 1) {
    // Legs passing — close together
    fillRect(pixels, width, offsetX + 13 + leanX, baseY + 25, 3, 3, dark);
    fillRect(pixels, width, offsetX + 16 + leanX, baseY + 25, 3, 3, dark);
    fillRect(pixels, width, offsetX + 13 + leanX, baseY + 28, 3, 1, shoe);
    fillRect(pixels, width, offsetX + 16 + leanX, baseY + 28, 3, 1, shoe);
  } else if (frame === 2) {
    // Left leg forward, right leg back
    fillRect(pixels, width, offsetX + 12 + leanX, baseY + 25, 3, 3, dark);
    fillRect(pixels, width, offsetX + 10 + leanX, baseY + 27, 3, 2, dark);
    fillRect(pixels, width, offsetX + 9 + leanX, baseY + 29, 4, 1, shoe);

    fillRect(pixels, width, offsetX + 18 + leanX, baseY + 25, 3, 2, dark);
    fillRect(pixels, width, offsetX + 19 + leanX, baseY + 27, 3, 2, dark);
    fillRect(pixels, width, offsetX + 20 + leanX, baseY + 28, 3, 1, shoe);
  } else {
    // Legs passing — close together
    fillRect(pixels, width, offsetX + 13 + leanX, baseY + 25, 3, 3, dark);
    fillRect(pixels, width, offsetX + 16 + leanX, baseY + 25, 3, 3, dark);
    fillRect(pixels, width, offsetX + 13 + leanX, baseY + 28, 3, 1, shoe);
    fillRect(pixels, width, offsetX + 16 + leanX, baseY + 28, 3, 1, shoe);
  }

  // --- Ground shadow ---
  fillRect(pixels, width, offsetX + 8, offsetY + 4 + 30, 16, 1, groundShadow);

  // State indicator glow at feet
  fillRect(pixels, width, offsetX + 6, offsetY + 4 + 29, 20, 2, glow);
}

// Generate ICO file (Windows icon format)
// ICO format can embed PNG images directly
function generateICO(sizes) {
  const images = sizes.map(size => generateIcon(size));

  // ICONDIR header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);           // Reserved, must be 0
  header.writeUInt16LE(1, 2);           // Type: 1 = ICO
  header.writeUInt16LE(sizes.length, 4); // Number of images

  // ICONDIRENTRY for each image (16 bytes each)
  const entries = [];
  let dataOffset = 6 + (16 * sizes.length); // After header and all entries

  for (let i = 0; i < sizes.length; i++) {
    const entry = Buffer.alloc(16);
    const size = sizes[i];
    const imageData = images[i];

    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // Width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);  // Height (0 = 256)
    entry.writeUInt8(0, 2);                        // Color palette
    entry.writeUInt8(0, 3);                        // Reserved
    entry.writeUInt16LE(1, 4);                     // Color planes
    entry.writeUInt16LE(32, 6);                    // Bits per pixel
    entry.writeUInt32LE(imageData.length, 8);      // Image data size
    entry.writeUInt32LE(dataOffset, 12);           // Offset to image data

    entries.push(entry);
    dataOffset += imageData.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

// Main execution
function main() {
  const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
  const spritesDir = path.join(__dirname, '..', 'src', 'assets', 'sprites');

  // Ensure directories exist
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }
  if (!fs.existsSync(spritesDir)) {
    fs.mkdirSync(spritesDir, { recursive: true });
  }

  // Generate PNG icons
  console.log('Generating icons...');
  fs.writeFileSync(path.join(iconsDir, '32x32.png'), generateIcon(32));
  fs.writeFileSync(path.join(iconsDir, '128x128.png'), generateIcon(128));
  fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), generateIcon(256));
  fs.writeFileSync(path.join(iconsDir, 'icon.png'), generateIcon(256));

  // Generate proper ICO file with multiple sizes
  const ico = generateICO([16, 32, 48, 256]);
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);

  // For Mac ICNS, use PNG (Tauri handles conversion)
  fs.writeFileSync(path.join(iconsDir, 'icon.icns'), generateIcon(512));

  console.log('Icons generated!');

  // Generate sprite sheet
  console.log('Generating sprite sheet...');
  fs.writeFileSync(path.join(spritesDir, 'dr-vibe.png'), generateSpriteSheet());
  console.log('Sprite sheet generated!');

  console.log('Done! Assets are ready.');
}

main();
