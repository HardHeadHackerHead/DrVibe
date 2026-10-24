"""
Generate a 'BridgeMind' skin for Dr. Vibe.

Based on the BridgeMind.ai brand: golden amber + cyan blue split,
lightning bolt energy. Dark tech background with the signature
gold-to-cyan gradient on the coat, matching goggle accents.

Bonus animations (rows 17-20):
  Row 17 – sunglasses  : puts on signature shades (4 frames)
  Row 18 – pushups     : Matthew's live-stream pushup routine (5 frames)
  Row 19 – smoothie    : blending and drinking a smoothie (4 frames)
  Row 20 – coldPlunge  : jumping into an ice bath (5 frames)
"""

from PIL import Image

SRC = "src/assets/sprites/skins/dr-vibe-default.png"
DST = "src/assets/sprites/skins/dr-vibe-bridgemind.png"

# BridgeMind brand colors (from logo analysis)
# Left side: golden amber gradient  #f0b000 → #fcd200
# Right side: cyan blue gradient    #0070c0 → #35c5fa

COLOR_MAP = {
    # Coat → start as BridgeMind gold (we'll split in accent pass)
    (245, 245, 250): (250, 200, 30),   # coat main     → BridgeMind gold
    (221, 224, 234): (225, 175, 20),   # coat shade    → darker gold
    (192, 196, 208): (195, 148, 10),   # coat dark     → deep gold shadow

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
BM_GOLD_DK    = (195, 148, 10)

BM_CYAN       = (50, 190, 245)
BM_CYAN_SHADE = (30, 160, 220)
BM_CYAN_DK    = (15, 130, 195)

BM_WHITE      = (255, 255, 255)     # Lightning bolt white
BM_DARK       = (12, 20, 40)        # Dark background accent

GOLD_SET = {BM_GOLD, BM_GOLD_SHADE, BM_GOLD_DK}

GOLD_TO_CYAN = {
    BM_GOLD:       BM_CYAN,
    BM_GOLD_SHADE: BM_CYAN_SHADE,
    BM_GOLD_DK:    BM_CYAN_DK,
}

# ── Bonus animation palette (from pixel-level frame analysis) ──────────────

SKIN        = (253, 216, 176)
SKIN_SH     = (232, 184, 136)
SKIN_MED    = (212, 168, 120)
EYE_PU      = (20, 30, 50)
EYE_HI      = (255, 245, 180)
MOUTH_C     = (195, 115, 95)
MOUTH_DK    = (140, 65, 60)
GOGGLE_FR   = (15, 60, 100)
GOGGLE_LN   = (255, 210, 30)
GOGGLE_GL   = (255, 240, 100)
HAIR_C      = (35, 155, 220)
HAIR_HI     = (55, 195, 250)
HAIR_DK     = (20, 120, 190)
NAVY        = (18, 30, 55)
NAVY_HI     = (25, 55, 90)
SHOE_C      = (15, 20, 35)
SHOE_HI     = (25, 32, 50)
SPARKLE_G   = (255, 235, 120)
SPARKLE_C   = (140, 230, 255)

# Sunglasses
SHADES      = (8, 12, 25)
SHADES_FR   = (25, 30, 50)
SHADES_GL   = (70, 150, 210)

# Smoothie / blender
BLENDER_C   = (30, 160, 220)
BLENDER_LT  = (60, 195, 245)
SMOOTHIE    = (80, 195, 100)
SMOOTHIE_DK = (55, 155, 75)
STRAW       = (255, 225, 45)
FRUIT_R     = (235, 65, 50)
FRUIT_Y     = (255, 185, 35)

# Cold plunge
TUB_RIM     = (115, 132, 148)
TUB_C       = (75, 90, 108)
WATER_C     = (25, 100, 195)
WATER_LT    = (50, 135, 220)
ICE_C       = (200, 228, 255)
ICE_SH      = (170, 205, 240)
SPLASH_C    = (130, 195, 245)
SPLASH_LT   = (200, 230, 255)
SWEAT_C     = (100, 168, 235)


# ── Existing accent functions ──────────────────────────────────────────────

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

        progress = rows_from_top / max(total - 1, 1)

        if progress < 0.33:
            split_x = center + 2 - int(progress * 6)
        elif progress < 0.66:
            split_x = center + 1 + int((progress - 0.33) * 6)
        else:
            split_x = center + 3 - int((progress - 0.66) * 9)

        py = fy + y_local

        for x in range(32):
            px = fx + x
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) in GOLD_SET:
                if x > split_x:
                    new_color = GOLD_TO_CYAN.get((r, g, b), BM_CYAN)
                    img.putpixel((px, py), new_color + (255,))

        lx = split_x
        if left + 2 <= lx <= right - 2:
            px = fx + lx
            r, g, b, a = img.getpixel((px, py))
            if a > 0:
                img.putpixel((px, py), BM_WHITE + (255,))

    for y_local, (left, right) in coat_rows.items():
        rows_from_top = y_local - top_y
        center = (left + right) // 2
        py = fy + y_local

        if rows_from_top == 2:
            sx = center - 3
            if left <= sx <= right:
                px = fx + sx
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in GOLD_SET:
                    img.putpixel((px, py), (255, 235, 120, 255))

        if rows_from_top == 4:
            sx = center + 3
            if left <= sx <= right:
                px = fx + sx
                r, g, b, a = img.getpixel((px, py))
                if a > 0 and (r, g, b) in (BM_CYAN, BM_CYAN_SHADE, BM_CYAN_DK):
                    img.putpixel((px, py), (140, 230, 255, 255))


