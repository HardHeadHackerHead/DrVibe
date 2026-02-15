#!/usr/bin/env node
// Dr. Vibe — Sprite Sheet Generator
// Renders the procedural character into a PNG sprite sheet.
// Usage: node tools/generate-spritesheet.js

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// ── Animation config (mirrored from src/config/animations.js) ──
const ANIMATIONS = {
  idle:        { row: 0, frameCount: 3, placeholderColor: '#4a90d9' },
  coding:      { row: 1, frameCount: 4, placeholderColor: '#4ade80' },
  thinking:    { row: 2, frameCount: 3, placeholderColor: '#facc15' },
  tired:       { row: 3, frameCount: 3, placeholderColor: '#9ca3af' },
  excited:     { row: 4, frameCount: 4, placeholderColor: '#f472b6' },
  alert:       { row: 5, frameCount: 3, placeholderColor: '#f87171' },
  walkRight:   { row: 6, frameCount: 4, placeholderColor: '#60a5fa' },
  stretching:  { row: 7, frameCount: 4, placeholderColor: '#f97316' },
  beaker:      { row: 8, frameCount: 3, placeholderColor: '#67e8f9' },
  libraryCard: { row: 9, frameCount: 4, placeholderColor: '#fbbf24' },
  thumbsUp:    { row: 10, frameCount: 3, placeholderColor: '#4ade80' },
  coverEyes:   { row: 11, frameCount: 3, placeholderColor: '#a78bfa' },
  celebrating: { row: 12, frameCount: 4, placeholderColor: '#f472b6' },
  focused:     { row: 13, frameCount: 2, placeholderColor: '#6366f1' },
  concerned:   { row: 14, frameCount: 3, placeholderColor: '#f59e0b' },
  presenting:  { row: 15, frameCount: 3, placeholderColor: '#2dd4bf' },
};

const FRAME_W = 32;
const FRAME_H = 32;

// ── Color palette ──
const PAL = {
  skin:       '#fdd8b0',
  skinShade:  '#e8b888',
  skinDark:   '#d4a878',
  hair:       '#b8b8c8',
  hairHi:     '#d0d0dc',
  hairDk:     '#9898a8',
  coat:       '#f5f5fa',
  coatShade:  '#dde0ea',
  coatDark:   '#c0c4d0',
  eye:        '#2a2a3a',
  eyeHi:      '#ffffff',
  gogFrame:   '#3a3a4a',
  gogLens:    '#5ce0ff',
  gogGlint:   '#a0f0ff',
  mouth:      '#c07060',
  mouthOpen:  '#8b4040',
  pants:      '#3a3a50',
  pantsHi:    '#4a4a60',
  shoes:      '#2a2a35',
  shoeHi:     '#3a3a45',
};

// ── Drawing helpers ──

