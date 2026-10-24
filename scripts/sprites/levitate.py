"""Draw the `levitating` row (row 16) for the bundled Lab Original skins.

Builds four frames per skin from that skin's own idle pose (row 0, frame 0):
the character is lifted off the ground and bobs across the frames, feet point
down and dangle, arms drift outward, a small shadow on the ground shrinks as
the character rises, and a few lab-green (#00ffa3) sparkles twinkle around it.

Rows 0-15 (and any bonus rows below 16) are copied pixel-for-pixel, so the
animation config baked into the PNG's LSBs (scripts/bake-skins.cjs) survives.

Usage:
    python scripts/sprites/levitate.py            # rewrite the 12 skins in place
    python scripts/sprites/levitate.py --check    # verify only, write nothing
    python scripts/sprites/levitate.py --force    # redraw even if row 16 has art

See scripts/sprites/README.md.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SKINS_DIR = ROOT / "src" / "assets" / "sprites" / "skins"

SKINS = [
    "alien", "arctic", "bridgemind", "classic", "cyberpunk", "default",
    "firefighter", "madscientist", "pirate", "retro80s", "tuxedo", "wizard",
]

FRAME = 32
ROW = 16
SPEC_ROWS = 17

GLOW = (0x00, 0xFF, 0xA3, 255)       # lab green
GLOW_DIM = (0x00, 0xA8, 0x6B, 255)   # same hue, darker, for sparkle arms / trails
SHADOW = (0x0B, 0x0D, 0x12, 80)      # alpha 80 matches the classic skin's shadow

# Lift (px above the ground) per frame: rise, peak, top, settle.
LIFTS = [1, 2, 3, 2]
# Arms float outward at the top of the bob.
ARM_DRIFT = [0, 1, 1, 0]

# Sparkles per frame: (x, y, kind) where kind is "plus" (bright centre, dim
# arms), "dot" (one bright pixel) or "dim" (one dim pixel). Coordinates are
# frame-relative and sit in empty space beside the head.
SPARKLES_STANDARD = [
    [(26, 8, "plus"), (5, 13, "dim")],
    [(27, 7, "dot"), (5, 11, "dot")],
    [(27, 6, "dim"), (5, 10, "plus")],
    [(26, 12, "dot"), (4, 8, "dim")],
]
SPARKLES_CLASSIC = [
    [(25, 6, "plus"), (3, 14, "dim")],
    [(26, 5, "dot"), (3, 12, "dot")],
    [(26, 4, "dim"), (3, 10, "plus")],
    [(28, 10, "dot"), (2, 7, "dim")],
]


def frame_of(img, col, row):
    return img.crop((col * FRAME, row * FRAME, (col + 1) * FRAME, (row + 1) * FRAME))


def put_if_empty(px, x, y, color):
    if 0 <= x < FRAME and 0 <= y < FRAME and px[x, y][3] == 0:
        px[x, y] = color


def draw_sparkles(px, sparkles):
    for x, y, kind in sparkles:
        if kind == "plus":
            put_if_empty(px, x, y, GLOW)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                put_if_empty(px, x + dx, y + dy, GLOW_DIM)
        elif kind == "dot":
            put_if_empty(px, x, y, GLOW)
        else:
            put_if_empty(px, x, y, GLOW_DIM)


def draw_shadow(px, center2, width, rows, color):
    """Flat pixel ellipse: the top row is 2 px narrower on each side.
    center2 is twice the centre x, so half-pixel centres stay exact."""
    for i, y in enumerate(rows):
        w = width - 4 * (len(rows) - 1 - i)
        x0 = (center2 - w + 1) // 2
        for x in range(x0, x0 + w):
            px[x, y] = color


def runs(px, y, x_range):
    """Contiguous opaque runs on one row, as (start, end_inclusive)."""
    out, start = [], None
    for x in x_range:
        on = px[x, y][3] == 255
        if on and start is None:
            start = x
        if not on and start is not None:
            out.append((start, x - 1))
            start = None
    if start is not None:
        out.append((start, x_range[-1]))
    return out


def build_standard(idle):
    """Skins on the shared 32x32 template: head rows 3-15, arms rows 17-23 at
    x 5-7 / 24-26, legs rows 24-26, shoes on row 27."""
    src = idle.load()
    legs = runs(src, 26, range(FRAME))
    if len(legs) != 2 or src[legs[0][0], 27][3] != 255:
        raise ValueError("idle frame does not match the standard template")

    # Pose: shoes narrowed to the leg width with a toe pointing down.
    pose = idle.copy()
    p = pose.load()
    for x in range(FRAME):
        p[x, 27] = (0, 0, 0, 0)
    toes = []
    for a, b in legs:
        for x in range(a, b + 1):
            p[x, 27] = src[x, 27]
        toe_x = (a + b) // 2
        p[toe_x, 28] = src[toe_x, 27]
        toes.append(toe_x)

    # Arms: opaque pixels beside the torso on the arm rows.
    arms = {}
    for y in range(17, 24):
        for x in range(FRAME):
            if src[x, y][3] == 255 and (x <= 7 or x >= 24):
                arms[(x, y)] = src[x, y]
                p[x, y] = (0, 0, 0, 0)

    center2 = legs[0][0] + legs[1][1]
    frames = []
    for i, lift in enumerate(LIFTS):
        out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        o = out.load()
        draw_shadow(o, center2, 14 - 2 * lift, (29, 30), SHADOW)
        out.alpha_composite(pose, (0, -lift))
        o = out.load()
        drift = ARM_DRIFT[i]
        for (x, y), c in arms.items():
            nx = x - drift if x <= 7 else x + drift
            o[nx, y - lift] = c
        # Hover glow under each toe, flickering with the bob.
        toe_y = 28 - lift
        for t in toes:
            put_if_empty(o, t, toe_y + 1, GLOW if lift >= 2 else GLOW_DIM)
            if lift == 3:
                put_if_empty(o, t, toe_y + 2, GLOW_DIM)
        draw_sparkles(o, SPARKLES_STANDARD[i])
        frames.append(out)
    return frames


def build_classic(idle):
    """The chunky classic skin: body rows 4-29, its own blue shadow on 30-31."""
    src = idle.load()
    shadow_color = src[16, 30]
    body = idle.copy()
    b = body.load()
    for y in (30, 31):
        for x in range(FRAME):
            b[x, y] = (0, 0, 0, 0)

    frames = []
    for i, lift in enumerate(LIFTS):
        lift += 1  # the classic body is taller, so it needs a bigger gap to read
        out = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        o = out.load()
        draw_shadow(o, 32, 24 - 3 * lift, (29, 30), shadow_color)
        out.alpha_composite(body, (0, -lift))
        o = out.load()
        # Hover glow along the hem.
        hem_y = 29 - lift + 1
        for x in range(10, 22, 3):
            put_if_empty(o, x + (i % 3), hem_y, GLOW if lift >= 3 else GLOW_DIM)
        draw_sparkles(o, SPARKLES_CLASSIC[i])
        frames.append(out)
    return frames


def row_is_empty(img, row):
    band = img.crop((0, row * FRAME, img.width, (row + 1) * FRAME))
    return band.getchannel("A").getbbox() is None


def process(name, write, force):
    path = SKINS_DIR / f"dr-vibe-{name}.png"
    img = Image.open(path)
    if img.mode != "RGBA":
        raise ValueError(f"{path.name}: expected RGBA, got {img.mode}")
    rows = max(SPEC_ROWS, img.height // FRAME)

    if img.height >= (ROW + 1) * FRAME and not row_is_empty(img, ROW) and not force:
        print(f"{path.name}: row {ROW} already drawn, skipping (use --force)")
        return img

    idle = frame_of(img, 0, 0)
    frames = build_classic(idle) if name == "classic" else build_standard(idle)

    out = Image.new("RGBA", (img.width, rows * FRAME), (0, 0, 0, 0))
    out.paste(img, (0, 0))
    out.paste(Image.new("RGBA", (img.width, FRAME), (0, 0, 0, 0)), (0, ROW * FRAME))
    for col, f in enumerate(frames):
        out.paste(f, (col * FRAME, ROW * FRAME))

    verify(img, out, path.name)
    if write:
        out.save(path, optimize=True)
        print(f"{path.name}: wrote row {ROW} -> {out.width}x{out.height}")
    return out


def verify(before, after, label):
    """Every row other than 16 must be pixel-identical to the original."""
    keep = [r for r in range(before.height // FRAME) if r != ROW]
    for r in keep:
        box = (0, r * FRAME, before.width, (r + 1) * FRAME)
        if before.crop(box).tobytes() != after.crop(box).tobytes():
            raise AssertionError(f"{label}: row {r} changed")
    if after.height < SPEC_ROWS * FRAME:
        raise AssertionError(f"{label}: sheet is only {after.height} px tall")
    for col in range(4):
        f = frame_of(after, col, ROW)
        hist = f.getchannel("A").histogram()
        if hist[255] < 0.05 * FRAME * FRAME:
            raise AssertionError(f"{label}: levitating frame {col} under 5% opaque")
        if {a for a, n in enumerate(hist) if n} - {0, 80, 255}:
            raise AssertionError(f"{label}: levitating frame {col} has stray alpha")


def main():
    write = "--check" not in sys.argv
    force = "--force" in sys.argv
    for name in SKINS:
        process(name, write, force)


if __name__ == "__main__":
    main()
