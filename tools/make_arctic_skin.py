"""
Generate an 'arctic explorer' skin for Dr. Vibe.

White/ice-blue parka with cream fur trim, orange snow goggles,
insulated gray pants, heavy brown snow boots.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-arctic.png"

COLOR_MAP = {
    # Coat → ice-blue parka
    (245, 245, 250): (180, 210, 235),  # coat main     → ice blue parka
    (221, 224, 234): (150, 185, 215),  # coat shade    → deeper ice blue
    (192, 196, 208): (120, 155, 190),  # coat dark     → shadow blue

    # Skin → cold-flushed, rosy

    # Hair → fur-lined hood (cream/white fur)
    (184, 184, 200): (235, 225, 205),  # hair          → cream fur
    (208, 208, 220): (250, 242, 228),  # hair highlight → bright cream
    (152, 152, 168): (200, 190, 170),  # hair dark     → fur shadow

    # Goggle lenses → orange snow goggles
    (92, 224, 255):  (240, 150, 40),   # goggle lens   → orange tint
    (160, 240, 255): (255, 200, 100),  # goggle glint  → bright amber

    # Goggle frames → white frame
    (58, 58, 74):    (220, 225, 235),  # goggle frame  → white plastic

    # Eyes
    (42, 42, 58):    (35, 40, 55),     # eye
    (255, 255, 255): (255, 250, 240),  # eye highlight

    # Mouth → cold-chapped
    (192, 112, 96):  (200, 120, 115),  # mouth         → rosy from cold
    (139, 64, 64):   (150, 70, 70),    # mouth open

    # Pants → insulated gray snow pants
    (58, 58, 80):    (85, 90, 100),    # pants         → insulated gray
    (74, 74, 96):    (100, 105, 118),  # pants highlight

    # Shoes → heavy brown snow boots
    (42, 42, 53):    (90, 60, 35),     # shoes         → brown snow boots
    (58, 58, 69):    (115, 80, 50),    # shoe highlight → lighter leather
}

# Accent colors
FUR_CREAM    = (245, 235, 215)
FUR_SHADOW   = (210, 195, 170)
ZIPPER_METAL = (160, 165, 175)
POCKET_DARK  = (100, 135, 170)

PARKA_SET = {
    (180, 210, 235),
    (150, 185, 215),
    (120, 155, 190),
}


def add_arctic_accents(img, fx, fy):
    """Add fur trim, zipper, and pocket details to the parka."""
    coat_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in PARKA_SET:
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

        # Fur trim on collar (top 2 rows)
        if rows_from_top <= 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in PARKA_SET:
                    if x % 2 == 0:
                        img.putpixel((px, py), FUR_CREAM + (255,))
                    else:
                        img.putpixel((px, py), FUR_SHADOW + (255,))

        # Zipper line down center
        if 2 <= rows_from_top <= total - 2:
            px, py = fx + center, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in PARKA_SET:
                img.putpixel((px, py), ZIPPER_METAL + (255,))

        # Pocket patches on sides (midway down)
        if total // 3 <= rows_from_top <= total // 3 + 1:
            for offset in [-3, 3]:
                px_pocket = center + offset
                px, py = fx + px_pocket, fy + y
                if 0 <= px_pocket < 32:
                    r, g, b, a = img.getpixel((px, py))
                    if a > 0 and (r, g, b) in PARKA_SET:
                        img.putpixel((px, py), POCKET_DARK + (255,))

        # Bottom fur trim
        if rows_from_top >= total - 1:
            for x in range(left + 3, right - 2):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in PARKA_SET:
                    if x % 2 == 0:
                        img.putpixel((px, py), FUR_CREAM + (255,))
                    else:
                        img.putpixel((px, py), FUR_SHADOW + (255,))


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

    # Second pass: add arctic accents
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_arctic_accents(img, fx, fy)

    img.save(DST)
    print(f"Saved arctic skin to {DST}")


if __name__ == "__main__":
    main()