function drawCharBase(ctx, x, by, color, gogglesDown) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x + 10, by + 25, 12, 1);

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(x + 8, by + 26, 16, 2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = PAL.shoes;
  ctx.fillRect(x + 11, by + 24, 4, 1);
  ctx.fillRect(x + 17, by + 24, 4, 1);
  ctx.fillStyle = PAL.shoeHi;
  ctx.fillRect(x + 11, by + 24, 1, 1);
  ctx.fillRect(x + 17, by + 24, 1, 1);

  ctx.fillStyle = PAL.pants;
  ctx.fillRect(x + 12, by + 21, 3, 3);
  ctx.fillRect(x + 17, by + 21, 3, 3);
  ctx.fillStyle = PAL.pantsHi;
  ctx.fillRect(x + 12, by + 21, 1, 2);
  ctx.fillRect(x + 17, by + 21, 1, 2);

  ctx.fillStyle = PAL.coat;
  ctx.fillRect(x + 9, by + 13, 14, 8);
  ctx.fillStyle = PAL.coatShade;
  ctx.fillRect(x + 14, by + 13, 1, 2);
  ctx.fillRect(x + 17, by + 13, 1, 2);
  ctx.fillStyle = PAL.skin;
  ctx.fillRect(x + 15, by + 13, 2, 1);
  ctx.fillStyle = PAL.coatDark;
  ctx.fillRect(x + 16, by + 15, 1, 5);
  ctx.fillStyle = PAL.coatShade;
  ctx.fillRect(x + 10, by + 16, 3, 2);
  ctx.fillRect(x + 9, by + 18, 14, 2);
  ctx.fillStyle = PAL.coatDark;
  ctx.fillRect(x + 10, by + 20, 12, 1);

  ctx.fillStyle = PAL.skinShade;
  ctx.fillRect(x + 14, by + 12, 4, 1);

  ctx.fillStyle = PAL.skin;
  ctx.fillRect(x + 11, by + 3, 10, 9);
  ctx.fillStyle = PAL.skinShade;
  ctx.fillRect(x + 11, by + 6, 1, 5);
  ctx.fillRect(x + 20, by + 6, 1, 5);
  ctx.fillStyle = PAL.skinDark;
  ctx.fillRect(x + 13, by + 11, 6, 1);

  ctx.fillStyle = PAL.hair;
  ctx.fillRect(x + 9,  by, 2, 1);
  ctx.fillRect(x + 13, by, 3, 1);
  ctx.fillRect(x + 19, by, 2, 1);
  ctx.fillRect(x + 9,  by + 1, 14, 1);
  ctx.fillRect(x + 10, by + 2, 12, 1);
  ctx.fillStyle = PAL.hairHi;
  ctx.fillRect(x + 11, by + 1, 2, 1);
  ctx.fillRect(x + 17, by + 1, 2, 1);
  ctx.fillStyle = PAL.hairDk;
  ctx.fillRect(x + 9,  by + 2, 1, 1);
  ctx.fillRect(x + 21, by + 2, 1, 1);

  if (gogglesDown) {
    ctx.fillStyle = PAL.gogFrame;
    ctx.fillRect(x + 11, by + 7, 4, 2);
    ctx.fillRect(x + 17, by + 7, 4, 2);
    ctx.fillRect(x + 15, by + 7, 2, 1);
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(x + 12, by + 7, 2, 1);
    ctx.fillRect(x + 18, by + 7, 2, 1);
    ctx.fillStyle = '#818cf8';
    ctx.fillRect(x + 12, by + 8, 2, 1);
    ctx.fillRect(x + 18, by + 8, 2, 1);
  } else {
    ctx.fillStyle = PAL.gogFrame;
    ctx.fillRect(x + 11, by + 3, 4, 2);
    ctx.fillRect(x + 17, by + 3, 4, 2);
    ctx.fillRect(x + 15, by + 3, 2, 1);
    ctx.fillStyle = PAL.gogLens;
    ctx.fillRect(x + 12, by + 3, 2, 1);
    ctx.fillRect(x + 18, by + 3, 2, 1);
    ctx.fillStyle = PAL.gogGlint;
    ctx.fillRect(x + 12, by + 3, 1, 1);
    ctx.fillRect(x + 18, by + 3, 1, 1);
  }
}

function drawEyes(ctx, x, by, style) {
  const L = x + 13, R = x + 17;
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
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(L, by + 6, 2, 3);
      ctx.fillRect(R, by + 6, 2, 3);
      ctx.fillStyle = PAL.eyeHi;
      ctx.fillRect(L, by + 6, 1, 1);
      ctx.fillRect(R, by + 6, 1, 1);
      break;
    case 'tired':
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(L, by + 8, 2, 1);
      ctx.fillRect(R, by + 8, 2, 1);
      ctx.fillStyle = PAL.skinShade;
      ctx.fillRect(L, by + 7, 2, 1);
      ctx.fillRect(R, by + 7, 2, 1);
      break;
    case 'squint':
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(L, by + 7, 2, 1);
      ctx.fillRect(R, by + 7, 2, 1);
      break;
    case 'lookUp':
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(L, by + 6, 2, 2);
      ctx.fillRect(R, by + 6, 2, 2);
      ctx.fillStyle = PAL.eyeHi;
      ctx.fillRect(L + 1, by + 6, 1, 1);
      ctx.fillRect(R + 1, by + 6, 1, 1);
      break;
    case 'lookDown':
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(L, by + 8, 2, 2);
      ctx.fillRect(R, by + 8, 2, 2);
      ctx.fillStyle = PAL.eyeHi;
      ctx.fillRect(L, by + 8, 1, 1);
      ctx.fillRect(R, by + 8, 1, 1);
      break;
    case 'sparkle':
      ctx.fillStyle = PAL.eye;
      ctx.fillRect(L, by + 7, 2, 2);
      ctx.fillRect(R, by + 7, 2, 2);
      ctx.fillStyle = PAL.eyeHi;
      ctx.fillRect(L, by + 7, 1, 1);
      ctx.fillRect(L + 1, by + 8, 1, 1);
      ctx.fillRect(R, by + 7, 1, 1);
      ctx.fillRect(R + 1, by + 8, 1, 1);
      break;
  }
}

