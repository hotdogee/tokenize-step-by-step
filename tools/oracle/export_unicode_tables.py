"""Export the Unicode tables the web app's pre-tokenizer and NFKC source map need.

Writes ``tools/oracle/unicode_tables.json`` (committed). WP02 converts it into
TypeScript (``packages/core/src/unicode/tables.generated.ts``); this script
never writes outside ``tools/oracle``.

**Character classes** (``classes``): ``L Lu Ll Lt Lm Lo M N`` and
``White_Space`` as sorted, inclusive ``[first, last]`` code-point ranges, at
the Unicode version of the engines that produce the fixture ids: tiktoken
0.14.0 (Rust ``regex``) and HF tokenizers 0.23.3 (Oniguruma) both implement
Unicode 16.0. The pinned Python ``regex`` module implements a newer version
(its metadata says 18.0.0), so its classes include letters and digits that
the id oracles treat as unassigned, and it moved U+0295 from ``Ll`` to
``Lo``. The tables are therefore read from tiktoken's own regex engine (one
probe per code point, see :func:`tiktoken_class`) and cross-checked:

* Oniguruma must give exactly the same sets;
* ``regex`` must agree on every code point that is assigned in the id
  oracles' tables, except the general-category changes listed in
  ``regexModule.categoryChanges``; what ``regex`` assigns beyond that is
  listed in ``regexModule.assignedLater``;
* ``\\s`` must equal ``\\p{White_Space}`` in ``regex``.

**Normalisation tables** (``normalization``), for the NFKC segment source map
(design 03 §B.4, which cuts the text before every code point with
``ccc = 0`` and ``NFKC_Quick_Check = Yes``):

* ``cccNonZero``: code points with Canonical_Combining_Class != 0;
* ``nfkcQcNotYes``: code points with NFKC_Quick_Check No or Maybe.

Both come from Python ``unicodedata`` (Unicode 15.1; NFKC_QC is derived:
No = NFKC changes the code point on its own, Maybe = the second half of a
canonical composition pair or a Hangul V/T jamo). Each is then unioned with
the same property from ``regex``: a larger "never cut here" set only makes
segments longer, which is always safe, so the union stays correct for
browsers whose ``String.prototype.normalize`` is on any Unicode version from
15.1 to the ``regex`` version. The derivation is asserted against ``regex`` on
every code point assigned in Unicode 15.1.

Output is deterministic (sorted keys, one range per line, LF, trailing
newline). Usage (from the repository root)::

    uv run --project tools/oracle tools/oracle/export_unicode_tables.py [--check]
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import re
import sys
import unicodedata
from collections.abc import Callable, Iterable

import regex
import tiktoken
from tokenizers import Regex
from tokenizers.pre_tokenizers import Split

from oracle_lib import fsio, paths

OUT_PATH = paths.ORACLE_DIR / "unicode_tables.json"
#: The Unicode version the web app pins (design AD-4): the id oracles' version.
TARGET_UNICODE = "16.0.0"
#: A code point first assigned in each version (CJK Ext I, Garay, CJK Ext J).
VERSION_MARKERS = (("15.1.0", 0x2EBF0), ("16.0.0", 0x10D50), ("17.0.0", 0x323B0))
#: Exported class name -> single-code-point pattern (identical syntax in Rust regex, Oniguruma and ``regex``).
CLASSES = {
    "L": r"\p{L}",
    "Lu": r"\p{Lu}",
    "Ll": r"\p{Ll}",
    "Lt": r"\p{Lt}",
    "Lm": r"\p{Lm}",
    "Lo": r"\p{Lo}",
    "M": r"\p{M}",
    "N": r"\p{N}",
    "White_Space": r"\s",
}
#: Every scalar value except U+0000 (the probe marker; asserted to be in no class) and the surrogates.
CODE_POINTS = [cp for cp in range(1, 0x110000) if not 0xD800 <= cp <= 0xDFFF]
_HANGUL_V = range(0x1161, 0x1176)
_HANGUL_T = range(0x11A8, 0x11C3)

Ranges = list[list[int]]


class UnicodeExportError(RuntimeError):
    """The engines disagree in an unexpected way; the tables must not be written."""


def to_ranges(code_points: Iterable[int]) -> Ranges:
    """Collapse code points into sorted, inclusive ``[first, last]`` ranges."""
    out: Ranges = []
    for cp in sorted(set(code_points)):
        if out and out[-1][1] == cp - 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


# --------------------------------------------------------------------------- engines


def tiktoken_class(pattern: str) -> set[int]:
    """Code points that ``pattern`` matches in tiktoken's Rust regex engine.

    tiktoken exposes no matcher, so the class is read through BPE: the text is
    ``U+0000 X`` for every code point X, the pre-tokenizer is
    ``\\x00<pattern>|[\\s\\S]``, and the ranks hold all 256 single bytes plus one
    merge ``00 b`` for every possible first byte b. ``U+0000 X`` is one chunk,
    and its first token is a merge, exactly when the engine matches X.
    """
    ranks = {bytes([i]): i for i in range(256)}
    for lead in [*range(0x01, 0x80), *range(0xC2, 0xF5)]:
        ranks[b"\x00" + bytes([lead])] = len(ranks)
    merged = set(range(256, len(ranks)))
    enc = tiktoken.Encoding(
        "unicode-probe", pat_str="\\x00" + pattern + r"|[\s\S]", mergeable_ranks=ranks, special_tokens={}
    )
    ids = enc.encode_ordinary("".join("\x00" + chr(cp) for cp in CODE_POINTS))
    found: set[int] = set()
    pos = 0
    for cp in CODE_POINTS:
        width = len(chr(cp).encode("utf-8"))
        if ids[pos] in merged:
            found.add(cp)
            pos += width  # the merge covers U+0000 and the first byte; width - 1 continuation bytes follow
        else:
            pos += 1 + width
    if pos != len(ids):
        raise UnicodeExportError(f"tiktoken probe for {pattern} consumed {pos} of {len(ids)} tokens")
    return found


def oniguruma_class(pattern: str, text: str) -> set[int]:
    """Code points that ``pattern`` matches in HF tokenizers' Oniguruma engine (``Split`` removes matches)."""
    kept = Split(Regex(pattern), behavior="removed").pre_tokenize_str(text)
    return set(CODE_POINTS) - {ord(ch) for piece, _ in kept for ch in piece}


