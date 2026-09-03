"""The full badge: public/logo-full.svg.

Geometry was measured from the original raster (logo-full.png, 782x874):
ring centre and radius, the horizontal band the wordmark cuts out of the
ring, cap height and ink width of each text line, and the stand's ellipses.
Everything is shifted by (+12, +8) into an 800x892 viewBox so nothing
touches the edge.

Text is shaped with HarfBuzz and converted to outlines. Letter-spacing on
each line is solved so its ink spans the same width as in the original.
"""
import math
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

from fonts import load

ROOT = Path(__file__).resolve().parents[2]

# ---- site tokens (src/app/globals.css) --------------------------------------
GOLD_LIT = "#c99c3f"   # --gold-lit: "the crest gold, for fills and rules"
WINE = "#6a0b20"       # --wine
WINE_LIT = "#7a1028"   # top of the very slight gradient on STEAKHOUSE
INK = "#1c1917"        # wordmark / stand / MEMBERS ONLY
MUTED = "#5c554b"      # --muted, for EST. 2016

W, H = 800, 892
CX, CY = 400, 336      # ring centre (388, 328 in the PNG)
R = 322                # centre-line radius
RING_W = 8

BAND_TOP, BAND_BOT = 198, 434   # wordmark band that cuts the ring (190/426 + 8)
STEM_X = 400
STEM_GAP = 11                    # half-width of the ring gap at the stem


def fmt(n: float) -> str:
    """One decimal, no trailing .0, no negative zero: keeps the paths small."""
    s = f"{n:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    if s == "-0":
        s = "0"
    return s


def shape(font, text: str):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {})
    return list(zip(buf.glyph_infos, buf.glyph_positions))


def text_path(ft, font, upem, cap, text, cap_height, baseline, width=None, cx=CX):
    """Return (SVG path 'd', tracking px) for *text* set at *cap_height*, centred on cx.

    If *width* is given, letter-spacing is solved so the ink spans that width.
    """
    scale = cap_height / cap
    glyph_set = ft.getGlyphSet()
    order = ft.getGlyphOrder()

    # natural pen positions in font units
    pen_x = 0
    pieces = []
    for info, pos in shape(font, text):
        name = order[info.codepoint]
        pieces.append((name, pen_x + pos.x_offset, pos.y_offset))
        pen_x += pos.x_advance

    def ink_bounds(track):
        xmin, xmax = math.inf, -math.inf
        for i, (name, x, _y) in enumerate(pieces):
            bp = BoundsPen(glyph_set)
            glyph_set[name].draw(bp)
            if bp.bounds is None:
                continue
            off = x + track * i
            xmin, xmax = min(xmin, bp.bounds[0] + off), max(xmax, bp.bounds[2] + off)
        return xmin, xmax

    track = 0.0
    if width is not None:
        xmin, xmax = ink_bounds(0)
        natural = (xmax - xmin) * scale
        n_gaps = len(pieces) - 1
        track = (width - natural) / scale / n_gaps if n_gaps else 0
    xmin, xmax = ink_bounds(track)
    left = cx - (xmax - xmin) * scale / 2 - xmin * scale

    pen = SVGPathPen(glyph_set, ntos=fmt)
    for i, (name, x, y) in enumerate(pieces):
        tx = left + (x + track * i) * scale
        ty = baseline - y * scale
        glyph_set[name].draw(TransformPen(pen, (scale, 0, 0, -scale, tx, ty)))
    return pen.getCommands(), track * scale


def arc(a0: float, a1: float) -> str:
    """Arc on the ring from angle a0 to a1 (degrees, 0 = 3 o'clock, clockwise on screen)."""
    x0, y0 = CX + R * math.cos(math.radians(a0)), CY + R * math.sin(math.radians(a0))
    x1, y1 = CX + R * math.cos(math.radians(a1)), CY + R * math.sin(math.radians(a1))
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{fmt(x0)} {fmt(y0)}A{R} {R} 0 {large} 1 {fmt(x1)} {fmt(y1)}"


def write(path: Path, svg: str):
    path.write_text(svg)
    size = len(svg.encode())
    print(f"wrote {path.relative_to(ROOT)} ({size // 1024} KB)" if size >= 1024
          else f"wrote {path.relative_to(ROOT)} ({size} bytes)")


def build():
    pf = load("Playfair-900")
    inter = load("Inter-500")

    main_d, _ = text_path(*pf, "MAIN STREET", 59, 274, width=640)
    steak_d, _ = text_path(*pf, "STEAKHOUSE", 72, 395, width=779)
    est_d, _ = text_path(*inter, "EST. 2016", 28, 492, width=213)
    memb_d, _ = text_path(*inter, "MEMBERS ONLY", 28, 880, width=316)

    top_a = math.degrees(math.asin((BAND_TOP - CY) / R))      # negative: above centre
    bot_a = math.degrees(math.asin((BAND_BOT - CY) / R))      # positive: below centre
    stem_a = math.degrees(math.asin(STEM_GAP / R))
    ring_top = arc(180 - top_a, 360 + top_a)                  # left band edge, over the top, to right
    ring_right = arc(bot_a, 90 - stem_a)                      # right band edge down to the stem
    ring_left = arc(90 + stem_a, 180 - bot_a)                 # stem round to left band edge

    write(ROOT / "public/logo-full.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t">
<title id="t">Main Street Steakhouse — Est. 2016 — Members Only</title>
<defs>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{WINE_LIT}"/>
<stop offset="1" stop-color="{WINE}"/>
</linearGradient>
</defs>
<g fill="none" stroke="{GOLD_LIT}" stroke-width="{RING_W}">
<path d="{ring_top}"/>
<path d="{ring_right}"/>
<path d="{ring_left}"/>
</g>
<path fill="{INK}" d="{main_d}"/>
<path fill="url(#w)" d="{steak_d}"/>
<path fill="{MUTED}" d="{est_d}"/>
<g fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round">
<ellipse cx="{STEM_X}" cy="556" rx="21" ry="11"/>
<path d="M{STEM_X} 567V758" stroke-width="4.5"/>
<ellipse cx="{STEM_X}" cy="769" rx="55" ry="11"/>
</g>
<path fill="{INK}" d="{memb_d}"/>
</svg>
''')


if __name__ == "__main__":
    build()
