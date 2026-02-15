"""
Generate a 'mad scientist' skin for Dr. Vibe.

Inspired by: curly-haired scientist in a white lab coat over a black
matrix-print hoodie, dark sunglasses with green code reflections,
black gloves, holding a glowing green flask, green lightning arcing
through long flowing hair. Dark cyber-lab background.

Features:
- White lab coat over black hoodie
- Long flowing golden-brown curly hair extending past shoulders
- Green electricity arcing through hair and around body
- Dark sunglasses with green code reflections
- Black gloves
- Beaker/flask liquid is glowing green
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-madscientist.png"

COLOR_MAP = {
    # Coat → white lab coat (crisp, slightly cool white)
    (245, 245, 250): (242, 244, 248),  # coat main     → clean white coat
    (221, 224, 234): (218, 222, 232),  # coat shade    → cool shadow fold
    (192, 196, 208): (188, 194, 208),  # coat dark     → deeper fold shadow

    # Hair → golden-brown curls (long, wild)
    (184, 184, 200): (175, 130, 65),   # hair          → golden brown
    (208, 208, 220): (205, 165, 95),   # hair highlight → sun-kissed curls
    (152, 152, 168): (130, 95, 45),    # hair dark     → deep brown shadow

    # Goggle lenses → dark sunglasses with green code reflection
    (92, 224, 255):  (25, 160, 50),    # goggle lens   → dark green-tinted
    (160, 240, 255): (60, 255, 100),   # goggle glint  → bright green code reflection

    # Goggle frames → thick dark frames (wayfarers)
    (58, 58, 74):    (18, 18, 24),     # goggle frame  → near-black thick frames

    # Eyes → barely visible behind dark shades
    (42, 42, 58):    (15, 15, 20),     # eye           → hidden dark
    (255, 255, 255): (50, 230, 90),    # eye highlight  → green code glint

    # Mouth → goatee/beard area, confident
    (192, 112, 96):  (165, 100, 85),   # mouth         → slightly muted by facial hair
    (139, 64, 64):   (125, 58, 50),    # mouth open

    # Pants → dark jeans
    (58, 58, 80):    (30, 30, 42),     # pants         → dark denim
    (74, 74, 96):    (42, 42, 58),     # pants highlight

    # Shoes → dark boots/sneakers
    (42, 42, 53):    (18, 18, 25),     # shoes         → dark
    (58, 58, 69):    (30, 30, 40),     # shoe highlight

    # Beaker liquid → glowing green (was cyan)
    (100, 231, 247): (50, 230, 80),    # beaker liquid main → green
    (103, 232, 249): (70, 245, 100),   # beaker liquid bright → bright green
    (224, 242, 254): (160, 255, 180),  # beaker highlight → green glow
    (165, 243, 252): (120, 250, 150),  # beaker mid-tone → mid green glow
}

# Accent colors
NEON_GREEN       = (50, 255, 100)
NEON_GREEN_DIM   = (30, 200, 70)
NEON_GREEN_GLOW  = (90, 255, 140)
NEON_GREEN_FAINT = (40, 180, 65)
ENERGY_DARK      = (20, 140, 50)
ENERGY_SPARK     = (140, 255, 180)
HOODIE_BLACK     = (22, 28, 22)     # black hoodie with green tint (matrix)
HOODIE_DARK      = (15, 20, 15)     # deeper hoodie shadow
GLOVE_BLACK      = (25, 25, 30)     # black gloves

# Hair colors (after mapping)
HAIR_MAIN = (175, 130, 65)
HAIR_HI   = (205, 165, 95)
HAIR_DK   = (130, 95, 45)
HAIR_SET  = {HAIR_MAIN, HAIR_HI, HAIR_DK}

COAT_SET = {
    (242, 244, 248),
    (218, 222, 232),
    (188, 194, 208),
}

SKIN_ORIG = {
    (253, 216, 176),
    (232, 184, 136),
    (212, 168, 120),
}


def extend_hair_down(img, fx, fy):
    """Extend the hair further down past the shoulders for a long flowing look.

    Adds hair pixels on the sides of the face/neck, extending into the
    coat area to simulate long curly hair flowing over the shoulders.
    """
    # Find existing hair pixels to know where hair currently is
    hair_pixels = []
    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in HAIR_SET:
                hair_pixels.append((x, y))

    if not hair_pixels:
        return

    # Find hair bounds
    hair_ys = [p[1] for p in hair_pixels]
    hair_xs = [p[0] for p in hair_pixels]
    hair_bottom = max(hair_ys)
    hair_left = min(hair_xs)
    hair_right = max(hair_xs)
    hair_center = (hair_left + hair_right) // 2

    # Extend hair down the sides — add curly strands hanging past the face
    # Left side strands (hanging down from left edge of hair)
    for dy in range(1, 12):
        y = hair_bottom + dy
        if y >= 32:
            break

        # Left strand - slightly wavy
        lx = hair_left + (1 if dy % 3 == 0 else 0)
        px, py = fx + lx, fy + y
        r, g, b, a = img.getpixel((px, py))
        # Only place hair on transparent pixels or coat pixels
        if a == 0 or (r, g, b) in COAT_SET:
            color = HAIR_DK if dy % 2 == 0 else HAIR_MAIN
            img.putpixel((px, py), color + (255,))

        # Second strand slightly inward
        lx2 = hair_left + 1 + (1 if dy % 4 == 0 else 0)
        if lx2 != lx:
            px2, py2 = fx + lx2, fy + y
            r, g, b, a = img.getpixel((px2, py2))
            if a == 0 or (r, g, b) in COAT_SET:
                if dy < 8:
                    img.putpixel((px2, py2), HAIR_MAIN + (255,))

        # Right side strands
        rx = hair_right - (1 if dy % 3 == 0 else 0)
        px, py = fx + rx, fy + y
        r, g, b, a = img.getpixel((px, py))
        if a == 0 or (r, g, b) in COAT_SET:
            color = HAIR_DK if dy % 2 == 0 else HAIR_HI
            img.putpixel((px, py), color + (255,))

        # Second right strand slightly inward
        rx2 = hair_right - 1 - (1 if dy % 4 == 0 else 0)
        if rx2 != rx:
            px2, py2 = fx + rx2, fy + y
            r, g, b, a = img.getpixel((px2, py2))
            if a == 0 or (r, g, b) in COAT_SET:
                if dy < 8:
                    img.putpixel((px2, py2), HAIR_HI + (255,))


def add_hair_lightning(img, fx, fy):
    """Add lots of green lightning sparks arcing through the hair."""
    hair_pixels = []
    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in HAIR_SET:
                hair_pixels.append((x, y))

    if len(hair_pixels) < 4:
        return

    # Place green sparks at regular intervals throughout the hair
    step = max(1, len(hair_pixels) // 6)
    for i in range(0, len(hair_pixels), step):
        hx, hy = hair_pixels[i]
        px, py = fx + hx, fy + hy
        # Alternate between bright and dim sparks
        if i % (step * 2) == 0:
            img.putpixel((px, py), NEON_GREEN_GLOW + (255,))
        else:
            img.putpixel((px, py), NEON_GREEN_DIM + (255,))

    # Add a couple extra bright sparks at the tips of extended hair
    # (bottom-most hair pixels on each side)
    left_bottom = None
    right_bottom = None
    for hx, hy in hair_pixels:
        if left_bottom is None or hy > left_bottom[1] or (hy == left_bottom[1] and hx < left_bottom[0]):
            if hx < 16:
                left_bottom = (hx, hy)
        if right_bottom is None or hy > right_bottom[1] or (hy == right_bottom[1] and hx > right_bottom[0]):
            if hx >= 16:
                right_bottom = (hx, hy)

    for tip in [left_bottom, right_bottom]:
        if tip:
            px, py = fx + tip[0], fy + tip[1]
            img.putpixel((px, py), ENERGY_SPARK + (255,))


def add_body_electricity(img, fx, fy):
    """Add green electricity arcing around the whole body — not just the coat."""
    # Find all non-transparent pixels to know the body silhouette
    body_by_row = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0:
                cols.append(x)
        if cols:
            body_by_row[y] = (min(cols), max(cols))

    if not body_by_row:
        return

    # Add green electricity sparks just outside the body silhouette
    for y, (left, right) in body_by_row.items():
        # Left side spark (1 pixel outside body)
        if left > 0 and y % 4 == 0:
            px, py = fx + left - 1, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a == 0:
                img.putpixel((px, py), NEON_GREEN_FAINT + (80,))  # semi-transparent

        # Right side spark
        if right < 31 and y % 4 == 2:
            px, py = fx + right + 1, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a == 0:
                img.putpixel((px, py), NEON_GREEN_FAINT + (80,))


def add_coat_details(img, fx, fy):
    """Add hoodie collar, energy accents on the lab coat, and black gloves."""
    coat_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in COAT_SET:
                cols.append(x)
        if cols:
            coat_rows[y] = (min(cols), max(cols))

    if not coat_rows:
        return

    top_y = min(coat_rows.keys())
    bot_y = max(coat_rows.keys())
    total = bot_y - top_y + 1

    for y, (left, right) in coat_rows.items():
        rows_from_top = y - top_y
        center = (left + right) // 2

        # Black hoodie showing at collar (top 2 rows of coat)
        if rows_from_top <= 1:
            for x in range(left + 3, right - 2):
                px, py_px = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py_px))
                if a > 0 and (r, g, b) in COAT_SET:
                    img.putpixel((px, py_px), HOODIE_BLACK + (255,))

        # Hoodie showing at center front (v-neck opening)
        if 2 <= rows_from_top <= total // 2:
            for dx in range(-1, 2):
                cx = center + dx
                px, py_px = fx + cx, fy + y
                if 0 <= cx < 32:
                    r, g, b, a = img.getpixel((px, py_px))
                    if a > 0 and (r, g, b) in COAT_SET:
                        if dx == 0:
                            img.putpixel((px, py_px), HOODIE_BLACK + (255,))
                        else:
                            img.putpixel((px, py_px), HOODIE_DARK + (255,))

        # Green energy veins on both sides of the coat
        for vein_offset in [-4, 4]:
            vein_x = center + vein_offset
            if left + 2 <= vein_x <= right - 2 and 2 <= rows_from_top <= total - 2:
                px, py_px = fx + vein_x, fy + y
                r, g, b, a = img.getpixel((px, py_px))
                if a > 0 and (r, g, b) in COAT_SET:
                    if rows_from_top % 2 == 0:
                        img.putpixel((px, py_px), NEON_GREEN + (255,))
                    else:
                        img.putpixel((px, py_px), NEON_GREEN_DIM + (255,))

        # Green energy sparks scattered across coat
        if rows_from_top == 2 and right - left > 8:
            sx = center + 2
            px, py_px = fx + sx, fy + y
            r, g, b, a = img.getpixel((px, py_px))
            if a > 0 and (r, g, b) in COAT_SET:
                img.putpixel((px, py_px), ENERGY_SPARK + (255,))

        if rows_from_top == 4 and right - left > 8:
            sx = center - 2
            px, py_px = fx + sx, fy + y
            r, g, b, a = img.getpixel((px, py_px))
            if a > 0 and (r, g, b) in COAT_SET:
                img.putpixel((px, py_px), NEON_GREEN_GLOW + (255,))

        if rows_from_top == 6 and right - left > 8:
            sx = center + 3
            px, py_px = fx + sx, fy + y
            r, g, b, a = img.getpixel((px, py_px))
            if a > 0 and (r, g, b) in COAT_SET:
                img.putpixel((px, py_px), NEON_GREEN + (255,))

        # Green glow on bottom hem
        if rows_from_top >= total - 1:
            for x in range(left + 3, right - 2):
                px, py_px = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py_px))
                if a > 0 and (r, g, b) in COAT_SET:
                    if x % 2 == 0:
                        img.putpixel((px, py_px), NEON_GREEN_DIM + (255,))
                    else:
                        img.putpixel((px, py_px), ENERGY_DARK + (255,))

    # Turn hands into black gloves
    for y, (left, right) in coat_rows.items():
        center = (left + right) // 2
        for x in range(32):
            px, py_px = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py_px))
            if a > 0 and (r, g, b) in SKIN_ORIG:
                if x < center - 8 or x > center + 8:
                    img.putpixel((px, py_px), GLOVE_BLACK + (255,))


def main():
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size

    # First pass: global color replacement (coat, hair, goggles, beaker liquid, etc.)
    for y in range(h):
        for x in range(w):
            r, g, b, a = img.getpixel((x, y))
            if a > 0 and (r, g, b) in COLOR_MAP:
                new_rgb = COLOR_MAP[(r, g, b)]
                img.putpixel((x, y), new_rgb + (a,))

    # Second pass: per-frame enhancements
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            extend_hair_down(img, fx, fy)
            add_coat_details(img, fx, fy)
            add_hair_lightning(img, fx, fy)
            add_body_electricity(img, fx, fy)

    img.save(DST)
    print(f"Saved mad scientist skin to {DST}")


if __name__ == "__main__":
    main()