function drawMouth(ctx, x, by, style) {
  switch (style) {
    case 'smile':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 14, by + 10, 4, 1);
      ctx.fillRect(x + 15, by + 11, 2, 1);
      break;
    case 'grin':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 13, by + 10, 6, 1);
      ctx.fillStyle = PAL.mouthOpen;
      ctx.fillRect(x + 14, by + 11, 4, 1);
      break;
    case 'frown':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 14, by + 11, 4, 1);
      ctx.fillRect(x + 13, by + 10, 1, 1);
      ctx.fillRect(x + 18, by + 10, 1, 1);
      break;
    case 'o':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 15, by + 10, 2, 1);
      ctx.fillStyle = PAL.mouthOpen;
      ctx.fillRect(x + 15, by + 11, 2, 1);
      break;
    case 'neutral':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 14, by + 10, 4, 1);
      break;
    case 'open':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 14, by + 10, 4, 1);
      ctx.fillStyle = PAL.mouthOpen;
      ctx.fillRect(x + 14, by + 11, 4, 1);
      break;
    case 'smirk':
      ctx.fillStyle = PAL.mouth;
      ctx.fillRect(x + 14, by + 10, 4, 1);
      ctx.fillRect(x + 17, by + 9, 1, 1);
      break;
  }
}

function drawBrows(ctx, x, by, style) {
  ctx.fillStyle = PAL.eye;
  switch (style) {
    case 'worried':
      ctx.fillRect(x + 12, by + 5, 3, 1);
      ctx.fillRect(x + 13, by + 6, 2, 1);
      ctx.fillRect(x + 17, by + 5, 3, 1);
      ctx.fillRect(x + 17, by + 6, 2, 1);
      break;
    case 'raised':
      ctx.fillRect(x + 12, by + 5, 3, 1);
      ctx.fillRect(x + 17, by + 5, 3, 1);
      break;
  }
}

function drawArmsDown(ctx, x, by) {
  ctx.fillStyle = PAL.coat;
  ctx.fillRect(x + 5, by + 14, 3, 6);
  ctx.fillRect(x + 24, by + 14, 3, 6);
  ctx.fillStyle = PAL.skin;
  ctx.fillRect(x + 5, by + 19, 3, 2);
  ctx.fillRect(x + 24, by + 19, 3, 2);
}

// ── Standing character (all non-walking, non-coverEyes states) ──