def add_pants_accent(img, fx, fy):
    """Add subtle BridgeMind accent to pants."""
    pants_hi = (28, 42, 70)
    for y in range(32):
        for x in range(32):
            px, py = fx + x, fy + y
            r, g, b, a = img.getpixel((px, py))
            if a > 0 and (r, g, b) == pants_hi:
                img.putpixel((px, py), (25, 55, 90, 255))


# ── Pixel helpers for bonus animations ────────────────────────────────────

def _p(img, x, y, color):
    """Set one pixel (bounds-checked). color is RGB or RGBA tuple."""
    w, h = img.size
    if 0 <= x < w and 0 <= y < h:
        c = color + (255,) if len(color) == 3 else color
        img.putpixel((x, y), c)


def _hl(img, x, y, length, color):
    for i in range(length):
        _p(img, x + i, y, color)


def _vl(img, x, y, length, color):
    for i in range(length):
        _p(img, x, y + i, color)


def _rc(img, x, y, w, h, color):
    for row in range(h):
        _hl(img, x, y + row, w, color)


def _erase(img, x, y, w, h):
    """Fill a rect with transparent."""
    for row in range(h):
        for col in range(w):
            ix, iy = x + col, y + row
            if 0 <= ix < img.width and 0 <= iy < img.height:
                img.putpixel((ix, iy), (0, 0, 0, 0))


def _copy_frame(img, src_row, src_col, dst_row, dst_col):
    """Copy a 32×32 frame within img."""
    for fy in range(32):
        for fx in range(32):
            p = img.getpixel((src_col * 32 + fx, src_row * 32 + fy))
            img.putpixel((dst_col * 32 + fx, dst_row * 32 + fy), p)


# ── Character component drawing (based on exact frame-0 pixel positions) ──

def _draw_hair(img, ox, oy):
    """Cyan hair. ox/oy = frame origin."""
    _p(img, ox+9,  oy+3, HAIR_C);  _p(img, ox+10, oy+3, HAIR_C)
    _p(img, ox+13, oy+3, HAIR_C);  _p(img, ox+14, oy+3, HAIR_C); _p(img, ox+15, oy+3, HAIR_C)
    _p(img, ox+19, oy+3, HAIR_C);  _p(img, ox+20, oy+3, HAIR_C)
    _hl(img, ox+9,  oy+4, 2, HAIR_C)
    _hl(img, ox+11, oy+4, 2, HAIR_HI)
    _hl(img, ox+13, oy+4, 4, HAIR_C)
    _hl(img, ox+17, oy+4, 2, HAIR_HI)
    _hl(img, ox+19, oy+4, 4, HAIR_C)
    _p(img, ox+9,  oy+5, HAIR_DK)
    _hl(img, ox+10, oy+5, 12, HAIR_C)
    _p(img, ox+22, oy+5, HAIR_DK)


def _draw_goggles(img, ox, oy):
    """Forehead goggles."""
    _p(img, ox+11, oy+6, GOGGLE_FR)
    _p(img, ox+12, oy+6, GOGGLE_GL)
    _p(img, ox+13, oy+6, GOGGLE_LN)
    _hl(img, ox+14, oy+6, 4, GOGGLE_FR)
    _p(img, ox+18, oy+6, GOGGLE_GL)
    _p(img, ox+19, oy+6, GOGGLE_LN)
    _p(img, ox+20, oy+6, GOGGLE_FR)
    _hl(img, ox+11, oy+7, 4, GOGGLE_FR)
    _p(img, ox+15, oy+7, SKIN); _p(img, ox+16, oy+7, SKIN)
    _hl(img, ox+17, oy+7, 4, GOGGLE_FR)


