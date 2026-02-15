"""
Generate a 'retro 80s' skin for Dr. Vibe.

Hot pink and electric blue color-blocked windbreaker,
yellow-tinted aviator goggle lenses, bright teal pants,
white sneakers. Full synthwave aesthetic.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-retro80s.png"

COLOR_MAP = {
    # Coat → hot pink windbreaker (top half) / electric blue (bottom half)
    # Base it as hot pink, we'll color-block in the accent pass
    (245, 245, 250): (240, 60, 150),   # coat main     → hot pink
    (221, 224, 234): (210, 45, 130),   # coat shade    → darker pink
    (192, 196, 208): (180, 35, 110),   # coat dark     → deep pink shadow

    # Skin → healthy 80s glow (slightly warm/tan)

    # Hair → big 80s hair, bleached blonde
    (184, 184, 200): (240, 220, 140),  # hair          → bleached blonde
    (208, 208, 220): (255, 240, 170),  # hair highlight → bright blonde
    (152, 152, 168): (210, 190, 110),  # hair dark     → darker blonde

    # Goggle lenses → yellow aviator tint
    (92, 224, 255):  (255, 230, 60),   # goggle lens   → yellow tint
    (160, 240, 255): (255, 245, 140),  # goggle glint  → bright yellow

    # Goggle frames → white plastic (80s style)
    (58, 58, 74):    (240, 240, 245),  # goggle frame  → white frames

    # Eyes → bright
    (42, 42, 58):    (40, 35, 50),     # eye
    (255, 255, 255): (255, 255, 255),  # eye highlight

    # Mouth → glossy 80s
    (192, 112, 96):  (210, 100, 120),  # mouth         → pink-toned
    (139, 64, 64):   (160, 60, 80),    # mouth open

    # Pants → bright teal
    (58, 58, 80):    (0, 170, 170),    # pants         → teal
    (74, 74, 96):    (20, 195, 195),   # pants highlight → brighter teal

    # Shoes → white sneakers
    (42, 42, 53):    (235, 235, 240),  # shoes         → white sneakers
    (58, 58, 69):    (250, 250, 252),  # shoe highlight → bright white
}

# Accent colors
ELECTRIC_BLUE    = (30, 120, 255)
ELECTRIC_BLUE_DK = (20, 95, 220)
ELECTRIC_BLUE_DD = (15, 75, 190)
NEON_YELLOW      = (255, 240, 50)
STRIPE_WHITE     = (255, 255, 255)

PINK_SET = {
    (240, 60, 150),
    (210, 45, 130),
    (180, 35, 110),
}

PINK_TO_BLUE = {
    (240, 60, 150): ELECTRIC_BLUE,
    (210, 45, 130): ELECTRIC_BLUE_DK,
    (180, 35, 110): ELECTRIC_BLUE_DD,
}


def add_80s_accents(img, fx, fy):
    """Add color-blocking and racing stripes to the windbreaker."""
    coat_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in PINK_SET:
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

        # Color-block: bottom half of windbreaker becomes electric blue
        if rows_from_top >= total // 2:
            for x in range(32):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in PINK_SET:
                    new_color = PINK_TO_BLUE.get((r, g, b), ELECTRIC_BLUE)
                    img.putpixel((px, py), new_color + (255,))

        # White racing stripe at the color-block boundary
        if rows_from_top == total // 2:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0:
                    rgb = (r, g, b)
                    if rgb in PINK_SET or rgb in PINK_TO_BLUE.values():
                        img.putpixel((px, py), STRIPE_WHITE + (255,))

        # Diagonal accent stripe (characteristic 80s windbreaker detail)
        # A thin neon yellow line running diagonally across
        diag_x = center - 4 + rows_from_top
        if left + 2 <= diag_x <= right - 2 and 1 <= rows_from_top <= total - 2:
            px, py = fx + diag_x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0:
                rgb = (r, g, b)
                if rgb in PINK_SET or rgb in PINK_TO_BLUE.values():
                    img.putpixel((px, py), NEON_YELLOW + (255,))

    # Add stripes to the sneakers
    shoe_white = (235, 235, 240)
    shoe_hi = (250, 250, 252)
    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) == shoe_hi:
                # Add a pink accent to shoe highlights
                img.putpixel((px, py), (240, 180, 200, 255))


def main():
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size

    # First pass: global color replacement
    for y in range(h):
        for x in range(w):
            r, g, b, a = img.getpixel((x, y))
            if a > 0 and (r, g, b) in COLOR_MAP:
                new_rgb = COLOR_MAP[(r, g, b)]
                img.putpixel((x, y), new_rgb + (a,))

    # Second pass: add 80s accents
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_80s_accents(img, fx, fy)

    img.save(DST)
    print(f"Saved retro 80s skin to {DST}")


if __name__ == "__main__":
    main()
