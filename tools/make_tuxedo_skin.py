"""
Generate a 'tuxedo shirt' skin for Dr. Vibe.

Takes the default sprite sheet and transforms the white lab coat into a
black tuxedo with white shirt front and red bow tie.
"""

from PIL import Image

SRC = "dr-vibe/src/assets/sprites/skins/dr-vibe-default.png"
DST = "dr-vibe/src/assets/sprites/skins/dr-vibe-tuxedo.png"

# Original coat palette
COAT_MAIN  = (245, 245, 250)   # #f5f5fa - primary coat body
COAT_SHADE = (221, 224, 234)   # #dde0ea - fold shadow
COAT_DARK  = (192, 196, 208)   # #c0c4d0 - deep shadow / hem

# Tuxedo jacket palette (rich black with subtle warm undertone)
TUX_MAIN   = (26, 26, 42)     # dark charcoal-navy
TUX_SHADE  = (18, 18, 34)     # darker fold
TUX_DARK   = (10, 10, 24)     # deepest shadow
TUX_LAPEL  = (34, 34, 52)     # slightly lighter for lapel highlight

# White shirt front
SHIRT_MAIN  = (240, 240, 248)  # crisp white
SHIRT_SHADE = (210, 212, 224)  # slight shadow on shirt
SHIRT_BTN   = (180, 180, 195)  # button dots

# Bow tie
BOWTIE_MAIN = (180, 32, 42)   # classic red
BOWTIE_DARK = (140, 24, 32)   # shadow red
BOWTIE_KNOT = (120, 20, 28)   # center knot

COAT_SET = {COAT_MAIN, COAT_SHADE, COAT_DARK}


def find_body_center_and_bounds(img, frame_x, frame_y):
    """Find the horizontal center and vertical extent of the coat in a frame."""
    coat_by_row = {}
    for y in range(32):
        cols = []
        for x in range(32):
            r, g, b, a = img.getpixel((frame_x + x, frame_y + y))
            if a > 0 and (r, g, b) in COAT_SET:
                cols.append(x)
        if cols:
            coat_by_row[y] = (min(cols), max(cols))
    return coat_by_row


def is_coat_pixel(img, px, py):
    r, g, b, a = img.getpixel((px, py))
    return a > 0 and (r, g, b) in COAT_SET


def get_rgb(img, px, py):
    r, g, b, a = img.getpixel((px, py))
    return (r, g, b), a