def regex_class(pattern: str, text: str) -> set[int]:
    """Code points that ``pattern`` matches in the Python ``regex`` module."""
    return {ord(ch) for m in regex.finditer(f"(?:{pattern})+", text) for ch in m.group()}


def detected_version(is_assigned: Callable[[int], bool]) -> str:
    """The newest :data:`VERSION_MARKERS` version whose marker code point is assigned (``"<15.1.0"`` if none)."""
    found = "<15.1.0"
    for version, cp in VERSION_MARKERS:
        if is_assigned(cp):
            found = version
    return found


def regex_claimed_unicode() -> str:
    """The Unicode version the installed ``regex`` distribution states in its metadata, or ``"unknown"``."""
    meta = importlib.metadata.metadata("regex").get_payload() or ""
    match = re.search(r"supports Unicode (\d+\.\d+\.\d+)", str(meta))
    return match.group(1) if match else "unknown"


# --------------------------------------------------------------------------- tables


def character_classes(text: str) -> tuple[dict[str, Ranges], dict[str, object]]:
    """Unicode 16.0 class tables from tiktoken, plus the ``regex`` module deltas (cross-checked)."""
    unassigned = tiktoken_class(r"\p{Cn}")
    version = detected_version(lambda cp: cp not in unassigned)
    if version != TARGET_UNICODE:
        raise UnicodeExportError(f"tiktoken's regex engine is Unicode {version}, expected {TARGET_UNICODE}")
    if oniguruma_class(r"\p{Cn}", text) != unassigned:
        raise UnicodeExportError("Oniguruma and tiktoken disagree on unassigned code points")
    regex_unassigned = regex_class(r"\p{Cn}", text)
    if not regex_unassigned <= unassigned:
        raise UnicodeExportError("regex leaves code points unassigned that the id oracles assign")
    if regex_class(r"\s", text) != regex_class(r"\p{White_Space}", text):
        raise UnicodeExportError(r"regex \s differs from \p{White_Space}")

    classes: dict[str, Ranges] = {}
    changes: dict[int, dict[str, str]] = {}
    for name, pattern in CLASSES.items():
        oracle = tiktoken_class(pattern)
        if oniguruma_class(pattern, text) != oracle:
            raise UnicodeExportError(f"Oniguruma and tiktoken disagree on {pattern}")
        if regex.match(pattern, "\x00"):
            raise UnicodeExportError(f"U+0000 is in {pattern}; the probe marker cannot be used")
        newer = regex_class(pattern, text) - unassigned  # ignore code points the id oracles leave unassigned
        for cp in oracle ^ newer:
            side = "oracle" if cp in oracle else "regex"
            changes.setdefault(cp, {})[side] = name
        classes[name] = to_ranges(oracle)
    category_changes = [
        {
            "codePoint": cp,
            "oracle": _general_category(sides.get("oracle")),
            "regex": _general_category(sides.get("regex")),
        }
        for cp, sides in sorted(changes.items())
    ]
    return classes, {
        "assignedLater": to_ranges(unassigned - regex_unassigned),
        "categoryChanges": category_changes,
        "unicodeVersion": regex_claimed_unicode(),
        "assignsMarkersUpTo": detected_version(lambda cp: cp not in regex_unassigned),
    }


def _general_category(name: str | None) -> str:
    """The two-letter category among the exported classes (``Lu``...), or ``"other"``."""
    return name if name in {"Lu", "Ll", "Lt", "Lm", "Lo"} else (name or "other")


