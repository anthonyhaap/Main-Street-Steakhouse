"""Fetch the two typefaces the marks are cut from and hand them to the shaper.

Playfair Display Black carries the wordmark, Inter Medium the small caps.
Both are pulled from Google Fonts on first run and cached next to this file
(scripts/logo/fonts/, git-ignored). Nothing here ends up in the SVGs as a
font reference: the glyphs are converted to outlines, so the site never
loads either face.
"""
import re
import urllib.request
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont

CACHE = Path(__file__).parent / "fonts"

# Google Fonts serves plain WOFF (which fontTools can read without brotli)
# to a browser this old. Newer user agents get WOFF2 or variable fonts.
UA = "Mozilla/5.0 (Windows NT 6.1; rv:20.0) Gecko/20100101 Firefox/20.0"

FAMILIES = {
    "Playfair-900": ("Playfair Display", 900),
    "Inter-500": ("Inter", 500),
}


def _fetch(name: str) -> Path:
    woff = CACHE / f"{name}.woff"
    if woff.exists():
        return woff
    family, weight = FAMILIES[name]
    css_url = (
        "https://fonts.googleapis.com/css2?family="
        f"{family.replace(' ', '+')}:wght@{weight}&display=swap"
    )
    req = urllib.request.Request(css_url, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req).read().decode()
    match = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css)
    if not match:
        raise RuntimeError(f"no font URL in Google Fonts CSS for {family} {weight}")
    CACHE.mkdir(exist_ok=True)
    woff.write_bytes(urllib.request.urlopen(match.group(1)).read())
    return woff


def load(name: str):
    """Return (fontTools font, HarfBuzz font, unitsPerEm, cap height) for *name*."""
    ttf_path = CACHE / f"{name}.ttf"
    if not ttf_path.exists():
        f = TTFont(_fetch(name))
        f.flavor = None  # HarfBuzz reads raw SFNT, not WOFF
        f.save(ttf_path)
    ft = TTFont(ttf_path)
    face = hb.Face(ttf_path.read_bytes())
    font = hb.Font(face)
    upem = ft["head"].unitsPerEm
    font.scale = (upem, upem)
    return ft, font, upem, ft["OS/2"].sCapHeight