def transform_frame(img, fx, fy):
    """Transform one 32x32 frame from lab coat to tuxedo shirt."""
    coat_rows = find_body_center_and_bounds(img, fx, fy)
    if not coat_rows:
        return  # No coat in this frame (shouldn't happen but safety)

    # Find topmost coat row and the center line
    top_row = min(coat_rows.keys())

    # First pass: Replace ALL coat pixels with tuxedo black
    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            rgb, a = get_rgb(img, px, py)
            if a > 0:
                if rgb == COAT_MAIN:
                    img.putpixel((px, py), TUX_MAIN + (255,))
                elif rgb == COAT_SHADE:
                    img.putpixel((px, py), TUX_SHADE + (255,))
                elif rgb == COAT_DARK:
                    img.putpixel((px, py), TUX_DARK + (255,))

    # Second pass: Add white shirt front (center vertical strip)
    # The shirt front is a narrow strip down the center of the torso
    for y_local, (left, right) in coat_rows.items():
        body_width = right - left + 1
        center = (left + right) // 2
        py = fy + y_local
        rows_from_top = y_local - top_row

        # Shirt front width: narrow strip, about 4-6 pixels in center
        # Taper at top (collar) and bottom (where jacket closes)
        total_coat_rows = max(coat_rows.keys()) - top_row + 1

        # Skip the arm rows (rows where coat extends far out - hands)
        # Arms are the disconnected coat pixels on the sides
        # The main body is roughly the inner 14 pixels
        inner_left = center - 6
        inner_right = center + 6

        # Shirt front: 4px wide strip in center, with lapel lines
        shirt_half = 2  # 2 pixels each side of center = 4px wide

        # Top 2 rows of coat: collar/neckline - make slightly wider for V-shape
        if rows_from_top <= 1:
            shirt_half = 3  # wider at top for V-neck collar effect
        elif rows_from_top >= total_coat_rows - 2:
            shirt_half = 1  # narrows at bottom

        for x_local in range(center - shirt_half, center + shirt_half + 1):
            px = fx + x_local
            py_check = fy + y_local
            rgb, a = get_rgb(img, px, py_check)
            if a > 0 and x_local >= inner_left and x_local <= inner_right:
                # Check it's actually tux (was coat) not something else
                if rgb in (TUX_MAIN, TUX_SHADE, TUX_DARK):
                    if x_local == center - shirt_half or x_local == center + shirt_half:
                        img.putpixel((px, py_check), SHIRT_SHADE + (255,))
                    else:
                        img.putpixel((px, py_check), SHIRT_MAIN + (255,))

        # Add button dots down the center (every 3rd row)
        if rows_from_top > 2 and rows_from_top < total_coat_rows - 1 and rows_from_top % 3 == 0:
            bpx = fx + center
            bpy = fy + y_local
            rgb, a = get_rgb(img, bpx, bpy)
            if a > 0:
                img.putpixel((bpx, bpy), SHIRT_BTN + (255,))

    # Third pass: Add bow tie at the top of the shirt front
    # Bow tie goes on the first coat row, centered
    if top_row in coat_rows:
        left, right = coat_rows[top_row]
        center = (left + right) // 2
        bt_y = fy + top_row

        # Bow tie: 5 pixels wide, 1-2 pixels tall
        # Pattern:  D M K M D  (dark, main, knot, main, dark)
        bow_pixels = [
            (center - 2, BOWTIE_DARK),
            (center - 1, BOWTIE_MAIN),
            (center,     BOWTIE_KNOT),
            (center + 1, BOWTIE_MAIN),
            (center + 2, BOWTIE_DARK),
        ]
        for bx, color in bow_pixels:
            px = fx + bx
            rgb, a = get_rgb(img, px, bt_y)
            if a > 0:
                img.putpixel((px, bt_y), color + (255,))

        # Second bow tie row (if there's a row below)
        if top_row + 1 in coat_rows:
            bt_y2 = fy + top_row + 1
            bow2 = [
                (center - 1, BOWTIE_DARK),
                (center,     BOWTIE_KNOT),
                (center + 1, BOWTIE_DARK),
            ]
            for bx, color in bow2:
                px = fx + bx
                rgb, a = get_rgb(img, px, bt_y2)
                if a > 0:
                    img.putpixel((px, bt_y2), color + (255,))

    # Fourth pass: Add lapel highlights along shirt front edges
    for y_local, (left, right) in coat_rows.items():
        center = (left + right) // 2
        rows_from_top = y_local - top_row
        total_coat_rows = max(coat_rows.keys()) - top_row + 1

        if 1 <= rows_from_top <= total_coat_rows - 2:
            shirt_half = 2
            if rows_from_top <= 1:
                shirt_half = 3
            elif rows_from_top >= total_coat_rows - 2:
                shirt_half = 1

            # Lapel highlight: 1px line just outside the shirt front
            for side in [-1, 1]:
                lx = center + side * (shirt_half + 1)
                px = fx + lx
                py = fy + y_local
                if 0 <= lx < 32:
                    rgb, a = get_rgb(img, px, py)
                    if a > 0 and rgb in (TUX_MAIN, TUX_SHADE, TUX_DARK):
                        img.putpixel((px, py), TUX_LAPEL + (255,))


def main():
    img = Image.open(SRC).convert("RGBA")

    # Process all 16 rows x 4 columns of frames
    for row in range(16):
        for col in range(4):
            fx = col * 32
            fy = row * 32
            transform_frame(img, fx, fy)

    img.save(DST)
    print(f"Saved tuxedo skin to {DST}")


if __name__ == "__main__":
    main()