function drawFrame(ctx, col, row, color, animState) {
  const x = col * FRAME_W;
  const y = row * FRAME_H;
  const bounce = col % 2;
  const by = y + 3 - bounce;

  if (animState === 6) { drawWalkingFrame(ctx, x, y, col, color); return; }
  if (animState === 11) { drawCoverEyesFrame(ctx, x, by, col, color); return; }

  const gogglesDown = animState === 13;
  drawCharBase(ctx, x, by, color, gogglesDown);

  switch (animState) {
    case 0: // idle
      drawEyes(ctx, x, by, 'normal');
      drawMouth(ctx, x, by, col === 1 ? 'smile' : 'neutral');
      drawArmsDown(ctx, x, by);
      break;
    case 1: // coding
      drawEyes(ctx, x, by, col % 2 === 0 ? 'normal' : 'lookDown');
      drawMouth(ctx, x, by, 'neutral');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 4, by + 11, 3, 7);
      ctx.fillRect(x + 25, by + 11, 3, 7);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 4, by + 17, 3, 2);
      ctx.fillRect(x + 25, by + 17, 3, 2);
      break;
    case 2: // thinking
      drawEyes(ctx, x, by, 'lookUp');
      drawMouth(ctx, x, by, 'neutral');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 21, by + 10, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 21, by + 9, 3, 2);
      break;
    case 3: // tired
      drawEyes(ctx, x, by, 'tired');
      drawMouth(ctx, x, by, 'frown');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 15, 3, 6);
      ctx.fillRect(x + 24, by + 15, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 20, 3, 2);
      ctx.fillRect(x + 24, by + 20, 3, 2);
      break;
    case 4: // excited
      drawEyes(ctx, x, by, 'sparkle');
      drawMouth(ctx, x, by, 'grin');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 3, by + 9, 3, 7);
      ctx.fillRect(x + 26, by + 9, 3, 7);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 3, by + 8, 3, 2);
      ctx.fillRect(x + 26, by + 8, 3, 2);
      break;
    case 5: // alert
      drawEyes(ctx, x, by, 'wide');
      drawBrows(ctx, x, by, 'raised');
      drawMouth(ctx, x, by, 'o');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 4, by + 13, 3, 6);
      ctx.fillRect(x + 25, by + 13, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 4, by + 18, 3, 2);
      ctx.fillRect(x + 25, by + 18, 3, 2);
      break;
    case 7: // stretching
      drawEyes(ctx, x, by, 'lookUp');
      drawMouth(ctx, x, by, col >= 2 ? 'open' : 'smile');
      if (col === 0) {
        drawArmsDown(ctx, x, by);
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
      drawEyes(ctx, x, by, 'normal');
      drawMouth(ctx, x, by, col === 2 ? 'grin' : 'smile');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      if (col === 0) {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 24, by + 10, 3, 7);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 24, by + 9, 3, 2);
        ctx.fillStyle = '#67e8f9';
        ctx.fillRect(x + 25, by + 5, 4, 5);
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(x + 25, by + 5, 4, 1);
      } else if (col === 1) {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 24, by + 6, 3, 9);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 24, by + 5, 3, 2);
        ctx.fillStyle = '#67e8f9';
        ctx.fillRect(x + 25, by + 1, 4, 5);
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(x + 25, by + 1, 4, 1);
        ctx.fillStyle = '#a5f3fc';
        ctx.fillRect(x + 26, by, 1, 1);
        ctx.fillRect(x + 28, by + 1, 1, 1);
      } else {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 24, by + 8, 3, 8);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 24, by + 7, 3, 2);
        ctx.fillStyle = '#67e8f9';
        ctx.fillRect(x + 25, by + 3, 4, 5);
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(x + 25, by + 3, 4, 1);
        ctx.fillStyle = '#a5f3fc';
        ctx.fillRect(x + 27, by + 2, 1, 1);
      }
      break;
    case 9: // libraryCard
      drawEyes(ctx, x, by, col === 0 ? 'normal' : 'sparkle');
      drawMouth(ctx, x, by, col >= 2 ? 'grin' : 'smile');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 23, by + 10, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 23, by + 9, 3, 2);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(x + 24, by + 5, 5, 4);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x + 24, by + 5, 5, 1);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(x + 25, by + 7, 3, 1);
      break;
    case 10: // thumbsUp
      drawEyes(ctx, x, by, 'normal');
      drawMouth(ctx, x, by, 'grin');
      // Left arm down at side
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      if (col === 0) {
        // Frame 0: right arm down at side (wind-up)
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 24, by + 14, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 24, by + 19, 3, 2);
      } else {
        // Frames 1-2: right arm raised with thumbs up
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 25, by + 8, 3, 8);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 25, by + 6, 3, 3);
        ctx.fillRect(x + 26, by + 5, 2, 2);
      }
      break;
    case 12: // celebrating
      drawEyes(ctx, x, by, 'sparkle');
      drawMouth(ctx, x, by, 'grin');
      if (col % 2 === 0) {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 3, by + 6, 3, 8);
        ctx.fillRect(x + 26, by + 6, 3, 8);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 3, by + 4, 3, 3);
        ctx.fillRect(x + 26, by + 4, 3, 3);
      } else {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 2, by + 4, 3, 10);
        ctx.fillRect(x + 27, by + 4, 3, 10);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 2, by + 2, 3, 3);
        ctx.fillRect(x + 27, by + 2, 3, 3);
      }
      break;
    case 13: // focused (goggles down)
      drawMouth(ctx, x, by, 'neutral');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 4, by + 11, 3, 7);
      ctx.fillRect(x + 25, by + 11, 3, 7);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 4, by + 17, 3, 2);
      ctx.fillRect(x + 25, by + 17, 3, 2);
      break;
    case 14: // concerned
      drawEyes(ctx, x, by, 'normal');
      drawBrows(ctx, x, by, 'worried');
      drawMouth(ctx, x, by, 'frown');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 13, 3, 7);
      ctx.fillRect(x + 24, by + 13, 3, 7);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      ctx.fillRect(x + 24, by + 19, 3, 2);
      break;
    case 15: // presenting
      drawEyes(ctx, x, by, 'normal');
      drawMouth(ctx, x, by, 'smile');
      ctx.fillStyle = PAL.coat;
      ctx.fillRect(x + 5, by + 14, 3, 6);
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(x + 5, by + 19, 3, 2);
      if (col === 0) {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 24, by + 12, 3, 6);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 24, by + 17, 3, 2);
      } else {
        ctx.fillStyle = PAL.coat;
        ctx.fillRect(x + 25, by + 8, 3, 8);
        ctx.fillStyle = PAL.skin;
        ctx.fillRect(x + 26, by + 7, 3, 2);
      }
      break;
    default:
      drawEyes(ctx, x, by, 'normal');
      drawMouth(ctx, x, by, 'smile');
      drawArmsDown(ctx, x, by);
      break;
  }
}

