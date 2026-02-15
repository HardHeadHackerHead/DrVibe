"""
Generate a 'wizard' skin for Dr. Vibe.

Deep purple/midnight blue robe with gold star accents,
golden goggle lenses, white-tinted beard hair, brown leather boots.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-wizard.png"

COLOR_MAP = {
    # Coat → deep purple wizard robe
    (245, 245, 250): (55, 30, 100),    # coat main     → rich purple robe
    (221, 224, 234): (42, 22, 80),     # coat shade    → darker purple fold
    (192, 196, 208): (30, 15, 60),     # coat dark     → deepest shadow

    # Skin → pale scholarly complexion

    # Hair → wise white/silver beard-like
    (184, 184, 200): (225, 220, 230),  # hair          → white-silver
    (208, 208, 220): (245, 242, 248),  # hair highlight → bright white
    (152, 152, 168): (195, 190, 205),  # hair dark     → silver shadow

    # Goggle lenses → golden enchanted spectacles
    (92, 224, 255):  (240, 200, 60),   # goggle lens   → golden
    (160, 240, 255): (255, 235, 130),  # goggle glint  → bright gold glint

    # Goggle frames → ornate bronze
    (58, 58, 74):    (140, 100, 50),   # goggle frame  → bronze

    # Eyes → wise deep eyes
    (42, 42, 58):    (30, 25, 55),     # eye           → deep purple tint
    (255, 255, 255): (255, 240, 180),  # eye highlight  → golden sparkle

    # Mouth → aged
    (192, 112, 96):  (180, 120, 110),  # mouth
    (139, 64, 64):   (130, 70, 65),    # mouth open

    # Pants → dark robe continues (long robe)
    (58, 58, 80):    (40, 22, 70),     # pants         → robe continuation
    (74, 74, 96):    (52, 32, 85),     # pants highlight

    # Shoes → brown leather boots
    (42, 42, 53):    (80, 50, 30),     # shoes         → brown leather
    (58, 58, 69):    (100, 65, 40),    # shoe highlight → lighter leather
}

# Accent colors
GOLD_STAR    = (255, 220, 80)
GOLD_DIM     = (200, 170, 55)
MIDNIGHT     = (20, 12, 50)
SILVER_TRIM  = (190, 195, 210)

ROBE_SET = {
    (55, 30, 100),
    (42, 22, 80),
    (30, 15, 60),
}


def add_wizard_accents(img, fx, fy):
    """Add gold stars and silver trim to the wizard robe."""
    coat_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in ROBE_SET:
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

        # Silver trim on collar
        if rows_from_top == 0:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in ROBE_SET:
                    img.putpixel((px, py), SILVER_TRIM + (255,))

        # Gold star accents scattered on the robe
        # Place stars at specific positions for a magical look
        if rows_from_top == 3 and right - left > 8:
            # Star on the left chest
            sx = center - 3
            px, py = fx + sx, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in ROBE_SET:
                img.putpixel((px, py), GOLD_STAR + (255,))

        if rows_from_top == 5 and right - left > 8:
            # Star on the right side
            sx = center + 2
            px, py = fx + sx, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in ROBE_SET:
                img.putpixel((px, py), GOLD_STAR + (255,))

        if rows_from_top == total // 2:
            # Star at center
            px, py = fx + center, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in ROBE_SET:
                img.putpixel((px, py), GOLD_DIM + (255,))

        # Gold hem trim at bottom
        if rows_from_top >= total - 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in ROBE_SET:
                    if x % 2 == 0:
                        img.putpixel((px, py), GOLD_DIM + (255,))
                    else:
                        img.putpixel((px, py), SILVER_TRIM + (255,))

        # Vertical gold trim down the center front
        if 1 <= rows_from_top <= total - 2:
            px, py = fx + center, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in ROBE_SET:
                img.putpixel((px, py), GOLD_DIM + (255,))


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

    # Second pass: add wizard accents
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_wizard_accents(img, fx, fy)

    img.save(DST)
    print(f"Saved wizard skin to {DST}")


if __name__ == "__main__":
    main()
