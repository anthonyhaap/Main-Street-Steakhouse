#!/usr/bin/env python3
"""Regenerate every logo SVG from the measured geometry.

    pip install -r scripts/logo/requirements.txt
    python3 scripts/logo/build.py          # or: npm run build:logo

Writes public/logo-full.svg, public/logo-lockup.svg, public/mark.svg and
src/app/icon1.svg. The first run fetches Playfair Display and Inter from
Google Fonts into scripts/logo/fonts/ (git-ignored); after that it is
offline. See README.md in this folder for what each number means.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import badge  # noqa: E402
import marks  # noqa: E402

if __name__ == "__main__":
    badge.build()
    marks.build()
