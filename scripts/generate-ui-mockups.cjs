/**
 * Generate UI mockup images for the Dr. Vibe README.
 *
 * Creates canvas-rendered previews of each major panel/window
 * to showcase the app's interface on GitHub.
 *
 * Usage: node scripts/generate-ui-mockups.cjs
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'images');
const SKINS_DIR = path.join(__dirname, '..', 'src', 'assets', 'sprites', 'skins');

// Shared theme
const T = {
  bg: '#1e1e1e',
  bgDark: '#181818',
  bgPanel: '#252525',
  bgCard: 'rgba(50,50,50,0.6)',
  bgCardSolid: '#323232',
  border: '#333',
  borderLight: '#444',
  text: '#e0e0e0',
  textMuted: '#a0a0a0',
  textDim: '#808080',
  green: '#4ade80',
  greenDark: '#22c55e',
  blue: '#60a5fa',
  orange: '#fb923c',
  yellow: '#facc15',
  red: '#f87171',
  pink: '#f472b6',
  purple: '#a78bfa',
  cyan: '#38bdf8',
  teal: '#34d399',
  font: '12px "Segoe UI", system-ui, sans-serif',
  fontBold: 'bold 12px "Segoe UI", system-ui, sans-serif',
  fontSmall: '10px "Segoe UI", system-ui, sans-serif',
  fontTiny: '9px "Segoe UI", system-ui, sans-serif',
  fontLabel: '10px "Segoe UI", system-ui, sans-serif',
  fontHeader: 'bold 16px "Segoe UI", system-ui, sans-serif',
  fontTitle: 'bold 14px "Segoe UI", system-ui, sans-serif',
  fontLarge: 'bold 20px "Segoe UI", system-ui, sans-serif',
  fontHuge: 'bold 28px "Segoe UI", system-ui, sans-serif',
};

// Helper: draw rounded rect
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Helper: fill rounded rect
function fillRoundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

// Helper: draw progress bar
function drawProgressBar(ctx, x, y, w, h, progress, color, bgColor = '#333') {
  fillRoundRect(ctx, x, y, w, h, h / 2, bgColor);
  if (progress > 0) {
    fillRoundRect(ctx, x, y, w * Math.min(progress, 1), h, h / 2, color);
  }
}

// Helper: draw a stat card
function drawStatCard(ctx, x, y, w, h, value, label, valueColor = T.green) {
  fillRoundRect(ctx, x, y, w, h, 8, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = valueColor;
  ctx.font = T.fontLarge;
  ctx.textAlign = 'center';
  ctx.fillText(value, x + w / 2, y + h / 2 + 2);
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText(label.toUpperCase(), x + w / 2, y + h - 10);
}

// Helper: draw window chrome
function drawWindowChrome(ctx, w, h, title) {
  // Background
  fillRoundRect(ctx, 0, 0, w, h, 12, T.bg);
  // Border
  ctx.strokeStyle = T.border;
  ctx.lineWidth = 1;
  roundRect(ctx, 0, 0, w, h, 12);
  ctx.stroke();
  // Title bar
  fillRoundRect(ctx, 0, 0, w, 36, [12, 12, 0, 0], T.bgDark);
  ctx.beginPath();
  ctx.moveTo(0, 36);
  ctx.lineTo(w, 36);
  ctx.strokeStyle = T.border;
  ctx.stroke();
  // Window dots
  const dotColors = ['#ff5f57', '#ffbd2e', '#28c940'];
  dotColors.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(16 + i * 20, 18, 6, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  // Title
  if (title) {
    ctx.fillStyle = T.textMuted;
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, 22);
  }
}

// ─────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────
async function generateSettingsPanel() {
  console.log('Generating settings panel...');
  const W = 500, H = 620;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawWindowChrome(ctx, W, H, 'Settings');

  // Tab bar
  const tabs = [
    { label: 'Timer', icon: '\u23F1', active: false },
    { label: 'Wellness', icon: '\u2764', active: false },
    { label: 'Companion', icon: '\u{1F9EA}', active: false },
    { label: 'Appearance', icon: '\u{1F3A8}', active: true },
  ];
  const tabY = 36;
  const tabW = W / tabs.length;
  tabs.forEach((tab, i) => {
    const tx = i * tabW;
    fillRoundRect(ctx, tx, tabY, tabW, 36, 0, T.bgDark);
    ctx.fillStyle = tab.active ? T.green : T.textDim;
    ctx.font = T.fontSmall;
    ctx.textAlign = 'center';
    ctx.fillText(`${tab.label}`, tx + tabW / 2, tabY + 22);
    if (tab.active) {
      ctx.fillStyle = T.green;
      ctx.fillRect(tx + 10, tabY + 33, tabW - 20, 3);
    }
  });

  const contentY = 80;
  const pad = 20;

  // Section: Character Skin
  ctx.fillStyle = T.green;
  ctx.font = T.fontLabel;
  ctx.textAlign = 'left';
  ctx.fillText('CHARACTER SKIN', pad, contentY + 10);

  // Skin selector grid
  const skinNames = ['default', 'classic', 'alien', 'arctic', 'cyberpunk', 'wizard',
    'pirate', 'retro80s', 'firefighter', 'madscientist', 'bridgemind', 'tuxedo'];
  const gridX = pad;
  const gridY = contentY + 20;
  const cellSize = 62;
  const cellGap = 8;
  const cols = 6;

  // Load and draw skin thumbnails
  const spriteImg = await loadImage(path.join(SKINS_DIR, 'dr-vibe-default.png'));

  for (let i = 0; i < skinNames.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = gridX + col * (cellSize + cellGap);
    const cy = gridY + row * (cellSize + cellGap + 16);

    // Load each skin
    try {
      const skinImg = await loadImage(path.join(SKINS_DIR, `dr-vibe-${skinNames[i]}.png`));

      // Cell bg
      const isSelected = skinNames[i] === 'default';
      fillRoundRect(ctx, cx, cy, cellSize, cellSize, 6, '#2a2a2a');
      if (isSelected) {
        ctx.strokeStyle = T.green;
        ctx.lineWidth = 2;
        roundRect(ctx, cx, cy, cellSize, cellSize, 6);
        ctx.stroke();
      }

      // Draw sprite
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(skinImg, 0, 0, 32, 32, cx + 7, cy + 3, 48, 48);
      ctx.imageSmoothingEnabled = true;

      // Label
      ctx.fillStyle = isSelected ? T.green : T.textMuted;
      ctx.font = T.fontTiny;
      ctx.textAlign = 'center';
      ctx.fillText(skinNames[i], cx + cellSize / 2, cy + cellSize + 12);
    } catch (e) { /* skip */ }
  }

  // Section: Skin Tone
  const toneY = gridY + 2 * (cellSize + cellGap + 16) + 20;
  ctx.fillStyle = T.green;
  ctx.font = T.fontLabel;
  ctx.textAlign = 'left';
  ctx.fillText('SKIN TONE', pad, toneY);

  const tones = ['Default', 'Light', 'Medium-Light', 'Dark'];
  const toneColors = ['#e8b88a', '#f5d4b3', '#d4a574', '#8b6539'];
  tones.forEach((tone, i) => {
    const tx = pad + i * 110;
    const ty = toneY + 10;
    const isActive = i === 0;

    fillRoundRect(ctx, tx, ty, 100, 32, 6, '#2a2a2a');
    if (isActive) {
      ctx.strokeStyle = T.green;
      ctx.lineWidth = 2;
      roundRect(ctx, tx, ty, 100, 6, 6);
      ctx.stroke();
    }

    // Color swatch
    ctx.beginPath();
    ctx.arc(tx + 16, ty + 16, 8, 0, Math.PI * 2);
    ctx.fillStyle = toneColors[i];
    ctx.fill();

    ctx.fillStyle = isActive ? T.green : T.textMuted;
    ctx.font = T.fontTiny;
    ctx.textAlign = 'left';
    ctx.fillText(tone, tx + 30, ty + 20);
  });

  // Section: Movement
  const moveY = toneY + 56;
  ctx.fillStyle = T.green;
  ctx.font = T.fontLabel;
  ctx.textAlign = 'left';
  ctx.fillText('MOVEMENT', pad, moveY);

  // Toggle rows
  const toggles = [
    { label: 'Walking enabled', on: true },
    { label: 'Click-through ghost mode', on: true },
  ];
  toggles.forEach((t, i) => {
    const ty = moveY + 14 + i * 32;
    ctx.fillStyle = T.text;
    ctx.font = T.font;
    ctx.textAlign = 'left';
    ctx.fillText(t.label, pad, ty + 14);

    // Toggle switch
    const sw = W - pad - 44;
    fillRoundRect(ctx, sw, ty + 4, 36, 18, 9, t.on ? T.green : '#555');
    ctx.beginPath();
    ctx.arc(t.on ? sw + 27 : sw + 9, ty + 13, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  });

  // Section: Walking Bounds
  const boundsY = moveY + 80;
  ctx.fillStyle = T.green;
  ctx.font = T.fontLabel;
  ctx.textAlign = 'left';
  ctx.fillText('WALKING BOUNDARIES', pad, boundsY);

  // Slider rows
  const sliders = [
    { label: 'Left bound', value: '0%' },
    { label: 'Right bound', value: '0%' },
  ];
  sliders.forEach((s, i) => {
    const sy = boundsY + 14 + i * 36;
    ctx.fillStyle = T.text;
    ctx.font = T.font;
    ctx.textAlign = 'left';
    ctx.fillText(s.label, pad, sy + 14);
    ctx.fillStyle = T.textMuted;
    ctx.font = T.fontSmall;
    ctx.textAlign = 'right';
    ctx.fillText(s.value, W - pad, sy + 14);

    // Slider track
    const slX = pad;
    const slW = W - pad * 2;
    drawProgressBar(ctx, slX, sy + 22, slW, 4, 0.0, T.green);
    // Slider thumb
    ctx.beginPath();
    ctx.arc(slX + 2, sy + 24, 6, 0, Math.PI * 2);
    ctx.fillStyle = T.green;
    ctx.fill();
  });

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-settings.png'), buf);
  console.log('  -> ui-settings.png');
}

