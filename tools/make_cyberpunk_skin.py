"""
Generate a 'cyberpunk hacker' skin for Dr. Vibe.

Dark hoodie with neon purple/magenta trim, green goggle lenses,
monitor-glow skin tones, black cargo pants with neon accent.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-cyberpunk.png"

# ── Color mapping: original → cyberpunk ──

COLOR_MAP = {
    # Coat → dark hoodie
    (245, 245, 250): (38, 22, 52),     # coat main     → deep purple-black hoodie
    (221, 224, 234): (28, 16, 42),     # coat shade    → darker fold
    (192, 196, 208): (20, 10, 32),     # coat dark     → deepest shadow

    # Skin → cool monitor-glow tones

    # Hair → stays silver but with a slight purple tint
    (184, 184, 200): (170, 165, 210),  # hair          → purple-silver
    (208, 208, 220): (195, 190, 230),  # hair highlight → lighter purple-silver
    (152, 152, 168): (140, 135, 185),  # hair dark     → deeper purple-silver

    # Goggle lenses → neon green (hacker terminal green)
    (92, 224, 255):  (40, 255, 90),    # goggle lens   → neon green
    (160, 240, 255): (140, 255, 170),  # goggle glint  → bright green glint

    # Goggle frames → darker, more techy
    (58, 58, 74):    (30, 30, 45),     # goggle frame  → near-black

    # Eyes → keep dark but slight green reflect
    (42, 42, 58):    (32, 38, 50),     # eye           → hint of green-dark
    (255, 255, 255): (200, 255, 210),  # eye highlight  → green-tinted sparkle

    # Mouth → cooler tone
    (192, 112, 96):  (175, 100, 105),  # mouth         → cooler lip
    (139, 64, 64):   (120, 55, 65),    # mouth open    → cooler interior

    # Pants → black cargo
    (58, 58, 80):    (22, 22, 30),     # pants         → near-black
    (74, 74, 96):    (32, 32, 42),     # pants highlight → subtle highlight

    # Shoes → black tactical
    (42, 42, 53):    (15, 15, 22),     # shoes         → dark
    (58, 58, 69):    (25, 25, 35),     # shoe highlight → subtle
}

# Neon accent colors for trim
NEON_MAGENTA     = (255, 40, 180)
NEON_MAGENTA_DIM = (200, 30, 140)
NEON_CYAN        = (0, 240, 255)
NEON_CYAN_DIM    = (0, 180, 210)

# Original coat colors for detection
COAT_ORIG = {
    (245, 245, 250),  # coat main
    (221, 224, 234),  # coat shade
    (192, 196, 208),  # coat dark
}

# Mapped hoodie colors for detection after first pass
HOODIE_SET = {
    (38, 22, 52),
    (28, 16, 42),
    (20, 10, 32),
}


def find_coat_edges(img, fx, fy):
    """Find coat outline pixels (coat pixels adjacent to transparency or non-coat)."""
    edges = []
    coat_rows = {}

    for y in range(32):
        cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in HOODIE_SET:
                cols.append(x)
        if cols:
            coat_rows[y] = (min(cols), max(cols))

    # Find edge pixels: leftmost and rightmost coat pixel per row
    # and topmost/bottommost coat pixel per column
    for y, (left, right) in coat_rows.items():
        # Left and right edges of the main body (exclude arms)
        # Arms are the disconnected groups on sides
        # Find the main body by looking at the inner contiguous block
        edges.append((left, y, 'left'))
        edges.append((right, y, 'right'))

    # Top and bottom edges
    if coat_rows:
        top_y = min(coat_rows.keys())
        bot_y = max(coat_rows.keys())
        for y in [top_y, bot_y]:
            left, right = coat_rows[y]
            for x in range(left, right + 1):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in HOODIE_SET:
                    edge_type = 'top' if y == top_y else 'bottom'
                    edges.append((x, y, edge_type))

    return edges, coat_rows


def add_neon_trim(img, fx, fy, coat_rows):
    """Add neon accent lines along hoodie edges."""
    if not coat_rows:
        return

    top_y = min(coat_rows.keys())
    bot_y = max(coat_rows.keys())
    total = bot_y - top_y + 1

    for y, (left, right) in coat_rows.items():
        rows_from_top = y - top_y

        # Neon stripe down the right side of the hoodie (like a racing stripe)
        # Place it 2 pixels inside the right edge of the main body
        # Find the inner body (exclude arm pixels - arms are disconnected)
        center = (left + right) // 2
        # The inner body right edge is roughly center + 6-7
        inner_right = min(center + 6, right)

        # Right racing stripe
        sx = inner_right - 1
        px, py = fx + sx, fy + y
        r, g, b, a = img.getpixel((px, py))
        if a > 0 and (r, g, b) in HOODIE_SET:
            img.putpixel((px, py), NEON_MAGENTA + (255,))

        # Hood/collar neon trim on top 2 rows
        if rows_from_top <= 1:
            # Neon line across the top (hood edge)
            for x in range(left + 4, right - 3):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in HOODIE_SET:
                    img.putpixel((px, py), NEON_CYAN_DIM + (255,))

        # Bottom hem neon accent
        if rows_from_top >= total - 1:
            for x in range(left + 4, right - 3):
                px, py = fx + x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in HOODIE_SET:
                    img.putpixel((px, py), NEON_MAGENTA_DIM + (255,))


def add_neon_pants_stripe(img, fx, fy):
    """Add a subtle neon stripe on the pants."""
    pants_mapped = {(22, 22, 30), (32, 32, 42)}

    for y in range(32):
        pants_cols = []
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in pants_mapped:
                pants_cols.append(x)

        if pants_cols:
            # Find rightmost pixel of the left leg
            # Pants typically appear as two groups (two legs)
            groups = []
            current = [pants_cols[0]]
            for i in range(1, len(pants_cols)):
                if pants_cols[i] - pants_cols[i-1] <= 1:
                    current.append(pants_cols[i])
                else:
                    groups.append(current)
                    current = [pants_cols[i]]
            groups.append(current)

            # Add a cyan dot on the outer edge of each leg group
            for group in groups:
                stripe_x = group[-1]  # rightmost pixel of group
                px, py = fx + stripe_x, fy + y
                r, g, b, a = img.getpixel((px, py))
                if a > 0:
                    img.putpixel((px, py), NEON_CYAN_DIM + (255,))


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

    # Second pass: add neon trim to each frame
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            _, coat_rows = find_coat_edges(img, fx, fy)
            add_neon_trim(img, fx, fy, coat_rows)
            add_neon_pants_stripe(img, fx, fy)

    img.save(DST)
    print(f"Saved cyberpunk skin to {DST}")


if __name__ == "__main__":
    main()