def _draw_face(img, ox, oy, expr='neutral', blink=False):
    """Face skin, eyes, mouth."""
    for fy in range(8, 13):
        _hl(img, ox+11, oy+fy, 10, SKIN)
        _p(img, ox+11, oy+fy, SKIN_SH)
        _p(img, ox+20, oy+fy, SKIN_SH)
    # Eyes
    if not blink:
        _p(img, ox+13, oy+10, EYE_HI); _p(img, ox+14, oy+10, EYE_PU)
        _p(img, ox+17, oy+10, EYE_HI); _p(img, ox+18, oy+10, EYE_PU)
        _p(img, ox+13, oy+11, EYE_PU); _p(img, ox+14, oy+11, EYE_PU)
        _p(img, ox+17, oy+11, EYE_PU); _p(img, ox+18, oy+11, EYE_PU)
    else:
        _hl(img, ox+12, oy+11, 3, SKIN_SH)
        _hl(img, ox+17, oy+11, 3, SKIN_SH)
    # Jaw / chin shadow
    _p(img, ox+11, oy+13, SKIN_SH); _hl(img, ox+12, oy+13, 2, SKIN)
    _hl(img, ox+18, oy+13, 2, SKIN); _p(img, ox+20, oy+13, SKIN_SH)
    # Mouth
    if expr == 'neutral':
        _hl(img, ox+14, oy+13, 4, MOUTH_C)
    elif expr in ('happy', 'smile'):
        _p(img, ox+13, oy+13, SKIN_SH)
        _hl(img, ox+14, oy+13, 4, MOUTH_C)
        _p(img, ox+18, oy+13, SKIN_SH)
    elif expr in ('open', 'excited'):
        _hl(img, ox+13, oy+13, 6, MOUTH_C)
        _hl(img, ox+14, oy+13, 4, MOUTH_DK)
    elif expr == 'strain':
        _hl(img, ox+13, oy+13, 6, MOUTH_C)
        _p(img, ox+14, oy+13, MOUTH_DK); _p(img, ox+17, oy+13, MOUTH_DK)
    elif expr == 'cold':
        _hl(img, ox+14, oy+13, 4, MOUTH_C)
        _p(img, ox+14, oy+13, (240, 240, 240))
        _p(img, ox+16, oy+13, (240, 240, 240))
    # Chin / neck
    _hl(img, ox+13, oy+14, 6, SKIN_MED)
    _p(img, ox+11, oy+14, SKIN); _p(img, ox+12, oy+14, SKIN)
    _p(img, ox+19, oy+14, SKIN); _p(img, ox+20, oy+14, SKIN)
    _hl(img, ox+14, oy+15, 4, SKIN_SH)


def _draw_coat_body(img, ox, oy):
    """Gold/cyan lightning-split coat (y=16-23)."""
    # y=16 collar
    _hl(img, ox+9,  oy+16, 6, BM_GOLD)
    _p(img, ox+14, oy+16, BM_GOLD_SHADE)
    _p(img, ox+15, oy+16, SKIN); _p(img, ox+16, oy+16, SKIN)
    _p(img, ox+17, oy+16, BM_WHITE)
    _hl(img, ox+18, oy+16, 5, BM_CYAN)
    # y=17-21 main coat + arms
    for fy in range(17, 22):
        _hl(img, ox+5,  oy+fy, 3, BM_GOLD)   # left arm
        _hl(img, ox+9,  oy+fy, 5, BM_GOLD)   # left coat
        _p(img, ox+14, oy+fy, BM_GOLD_SHADE)
        _hl(img, ox+15, oy+fy, 2, BM_GOLD)
        _p(img, ox+17, oy+fy, BM_WHITE)       # lightning
        _hl(img, ox+18, oy+fy, 5, BM_CYAN)   # right coat
        _hl(img, ox+24, oy+fy, 3, BM_CYAN)   # right arm
    # sparkles
    _p(img, ox+12, oy+18, SPARKLE_G)
    _p(img, ox+18, oy+20, SPARKLE_C)
    # y=22 lower coat
    _hl(img, ox+5,  oy+22, 3, SKIN)
    _hl(img, ox+9,  oy+22, 8, BM_GOLD_SHADE)
    _p(img, ox+17, oy+22, BM_WHITE)
    _hl(img, ox+18, oy+22, 5, BM_CYAN_SHADE)
    _hl(img, ox+24, oy+22, 3, SKIN)
    # y=23 bottom coat edge
    _hl(img, ox+5,  oy+23, 3, SKIN)
    _p(img, ox+9,  oy+23, BM_GOLD)
    _hl(img, ox+10, oy+23, 5, BM_GOLD_DK)
    _p(img, ox+15, oy+23, BM_WHITE)
    _hl(img, ox+16, oy+23, 6, BM_CYAN_DK)
    _p(img, ox+22, oy+23, BM_CYAN)
    _hl(img, ox+24, oy+23, 3, SKIN)


def _draw_legs(img, ox, oy):
    """Navy pants + dark shoes."""
    for fy in range(24, 27):
        _p(img, ox+12, oy+fy, NAVY_HI); _hl(img, ox+13, oy+fy, 2, NAVY)
        _p(img, ox+17, oy+fy, NAVY_HI); _hl(img, ox+18, oy+fy, 2, NAVY)
    _p(img, ox+11, oy+27, SHOE_HI); _hl(img, ox+12, oy+27, 3, SHOE_C)
    _p(img, ox+17, oy+27, SHOE_HI); _hl(img, ox+18, oy+27, 3, SHOE_C)


def _draw_bm_char(img, ox, oy, expr='neutral', blink=False):
    """Draw a complete upright BridgeMind character at frame origin (ox, oy)."""
    _draw_hair(img, ox, oy)
    _draw_goggles(img, ox, oy)
    _draw_face(img, ox, oy, expr=expr, blink=blink)
    _draw_coat_body(img, ox, oy)
    _draw_legs(img, ox, oy)


