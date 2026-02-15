"""
Generate an 'alien' skin for Dr. Vibe.

Green alien skin, dark space suit, glowing purple goggle lenses,
antenna-like hair highlights, and metallic boots.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-alien.png"

COLOR_MAP = {
    # Skin → alien green

    # Hair → bioluminescent teal (like alien tendrils/antennae)
    (184, 184, 200): (30, 220, 200),   # hair          → glowing teal
    (208, 208, 220): (80, 255, 230),   # hair highlight → bright bioluminescent
    (152, 152, 168): (20, 170, 155),   # hair dark     → deep teal

    # Coat → dark space suit / alien jumpsuit
    (245, 245, 250): (45, 45, 65),     # coat main     → dark gunmetal
    (221, 224, 234): (35, 35, 52),     # coat shade    → darker
    (192, 196, 208): (25, 25, 40),     # coat dark     → deepest

    # Goggle lenses → glowing purple/violet (alien tech)
    (92, 224, 255):  (180, 60, 255),   # goggle lens   → vivid purple
    (160, 240, 255): (220, 140, 255),  # goggle glint  → bright lavender glint

    # Goggle frames → alien alloy (dark with green tint)
    (58, 58, 74):    (35, 50, 45),     # goggle frame  → dark greenish metal

    # Eyes → large dark alien eyes
    (42, 42, 58):    (10, 10, 15),     # eye           → deep black
    (255, 255, 255): (180, 60, 255),   # eye highlight  → purple sparkle (matches goggles)

    # Mouth → subtle, alien
    (192, 112, 96):  (70, 150, 60),    # mouth         → greenish (blends with skin)
    (139, 64, 64):   (45, 110, 40),    # mouth open    → darker green interior

    # Pants → dark space suit continuation
    (58, 58, 80):    (30, 30, 48),     # pants         → dark space suit
    (74, 74, 96):    (40, 42, 60),     # pants highlight → subtle

    # Shoes → metallic alien boots
    (42, 42, 53):    (55, 65, 75),     # shoes         → metallic silver-blue
    (58, 58, 69):    (75, 88, 100),    # shoe highlight → lighter metallic
}

# Accent colors
GLOW_GREEN       = (100, 255, 120)
GLOW_GREEN_DIM   = (60, 200, 80)
GLOW_PURPLE      = (160, 50, 230)
GLOW_PURPLE_DIM  = (120, 35, 180)

# Mapped suit colors for detection
SUIT_SET = {
    (45, 45, 65),
    (35, 35, 52),
    (25, 25, 40),
}

PANTS_SET = {
    (30, 30, 48),
    (40, 42, 60),
}


def add_suit_accents(img, fx, fy):
    """Add glowing alien accents to the space suit."""
    suit_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in SUIT_SET:
                cols.append(x)
        if cols:
            suit_rows[y] = (min(cols), max(cols))

    if not suit_rows:
        return

    top_y = min(suit_rows.keys())
    bot_y = max(suit_rows.keys())
    total = bot_y - top_y + 1

    for y, (left, right) in suit_rows.items():
        rows_from_top = y - top_y
        center = (left + right) // 2

        # Glowing green center stripe (alien tech line down the chest)
        px, py = fx + center, fy + y
        r, g, b, a = img.getpixel((px, py))
        if a > 0 and (r, g, b) in SUIT_SET:
            if rows_from_top % 2 == 0:
                img.putpixel((px, py), GLOW_GREEN + (255,))
            else:
                img.putpixel((px, py), GLOW_GREEN_DIM + (255,))

        # Purple glow on shoulder/collar area (top 2 rows)
        if rows_from_top <= 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), GLOW_PURPLE_DIM + (255,))

        # Bottom hem glow
        if rows_from_top >= total - 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), GLOW_GREEN_DIM + (255,))


def add_boot_glow(img, fx, fy):
    """Add a subtle glow line on the metallic boots."""
    boot_colors = {(55, 65, 75), (75, 88, 100)}
    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) == (75, 88, 100):
                # Replace boot highlights with a subtle purple glow
                img.putpixel((px, py), (130, 100, 180, 255))


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

    # Second pass: add alien accents to each frame
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_suit_accents(img, fx, fy)
            add_boot_glow(img, fx, fy)

    img.save(DST)
    print(f"Saved alien skin to {DST}")


if __name__ == "__main__":
    main()
