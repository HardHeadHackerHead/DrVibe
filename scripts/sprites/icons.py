"""Draw the app and tray icons from the default Dr. Vibe sprite.

Every size is drawn on its own pixel grid and only ever scaled by whole
numbers with nearest-neighbour, so the sprite stays crisp:

    App icon   rounded dark (#0b0d12) tile, lab-green (#00ffa3) rim, the
               default idle pose standing on a faint green glow.
               128 px is the master grid (sprite at 3x); 256/512/1024 are
               2x/4x/8x of it. 64 and 32 px have their own grids (sprite at
               2x and 1x). 16/24 px show the head only.
    Tray icon  the head alone with a dark outline, 16 px and 2x = 32 px.
    macOS tray a black template silhouette of the head with the goggle
               lenses and eyes cut out (use with icon_as_template(true)).

Outputs in src-tauri/icons/:
    32x32.png 64x64.png 128x128.png 128x128@2x.png icon.png (512)
    icon.ico (16, 24, 32, 48, 64, 128, 256)  icon.icns (16 ... 1024)
    tray.png (32) tray-16.png  tray-template.png (32) tray-template-16.png
the 1024 px master at scripts/sprites/out/app-icon-1024.png, and a review
sheet at scripts/sprites/preview/icons.png.

Usage:
    python scripts/sprites/icons.py
"""

import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SKIN = ROOT / "src" / "assets" / "sprites" / "skins" / "dr-vibe-default.png"
ICONS = ROOT / "src-tauri" / "icons"
OUT = Path(__file__).resolve().parent / "out"

TILE = (0x0B, 0x0D, 0x12, 255)
RIM = (0x00, 0xFF, 0xA3, 255)
RIM_INNER = (0x00, 0x6E, 0x47, 255)
FLOOR = (0x0E, 0x3B, 0x2C, 255)
OUTLINE = (0x0B, 0x0D, 0x12, 255)
TEMPLATE = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)

# Default skin, idle frame 0: the body and the head-only crop (x0, y0, x1, y1).
BODY_BOX = (5, 3, 27, 28)
HEAD_BOX = (9, 3, 23, 15)


def nn(img, factor):
    return img.resize((img.width * factor, img.height * factor), Image.NEAREST)


def corner_insets(radius, rows):
    """Per-row horizontal inset for a stepped rounded corner."""
    out = []
    for i in range(rows):
        if i >= radius:
            out.append(0)
            continue
        dy = radius - i - 0.5
        out.append(radius - int(math.floor(math.sqrt(max(radius * radius - dy * dy, 0)) + 0.5)))
    return out


def rounded_rect(img, x0, y0, size, radius, color):
    px = img.load()
    insets = corner_insets(radius, size)
    for i in range(size):
        inset = max(insets[i], insets[size - 1 - i])
        for x in range(x0 + inset, x0 + size - inset):
            px[x, y0 + i] = color


def tile(grid, margin, rim, radius, inner_rim=0):
    img = Image.new("RGBA", (grid, grid), CLEAR)
    size = grid - 2 * margin
    rounded_rect(img, margin, margin, size, radius, RIM)
    if inner_rim:
        rounded_rect(img, margin + rim, margin + rim, size - 2 * rim,
                     max(radius - rim, 0), RIM_INNER)
    off = rim + inner_rim
    rounded_rect(img, margin + off, margin + off, size - 2 * off,
                 max(radius - off, 0), TILE)
    return img


def floor_glow(img, cx, y, width, height):
    """Stepped ellipse centred on cx, top row at y."""
    px = img.load()
    for i in range(height):
        t = (i + 0.5) / height * 2 - 1
        w = int(round(width * math.sqrt(max(1 - t * t, 0)) / 2))
        for x in range(cx - w, cx + w):
            if px[x, y + i][3]:
                px[x, y + i] = FLOOR