def _draw_sunglasses(img, ox, oy):
    """Overlay cool shades over the eye area at frame origin (ox, oy)."""
    ey = oy + 10   # eye row
    # Left lens
    _rc(img, ox+11, ey, 4, 2, SHADES)
    # Right lens
    _rc(img, ox+16, ey, 4, 2, SHADES)
    # Bridge
    _p(img, ox+15, ey, SHADES_FR)
    # Frame arms
    _p(img, ox+10, ey, SHADES_FR)
    _p(img, ox+20, ey, SHADES_FR)
    # Glints (cyan BridgeMind reflection)
    _p(img, ox+11, ey,     SHADES_GL)
    _p(img, ox+16, ey,     SHADES_GL)


# ── ROW 17 – Sunglasses (4 frames) ────────────────────────────────────────

def draw_sunglasses_anim(img):
    """
    Bridgemind slides on a pair of cool shades.
    Row 17 in the sprite sheet.
    """
    ROW = 17

    # Frame 0: normal idle (no glasses yet)
    _copy_frame(img, 0, 0, ROW, 0)

    # Frame 1: right arm raised toward face
    _copy_frame(img, 0, 1, ROW, 1)
    ox, oy = 1 * 32, ROW * 32
    # Erase the normal right arm (x=24-26, y=17-23) in this frame
    _erase(img, ox + 24, oy + 17, 3, 7)
    # Draw arm curving up to the face area: sleeve then bare arm
    _vl(img, ox + 22, oy + 16, 3, BM_CYAN)         # shoulder turn
    _vl(img, ox + 23, oy + 16, 3, BM_CYAN)
    _hl(img, ox + 20, oy + 15, 3, BM_CYAN)          # forearm
    _hl(img, ox + 19, oy + 14, 3, SKIN)             # elbow / bare arm
    _hl(img, ox + 18, oy + 13, 3, SKIN)             # forearm bare
    _hl(img, ox + 18, oy + 12, 2, SKIN)             # hand reaching face
    _hl(img, ox + 19, oy + 11, 2, SKIN)

    # Frame 2: sunglasses sliding down, hand still near face
    _copy_frame(img, 0, 0, ROW, 2)
    ox, oy = 2 * 32, ROW * 32
    # Partial glasses visible (just the frame line starting)
    _hl(img, ox + 11, oy + 10, 9, SHADES_FR)        # thin frame line
    _p(img, ox + 15, oy + 10, SHADES_FR)            # bridge
    # Hand remnant at face
    _p(img, ox + 20, oy + 11, SKIN)
    _p(img, ox + 21, oy + 11, SKIN)
    _p(img, ox + 20, oy + 12, SKIN)

    # Frame 3: full shades on, cool pose
    _copy_frame(img, 0, 0, ROW, 3)
    ox, oy = 3 * 32, ROW * 32
    _draw_sunglasses(img, ox, oy)


# ── ROW 18 – Pushups (5 frames) ───────────────────────────────────────────
#
# Front-facing layout (character faces viewer, same orientation as idle):
#
#  UP   – head at normal height, arms extend out+down in a V to planted hands
#  DOWN – head drops 5px (body near floor), elbows flare wide then fold back
#
# The V-arm shape in UP and wide-elbow shape in DOWN read immediately as
# pushup form when viewed from the front.