// ── Cover Eyes ──

function drawCoverEyesFrame(ctx, x, by, col, color) {
  drawCharBase(ctx, x, by, color, false);

  if (col === 0) {
    ctx.fillStyle = PAL.eye;
    ctx.fillRect(x + 13, by + 8, 2, 1);
    ctx.fillRect(x + 17, by + 8, 2, 1);
    drawMouth(ctx, x, by, 'neutral');
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 5, by + 10, 3, 7);
    ctx.fillRect(x + 24, by + 10, 3, 7);
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 7, by + 8, 3, 3);
    ctx.fillRect(x + 22, by + 8, 3, 3);
  } else if (col === 1) {
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 10, by + 6, 12, 4);
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 13, by + 6, 1, 4);
    ctx.fillRect(x + 16, by + 6, 1, 4);
    ctx.fillRect(x + 19, by + 6, 1, 4);
    drawMouth(ctx, x, by, 'neutral');
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 5, by + 8, 5, 8);
    ctx.fillRect(x + 22, by + 8, 5, 8);
  } else {
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 10, by + 6, 12, 4);
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 12, by + 6, 1, 4);
    ctx.fillRect(x + 16, by + 6, 1, 4);
    ctx.fillRect(x + 20, by + 6, 1, 4);
    ctx.fillStyle = PAL.eye;
    ctx.fillRect(x + 13, by + 7, 2, 2);
    ctx.fillStyle = PAL.eyeHi;
    ctx.fillRect(x + 13, by + 7, 1, 1);
    drawMouth(ctx, x, by, 'smile');
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 5, by + 8, 5, 8);
    ctx.fillRect(x + 22, by + 8, 5, 8);
  }
}

// ── Walking ──

