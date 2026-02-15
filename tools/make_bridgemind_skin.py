"""
Generate a 'BridgeMind' skin for Dr. Vibe.

Based on the BridgeMind.ai brand: golden amber + cyan blue split,
lightning bolt energy. Dark tech background with the signature
gold-to-cyan gradient on the coat, matching goggle accents.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-bridgemind.png"

# BridgeMind brand colors (from logo analysis)
# Left side: golden amber gradient  #f0b000 → #fcd200
# Right side: cyan blue gradient    #0070c0 → #35c5fa

# We'll do a color-blocked coat: left half gold, right half cyan
# with a lightning-bolt inspired diagonal split

COLOR_MAP = {
    # Coat → start as BridgeMind gold (we'll split in accent pass)
    (245, 245, 250): (250, 200, 30),   # coat main     → BridgeMind gold
    (221, 224, 234): (225, 175, 20),   # coat shade    → darker gold
    (192, 196, 208): (195, 148, 10),   # coat dark     → deep gold shadow

    # Skin → warm, healthy glow (lit by the brand energy)

    # Hair → dark with cyan-blue highlights (tech-forward)
    (184, 184, 200): (35, 155, 220),   # hair          → BridgeMind cyan
    (208, 208, 220): (55, 195, 250),   # hair highlight → bright cyan
    (152, 152, 168): (20, 120, 190),   # hair dark     → deep blue

    # Goggle lenses → electric gold (lightning energy)
    (92, 224, 255):  (255, 210, 30),   # goggle lens   → electric gold
    (160, 240, 255): (255, 240, 100),  # goggle glint  → bright gold flash

    # Goggle frames → dark tech frame with blue tint
    (58, 58, 74):    (15, 60, 100),    # goggle frame  → dark blue-tech

    # Eyes → bright, energized
    (42, 42, 58):    (20, 30, 50),     # eye           → deep blue-dark
    (255, 255, 255): (255, 245, 180),  # eye highlight  → golden sparkle

    # Mouth → warm
    (192, 112, 96):  (195, 115, 95),   # mouth
    (139, 64, 64):   (140, 65, 60),    # mouth open

    # Pants → dark navy (matches BridgeMind's dark theme)
    (58, 58, 80):    (18, 30, 55),     # pants         → dark navy
    (74, 74, 96):    (28, 42, 70),     # pants highlight → subtle blue

    # Shoes → dark professional
    (42, 42, 53):    (15, 20, 35),     # shoes         → dark
    (58, 58, 69):    (25, 32, 50),     # shoe highlight
}

# BridgeMind brand palette
BM_GOLD       = (250, 200, 30)
BM_GOLD_SHADE = (225, 175, 20)
BM_GOLD_DARK  = (195, 148, 10)

BM_CYAN       = (50, 190, 245)
BM_CYAN_SHADE = (30, 160, 220)
BM_CYAN_DARK  = (15, 130, 195)

BM_WHITE      = (255, 255, 255)     # Lightning bolt white
BM_DARK       = (12, 20, 40)        # Dark background accent

GOLD_SET = {BM_GOLD, BM_GOLD_SHADE, BM_GOLD_DARK}

GOLD_TO_CYAN = {
    BM_GOLD:       BM_CYAN,
    BM_GOLD_SHADE: BM_CYAN_SHADE,
    BM_GOLD_DARK:  BM_CYAN_DARK,
}


def add_bridgemind_accents(img, fx, fy):
    """Split coat into gold/cyan halves with lightning bolt diagonal."""
    coat_rows = {}
    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in GOLD_SET:
                cols.append(x)
        if cols:
            coat_rows[y] = (min(cols), max(cols))

    if not coat_rows:
        return

    top_y = min(coat_rows.keys())
    bot_y = max(coat_rows.keys())
    total = bot_y - top_y + 1

    for y_local, (left, right) in coat_rows.items():
        rows_from_top = y_local - top_y
        center = (left + right) // 2
        body_width = right - left + 1

        # Lightning bolt diagonal split:
        # The split line goes from upper-right to lower-left
        # creating a zigzag pattern like the BridgeMind lightning bolt
        # Progress through the coat: 0.0 (top) to 1.0 (bottom)
        progress = rows_from_top / max(total - 1, 1)

        # Zigzag split: the dividing line shifts
        # Top: split is right of center (more gold)
        # Middle: split shifts left (zigzag)
        # Bottom: split is left of center (more cyan)
        if progress < 0.33:
            split_x = center + 2 - int(progress * 6)
        elif progress < 0.66:
            split_x = center + 1 + int((progress - 0.33) * 6)
        else:
            split_x = center + 3 - int((progress - 0.66) * 9)

        py = fy + y_local

        # Right side of split → cyan
        for x in range(32):
            px = fx + x
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in GOLD_SET:
                if x > split_x:
                    new_color = GOLD_TO_CYAN.get((r, g, b), BM_CYAN)
                    img.putpixel((px, py), new_color + (255,))

        # Lightning bolt line itself → white energy
        lx = split_x
        if left + 2 <= lx <= right - 2:
            px = fx + lx
            r, g, b, a = img.getpixel((px, py))
            if a > 0:
                img.putpixel((px, py), BM_WHITE + (255,))

    # Add energy glow dots on the coat (subtle sparkle)
    for y_local, (left, right) in coat_rows.items():
        rows_from_top = y_local - top_y
        center = (left + right) // 2
        py = fy + y_local

        # Scattered energy sparkles
        if rows_from_top == 2:
            # Gold side sparkle
            sx = center - 3
            if left <= sx <= right:
                px = fx + sx
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in GOLD_SET:
                    img.putpixel((px, py), (255, 235, 120, 255))

        if rows_from_top == 4:
            # Cyan side sparkle
            sx = center + 3
            if left <= sx <= right:
                px = fx + sx
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in (BM_CYAN, BM_CYAN_SHADE, BM_CYAN_DARK):
                    img.putpixel((px, py), (140, 230, 255, 255))


def add_pants_accent(img, fx, fy):
    """Add subtle BridgeMind accent to pants."""
    pants_dark = (18, 30, 55)
    pants_hi = (28, 42, 70)

    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) == pants_hi:
                # Subtle cyan tint on pant highlights
                img.putpixel((px, py), (25, 55, 90, 255))


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

    # Second pass: add BridgeMind split and accents
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            add_bridgemind_accents(img, fx, fy)
            add_pants_accent(img, fx, fy)

    img.save(DST)
    print(f"Saved BridgeMind skin to {DST}")


if __name__ == "__main__":
    main()
