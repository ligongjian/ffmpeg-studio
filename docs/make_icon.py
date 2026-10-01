"""Generate the FFmpeg Studio app icon (1024x1024 RGBA PNG).

Design: diagonal navy->indigo gradient rounded-square background,
a white rounded "video window" with film perforations on the left
and a play triangle in the middle. Drawn at 4x supersampling and
downscaled for smooth edges.
"""

from PIL import Image, ImageDraw

S = 4                 # supersample factor
W = 1024 * S          # working canvas (4096)

# ---- diagonal gradient background (drawn small, then upscaled) ----
G = 512
C1 = (24, 33, 77)     # top-left deep navy
C2 = (88, 76, 234)    # bottom-right indigo
grad = Image.new("RGB", (G, G))
gp = grad.load()
for y in range(G):
    for x in range(G):
        t = (x + y) / (2 * (G - 1))
        gp[x, y] = (
            round(C1[0] + (C2[0] - C1[0]) * t),
            round(C1[1] + (C2[1] - C1[1]) * t),
            round(C1[2] + (C2[2] - C1[2]) * t),
        )
bg = grad.resize((W, W), Image.BILINEAR)
draw = ImageDraw.Draw(bg)


def sc(v: float) -> int:
    """Scale a 1024-baseline coordinate to the working canvas."""
    return round(v * S)


WHITE = (255, 255, 255)
DARK = (26, 35, 82)

# ---- video window (white rounded rect) ----
wx0, wy0, wx1, wy1 = sc(282), sc(352), sc(742), sc(672)
draw.rounded_rectangle([wx0, wy0, wx1, wy1], radius=sc(28), fill=WHITE)

# ---- film perforations: 3 small squares near the left edge ----
px0 = wx0 + sc(24)
for i in range(3):
    cy = 512 - 40 + i * 40          # 472 / 512 / 552
    sx0, sy0 = px0, sc(cy - 11)
    sx1, sy1 = px0 + sc(22), sc(cy + 11)
    draw.rounded_rectangle([sx0, sy0, sx1, sy1], radius=sc(6), fill=DARK)

# ---- play triangle, centered in the area right of the perforations ----
tx_l = sc(475)      # left edge
ty_t = sc(442)      # top
ty_b = sc(582)      # bottom
tx_r = sc(615)      # tip
draw.polygon([(tx_l, ty_t), (tx_l, ty_b), (tx_r, sc(512))], fill=DARK)

# ---- rounded-square alpha mask (iOS-like corner ratio) ----
mask = Image.new("L", (W, W), 0)
mdraw = ImageDraw.Draw(mask)
mdraw.rounded_rectangle([0, 0, W - 1, W - 1], radius=sc(220), fill=255)
bg.putalpha(mask)

# ---- downscale to final 1024 and save ----
icon = bg.resize((1024, 1024), Image.LANCZOS)
out = r"C:\Users\m1391\WorkBuddy\2026-09-29-22-01-43\ffmpeg-studio\src-tauri\icons\icon.png"
icon.save(out, "PNG")
print("saved", out)