def _draw_pushup_front(img, ox, oy, position='up'):
    """Front-facing pushup frame. Character faces viewer."""
    # HEAD: DOWN shifts everything 5px lower so body looks closer to floor
    hoff = 0 if position == 'up' else 5
    hy   = oy + hoff    # head-functions origin y
    by   = hy + 16      # coat body top y  (always 16 below head origin)

    # ── HEAD (reuse existing drawing functions) ───────────────────────────
    _draw_hair(img, ox, hy)
    _draw_goggles(img, ox, hy)
    _draw_face(img, ox, hy, expr='neutral' if position == 'up' else 'strain')

    # ── COAT BODY (no hanging arm sleeves — arms drawn separately) ────────
    # Collar row
    _hl(img, ox+9,  by, 5, BM_GOLD)
    _p(img,  ox+14, by, BM_GOLD_SHADE)
    _p(img,  ox+15, by, SKIN); _p(img, ox+16, by, SKIN)  # shirt peek
    _p(img,  ox+17, by, BM_WHITE)
    _hl(img, ox+18, by, 5, BM_CYAN)
    # Coat row 1
    _hl(img, ox+9,  by+1, 5, BM_GOLD)
    _p(img,  ox+14, by+1, BM_GOLD_SHADE)
    _hl(img, ox+15, by+1, 2, BM_GOLD)
    _p(img,  ox+17, by+1, BM_WHITE)
    _hl(img, ox+18, by+1, 5, BM_CYAN)
    _p(img,  ox+12, by+1, SPARKLE_G)
    # Coat row 2 (lower edge)
    _hl(img, ox+9,  by+2, 5, BM_GOLD_SHADE)
    _p(img,  ox+14, by+2, BM_GOLD_DK)
    _hl(img, ox+15, by+2, 2, BM_GOLD_SHADE)
    _p(img,  ox+17, by+2, BM_WHITE)
    _hl(img, ox+18, by+2, 5, BM_CYAN_SHADE)
    _p(img,  ox+20, by+2, SPARKLE_C)
    # Shoulder stubs (just outside the coat, start of arm sleeves)
    _p(img, ox+8,  by+1, BM_GOLD)
    _p(img, ox+7,  by+2, BM_GOLD_SHADE)
    _p(img, ox+23, by+1, BM_CYAN)
    _p(img, ox+24, by+2, BM_CYAN_SHADE)

    # ── ARMS ─────────────────────────────────────────────────────────────
    floor_y = oy + 28   # hands rest at this y (fixed regardless of position)
    ay      = by + 2    # arms start just below the shoulder stubs

    def _arm3(img, x, y, c, cd):
        """Draw a 3-pixel-wide arm segment (bounds-safe)."""
        _p(img, ox + max(0, min(31, x)),     y, c)
        _p(img, ox + max(0, min(31, x + 1)), y, cd)
        _p(img, ox + max(0, min(31, x + 2)), y, cd)

    if position == 'up':
        # Wide V-shape: arms spread from shoulders all the way to the frame
        # edges, creating a clear extended-arm pushup silhouette.
        # Left:  shoulder x=7 → hand x=0  (7px spread, full width)
        # Right: shoulder x=24 → hand x=29 (7px spread, full width)
        # Gold/cyan sleeve for upper ~half, bare skin for lower half.
        # Arms are 3 pixels wide for clear visibility at 4× render scale.
        n = floor_y - ay
        for dy in range(n):
            frac = dy / max(n - 1, 1)
            xl  = round(7  - frac * 7)    # 7 → 0
            xr  = round(24 + frac * 7)    # 24 → 31
            cl  = BM_GOLD    if frac < 0.5 else SKIN
            cld = BM_GOLD_DK if frac < 0.5 else SKIN_SH
            cr  = BM_CYAN    if frac < 0.5 else SKIN
            crd = BM_CYAN_DK if frac < 0.5 else SKIN_SH
            _arm3(img, xl, ay+dy, cl,  cld)
            _arm3(img, xr, ay+dy, cr,  crd)
        # Wide flat hands at frame edges
        _hl(img, ox+0,  floor_y,   5, SKIN_SH)
        _hl(img, ox+27, floor_y,   5, SKIN_SH)
        _p(img,  ox+1,  floor_y+1, SKIN_MED)
        _p(img,  ox+28, floor_y+1, SKIN_MED)

    else:  # DOWN
        # Bent elbows with dramatic flare: gold/cyan sleeve splays wide to
        # the frame edges, then bare-skin forearm folds back under the body.
        # Left:  shoulder x=7 → elbow x=0 → hand x=8
        # Right: shoulder x=24 → elbow x=31 → hand x=23
        n = floor_y - ay
        for dy in range(n):
            frac = dy / max(n - 1, 1)
            if frac <= 0.4:
                t   = frac / 0.4
                xl  = round(7  - t * 7)    # 7 → 0
                xr  = round(24 + t * 7)    # 24 → 31
                cl  = BM_GOLD;    cld = BM_GOLD_DK
                cr  = BM_CYAN;    crd = BM_CYAN_DK
            else:
                t   = (frac - 0.4) / 0.6
                xl  = round(0  + t * 8)    # 0 → 8
                xr  = round(31 - t * 8)    # 31 → 23
                cl  = SKIN;       cld = SKIN_SH
                cr  = SKIN;       crd = SKIN_SH
            _arm3(img, xl, ay+dy, cl,  cld)
            _arm3(img, xr, ay+dy, cr,  crd)
        # Hands planted under chest (closer to centre in low position)
        _hl(img, ox+6,  floor_y,   5, SKIN_SH)
        _hl(img, ox+21, floor_y,   5, SKIN_SH)
        _p(img,  ox+7,  floor_y+1, SKIN_MED)
        _p(img,  ox+22, floor_y+1, SKIN_MED)

    # ── SWEAT DROPS ───────────────────────────────────────────────────────
    _p(img, ox+8,  hy+8, SWEAT_C)
    _p(img, ox+23, hy+9, SWEAT_C)


