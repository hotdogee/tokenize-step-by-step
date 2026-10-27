"""Build the token-id digits subset font (PA-17, docs/design/05-ui-ux.md §4, §10).

Token ids sit inside every chip, down to one column, so they need figures that can narrow: the ten digits of Noto Sans
(Copyright 2022 The Noto Project Authors, SIL Open Font License 1.1, no Reserved Font Name; fonts/NotoSans-OFL.txt)
with the width axis kept (wdth 62.5-100, so CSS `font-stretch` narrows them), the weight pinned at 400 and the tabular
figures baked into the cmap (every digit has one advance, so an id's width is digits x advance). The family is renamed
`TSBS Digits` so it never collides with an installed Noto Sans. The pinned upstream file is downloaded into a gitignored
cache, verified by its sha256, and the result written as a deterministic WOFF2 to ../src/fonts/tsbs-digits.woff2
(with the stand-ins inside the 4 KB font budget, 06 §3).

The board maps the room an id has to a width with `w = 262.2 * advance - 50` (board.css); main() asserts the advances
that line rests on (0.429 em at wdth 62.5, 0.572 em at 100, never above the line in between) before writing.

Run: pnpm -F @tsbs/ui-tokens font:build:digits   (uv run --no-project --with fonttools==4.60.1 --with brotli==1.1.0 ...)
"""

from __future__ import annotations

import hashlib
import urllib.request
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

from build_standins import TIMESTAMP

COMMIT = "2984c575fdce412ee02b2baaba67672b9a9434d8"
SOURCE_URL = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf"
SOURCE_SHA256 = "bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d"
HERE = Path(__file__).resolve().parent
CACHE = HERE.parent.parent.parent / "node_modules" / ".cache" / "tsbs" / "fonts" / f"NotoSans-wdth-wght-{COMMIT[:12]}.ttf"
OUT = HERE.parent / "src" / "fonts" / "tsbs-digits.woff2"

DIGITS = range(0x30, 0x3A)
FAMILY = "TSBS Digits"
WIDTH = (62.5, 100.0)
# Tabular advance (em) at each end of the width axis, and the board's linear map between them (board.css `.bd-id`).
ADVANCE = {62.5: 0.429, 100.0: 0.572}
SLOPE, OFFSET = 262.2, 50.0
TOLERANCE = 0.001
BUDGET = 3072
KEEP_NAMES = (0, 1, 2, 3, 4, 5, 6, 13, 14)


def source() -> bytes:
    """The pinned upstream variable font, from the cache or downloaded into it, verified by sha256."""
    if CACHE.exists():
        data = CACHE.read_bytes()
        if hashlib.sha256(data).hexdigest() == SOURCE_SHA256:
            return data
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(f"sha256 mismatch for {SOURCE_URL}: {digest}")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(data)
    return data


def tnum_map(font: TTFont) -> dict[str, str]:
    """Glyph -> tabular glyph, from the single substitutions of the `tnum` feature."""
    gsub = font["GSUB"].table
    records = [record for record in gsub.FeatureList.FeatureRecord if record.FeatureTag == "tnum"]
    lookups = {index for record in records for index in record.Feature.LookupListIndex}
    mapping: dict[str, str] = {}
    for index in sorted(lookups):
        for table in gsub.LookupList.Lookup[index].SubTable:
            if table.LookupType == 7:  # extension
                table = table.ExtSubTable
            mapping.update(getattr(table, "mapping", {}))
    return mapping


def subset_font(font: TTFont, features: list[str]) -> None:
    options = subset.Options()
    options.layout_features = features
    options.hinting = False
    options.notdef_outline = False
    options.glyph_names = False
    options.name_IDs = list(KEEP_NAMES)
    options.name_languages = [0x409]
    options.name_legacy = False
    options.drop_tables += ["DSIG"] + ([] if features else ["GSUB", "GPOS", "GDEF"])
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=list(DIGITS))
    subsetter.subset(font)


