"""Export previews of the levitating row for every Lab Original.

Writes to scripts/sprites/preview/:
    levitating-contact.png  idle frame + the 4 levitating frames per skin, 4x
    levitating.gif          all 12 skins levitating side by side, 4x

Usage:
    python scripts/sprites/preview.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

from levitate import FRAME, ROW, SKINS, SKINS_DIR, frame_of

OUT_DIR = Path(__file__).resolve().parent / "preview"
SCALE = 4
BG = (0x0B, 0x0D, 0x12, 255)
# Light panel so the alpha-80 ground shadow is visible in the preview
PANEL = (0xC8, 0xCE, 0xD8, 255)
LABEL = (0x9A, 0xA4, 0xB2, 255)
GREEN = (0x00, 0xFF, 0xA3, 255)
# Frame timings from src/config/animations.js (levitating.frameDurations)
DURATIONS = [200, 300, 350, 200]

CELL = FRAME * SCALE
GAP = 8
LABEL_W = 120


def scaled(img):
    return img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)


def contact_sheet(sheets):
    cols = 5
    w = LABEL_W + cols * (CELL + GAP) + GAP
    h = GAP + 24 + len(sheets) * (CELL + GAP)
    out = Image.new("RGBA", (w, h), BG)
    d = ImageDraw.Draw(out)
    d.text((LABEL_W + GAP, GAP), "idle", fill=LABEL)
    d.text((LABEL_W + 2 * GAP + CELL, GAP), "levitating  0 / 1 / 2 / 3", fill=GREEN)
    for i, (name, sheet) in enumerate(sheets):
        y = GAP + 24 + i * (CELL + GAP)
        d.text((GAP, y + CELL // 2 - 6), name, fill=LABEL)
        frames = [frame_of(sheet, 0, 0)] + [frame_of(sheet, c, ROW) for c in range(4)]
        for c, f in enumerate(frames):
            x = LABEL_W + GAP + c * (CELL + GAP)
            out.paste(PANEL, (x, y, x + CELL, y + CELL))
            out.alpha_composite(scaled(f), (x, y))
    return out


def animated(sheets):
    per_row = 6
    rows = (len(sheets) + per_row - 1) // per_row
    w = per_row * (CELL + GAP) + GAP
    h = rows * (CELL + GAP + 16) + GAP
    frames = []
    for col in range(4):
        canvas = Image.new("RGBA", (w, h), BG)
        d = ImageDraw.Draw(canvas)
        for i, (name, sheet) in enumerate(sheets):
            x = GAP + (i % per_row) * (CELL + GAP)
            y = GAP + (i // per_row) * (CELL + GAP + 16)
            canvas.paste(PANEL, (x, y, x + CELL, y + CELL))
            canvas.alpha_composite(scaled(frame_of(sheet, col, ROW)), (x, y))
            d.text((x, y + CELL + 2), name, fill=LABEL)
        frames.append(canvas.convert("RGB"))
    return frames


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheets = [(n, Image.open(SKINS_DIR / f"dr-vibe-{n}.png").convert("RGBA")) for n in SKINS]
    contact_sheet(sheets).save(OUT_DIR / "levitating-contact.png")
    frames = animated(sheets)
    frames[0].save(
        OUT_DIR / "levitating.gif",
        save_all=True,
        append_images=frames[1:],
        duration=DURATIONS,
        loop=0,
        disposal=1,
    )
    print(f"wrote {OUT_DIR / 'levitating-contact.png'}")
    print(f"wrote {OUT_DIR / 'levitating.gif'}")


if __name__ == "__main__":
    main()