def nfkc_qc_not_yes_unicodedata() -> set[int]:
    """Code points whose NFKC_Quick_Check is No or Maybe, derived from Python ``unicodedata``."""
    out = {cp for cp in CODE_POINTS if unicodedata.normalize("NFKC", chr(cp)) != chr(cp)}  # No
    for cp in CODE_POINTS:  # Maybe: the trailing half of a primary composite
        decomposition = unicodedata.decomposition(chr(cp)).split()
        if len(decomposition) == 2 and not decomposition[0].startswith("<"):
            first, second = (int(part, 16) for part in decomposition)
            if unicodedata.normalize("NFC", chr(first) + chr(second)) == chr(cp):
                out.add(second)
    out.update(_HANGUL_V)
    out.update(_HANGUL_T)
    return out


def normalization_tables(text: str) -> tuple[dict[str, Ranges], dict[str, int]]:
    """``cccNonZero`` and ``nfkcQcNotYes``: unicodedata, unioned with ``regex`` (asserted equal on 15.1)."""
    assigned_151 = {cp for cp in CODE_POINTS if unicodedata.category(chr(cp)) != "Cn"}
    ccc_ud = {cp for cp in CODE_POINTS if unicodedata.combining(chr(cp))}
    qc_ud = nfkc_qc_not_yes_unicodedata()
    ccc_rx = set(CODE_POINTS) - regex_class(r"\p{ccc=0}", text)
    qc_rx = set(CODE_POINTS) - regex_class(r"\p{NFKC_QC=Y}", text)
    for label, ours, theirs in (("ccc != 0", ccc_ud, ccc_rx), ("NFKC_QC != Yes", qc_ud, qc_rx)):
        diff = sorted((ours ^ theirs) & assigned_151)
        if diff:
            raise UnicodeExportError(f"unicodedata and regex disagree on {label} for {[hex(c) for c in diff[:10]]}")
    counts = {
        "cccNonZeroUnicodedata": len(ccc_ud),
        "cccNonZeroAddedByRegex": len(ccc_rx - ccc_ud),
        "nfkcQcNotYesUnicodedata": len(qc_ud),
        "nfkcQcNotYesAddedByRegex": len(qc_rx - qc_ud),
    }
    return {"cccNonZero": to_ranges(ccc_ud | ccc_rx), "nfkcQcNotYes": to_ranges(qc_ud | qc_rx)}, counts


# --------------------------------------------------------------------------- output


def build() -> dict[str, object]:
    """Assemble the document written to ``unicode_tables.json``."""
    text = "".join(map(chr, CODE_POINTS))
    classes, regex_module = character_classes(text)
    normalization, norm_counts = normalization_tables(text)
    return {
        "description": "Unicode tables for the tokenize-step-by-step pre-tokenizer (classes, at the id oracles'"
        " Unicode version) and NFKC source map (normalization). Ranges are sorted, inclusive [first, last] code"
        " points. Generated by tools/oracle/export_unicode_tables.py; do not edit by hand.",
        "unicodeVersion": TARGET_UNICODE,
        "versions": {
            "python": platform.python_version(),
            "regex": importlib.metadata.version("regex"),
            "tiktoken": importlib.metadata.version("tiktoken"),
            "tokenizers": importlib.metadata.version("tokenizers"),
            "unicodedata": unicodedata.unidata_version,
        },
        "classes": classes,
        "classSources": "tiktoken (Rust regex) via a BPE probe, equal to HF tokenizers (Oniguruma) on every class;"
        " the Python regex module agrees except on regexModule.assignedLater and regexModule.categoryChanges.",
        "regexModule": regex_module,
        "normalization": normalization,
        "normalizationSources": "unicodedata (NFKC_QC derived: No = NFKC changes the code point alone, Maybe ="
        " trailing half of a canonical composition pair or Hangul V/T jamo) united with the regex module's"
        " ccc and NFKC_QC properties; both agree on every code point assigned in the unicodedata version.",
        "counts": {
            **{name: {"codePoints": sum(b - a + 1 for a, b in r), "ranges": len(r)} for name, r in classes.items()},
            **{
                name: {"codePoints": sum(b - a + 1 for a, b in r), "ranges": len(r)}
                for name, r in normalization.items()
            },
            "normalizationSourceCounts": norm_counts,
        },
    }


def render(doc: dict[str, object]) -> bytes:
    """Serialise ``doc`` deterministically, with one ``[first, last]`` range per line."""
    text = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True)
    text = re.sub(r"\[\s+(-?\d+),\s+(-?\d+)\s+\]", r"[\1, \2]", text)
    return (text + "\n").encode("utf-8")


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point: write ``unicode_tables.json``, or with ``--check`` verify it is current."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if unicode_tables.json is stale")
    args = parser.parse_args(argv)
    data = render(build())
    rel = paths.repo_relative(OUT_PATH)
    if args.check:
        if (OUT_PATH.read_bytes() if OUT_PATH.exists() else b"") != data:
            print(f"{rel} is stale; re-run export_unicode_tables.py", file=sys.stderr)
            return 1
        print(f"{rel} is up to date")
        return 0
    changed = fsio.write_bytes_if_changed(OUT_PATH, data)
    print(f"{rel} {'written' if changed else 'unchanged'} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