def draw_pushups_anim(img):
    """
    Matthew-style pushup routine. Row 18, 5 frames.
    0=standing  1=pushup-UP  2=pushup-DOWN  3=pushup-UP  4=triumphant-stand
    """
    ROW = 18

    # Frame 0: standing ready
    _copy_frame(img, 0, 0, ROW, 0)

    # Frame 1: pushup UP (arms extended, body high)
    _draw_pushup_front(img, 1 * 32, ROW * 32, 'up')

    # Frame 2: pushup DOWN (elbows bent, body near floor)
    _draw_pushup_front(img, 2 * 32, ROW * 32, 'down')

    # Frame 3: pushup UP again (push back up)
    _draw_pushup_front(img, 3 * 32, ROW * 32, 'up')
    _p(img, 3*32 + 1, ROW*32 + 1, SWEAT_C)   # extra sweat on second rep

    # Frame 4: triumphant standing – arms raised, happy face
    _copy_frame(img, 0, 0, ROW, 4)
    ox, oy = 4 * 32, ROW * 32
    _erase(img, ox+5,  oy+17, 3, 7)           # erase normal left arm
    _erase(img, ox+24, oy+17, 3, 7)           # erase normal right arm
    _vl(img, ox+10, oy+11, 6, BM_GOLD)        # left arm raised
    _vl(img, ox+9,  oy+10, 7, BM_GOLD)
    _p(img,  ox+9,  oy+10, SKIN)              # left hand
    _vl(img, ox+21, oy+11, 6, BM_CYAN)        # right arm raised
    _vl(img, ox+22, oy+10, 7, BM_CYAN)
    _p(img,  ox+22, oy+10, SKIN)              # right hand
    # Happy smile
    _p(img, ox+13, oy+13, SKIN_SH)
    _hl(img, ox+14, oy+13, 4, MOUTH_C)
    _p(img, ox+18, oy+13, SKIN_SH)
    # Hard-earned sweat drops
    _p(img, ox+8,  oy+8,  SWEAT_C)
    _p(img, ox+23, oy+9,  SWEAT_C)


# ── ROW 19 – Smoothie (4 frames) ──────────────────────────────────────────

def _draw_blender(img, ox, oy, phase=0):
    """
    Draw a blender/cup at right side of frame.
    phase: 0=empty cup, 1=ingredients dropped, 2=blending, 3=pour
    """
    bx = ox + 22   # blender left edge
    by = oy + 16   # blender top

    # Base / motor (small square at bottom)
    _rc(img, bx+1, by+10, 4, 2, BM_GOLD_SHADE)
    _p(img, bx+2, by+11, BM_GOLD_DK)

    # Pitcher body (trapezoid-ish: wider at top)
    _hl(img, bx,   by+2, 6, BLENDER_C)      # top of container
    _hl(img, bx+1, by+3, 4, BLENDER_C)      # container body row 1
    _hl(img, bx+1, by+4, 4, BLENDER_C)
    _hl(img, bx+1, by+5, 4, BLENDER_C)
    _hl(img, bx+1, by+6, 4, BLENDER_C)
    _hl(img, bx+1, by+7, 4, BLENDER_C)
    _hl(img, bx+1, by+8, 4, BLENDER_C)
    _hl(img, bx+1, by+9, 4, BLENDER_C)
    # Container highlight
    _vl(img, bx+1, by+3, 7, BLENDER_LT)
    _p(img, bx+1, by+2, BLENDER_LT)

    # Lid / funnel opening
    _hl(img, bx-1, by+1, 8, BLENDER_C)
    _hl(img, bx,   by,   6, BLENDER_LT)

    # Handle (right side)
    _p(img, bx+5, by+4, BM_GOLD_SHADE)
    _p(img, bx+5, by+6, BM_GOLD_SHADE)

    # Contents based on phase
    if phase == 0:
        pass   # empty
    elif phase == 1:
        # Fruit chunks dropped in – colorful bits
        _rc(img, bx+2, by+4, 3, 5, SMOOTHIE)   # smoothie starting
        _p(img, bx+2, by+3, FRUIT_R)
        _p(img, bx+4, by+3, FRUIT_Y)
        _p(img, bx+3, by+4, FRUIT_R)
    elif phase == 2:
        # Blending – green smoothie, motion dots
        _rc(img, bx+2, by+3, 3, 6, SMOOTHIE)
        _p(img, bx+2, by+3, SMOOTHIE_DK)
        _p(img, bx+4, by+5, SMOOTHIE_DK)
        # Motion lines outside blender
        _p(img, bx-1, by+4, BLENDER_LT)
        _p(img, bx+6, by+3, BLENDER_LT)
        _p(img, bx+6, by+6, BLENDER_LT)
    elif phase == 3:
        # Pouring – smoothie content + stream going left
        _rc(img, bx+2, by+3, 3, 6, SMOOTHIE)
        _vl(img, bx,   by+1, 3, SMOOTHIE)    # pour stream