// ─────────────────────────────────────────────────────
// SPRITE EDITOR
// ─────────────────────────────────────────────────────
async function generateSpriteEditor() {
  console.log('Generating sprite editor...');
  const W = 820, H = 520;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawWindowChrome(ctx, W, H, 'Dr. Vibe \u2014 Sprite Sheet Editor');

  // Toolbar
  const tbY = 36;
  fillRoundRect(ctx, 0, tbY, W, 34, 0, T.bgPanel);
  ctx.beginPath(); ctx.moveTo(0, tbY + 34); ctx.lineTo(W, tbY + 34);
  ctx.strokeStyle = T.border; ctx.stroke();

  const toolGroups = [
    ['Pencil', 'Eraser', 'Fill', 'Eyedropper'],
    ['Undo', 'Redo'],
    ['Save to App'],
  ];
  let tx = 12;
  toolGroups.forEach((group, gi) => {
    group.forEach((tool) => {
      const isActive = tool === 'Pencil';
      const isSave = tool === 'Save to App';
      const tw = ctx.measureText(tool).width + 20;

      fillRoundRect(ctx, tx, tbY + 5, tw, 24, 4, isSave ? T.green : isActive ? T.green : '#333');
      ctx.fillStyle = isSave || isActive ? T.bg : T.text;
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tool, tx + tw / 2, tbY + 21);
      tx += tw + 4;
    });
    if (gi < toolGroups.length - 1) {
      // Separator
      ctx.fillStyle = T.borderLight;
      ctx.fillRect(tx + 2, tbY + 8, 1, 18);
      tx += 10;
    }
  });

  const mainY = tbY + 34;
  const mainH = H - mainY;

  // Left panel: Frame Navigator
  const lpW = 180;
  fillRoundRect(ctx, 0, mainY, lpW, mainH, 0, T.bgPanel);
  ctx.fillStyle = T.border;
  ctx.fillRect(lpW, mainY, 1, mainH);

  // Load sprite for thumbnails
  const spriteImg = await loadImage(path.join(SKINS_DIR, 'dr-vibe-default.png'));

  const animNames = ['idle', 'coding', 'thinking', 'tired', 'excited', 'alert',
    'walk', 'stretching', 'beaker', 'libraryCard', 'thumbsUp', 'coverEyes',
    'celebrating', 'focused', 'concerned', 'presenting'];
  const frameCounts = [3, 4, 3, 3, 4, 3, 4, 4, 3, 4, 3, 3, 4, 2, 3, 3];

  let ly = mainY + 8;
  ctx.imageSmoothingEnabled = false;
  for (let a = 0; a < Math.min(animNames.length, 8); a++) {
    // Label
    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.textAlign = 'left';
    ctx.fillText(animNames[a].toUpperCase(), 8, ly + 10);
    ly += 14;

    // Frame thumbnails
    for (let f = 0; f < frameCounts[a]; f++) {
      const fx = 8 + f * 40;
      const isSelected = a === 1 && f === 1;

      fillRoundRect(ctx, fx, ly, 36, 36, 3, '#1a1a1a');
      ctx.strokeStyle = isSelected ? T.green : T.borderLight;
      ctx.lineWidth = isSelected ? 2 : 1;
      roundRect(ctx, fx, ly, 36, 36, 3);
      ctx.stroke();

      ctx.drawImage(spriteImg, f * 32, a * 32, 32, 32, fx + 2, ly + 2, 32, 32);
    }
    ly += 42;
  }
  ctx.imageSmoothingEnabled = true;

  // Center panel: Edit canvas
  const cpX = lpW + 1;
  const rpW = 200;
  const cpW = W - lpW - rpW - 2;

  // Checkerboard background
  const checkSize = 16;
  for (let cy = mainY; cy < H; cy += checkSize) {
    for (let cx = cpX; cx < cpX + cpW; cx += checkSize) {
      const isDark = ((cx - cpX) / checkSize + (cy - mainY) / checkSize) % 2 < 1;
      ctx.fillStyle = isDark ? '#2a2a2a' : '#333';
      ctx.fillRect(cx, cy, checkSize, checkSize);
    }
  }

  // Draw enlarged sprite in center
  const editScale = 12;
  const editSize = 32 * editScale;
  const editX = cpX + (cpW - editSize) / 2;
  const editY = mainY + (mainH - editSize) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteImg, 32, 32, 32, 32, editX, editY, editSize, editSize);
  ctx.imageSmoothingEnabled = true;

  // Grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx <= 32; gx++) {
    ctx.beginPath();
    ctx.moveTo(editX + gx * editScale, editY);
    ctx.lineTo(editX + gx * editScale, editY + editSize);
    ctx.stroke();
  }
  for (let gy = 0; gy <= 32; gy++) {
    ctx.beginPath();
    ctx.moveTo(editX, editY + gy * editScale);
    ctx.lineTo(editX + editSize, editY + gy * editScale);
    ctx.stroke();
  }

  // Right panel
  const rpX = W - rpW;
  fillRoundRect(ctx, rpX, mainY, rpW, mainH, 0, T.bgPanel);
  ctx.fillStyle = T.border;
  ctx.fillRect(rpX, mainY, 1, mainH);

  let ry = mainY + 12;

  // Color palette section
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('COLOR PALETTE', rpX + 10, ry);
  ry += 10;

  const paletteColors = [
    '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
    '#ff0000', '#ff6600', '#ffcc00', '#33cc33', '#0099ff', '#9933ff',
    '#ff3366', '#ff9933', '#ffff33', '#66ff66', '#33ccff', '#cc66ff',
    '#990000', '#994400', '#999900', '#006600', '#003399', '#660099',
    '#e8b88a', '#f5d4b3', '#d4a574', '#8b6539', '#4ade80', '#60a5fa',
  ];

  paletteColors.forEach((c, i) => {
    const px = rpX + 10 + (i % 6) * 22;
    const py = ry + Math.floor(i / 6) * 22;
    ctx.fillStyle = c;
    ctx.fillRect(px, py, 18, 18);
    ctx.strokeStyle = i === 0 ? T.green : '#555';
    ctx.lineWidth = i === 0 ? 2 : 0.5;
    ctx.strokeRect(px, py, 18, 18);
  });

  ry += Math.ceil(paletteColors.length / 6) * 22 + 16;

  // Current color
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText('CURRENT', rpX + 10, ry);
  fillRoundRect(ctx, rpX + 60, ry - 10, 24, 24, 4, '#000000');
  ctx.strokeStyle = T.green;
  ctx.lineWidth = 2;
  roundRect(ctx, rpX + 60, ry - 10, 24, 24, 4);
  ctx.stroke();
  ry += 24;

  // Animation Preview section
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText('ANIMATION PREVIEW', rpX + 10, ry);
  ry += 6;

  fillRoundRect(ctx, rpX + 10, ry, rpW - 20, rpW - 60, 6, '#1a1a1a');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteImg, 32, 32, 32, 32, rpX + 10 + (rpW - 20 - 128) / 2, ry + 5, 128, 128);
  ctx.imageSmoothingEnabled = true;
  ry += rpW - 50;

  // FPS slider
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText('FPS: 8', rpX + 10, ry);
  drawProgressBar(ctx, rpX + 50, ry - 4, rpW - 70, 4, 0.4, T.green);
  ry += 16;

  // Minimap
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText('MINIMAP', rpX + 10, ry);
  ry += 6;
  const mmScale = 0.33;
  const mmW = 128 * mmScale;
  const mmH = 512 * mmScale;
  fillRoundRect(ctx, rpX + 10, ry, mmW + 4, mmH + 4, 3, '#1a1a1a');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteImg, 0, 0, 128, 512, rpX + 12, ry + 2, mmW, mmH);
  ctx.imageSmoothingEnabled = true;

  // Status bar
  fillRoundRect(ctx, 0, H - 22, W, 22, [0, 0, 12, 12], '#252525');
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('Frame: coding [1]  |  Pos: (16, 12)  |  Color: #000000  |  Size: 32x32', 12, H - 8);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-sprite-editor.png'), buf);
  console.log('  -> ui-sprite-editor.png');
}

