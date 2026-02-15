"""
Generate a 'pirate' skin for Dr. Vibe.

Tattered brown captain's coat, eye patch over one goggle lens,
red bandana hair highlights, gold accents, dark boots.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-pirate.png"

COLOR_MAP = {
    # Coat → tattered brown captain's coat
    (245, 245, 250): (120, 72, 40),    # coat main     → worn brown leather
    (221, 224, 234): (95, 55, 30),     # coat shade    → darker brown fold
    (192, 196, 208): (70, 40, 22),     # coat dark     → deep shadow

    # Skin → sun-weathered tan

    # Hair → red bandana with dark hair underneath
    (184, 184, 200): (180, 35, 35),    # hair          → red bandana
    (208, 208, 220): (210, 55, 50),    # hair highlight → bright red
    (152, 152, 168): (140, 25, 25),    # hair dark     → dark red

    # Goggle lenses → one gold (spyglass), one dark (eye patch effect)
    (92, 224, 255):  (220, 180, 60),   # goggle lens   → gold/amber
    (160, 240, 255): (245, 215, 100),  # goggle glint  → gold glint

    # Goggle frames → dark leather/metal
    (58, 58, 74):    (45, 30, 20),     # goggle frame  → dark leather

    # Eyes → intense pirate stare
    (42, 42, 58):    (30, 25, 20),     # eye           → dark brown
    (255, 255, 255): (255, 245, 220),  # eye highlight  → warm sparkle

    # Mouth → weathered
    (192, 112, 96):  (180, 100, 80),   # mouth         → sun-chapped
    (139, 64, 64):   (130, 55, 45),    # mouth open

    # Pants → dark seafarer pants
    (58, 58, 80):    (40, 35, 50),     # pants         → dark navy
    (74, 74, 96):    (55, 48, 65),     # pants highlight

    # Shoes → tall dark boots
    (42, 42, 53):    (35, 22, 15),     # shoes         → dark brown boots
    (58, 58, 69):    (55, 35, 25),     # shoe highlight → worn leather
}

# Accent colors
GOLD_BRIGHT = (240, 200, 70)
GOLD_DIM    = (190, 150, 50)
BELT_DARK   = (60, 35, 20)

SUIT_SET = {
    (120, 72, 40),
    (95, 55, 30),
    (70, 40, 22),
}


def add_pirate_accents(img, fx, fy):
    """Add gold trim and belt accents to the captain's coat."""
    coat_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in SUIT_SET:
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

        # Gold buttons down the front (offset left of center like a naval coat)
        btn_x = center - 1
        if rows_from_top > 1 and rows_from_top < total - 1 and rows_from_top % 2 == 0:
            px, py = fx + btn_x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in SUIT_SET:
                img.putpixel((px, py), GOLD_BRIGHT + (255,))

        # Gold trim on collar (top 1 row)
        if rows_from_top == 0:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), GOLD_DIM + (255,))

        # Belt line (dark stripe across the middle)
        if rows_from_top == total // 2:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), BELT_DARK + (255,))
            # Gold belt buckle at center
            px, py = fx + center, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0:
                img.putpixel((px, py), GOLD_BRIGHT + (255,))

        # Bottom hem gold trim
        if rows_from_top >= total - 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), GOLD_DIM + (255,))


def add_eye_patch(img, fx, fy):
    """Make the left goggle lens dark (eye patch effect)."""
    # The left goggle lens pixels - find them and darken one side
    GOLD_LENS = (220, 180, 60)
    PATCH = (25, 18, 12)

    for y in range(32):
        lens_xs = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) == GOLD_LENS:
                lens_xs.append((x, y))

        if len(lens_xs) >= 2:
            # Left lens is the one with smaller x values
            # Darken the leftmost lens pixel(s)
            left_lens = lens_xs[0]
            px, py = fx + left_lens[0], fy + left_lens[1]
            img.putpixel((px, py), PATCH + (255,))


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

    # Second pass: add accents
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_pirate_accents(img, fx, fy)
            add_eye_patch(img, fx, fy)

    img.save(DST)
    print(f"Saved pirate skin to {DST}")


if __name__ == "__main__":
    main()