def draw_smoothie_anim(img):
    """
    Bridgemind makes a smoothie. Row 19, 4 frames.
    0: holding empty cup  1: dropping ingredients  2: blending  3: drinking
    """
    ROW = 19

    # Frame 0: idle holding blender in right hand
    _copy_frame(img, 0, 0, ROW, 0)
    ox, oy = 0 * 32, ROW * 32
    # Erase normal right arm, hold blender lower
    _erase(img, ox + 24, oy + 17, 3, 7)
    _erase(img, ox + 24, oy + 22, 3, 2)
    # Right arm bent holding blender handle area
    _vl(img, ox + 23, oy + 17, 5, BM_CYAN)
    _hl(img, ox + 21, oy + 22, 3, SKIN)
    _draw_blender(img, ox, oy, phase=0)

    # Frame 1: left arm raises, drops ingredients in
    _copy_frame(img, 0, 1, ROW, 1)
    ox, oy = 1 * 32, ROW * 32
    _erase(img, ox + 24, oy + 17, 3, 7)
    _erase(img, ox + 5,  oy + 17, 3, 7)
    # Right arm holds blender
    _vl(img, ox + 23, oy + 17, 5, BM_CYAN)
    _hl(img, ox + 21, oy + 22, 3, SKIN)
    # Left arm raised dropping fruit
    _vl(img, ox + 9,  oy + 13, 4, BM_GOLD)
    _hl(img, ox + 8,  oy + 12, 4, SKIN)   # hand above blender
    _draw_blender(img, ox, oy, phase=1)

    # Frame 2: blending – both arms down, blender shaking
    _copy_frame(img, 0, 0, ROW, 2)
    ox, oy = 2 * 32, ROW * 32
    _erase(img, ox + 24, oy + 17, 3, 7)
    _vl(img, ox + 23, oy + 17, 5, BM_CYAN)
    _hl(img, ox + 21, oy + 22, 3, SKIN)
    _draw_blender(img, ox, oy, phase=2)
    # Vibration dots
    _p(img, ox + 27, oy + 20, SPARKLE_C)
    _p(img, ox + 27, oy + 22, SPARKLE_C)

    # Frame 3: drinking from a cup (straw to mouth)
    _copy_frame(img, 0, 0, ROW, 3)
    ox, oy = 3 * 32, ROW * 32
    # Erase right arm, raise it holding cup to face
    _erase(img, ox + 24, oy + 17, 3, 7)
    _erase(img, ox + 24, oy + 22, 3, 2)
    # Right arm up, bent at elbow, holding cup near mouth
    _vl(img, ox + 23, oy + 16, 3, BM_CYAN)
    _hl(img, ox + 20, oy + 15, 4, BM_CYAN)
    _hl(img, ox + 19, oy + 14, 2, SKIN)
    # Cup held near mouth (small cyan cup at face level)
    _rc(img, ox + 16, oy + 13, 4, 4, BLENDER_C)
    _rc(img, ox + 17, oy + 14, 2, 2, SMOOTHIE)
    # Straw
    _vl(img, ox + 17, oy + 10, 4, STRAW)
    # Happy drinking face
    _p(img, ox + 13, oy + 13, SKIN_SH)
    _hl(img, ox + 14, oy + 13, 4, MOUTH_C)
    _p(img, ox + 18, oy + 13, SKIN_SH)


# ── ROW 20 – Cold Plunge (5 frames) ───────────────────────────────────────

def _draw_tub(img, ox, oy, water_level=24, show_ice=True):
    """
    Draw an ice bath tub at the bottom of the frame.
    water_level: y-offset (from frame top) where water surface is.
    """
    # Tub outer walls
    _hl(img, ox+3,  oy+water_level,   26, TUB_RIM)    # top rim
    _vl(img, ox+3,  oy+water_level,    8, TUB_RIM)    # left wall
    _vl(img, ox+28, oy+water_level,    8, TUB_RIM)    # right wall
    _hl(img, ox+3,  oy+31,            26, TUB_RIM)    # bottom
    # Tub inner walls
    _vl(img, ox+4,  oy+water_level+1,  6, TUB_C)
    _vl(img, ox+27, oy+water_level+1,  6, TUB_C)
    # Water fill
    _rc(img, ox+5, oy+water_level+1, 22, 30 - water_level, WATER_C)
    # Water surface shimmer
    _hl(img, ox+5, oy+water_level+1, 22, WATER_LT)
    # Ice chunks scattered in water
    if show_ice:
        _rc(img, ox+6,  oy+water_level+3, 3, 2, ICE_C)
        _p(img,  ox+5,  oy+water_level+3,    ICE_SH)
        _rc(img, ox+21, oy+water_level+2, 4, 2, ICE_C)
        _p(img,  ox+24, oy+water_level+2,    ICE_SH)
        _rc(img, ox+13, oy+water_level+5, 3, 2, ICE_C)
        _rc(img, ox+8,  oy+29,             2, 1, ICE_C)
        _rc(img, ox+24, oy+28,             2, 1, ICE_C)