def bake_tabular(font: TTFont) -> None:
    """Points the digit code points at their `tnum` forms (then GSUB can go). Noto Sans's default figures are already
    the tabular ones (`tnum` maps its `.lf` proportional figures back to them), so they stay; check() asserts the result."""
    tnum = tnum_map(font)
    for table in font["cmap"].tables:
        for c in DIGITS:
            if c in table.cmap:
                table.cmap[c] = tnum.get(table.cmap[c], table.cmap[c])


def rename(font: TTFont) -> None:
    name = font["name"]
    version = name.getDebugName(5) or "Version 1.000"
    for name_id, value in (
        (1, FAMILY),
        (2, "Regular"),
        (3, f"{FAMILY} Regular; {version}"),
        (4, f"{FAMILY} Regular"),
        (6, "TSBSDigits-Regular"),
    ):
        name.setName(value, name_id, 3, 1, 0x409)
    # Keep the listed records and the names the remaining tables reference (the wdth axis, the STAT axis values).
    referenced = {axis.axisNameID for axis in font["fvar"].axes}
    if "STAT" in font:
        stat = font["STAT"].table
        referenced.add(stat.ElidedFallbackNameID)
        referenced.update(record.AxisNameID for record in stat.DesignAxisRecord.Axis)
        referenced.update(value.ValueNameID for value in (stat.AxisValueArray.AxisValue if stat.AxisValueArray else []))
    name.names = [record for record in name.names if record.nameID in KEEP_NAMES or record.nameID in referenced]


def digit_advances(font: TTFont) -> set[float]:
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    return {font["hmtx"][cmap[c]][0] / upm for c in DIGITS}


def check(font: TTFont, size: int) -> dict[float, float]:
    """Asserts the facts the board's CSS relies on; returns the advance (em) at sampled widths."""
    axes = [(a.axisTag, a.minValue, a.maxValue) for a in font["fvar"].axes]
    assert axes == [("wdth", *WIDTH)], f"fvar axes {axes}"
    assert sorted(font.getBestCmap()) == list(DIGITS), f"cmap {sorted(font.getBestCmap())}"
    assert "GSUB" not in font and "GPOS" not in font, "layout tables left"
    advances: dict[float, float] = {}
    for width in (62.5, 68.75, 75.0, 81.25, 87.5, 93.75, 100.0):
        pinned = instancer.instantiateVariableFont(font, {"wdth": width}, inplace=False)
        values = digit_advances(pinned)
        assert len(values) == 1, f"digits differ in advance at wdth {width}: {sorted(values)}"
        advance = values.pop()
        if width in ADVANCE:
            assert abs(advance - ADVANCE[width]) <= TOLERANCE, f"advance {advance} at wdth {width}"
        # The board picks w = SLOPE * room - OFFSET; the glyphs at w must never be wider than that room.
        assert advance <= (width + OFFSET) / SLOPE + TOLERANCE / 2, f"advance {advance} above the linear map at {width}"
        advances[width] = advance
    assert size <= BUDGET, f"{size} B over the {BUDGET} B budget"
    return advances


def build() -> tuple[bytes, dict[float, float]]:
    font = TTFont(BytesIO(source()))
    subset_font(font, ["tnum"])  # the digits and their tabular forms
    bake_tabular(font)
    subset_font(font, [])  # only the tabular forms remain, no layout tables
    font = instancer.instantiateVariableFont(font, {"wght": 400, "wdth": WIDTH})
    font["fvar"].instances = []
    rename(font)
    font["head"].modified = TIMESTAMP
    font.recalcTimestamp = False  # keep head.modified = TIMESTAMP (deterministic output)
    font.flavor = "woff2"
    buf = BytesIO()
    font.save(buf, reorderTables=True)
    data = buf.getvalue()
    return data, check(TTFont(BytesIO(data)), len(data))


def main() -> None:
    data, advances = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(data)
    print(f"wrote {OUT} ({len(data)} bytes)")
    print("tabular advance (em) by wdth: " + ", ".join(f"{w:g} -> {a:.4f}" for w, a in advances.items()))


if __name__ == "__main__":
    main()