// ─────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────
async function generateDashboard() {
  console.log('Generating dashboard...');
  const W = 560, H = 480;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawWindowChrome(ctx, W, H, 'Dashboard');

  // Tab bar
  const tabs = ['Overview', 'Achievements', 'Skills', 'History', 'Wellness'];
  const tabW = W / tabs.length;
  tabs.forEach((tab, i) => {
    const tx = i * tabW;
    const isActive = i === 0;
    ctx.fillStyle = isActive ? T.green : T.textDim;
    ctx.font = T.fontSmall;
    ctx.textAlign = 'center';
    ctx.fillText(tab, tx + tabW / 2, 56);
    if (isActive) {
      ctx.fillStyle = T.green;
      ctx.fillRect(tx + 8, 62, tabW - 16, 2);
    }
  });

  const pad = 16;
  let y = 76;

  // Hero stats row
  const heroCards = [
    { value: '12', label: 'Day Streak', color: T.orange },
    { value: 'Hot', label: 'Momentum', color: T.orange },
    { value: '4', label: 'Glasses Today', color: T.cyan },
  ];
  const heroW = (W - pad * 2 - 16) / 3;
  heroCards.forEach((card, i) => {
    const cx = pad + i * (heroW + 8);
    drawStatCard(ctx, cx, y, heroW, 70, card.value, card.label, card.color);
  });
  y += 82;

  // Section: Today's Session
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText("TODAY'S SESSION", pad, y + 8);
  y += 16;

  const sessionStats = [
    { value: '2h 34m', label: 'Coding Time' },
    { value: '18', label: 'Files Modified' },
    { value: 'dr-vibe', label: 'Active Project' },
    { value: 'JS, Rust', label: 'Languages' },
  ];
  const ssW = (W - pad * 2 - 24) / 4;
  sessionStats.forEach((s, i) => {
    const cx = pad + i * (ssW + 8);
    fillRoundRect(ctx, cx, y, ssW, 54, 6, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = T.green;
    ctx.font = T.fontBold;
    ctx.textAlign = 'center';
    ctx.fillText(s.value, cx + ssW / 2, y + 24);
    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.fillText(s.label, cx + ssW / 2, y + 42);
  });
  y += 68;

  // Section: Weekly Activity Chart
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('WEEKLY ACTIVITY', pad, y + 8);
  y += 18;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = [3.2, 4.1, 2.8, 5.5, 4.0, 1.2, 2.5];
  const maxH = 100;
  const barW = (W - pad * 2 - days.length * 6) / days.length;
  const chartY = y;

  days.forEach((day, i) => {
    const bx = pad + i * (barW + 6);
    const bh = (hours[i] / 6) * maxH;
    const by = chartY + maxH - bh;
    const isToday = i === 6;

    fillRoundRect(ctx, bx, by, barW, bh, [4, 4, 0, 0], isToday ? T.blue : '#3a3a3a');

    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.textAlign = 'center';
    ctx.fillText(day, bx + barW / 2, chartY + maxH + 14);

    ctx.fillStyle = isToday ? T.blue : T.textMuted;
    ctx.fillText(`${hours[i]}h`, bx + barW / 2, by - 6);
  });
  y = chartY + maxH + 28;

  // Section: Personal Bests
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('PERSONAL BESTS', pad, y + 8);
  y += 18;

  const bests = [
    { label: 'Longest Session', value: '4h 12m', icon: '\u23F1' },
    { label: 'Most Files', value: '47 files', icon: '\u{1F4C1}' },
  ];
  const bestW = (W - pad * 2 - 8) / 2;
  bests.forEach((b, i) => {
    const cx = pad + i * (bestW + 8);
    fillRoundRect(ctx, cx, y, bestW, 44, 6, 'rgba(0,0,0,0.3)');
    ctx.strokeStyle = T.orange;
    ctx.lineWidth = 1;
    roundRect(ctx, cx, y, bestW, 44, 6);
    ctx.stroke();
    ctx.fillStyle = T.orange;
    ctx.font = T.fontBold;
    ctx.textAlign = 'center';
    ctx.fillText(b.value, cx + bestW / 2, y + 20);
    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.fillText(b.label, cx + bestW / 2, y + 35);
  });

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-dashboard.png'), buf);
  console.log('  -> ui-dashboard.png');
}

// ─────────────────────────────────────────────────────
// SESSION STATS
// ─────────────────────────────────────────────────────
async function generateSessionPanel() {
  console.log('Generating session panel...');
  const W = 380, H = 460;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawWindowChrome(ctx, W, H, 'Session Stats');
  const pad = 16;
  let y = 48;

  // Project name
  ctx.fillStyle = T.textMuted;
  ctx.font = T.fontSmall;
  ctx.textAlign = 'center';
  ctx.fillText('dr-vibe', W / 2, y + 8);
  y += 20;

  // Stats grid (2x2)
  const stats = [
    { value: '2h 34m', label: 'Coding Time', color: T.green },
    { value: '12', label: 'Day Streak', color: T.orange },
    { value: '3', label: 'New Files', color: T.blue },
    { value: '18', label: 'Changed Files', color: T.green },
  ];
  const cardW = (W - pad * 2 - 8) / 2;
  stats.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = pad + col * (cardW + 8);
    const cy = y + row * 72;
    drawStatCard(ctx, cx, cy, cardW, 64, s.value, s.label, s.color);
  });
  y += 152;

  // Coding Ratio
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('CODING RATIO', pad, y);
  y += 8;
  ctx.fillStyle = T.text;
  ctx.font = T.fontBold;
  ctx.fillText('72%', pad, y + 12);
  ctx.fillStyle = T.textMuted;
  ctx.font = T.fontSmall;
  ctx.fillText('of session active', pad + 40, y + 12);
  y += 18;
  drawProgressBar(ctx, pad, y, W - pad * 2, 6, 0.72, T.green);
  y += 20;

  // Activity Timeline
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('ACTIVITY TIMELINE', pad, y);
  y += 10;

  // Simulated timeline blocks
  const segments = [
    { w: 0.15, coding: true },
    { w: 0.05, coding: false },
    { w: 0.25, coding: true },
    { w: 0.03, coding: false },
    { w: 0.18, coding: true },
    { w: 0.08, coding: false },
    { w: 0.12, coding: true },
    { w: 0.04, coding: false },
    { w: 0.10, coding: true },
  ];
  const tlW = W - pad * 2;
  let tlX = pad;
  segments.forEach((seg) => {
    const sw = tlW * seg.w;
    fillRoundRect(ctx, tlX, y, sw - 1, 16, 3, seg.coding ? T.green : '#3a3a3a');
    tlX += sw;
  });
  y += 28;

  // Legend
  ctx.beginPath();
  ctx.arc(pad + 6, y + 4, 4, 0, Math.PI * 2);
  ctx.fillStyle = T.green;
  ctx.fill();
  ctx.fillStyle = T.textMuted;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('Coding', pad + 14, y + 8);

  ctx.beginPath();
  ctx.arc(pad + 66, y + 4, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#3a3a3a';
  ctx.fill();
  ctx.fillStyle = T.textMuted;
  ctx.fillText('Idle', pad + 74, y + 8);
  y += 22;

  // Recent Files
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('RECENT FILES', pad, y);
  y += 8;

  const files = [
    { name: 'SpriteAnimator.js', path: 'src/features/character/', time: '2m ago' },
    { name: 'main.rs', path: 'src-tauri/src/', time: '8m ago' },
    { name: 'settings.html', path: 'src/', time: '15m ago' },
  ];
  files.forEach((f) => {
    fillRoundRect(ctx, pad, y, W - pad * 2, 32, 4, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = T.text;
    ctx.font = T.fontBold;
    ctx.textAlign = 'left';
    ctx.fillText(f.name, pad + 8, y + 14);
    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.fillText(f.path, pad + 8, y + 26);
    ctx.fillStyle = T.textMuted;
    ctx.textAlign = 'right';
    ctx.fillText(f.time, W - pad - 8, y + 18);
    y += 36;
  });

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-session.png'), buf);
  console.log('  -> ui-session.png');
}

// ─────────────────────────────────────────────────────
// ACHIEVEMENTS
// ─────────────────────────────────────────────────────
async function generateAchievementsPanel() {
  console.log('Generating achievements panel...');
  const W = 400, H = 420;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawWindowChrome(ctx, W, H, 'Achievements');
  const pad = 14;
  let y = 48;

  // Header count
  ctx.fillStyle = T.green;
  ctx.font = T.fontHeader;
  ctx.textAlign = 'left';
  ctx.fillText('Achievements', pad, y + 8);
  ctx.fillStyle = T.textMuted;
  ctx.font = T.fontSmall;
  ctx.textAlign = 'right';
  ctx.fillText('8 / 24 unlocked', W - pad, y + 8);
  y += 24;

  // Unlocked achievements
  const unlocked = [
    { title: 'First Steps', desc: 'Complete your first coding session', icon: '\u{1F3C3}', date: 'Feb 12' },
    { title: 'Hour Power', desc: 'Code for a full hour straight', icon: '\u26A1', date: 'Feb 13' },
    { title: 'Streak Week', desc: '7-day coding streak', icon: '\u{1F525}', date: 'Feb 14' },
    { title: 'JS Journeyman', desc: '5 hours of JavaScript', icon: '\u{1F4DC}', date: 'Feb 14' },
  ];

  unlocked.forEach((a) => {
    fillRoundRect(ctx, pad, y, W - pad * 2, 56, 8, 'rgba(74,222,128,0.05)');
    ctx.strokeStyle = 'rgba(74,222,128,0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, pad, y, W - pad * 2, 56, 8);
    ctx.stroke();

    // Emblem circle
    ctx.beginPath();
    ctx.arc(pad + 26, y + 28, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(74,222,128,0.15)';
    ctx.fill();
    ctx.strokeStyle = T.green;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = T.text;
    ctx.font = '16px "Segoe UI"';
    ctx.textAlign = 'center';
    ctx.fillText(a.icon, pad + 26, y + 34);

    // Text
    ctx.fillStyle = T.text;
    ctx.font = T.fontBold;
    ctx.textAlign = 'left';
    ctx.fillText(a.title, pad + 52, y + 22);
    ctx.fillStyle = T.textMuted;
    ctx.font = T.fontTiny;
    ctx.fillText(a.desc, pad + 52, y + 36);
    ctx.fillStyle = T.green;
    ctx.font = T.fontTiny;
    ctx.textAlign = 'right';
    ctx.fillText(a.date, W - pad - 8, y + 22);
    y += 62;
  });

  // Locked with progress
  y += 6;
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'left';
  ctx.fillText('IN PROGRESS', pad, y);
  y += 10;

  const locked = [
    { title: 'Month Master', desc: '30-day coding streak', icon: '\u{1F3C6}', progress: 0.4, progressText: '12/30 days' },
    { title: 'Polyglot', desc: 'Code in 3+ languages', icon: '\u{1F310}', progress: 0.66, progressText: '2/3 langs' },
  ];

  locked.forEach((a) => {
    fillRoundRect(ctx, pad, y, W - pad * 2, 62, 8, 'rgba(80,80,80,0.3)');
    ctx.strokeStyle = T.borderLight;
    ctx.lineWidth = 1;
    roundRect(ctx, pad, y, W - pad * 2, 62, 8);
    ctx.stroke();

    // Emblem (dimmed)
    ctx.beginPath();
    ctx.arc(pad + 26, y + 24, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,100,100,0.2)';
    ctx.fill();
    ctx.strokeStyle = T.borderLight;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = T.textDim;
    ctx.font = '16px "Segoe UI"';
    ctx.textAlign = 'center';
    ctx.fillText(a.icon, pad + 26, y + 30);

    // Text
    ctx.fillStyle = T.textMuted;
    ctx.font = T.fontBold;
    ctx.textAlign = 'left';
    ctx.fillText(a.title, pad + 52, y + 20);
    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.fillText(a.desc, pad + 52, y + 34);

    // Progress bar
    drawProgressBar(ctx, pad + 52, y + 42, W - pad * 2 - 60, 6, a.progress, T.green);
    ctx.fillStyle = T.textDim;
    ctx.font = T.fontTiny;
    ctx.textAlign = 'right';
    ctx.fillText(a.progressText, W - pad - 8, y + 34);
    y += 68;
  });

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-achievements.png'), buf);
  console.log('  -> ui-achievements.png');
}

// ─────────────────────────────────────────────────────
// TOAST NOTIFICATION
// ─────────────────────────────────────────────────────
function generateToastNotification() {
  console.log('Generating toast notifications...');
  const W = 360, H = 280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, W, H);

  const toasts = [
    { title: 'Achievement Unlocked!', body: 'Streak Week — 7 consecutive days of coding', color: T.yellow, icon: '\u{1F3C6}', progress: 0.7 },
    { title: 'Hydration Reminder', body: "Hey, don't forget to drink some water!", color: T.cyan, icon: '\u{1F4A7}', progress: 0.3 },
    { title: 'Personal Best!', body: 'New record: 47 files in one session', color: T.orange, icon: '\u2B50', progress: 0.9 },
  ];

  toasts.forEach((toast, i) => {
    const tx = 0;
    const ty = i * 90;
    const tw = W;
    const th = 82;

    // Toast background with glassmorphic effect
    fillRoundRect(ctx, tx, ty, tw, th, 12, 'rgba(30,30,36,0.95)');
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, tx, ty, tw, th, 12);
    ctx.stroke();

    // Left color bar
    fillRoundRect(ctx, tx, ty, 4, th, [12, 0, 0, 12], toast.color);

    // Glow
    ctx.save();
    ctx.shadowColor = toast.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(tx, ty, 4, th);
    ctx.restore();

    // Icon
    ctx.font = '18px "Segoe UI"';
    ctx.textAlign = 'left';
    ctx.fillText(toast.icon, tx + 16, ty + 30);

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(toast.title, tx + 42, ty + 28);

    // Body
    ctx.fillStyle = '#a8a8b0';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(toast.body, tx + 42, ty + 48);

    // Close button
    ctx.fillStyle = '#666';
    ctx.font = '14px "Segoe UI"';
    ctx.textAlign = 'right';
    ctx.fillText('\u2715', tw - 12, ty + 22);

    // Progress bar at bottom
    drawProgressBar(ctx, tx + 12, ty + th - 8, tw - 24, 3, toast.progress, toast.color, 'rgba(255,255,255,0.06)');
  });

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-toasts.png'), buf);
  console.log('  -> ui-toasts.png');
}

