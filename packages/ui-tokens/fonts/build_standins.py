"""Build the stand-in subset font (AD-36, docs/design/05-ui-ux.md §4, §10).

The whitespace/control stand-ins (U+2420 SP, U+21E5 tab, U+23CE return, U+240D CR, U+237D no-break space, U+27E8/9
angle brackets around control code points, U+2581 escaped space) and the U+25CC dotted circle that combining marks sit
on are tofu on many Android and Windows configurations, so the site ships its own glyphs. They are drawn here from
straight strokes (no third-party outlines, so the font is covered by the repository's MIT licence) and written as a
deterministic WOFF2 to ../src/fonts/tsbs-standins.woff2 (budget 4 KB, 06 §3).

Run: pnpm -F @tsbs/ui-tokens font:build   (uv run --no-project --with fonttools==4.60.1 --with brotli==1.1.0 ...)
"""

from __future__ import annotations

import math
from io import BytesIO
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
ADVANCE = 600
STROKE = 70
ASCENT = 800
DESCENT = -200
OUT = Path(__file__).resolve().parent.parent / "src" / "fonts" / "tsbs-standins.woff2"
# Fixed timestamp (2026-10-25T00:00:00Z as seconds since 1904-01-01) so every build is byte-identical.
TIMESTAMP = 3844454400

Point = tuple[float, float]


def quad(pen: TTGlyphPen, pts: list[Point], counter: bool = False) -> None:
    """One closed contour, wound clockwise (TrueType outer contour) or counter-clockwise for a counter (hole)."""
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    if (area > 0) != counter:
        pts = list(reversed(pts))
    pen.moveTo(tuple(round(v) for v in pts[0]))
    for p in pts[1:]:
        pen.lineTo(tuple(round(v) for v in p))
    pen.closePath()


def segment(pen: TTGlyphPen, a: Point, b: Point, width: float = STROKE) -> None:
    """A stroke from a to b with square caps extended by half the width (so polyline joints overlap cleanly)."""
    (x0, y0), (x1, y1) = a, b
    length = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    h = width / 2
    x0, y0, x1, y1 = x0 - ux * h, y0 - uy * h, x1 + ux * h, y1 + uy * h
    nx, ny = -uy * h, ux * h
    quad(pen, [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)])


def polyline(pen: TTGlyphPen, pts: list[Point], width: float = STROKE) -> None:
    for a, b in zip(pts, pts[1:]):
        segment(pen, a, b, width)


def glyph_sp(pen: TTGlyphPen) -> None:  # U+2420 SYMBOL FOR SPACE: small S, P on a diagonal
    polyline(pen, [(250, 330), (90, 330), (90, 180), (250, 180), (250, 30), (90, 30)], 55)
    polyline(pen, [(350, 300), (350, 600), (510, 600), (510, 450), (350, 450)], 55)


def glyph_cr(pen: TTGlyphPen) -> None:  # U+240D SYMBOL FOR CARRIAGE RETURN: small C, R
    polyline(pen, [(250, 330), (90, 330), (90, 30), (250, 30)], 55)
    polyline(pen, [(350, 300), (350, 600), (510, 600), (510, 450), (350, 450), (510, 300)], 55)


def glyph_return(pen: TTGlyphPen) -> None:  # U+23CE RETURN SYMBOL
    polyline(pen, [(480, 620), (480, 260), (200, 260)])
    quad(pen, [(80, 260), (230, 400), (230, 120)])


def glyph_tab(pen: TTGlyphPen) -> None:  # U+21E5 RIGHTWARDS ARROW TO BAR
    segment(pen, (60, 300), (380, 300))
    quad(pen, [(470, 300), (330, 440), (330, 160)])
    segment(pen, (520, 120), (520, 480))


def glyph_nbsp(pen: TTGlyphPen) -> None:  # U+237D SHOULDERED OPEN BOX
    polyline(pen, [(50, 330), (150, 330), (150, 90), (450, 90), (450, 330), (550, 330)])


def glyph_langle(pen: TTGlyphPen) -> None:  # U+27E8 MATHEMATICAL LEFT ANGLE BRACKET
    polyline(pen, [(420, 760), (200, 300), (420, -160)])


def glyph_rangle(pen: TTGlyphPen) -> None:  # U+27E9 MATHEMATICAL RIGHT ANGLE BRACKET
    polyline(pen, [(180, 760), (400, 300), (180, -160)])


def glyph_lower_eighth(pen: TTGlyphPen) -> None:  # U+2581 LOWER ONE EIGHTH BLOCK
    quad(pen, [(0, DESCENT), (ADVANCE, DESCENT), (ADVANCE, DESCENT + (ASCENT - DESCENT) / 8), (0, DESCENT + (ASCENT - DESCENT) / 8)])


def glyph_dotted_circle(pen: TTGlyphPen) -> None:  # U+25CC DOTTED CIRCLE (base for combining marks)
    cx, cy, r, d = 300, 300, 230, 32
    for i in range(12):
        a = 2 * math.pi * i / 12
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        quad(pen, [(x, y + d), (x + d, y), (x, y - d), (x - d, y)])


def glyph_notdef(pen: TTGlyphPen) -> None:
    quad(pen, [(80, 0), (520, 0), (520, 700), (80, 700)])
    quad(pen, [(150, 70), (150, 630), (450, 630), (450, 70)], counter=True)


GLYPHS = {
    ".notdef": (None, glyph_notdef),
    "uni2420": (0x2420, glyph_sp),
    "uni240D": (0x240D, glyph_cr),
    "uni23CE": (0x23CE, glyph_return),
    "uni21E5": (0x21E5, glyph_tab),
    "uni237D": (0x237D, glyph_nbsp),
    "uni27E8": (0x27E8, glyph_langle),
    "uni27E9": (0x27E9, glyph_rangle),
    "uni2581": (0x2581, glyph_lower_eighth),
    "uni25CC": (0x25CC, glyph_dotted_circle),
}


def build() -> bytes:
    fb = FontBuilder(UPM, isTTF=True)
    order = list(GLYPHS)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: name for name, (cp, _) in GLYPHS.items() if cp is not None})
    glyphs = {}
    for name, (_, draw) in GLYPHS.items():
        pen = TTGlyphPen(None)
        draw(pen)
        glyphs[name] = pen.glyph()
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (ADVANCE, getattr(glyphs[name], "xMin", 0)) for name in order})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable(
        {
            "familyName": "TSBS Stand-ins",
            "styleName": "Regular",
            "copyright": "Copyright (c) 2026 Han Lin. MIT License.",
            "uniqueFontIdentifier": "TSBS Stand-ins Regular 1.000",
            "version": "Version 1.000",
            "psName": "TSBSStandins-Regular",
            "licenseDescription": "MIT License (see LICENSE in the tokenize-step-by-step repository)",
        }
    )
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=-DESCENT, fsType=0)
    fb.setupPost(keepGlyphNames=False)
    fb.setupHead(unitsPerEm=UPM, created=TIMESTAMP, modified=TIMESTAMP)
    font = fb.font
    font.recalcTimestamp = False  # keep head.modified = TIMESTAMP (deterministic output)
    font.flavor = "woff2"
    buf = BytesIO()
    font.save(buf, reorderTables=True)
    return buf.getvalue()


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    OUT.write_bytes(data)
    print(f"wrote {OUT} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