function drawWalkingFrame(ctx, x, baseY, col, color) {
  const isContact = col === 0 || col === 2;
  const bobY = isContact ? 1 : 0;
  const by = baseY + 3 + bobY;
  const leanX = isContact ? 1 : 0;

  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  const shW = isContact ? 14 : 12;
  ctx.fillRect(x + 16 - shW / 2, by + 25, shW, 1);

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(x + 8, by + 26, 16, 2);
  ctx.globalAlpha = 1;

  // Shoes
  ctx.fillStyle = PAL.shoes;
  if (col === 0) {
    ctx.fillRect(x + 18 + leanX, by + 24, 4, 1);
    ctx.fillRect(x + 10 + leanX, by + 24, 3, 1);
  } else if (col === 2) {
    ctx.fillRect(x + 10 + leanX, by + 24, 4, 1);
    ctx.fillRect(x + 19 + leanX, by + 24, 3, 1);
  } else {
    ctx.fillRect(x + 12, by + 24, 4, 1);
    ctx.fillRect(x + 17, by + 24, 4, 1);
  }

  // Legs
  ctx.fillStyle = PAL.pants;
  if (col === 0 || col === 2) {
    ctx.fillRect(x + 12 + leanX, by + 21, 3, 3);
    ctx.fillRect(x + 17 + leanX, by + 21, 3, 3);
  } else {
    ctx.fillRect(x + 13, by + 21, 3, 3);
    ctx.fillRect(x + 17, by + 21, 3, 3);
    ctx.fillStyle = PAL.pantsHi;
    ctx.fillRect(x + 13, by + 21, 1, 2);
    ctx.fillRect(x + 17, by + 21, 1, 2);
  }

  // Coat
  ctx.fillStyle = PAL.coat;
  ctx.fillRect(x + 9 + leanX, by + 13, 14, 8);
  ctx.fillStyle = PAL.coatShade;
  ctx.fillRect(x + 14 + leanX, by + 13, 1, 2);
  ctx.fillRect(x + 17 + leanX, by + 13, 1, 2);
  ctx.fillStyle = PAL.skin;
  ctx.fillRect(x + 15 + leanX, by + 13, 2, 1);
  ctx.fillStyle = PAL.coatDark;
  ctx.fillRect(x + 16 + leanX, by + 15, 1, 5);
  ctx.fillStyle = PAL.coatShade;
  ctx.fillRect(x + 10 + leanX, by + 16, 3, 2);
  ctx.fillRect(x + 9 + leanX, by + 18, 14, 2);
  ctx.fillStyle = PAL.coatDark;
  ctx.fillRect(x + 10 + leanX, by + 20, 12, 1);

  // Neck
  ctx.fillStyle = PAL.skinShade;
  ctx.fillRect(x + 14 + leanX, by + 12, 4, 1);

  // Head
  ctx.fillStyle = PAL.skin;
  ctx.fillRect(x + 11 + leanX, by + 3, 10, 9);
  ctx.fillStyle = PAL.skinShade;
  ctx.fillRect(x + 11 + leanX, by + 6, 1, 5);
  ctx.fillRect(x + 20 + leanX, by + 6, 1, 5);
  ctx.fillStyle = PAL.skinDark;
  ctx.fillRect(x + 13 + leanX, by + 11, 6, 1);

  // Hair
  const hb = isContact ? 0 : -1;
  ctx.fillStyle = PAL.hair;
  ctx.fillRect(x + 9 + leanX,  by + hb, 2, 1);
  ctx.fillRect(x + 13 + leanX, by + hb, 3, 1);
  ctx.fillRect(x + 19 + leanX, by + hb, 2, 1);
  ctx.fillRect(x + 9 + leanX,  by + 1 + hb, 14, 1);
  ctx.fillRect(x + 10 + leanX, by + 2 + hb, 12, 1);
  ctx.fillStyle = PAL.hairHi;
  ctx.fillRect(x + 11 + leanX, by + 1 + hb, 2, 1);
  ctx.fillRect(x + 17 + leanX, by + 1 + hb, 2, 1);
  ctx.fillStyle = PAL.hairDk;
  ctx.fillRect(x + 9 + leanX,  by + 2 + hb, 1, 1);
  ctx.fillRect(x + 21 + leanX, by + 2 + hb, 1, 1);

  // Goggles
  ctx.fillStyle = PAL.gogFrame;
  ctx.fillRect(x + 11 + leanX, by + 3 + hb, 4, 2);
  ctx.fillRect(x + 17 + leanX, by + 3 + hb, 4, 2);
  ctx.fillRect(x + 15 + leanX, by + 3 + hb, 2, 1);
  ctx.fillStyle = PAL.gogLens;
  ctx.fillRect(x + 12 + leanX, by + 3 + hb, 2, 1);
  ctx.fillRect(x + 18 + leanX, by + 3 + hb, 2, 1);
  ctx.fillStyle = PAL.gogGlint;
  ctx.fillRect(x + 12 + leanX, by + 3 + hb, 1, 1);
  ctx.fillRect(x + 18 + leanX, by + 3 + hb, 1, 1);

  // Eyes
  ctx.fillStyle = PAL.eye;
  ctx.fillRect(x + 14 + leanX, by + 7, 2, 2);
  ctx.fillRect(x + 18 + leanX, by + 7, 2, 2);
  ctx.fillStyle = PAL.eyeHi;
  ctx.fillRect(x + 14 + leanX, by + 7, 1, 1);
  ctx.fillRect(x + 18 + leanX, by + 7, 1, 1);

  // Mouth
  ctx.fillStyle = PAL.mouth;
  ctx.fillRect(x + 14 + leanX, by + 10, 4, 1);
  if (!isContact) {
    ctx.fillRect(x + 17 + leanX, by + 9, 1, 1);
  }

  // Arms
  if (col === 0) {
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 4, by + 12, 3, 7);
    ctx.fillRect(x + 3, by + 14, 2, 4);
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 3, by + 17, 3, 2);
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 24, by + 15, 3, 5);
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 24, by + 19, 3, 2);
  } else if (col === 1 || col === 3) {
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 5, by + 14, 3, 6);
    ctx.fillRect(x + 24, by + 14, 3, 6);
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 5, by + 19, 3, 2);
    ctx.fillRect(x + 24, by + 19, 3, 2);
  } else {
    ctx.fillStyle = PAL.coat;
    ctx.fillRect(x + 25, by + 12, 3, 7);
    ctx.fillRect(x + 27, by + 14, 2, 4);
    ctx.fillStyle = PAL.skin;
    ctx.fillRect(x + 27, by + 17, 3, 2);
    ctx.fillStyle = PAL.coatShade;
    ctx.fillRect(x + 5, by + 15, 3, 5);
    ctx.fillStyle = PAL.skinShade;
    ctx.fillRect(x + 5, by + 19, 3, 2);
  }
}

// ── Generate and save ──

function generate() {
  const animEntries = Object.entries(ANIMATIONS);
  const maxCols = Math.max(...animEntries.map(([, a]) => a.frameCount));
  const rows = Math.max(...animEntries.map(([, a]) => a.row)) + 1;

  const canvas = createCanvas(FRAME_W * maxCols, FRAME_H * rows);
  const ctx = canvas.getContext('2d');

  for (const [name, anim] of animEntries) {
    if (name === 'walkLeft') continue; // walkLeft = flipped walkRight
    const color = anim.placeholderColor || '#888888';
    for (let col = 0; col < anim.frameCount; col++) {
      drawFrame(ctx, col, anim.row, color, anim.row);
    }
  }

  return canvas;
}

// ── Main ──

const outDir = path.join(__dirname, '..', 'src', 'assets', 'sprites', 'skins');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const canvas = generate();
const outPath = path.join(outDir, 'dr-vibe-default.png');
const buf = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buf);

console.log(`Sprite sheet generated: ${outPath}`);
console.log(`  Size: ${canvas.width}x${canvas.height} (${FRAME_W}x${FRAME_H} frames)`);
console.log(`  File: ${(buf.length / 1024).toFixed(1)} KB`);
