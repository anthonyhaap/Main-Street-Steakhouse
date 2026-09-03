# Logo build

The four logo SVGs are generated, not hand-drawn. Edit the numbers here and
rerun rather than editing the SVGs.

```
pip install -r scripts/logo/requirements.txt
npm run build:logo
```

| Output                  | Built by   | Used for                                   |
| ----------------------- | ---------- | ------------------------------------------ |
| `public/logo-full.svg`  | `badge.py` | Auth screens. The full badge.              |
| `public/logo-lockup.svg`| `marks.py` | Header at 38px tall, wide screens.         |
| `public/mark.svg`       | `marks.py` | Header on phones; any 32 to 48px spot.     |
| `src/app/icon1.svg`     | `marks.py` | Vector favicon, served beside `icon.png`.  |

`public/logo-full.png` stays as the source of truth for the geometry and is
still what the Open Graph image and the invite email use, since SVG support
is unreliable in both places.

## How it works

- **Geometry** in `badge.py` was measured from the PNG: ring centre and
  radius, the band the wordmark cuts out of the ring, the cap height and ink
  width of each line, the stand's ellipses. The badge is that geometry
  shifted by (+12, +8) into an 800x892 viewBox.
- **Type** is Playfair Display Black (wordmark) and Inter Medium (small
  caps). `fonts.py` pulls both from Google Fonts on first run into
  `scripts/logo/fonts/`, which is git-ignored. HarfBuzz shapes each line,
  the glyphs are converted to outlines, and letter-spacing is solved so the
  line spans the width measured from the original. No font is referenced
  from the SVGs.
- **Colours** are the site tokens from `src/app/globals.css`: `--gold-lit`
  for the ring (it matches the PNG's ring within a few RGB points),
  `--wine` for STEAKHOUSE, `--muted` for EST. 2016, and ink `#1c1917`.
- **The small marks** in `marks.py` reuse the badge's proportions with the
  ellipses opened up slightly, because at 32px the badge's flat ellipses
  collapse into lines. The favicon variant has heavier strokes again so it
  reads at 16px, and sits on the wine tile to match the PNG app icons.
- The lockup is the mark plus the badge's two wordmark lines at quarter
  scale, so the header and the badge share the exact same outlines.