// ─────────────────────────────────────────────────────
// MAIN CHARACTER WINDOW (mock)
// ─────────────────────────────────────────────────────
async function generateMainWindow() {
  console.log('Generating main window...');
  const W = 220, H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Transparent-ish dark background to show the concept
  fillRoundRect(ctx, 0, 0, W, H, 12, 'rgba(20,20,20,0.6)');

  // Character
  const spriteImg = await loadImage(path.join(SKINS_DIR, 'dr-vibe-default.png'));
  const charSize = 160;
  const charX = (W - charSize) / 2;
  const charY = 20;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteImg, 32, 32, 32, 32, charX, charY, charSize, charSize);
  ctx.imageSmoothingEnabled = true;

  // Speech bubble above (offset)
  const bubbleW = 170;
  const bubbleH = 48;
  const bubbleX = (W - bubbleW) / 2;
  const bubbleY = charY - 4;
  fillRoundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 10, 'rgba(30,30,30,0.92)');
  ctx.strokeStyle = 'rgba(74,222,128,0.2)';
  ctx.lineWidth = 1;
  roundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 10);
  ctx.stroke();

  // Bubble arrow
  ctx.fillStyle = 'rgba(30,30,30,0.92)';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 6, bubbleY + bubbleH);
  ctx.lineTo(W / 2, bubbleY + bubbleH + 8);
  ctx.lineTo(W / 2 + 6, bubbleY + bubbleH);
  ctx.fill();

  ctx.fillStyle = T.green;
  ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText("You're on fire! Keep it up!", W / 2, bubbleY + 22);
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText('click to dismiss', W / 2, bubbleY + 38);

  // Momentum meter
  const meterY = charY + charSize + 8;
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.textAlign = 'center';
  ctx.fillText('MOMENTUM', W / 2, meterY);
  drawProgressBar(ctx, (W - 80) / 2, meterY + 4, 80, 4, 0.75, T.orange);

  // Project badge
  const badgeY = meterY + 18;
  const badgeW = 90;
  fillRoundRect(ctx, (W - badgeW) / 2, badgeY, badgeW, 20, 10, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = T.textMuted;
  ctx.font = T.fontTiny;
  ctx.fillText('dr-vibe', W / 2, badgeY + 14);

  // Session context
  const scY = badgeY + 28;
  ctx.fillStyle = T.textDim;
  ctx.font = T.fontTiny;
  ctx.fillText('3 active files', W / 2, scY);

  // Focus mode button
  const fbY = scY + 16;
  fillRoundRect(ctx, (W - 100) / 2, fbY, 100, 24, 6, 'rgba(74,222,128,0.1)');
  ctx.strokeStyle = 'rgba(74,222,128,0.3)';
  ctx.lineWidth = 1;
  roundRect(ctx, (W - 100) / 2, fbY, 100, 24, 6);
  ctx.stroke();
  ctx.fillStyle = T.green;
  ctx.font = T.fontSmall;
  ctx.fillText('Start Focus', W / 2, fbY + 16);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'ui-main-window.png'), buf);
  console.log('  -> ui-main-window.png');
}

// ─────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Generating UI mockup images...\n');

  await generateSettingsPanel();
  await generateSpriteEditor();
  await generateDashboard();
  await generateSessionPanel();
  await generateAchievementsPanel();
  generateToastNotification();
  await generateMainWindow();

  console.log('\nDone! UI mockups saved to docs/images/');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
