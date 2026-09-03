"""The small treatments: public/mark.svg, src/app/icon1.svg, public/logo-lockup.svg.

They share fonts, colours and the text-outlining code with badge.py, so
the header, the favicon and the badge are guaranteed to match.
"""
from pathlib import Path

import badge as B
from badge import ROOT, fmt, write
from fonts import load

# ---- the mark: stand inside the gold ring, 64x64 ----------------------------
# Proportions follow the badge (base ellipse is ~2.6x the top one, stem is
# the height of ~4 base widths) but the ellipses are opened up a little so
# they still read as ellipses at 32px rather than collapsing into lines.
MARK = dict(r=28.5, ring_w=3.5, top_cy=20, top_rx=9, top_ry=3.4,
            stem_top=23.4, stem_bot=43, base_cy=44.5, base_rx=14.5, base_ry=4,
            stand_w=2.8)


def mark_group(m, ring, ink, x=0, y=0, s=1.0):
    """The ring and stand as a translated/scaled <g>."""
    return f'''<g transform="translate({fmt(x)} {fmt(y)}) scale({fmt(s)})">
<circle cx="32" cy="32" r="{m['r']}" fill="none" stroke="{ring}" stroke-width="{m['ring_w']}"/>
<g fill="none" stroke="{ink}" stroke-width="{m['stand_w']}" stroke-linecap="round">
<ellipse cx="32" cy="{m['top_cy']}" rx="{m['top_rx']}" ry="{m['top_ry']}"/>
<path d="M32 {m['stem_top']}V{m['stem_bot']}"/>
<ellipse cx="32" cy="{m['base_cy']}" rx="{m['base_rx']}" ry="{m['base_ry']}"/>
</g>
</g>'''


def build():
    # 1. mark-only, transparent: for 32-48px spots on the cream
    write(ROOT / "public/mark.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Main Street Steakhouse">
{mark_group(MARK, B.GOLD_LIT, B.INK)}
</svg>
''')

    # 2. favicon: the same mark on the wine tile, matching icon.png / apple-icon.png.
    # Numbered so Next serves it alongside icon.png (see the app-icons file
    # convention); strokes are heavier because this has to survive 16px.
    write(ROOT / "src/app/icon1.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="{B.WINE}"/>
{mark_group(dict(MARK, r=25, ring_w=4, stand_w=3.6, top_ry=3.8, base_ry=4.4), B.GOLD_LIT, "#ffffff", 4.5, 4.5, 0.86)}
</svg>
''')

    # 3. horizontal lockup: mark + the badge's two wordmark lines at 1/4 scale
    pf = load("Playfair-900")
    k = 0.25
    H = 40
    mark_s = H / 64
    text_x = H + 12                       # gap between mark and words
    steak_cap, steak_w = 72 * k, 779 * k  # 18 / 194.75
    main_cap, main_w = 59 * k, 640 * k    # 14.75 / 160
    # vertical rhythm: the block of two lines is centred on the mark
    gap = 5
    block_h = main_cap + gap + steak_cap
    main_base = (H - block_h) / 2 + main_cap
    steak_base = main_base + gap + steak_cap
    # left-aligned: centre each line on its own half-width
    main_d, _ = B.text_path(*pf, "MAIN STREET", main_cap, main_base,
                            width=main_w, cx=text_x + main_w / 2)
    steak_d, _ = B.text_path(*pf, "STEAKHOUSE", steak_cap, steak_base,
                             width=steak_w, cx=text_x + steak_w / 2)
    W = round(text_x + steak_w + 1)
    write(ROOT / "public/logo-lockup.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t">
<title id="t">Main Street Steakhouse</title>
{mark_group(MARK, B.GOLD_LIT, B.INK, 0, 0, mark_s)}
<path fill="{B.INK}" d="{main_d}"/>
<path fill="{B.WINE}" d="{steak_d}"/>
</svg>
''')


if __name__ == "__main__":
    build()
