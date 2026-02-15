"""
Generate a 'firefighter' skin for Dr. Vibe.

Bright yellow turnout coat with reflective silver stripes,
red helmet tint on hair, dark visor goggles, heavy black boots.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-firefighter.png"

COLOR_MAP = {
    # Coat → bright yellow turnout gear
    (245, 245, 250): (230, 200, 45),   # coat main     → safety yellow
    (221, 224, 234): (200, 170, 35),   # coat shade    → darker yellow fold
    (192, 196, 208): (170, 140, 25),   # coat dark     → deep yellow shadow

    # Skin → healthy warm tone (soot-touched)

    # Hair → red helmet tint
    (184, 184, 200): (190, 45, 35),    # hair          → fire helmet red
    (208, 208, 220): (220, 65, 50),    # hair highlight → bright red
    (152, 152, 168): (150, 30, 25),    # hair dark     → dark helmet

    # Goggle lenses → dark smoke visor
    (92, 224, 255):  (60, 60, 70),     # goggle lens   → dark tinted visor
    (160, 240, 255): (100, 100, 115),  # goggle glint  → subtle reflection

    # Goggle frames → yellow to match helmet
    (58, 58, 74):    (180, 155, 30),   # goggle frame  → yellow frame

    # Eyes → determined look
    (42, 42, 58):    (35, 30, 25),     # eye
    (255, 255, 255): (255, 250, 240),  # eye highlight

    # Mouth
    (192, 112, 96):  (185, 108, 90),   # mouth
    (139, 64, 64):   (130, 58, 50),    # mouth open

    # Pants → dark turnout pants
    (58, 58, 80):    (50, 48, 42),     # pants         → dark fireproof
    (74, 74, 96):    (65, 62, 55),     # pants highlight

    # Shoes → heavy black firefighter boots
    (42, 42, 53):    (25, 25, 22),     # shoes         → heavy black
    (58, 58, 69):    (40, 38, 35),     # shoe highlight → rubber sheen
}

# Accent colors
SILVER_STRIPE    = (200, 205, 215)
SILVER_STRIPE_DK = (160, 165, 175)
ORANGE_ACCENT    = (240, 120, 30)

SUIT_SET = {
    (230, 200, 45),
    (200, 170, 35),
    (170, 140, 25),
}

PANTS_SET = {
    (50, 48, 42),
    (65, 62, 55),
}


def add_reflective_stripes(img, fx, fy):
    """Add silver reflective stripes to the turnout coat and pants."""
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

        # Two horizontal reflective stripes across the torso
        # One at ~1/3 and one at ~2/3 of the coat height
        stripe1 = total // 3
        stripe2 = (total * 2) // 3

        if rows_from_top == stripe1 or rows_from_top == stripe2:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), SILVER_STRIPE + (255,))

        # Orange accent line just below each silver stripe
        if rows_from_top == stripe1 + 1 or rows_from_top == stripe2 + 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in SUIT_SET:
                    img.putpixel((px, py), ORANGE_ACCENT + (255,))

    # Reflective stripe on pants
    for y in range(32):
        pants_cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in PANTS_SET:
                pants_cols.append(x)
        if pants_cols:
            # Silver stripe on the bottom row of pants
            pant_groups = []
            current = [pants_cols[0]]
            for i in range(1, len(pants_cols)):
                if pants_cols[i] - pants_cols[i-1] <= 1:
                    current.append(pants_cols[i])
                else:
                    pant_groups.append(current)
                    current = [pants_cols[i]]
            pant_groups.append(current)

            for group in groups if 'groups' in dir() else pant_groups:
                if len(group) >= 2:
                    # Bottom pixel of each leg group gets a silver stripe
                    mid = group[len(group)//2]
                    px, py = fx + mid, fy + y
                    r, g, b, a = img.getpixel((px, py))
                    if a > 0 and (r, g, b) in PANTS_SET:
                        img.putpixel((px, py), SILVER_STRIPE_DK + (255,))


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

    # Second pass: add reflective stripes
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_reflective_stripes(img, fx, fy)

    img.save(DST)
    print(f"Saved firefighter skin to {DST}")


if __name__ == "__main__":
    main()