def draw_cold_plunge_anim(img):
    """
    Bridgemind does a cold plunge. Row 20, 5 frames.
    0: nervous at tub  1: jumping  2: mid-air  3: splash entry  4: submerged
    """
    ROW = 20

    # Frame 0: standing at edge of tub, nervous look
    _copy_frame(img, 0, 0, ROW, 0)
    ox, oy = 0 * 32, ROW * 32
    _draw_tub(img, ox, oy, water_level=24)
    # Worried expression
    _p(img, ox+13, oy+13, SKIN_SH)
    _hl(img, ox+14, oy+13, 2, MOUTH_C)
    _p(img, ox+16, oy+13, SKIN_SH)
    # Cold breath / nervousness dots
    _p(img, ox+21, oy+11, SPLASH_LT)
    _p(img, ox+22, oy+10, SPLASH_LT)

    # Frame 1: jumping (body lifted up ~5 pixels, arms spread)
    ox, oy = 1 * 32, ROW * 32
    _draw_bm_char(img, ox, oy - 5, expr='excited')   # drawn 5px higher
    _draw_tub(img, ox, oy, water_level=24)
    # Arms spread wide for the jump
    _erase(img, ox+5, oy-5+17, 3, 7)     # erase normal left arm
    _erase(img, ox+24, oy-5+17, 3, 7)    # erase normal right arm
    _hl(img, ox+2,  oy-5+16, 4, BM_GOLD)   # left arm extended
    _hl(img, ox+24, oy-5+16, 5, BM_CYAN)   # right arm extended
    _p(img, ox+1,   oy-5+16, SKIN)          # left hand
    _p(img, ox+28,  oy-5+16, SKIN)          # right hand

    # Frame 2: mid-air descent, arms still wide
    ox, oy = 2 * 32, ROW * 32
    _draw_bm_char(img, ox, oy - 2, expr='open')
    _draw_tub(img, ox, oy, water_level=24)
    _erase(img, ox+5,  oy-2+17, 3, 7)
    _erase(img, ox+24, oy-2+17, 3, 7)
    _hl(img, ox+2,  oy-2+17, 4, BM_GOLD)
    _hl(img, ox+24, oy-2+17, 5, BM_CYAN)
    _p(img, ox+1,   oy-2+17, SKIN)
    _p(img, ox+28,  oy-2+17, SKIN)

    # Frame 3: entering water – splash, lower body in tub
    ox, oy = 3 * 32, ROW * 32
    # Draw only upper body (above water line)
    _draw_hair(img, ox, oy)
    _draw_goggles(img, ox, oy)
    _draw_face(img, ox, oy, expr='open')
    _draw_coat_body(img, ox, oy)
    # Tub with higher water level (character going in)
    _draw_tub(img, ox, oy, water_level=21)
    # Splash pixels around entry point
    _p(img, ox+8,  oy+20, SPLASH_LT); _p(img, ox+7,  oy+19, SPLASH_C)
    _p(img, ox+23, oy+20, SPLASH_LT); _p(img, ox+24, oy+19, SPLASH_C)
    _p(img, ox+5,  oy+21, SPLASH_LT); _p(img, ox+26, oy+21, SPLASH_LT)
    _p(img, ox+6,  oy+18, SPLASH_C);  _p(img, ox+25, oy+18, SPLASH_C)
    # Cover lower body with water
    _rc(img, ox+5, oy+21, 22, 3, WATER_C)
    _hl(img, ox+5, oy+21, 22, WATER_LT)

    # Frame 4: fully submerged – only head sticks out, cold/shocked
    ox, oy = 4 * 32, ROW * 32
    _draw_tub(img, ox, oy, water_level=16)
    # Just the head above water
    _draw_hair(img, ox, oy)
    _draw_goggles(img, ox, oy)
    _draw_face(img, ox, oy, expr='cold', blink=False)
    # Cold blush / shiver marks on cheeks
    _p(img, ox+11, oy+12, (150, 100, 200))   # blue-purple cold tint left
    _p(img, ox+20, oy+12, (150, 100, 200))   # blue-purple cold tint right
    # Water covers body
    _rc(img, ox+5, oy+17, 22, 15, WATER_C)
    _hl(img, ox+5, oy+17, 22, WATER_LT)
    # Ice chunks visible around head
    _p(img, ox+8,  oy+17, ICE_C); _p(img, ox+9,  oy+17, ICE_SH)
    _p(img, ox+21, oy+17, ICE_C); _p(img, ox+22, oy+17, ICE_SH)
    # Shiver lines / cold breath
    _p(img, ox+21, oy+8,  SPLASH_LT)
    _p(img, ox+22, oy+7,  SPLASH_LT)
    _p(img, ox+23, oy+8,  SPLASH_LT)
    _p(img, ox+8,  oy+9,  SPLASH_LT)


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    base = Image.open(SRC).convert("RGBA")
    bw, bh = base.size   # 128 × 512

    # Step 1: global color replacement on the base skin
    for y in range(bh):
        for x in range(bw):
            r, g, b, a = base.getpixel((x, y))
            if a > 0 and (r, g, b) in COLOR_MAP:
                new_rgb = COLOR_MAP[(r, g, b)]
                base.putpixel((x, y), new_rgb + (a,))

    # Step 2: BridgeMind coat/pants accents on existing 16 rows
    for row in range(16):
        for col in range(4):
            add_bridgemind_accents(base, col * 32, row * 32)
            add_pants_accent(base, col * 32, row * 32)

    # Step 3: Create extended canvas
    #   Width : 6 cols × 32 = 192 px  (bonus rows use up to 5 frames)
    #   Height: 21 rows × 32 = 672 px (rows 0-20; row 16 blank for levitating)
    img = Image.new("RGBA", (192, 672), (0, 0, 0, 0))
    img.paste(base, (0, 0))

    # Step 4: draw bonus animations
    draw_sunglasses_anim(img)   # row 17
    draw_pushups_anim(img)      # row 18
    draw_smoothie_anim(img)     # row 19
    draw_cold_plunge_anim(img)  # row 20

    img.save(DST)
    print(f"Saved BridgeMind skin to {DST}")
    print(f"Canvas: {img.size[0]}×{img.size[1]} px  ({img.size[0]//32} cols × {img.size[1]//32} rows)")


if __name__ == "__main__":
    main()
