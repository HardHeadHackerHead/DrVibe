# Sprite scripts

Python 3 + Pillow (`pip install pillow`). Run from the repo root.

## Sheet format

32 × 32 frames, 4 columns × 16 rows = 128 × 512, transparent background, no
anti-aliasing. Rows: 0 idle, 1 coding, 2 thinking, 3 tired, 4 excited,
5 alert, 6 walk (mirrored for left), 7 stretching, 8 beaker, 9 libraryCard,
10 thumbsUp, 11 coverEyes, 12 celebrating, 13 focused, 14 concerned,
15 presenting. Row 16 (levitating) is an optional 17th row (128 × 544); the
app falls back to the idle frames when a sheet doesn't have it. The 12 Lab
Originals ship with it. Skins may add bonus rows after 16 (bridgemind is
6 × 21 = 192 × 672). The row map lives in `src/config/animations.js`.

The bundled sheets carry their `.anim.json` in the pixel LSBs (see
`scripts/bake-skins.cjs`), starting at the top-left pixel. Never re-encode or
recolour rows 0–15, or the baked config breaks.

## `levitate.py`

Draws row 16 (`levitating`, 4 frames) for the 12 Lab Originals from each
skin's own idle frame: lifted 1–3 px and bobbing, shoes narrowed with a toe
pointing down, arms drifting out at the top of the bob, an alpha-80 ground
shadow that shrinks as the character rises, and lab-green `#00ffa3` sparkles
and toe glow. The classic skin has its own builder (chunkier body, keeps its
blue shadow colour).

```
python scripts/sprites/levitate.py            # write row 16 into each sheet
python scripts/sprites/levitate.py --force    # redraw an existing row 16
python scripts/sprites/levitate.py --check    # build and verify, write nothing
```

It verifies that every other row is pixel-identical, the sheet is at least
544 px tall, and each new frame is at least 5% opaque with no stray alpha.

## `preview.py`

```
python scripts/sprites/preview.py
```

Writes `preview/levitating-contact.png` (idle + the 4 levitating frames per
skin, 4×) and `preview/levitating.gif` (all 12 skins animating, 4×).

## `icons.py`

```
python scripts/sprites/icons.py
```

Draws the app and tray icons from the default skin's idle frame and writes
the full desktop icon set to `src-tauri/icons/` (`32x32.png`, `64x64.png`,
`128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`, `icon.icns`) plus
the tray icons (`tray.png` 32 px / `tray-16.png`, and the macOS template
`tray-template.png` / `tray-template-16.png`). Each size is drawn on its own
pixel grid and only scaled by whole numbers, so nothing is resampled; the
16/24 px sizes show the head only. The 1024 px master goes to
`scripts/sprites/out/app-icon-1024.png` (git-ignored) if you want to feed it
to `npx tauri icon` for other platforms.