def app_icon(grid, margin, rim, radius, scale, inner_rim=0, glow=True):
    img = tile(grid, margin, rim, radius, inner_rim)
    body = idle.crop(BODY_BOX)
    body = nn(body, scale) if scale > 1 else body
    floor_h = scale * 2 if glow else 0
    x = (grid - body.width) // 2
    y = (grid - body.height - floor_h // 2) // 2
    if glow:
        floor_glow(img, grid // 2, y + body.height - scale, int(body.width * 0.8), floor_h)
    img.alpha_composite(body, (x, y))
    return img


def head_icon(grid, radius):
    img = tile(grid, 0, 1, radius)
    head = idle.crop(HEAD_BOX)
    img.alpha_composite(head, ((grid - head.width) // 2, (grid - head.height) // 2))
    return img


def outlined(sprite):
    """Add a 1 px outline (4-neighbour) around the opaque pixels."""
    w, h = sprite.width + 2, sprite.height + 2
    out = Image.new("RGBA", (w, h), CLEAR)
    src = sprite.load()
    o = out.load()
    for y in range(sprite.height):
        for x in range(sprite.width):
            if src[x, y][3]:
                for dx, dy in ((0, 1), (2, 1), (1, 0), (1, 2)):
                    o[x + dx, y + dy] = OUTLINE
    out.alpha_composite(sprite, (1, 1))
    return out


def centred(img, size):
    out = Image.new("RGBA", (size, size), CLEAR)
    out.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return out


def is_lens(c):
    r, g, b, a = c
    return a and b > 200 and g - r > 40  # cyan; hair greys sit near g == r


def is_eye(c):
    r, g, b, a = c
    return a and (r + g + b) < 200 or (r > 245 and g > 245 and b > 245)


def template(head):
    """Black silhouette; goggle lenses and eyes knocked out."""
    out = Image.new("RGBA", head.size, CLEAR)
    src = head.load()
    o = out.load()
    eye_rows = (10 - HEAD_BOX[1], 11 - HEAD_BOX[1])
    face_cols = range(11 - HEAD_BOX[0], 21 - HEAD_BOX[0])
    for y in range(head.height):
        for x in range(head.width):
            c = src[x, y]
            if not c[3]:
                continue
            cut = is_lens(c) or (y in eye_rows and x in face_cols and is_eye(c))
            o[x, y] = CLEAR if cut else TEMPLATE
    return out


def save_preview(sizes, tray16, tmpl16):
    """preview/icons.png: app icon sizes, then the tray icons on dark and light."""
    light, dark = (0xEB, 0xEC, 0xF0, 255), (0x1E, 0x20, 0x28, 255)
    sheet = Image.new("RGBA", (980, 420), light)
    x = 16
    for s, k in ((256, 1), (128, 1), (64, 2), (32, 4), (24, 4), (16, 6)):
        sheet.alpha_composite(nn(sizes[s], k) if k > 1 else sizes[s], (x, 16))
        x += s * k + 16
    x = 16
    for icon, bg in ((tray16, dark), (tray16, light), (tmpl16, light)):
        panel = Image.new("RGBA", (16, 16), bg)
        panel.alpha_composite(icon)
        sheet.alpha_composite(nn(panel, 8), (x, 288))
        x += 128 + 16
    preview_dir = Path(__file__).resolve().parent / "preview"
    preview_dir.mkdir(exist_ok=True)
    sheet.save(preview_dir / "icons.png")


def main():
    global idle
    idle = Image.open(SKIN).convert("RGBA").crop((0, 0, 32, 32))
    OUT.mkdir(parents=True, exist_ok=True)

    master = app_icon(128, margin=8, rim=2, radius=22, scale=3, inner_rim=1)
    sizes = {
        16: head_icon(16, radius=3),
        24: head_icon(24, radius=4),
        32: app_icon(32, margin=0, rim=1, radius=6, scale=1, glow=False),
        48: app_icon(48, margin=1, rim=1, radius=9, scale=1),
        64: app_icon(64, margin=2, rim=1, radius=12, scale=2),
        128: master,
        256: nn(master, 2),
        512: nn(master, 4),
        1024: nn(master, 8),
    }

    sizes[1024].save(OUT / "app-icon-1024.png")
    sizes[32].save(ICONS / "32x32.png")
    sizes[64].save(ICONS / "64x64.png")
    sizes[128].save(ICONS / "128x128.png")
    sizes[256].save(ICONS / "128x128@2x.png")
    sizes[512].save(ICONS / "icon.png")

    ico = [16, 24, 32, 48, 64, 128, 256]
    sizes[256].save(ICONS / "icon.ico", sizes=[(s, s) for s in ico],
                    append_images=[sizes[s] for s in ico[:-1]])
    icns = [16, 32, 64, 128, 256, 512, 1024]
    sizes[1024].save(ICONS / "icon.icns", append_images=[sizes[s] for s in icns[:-1]])

    head = idle.crop(HEAD_BOX)
    tray16 = centred(outlined(head), 16)
    tray16.save(ICONS / "tray-16.png")
    nn(tray16, 2).save(ICONS / "tray.png")
    tmpl16 = centred(template(head), 16)
    tmpl16.save(ICONS / "tray-template-16.png")
    nn(tmpl16, 2).save(ICONS / "tray-template.png")

    save_preview(sizes, tray16, tmpl16)

    for name in ("32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png",
                 "icon.ico", "icon.icns", "tray.png", "tray-16.png",
                 "tray-template.png", "tray-template-16.png"):
        print(f"wrote {ICONS / name}")
    print(f"wrote {OUT / 'app-icon-1024.png'}")


if __name__ == "__main__":
    main()
