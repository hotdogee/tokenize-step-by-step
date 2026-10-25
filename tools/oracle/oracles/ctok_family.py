"""Reference fixtures for ctok, the community reconstruction of Claude's tokenizer.

ctok (``sanderland/ctok``, PyPI 1.3.0, MIT) reconstructs Claude *token counts*
from ``count_tokens`` measurements. It is not Anthropic's tokenizer and is not
byte-exact: in its author's words, ``tokenize()`` returns "one valid
minimum-cost tiling, not a claim about Anthropic's exact segmentation". The
fixture family is therefore called ``ctok-tiling`` and every document says so.

There is one fixture per reconstructed ctok family, ``fixtures/anthropic-ctok-<key>.json``
(``v3``, ``v4.7``, ``v4.8``). Each is a regular fixture document: the family's
metadata (``version``, ``ctokFamily``, ``frame``, ``dataFile``, ...) sits at the
top level and ``cases`` holds every corpus case with

* ``pieces``: the verbatim ``ctok.tokenize(text, version)`` output, frame
  ``⟨pad⟩`` tokens first; ``frameCount + contentCount == totalCount``;
* ``tokens``: the content pieces aligned to byte spans of UTF-8(NFC(text))
  (:mod:`oracles.ctok_spans`), or ``null`` plus ``spansNullReason``;
* ``absorbed``: source byte ranges no piece spells (seam spaces, stripped
  controls, frame-absorbed newlines) and the piece each is attached to.

ctok has no token ids, so ``ids`` and every token ``id`` are ``null`` (``ids``
itself is ``null`` when ``tokens`` is). ``gen_fixtures.py`` checks every case
with :func:`oracles.common.check_fixture` under NFC (:data:`NORMALIZE`).
"""

from __future__ import annotations

import hashlib
import json
import sys
import tomllib
import unicodedata
from functools import partial
from importlib.resources import files

import ctok
import ctok.main as ctok_main

from oracle_lib.paths import MANIFEST_PATH, ORACLE_DIR
from oracles import common
from oracles.ctok_spans import SpanError, align
from oracles.ctok_tiling_check import Vocabulary, check_case

TOKENIZER_ID = "anthropic-ctok"
VOCAB_ASSET = "anthropic-ctok"
FAMILY = "ctok-tiling"
FRAME_PIECE = "⟨pad⟩"
#: Labels that ctok accepts beyond each family's base version; checked to be exact aliases.
ALIAS_LABELS = ("5", "5.5")
#: Labels whose routing is recorded (ctok routes any version >= 4.8 to v4.8).
ROUTING_PROBES = ("2.1", "3.0", "3.5", "4.6", "4.7", "4.8", "5", "5.5")
#: Model generations per family, from the "Supported families" table of ctok's README.
FAMILY_MODELS = {
    "v3": "Claude 3 through Opus 4.6",
    "v4.7": "Opus 4.7",
    "v4.8": "Opus 4.8, Sonnet 5, and Fable 5",
}
KNOWN_GAPS = {
    "v4.8": [
        "Opus 5 makes trailing ASCII whitespace free; ctok intentionally does not model this (ctok README).",
        (
            "Opus 5.5 adds 2 tokens to the message frame (docs/research/01-tokenizers-and-platform.md 3.2); "
            "ctok 1.3.0 does not model this, so its '5.5' label returns the v4.8 count."
        ),
    ],
}
CAVEAT = (
    "The reconstruction targets counts. Claude does not expose token boundaries, so `tokenize()` "
    "returns one valid minimum-cost tiling, not a claim about Anthropic's exact segmentation. "
    "(ctok 1.3.0 README)"
)
#: Known answers from docs/research/01-tokenizers-and-platform.md (sections 3.2 and 5.3).
RESEARCH_CHECKS = {
    "3.0": ("台灣台南", 13, ["⟨bow⟩", "台", "⟨0xE7⟩⟨0x81⟩", "⟨0xA3⟩", "台", "南"]),
    "4.7": ("台灣台南", 17, ["⟨bow⟩", "台", "⟨0xE7⟩⟨0x81⟩", "⟨0xA3⟩", "台", "南"]),
    "4.8": ("台灣台南", 11, ["台", "⟨0xE7⟩⟨0x81⟩", "⟨0xA3⟩", "台", "南"]),
}
CROSS_CHECK_LIBRARY = "independent tiling re-check (tools/oracle/oracles/ctok_tiling_check.py)"
CROSS_CHECK_SCOPE = (
    "Re-derives the tiling only: pieces concatenate to ctok.marked_stream, every piece is a "
    "vocabulary piece, unit-cost character or byte-fallback chunk, the content count equals an "
    "independent minimum-cost tiling, and the frame tail length is as predicted. ctok's "
    "normalization and marker model are taken as given; no Anthropic ground truth is involved."
)
DESCRIPTION = (
    "Community reconstruction of Claude token counts (ctok, sanderland/ctok, MIT). Not an "
    "Anthropic artifact and not byte-exact: only counts are calibrated against count_tokens."
)


def nfc(text: str) -> str:
    """The text whose UTF-8 bytes ctok token spans cover."""
    return unicodedata.normalize("NFC", text)


# --------------------------------------------------------------------------- provenance


def _manifest_asset() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return next(a for a in manifest["assets"] if a["id"] == VOCAB_ASSET)


def _data_file(filename: str) -> tuple[dict, dict]:
    """Describe and parse one bundled pieces file, verified against the manifest."""
    member = f"ctok/data/{filename}"
    raw = files("ctok").joinpath("data", filename).read_bytes()
    info = {"bytes": len(raw), "path": member, "sha256": hashlib.sha256(raw).hexdigest()}
    pinned = [f for f in _manifest_asset()["files"] if f["source"].get("member") == member]
    if not pinned or (pinned[0]["sha256"], pinned[0]["bytes"]) != (info["sha256"], info["bytes"]):
        raise ValueError(f"installed {member} does not match manifest asset {VOCAB_ASSET}")
    return info, json.loads(raw.decode("utf-8"))


def _wheel_sha256() -> str:
    """SHA-256 of the pinned ctok wheel, checked against uv.lock's hash for it."""
    wheel = next(f for f in _manifest_asset()["files"] if f["role"] == "archive")
    lock = tomllib.loads((ORACLE_DIR / "uv.lock").read_text(encoding="utf-8"))
    package = next(p for p in lock["package"] if p["name"] == "ctok")
    if package["version"] != common.library_version("ctok"):
        raise ValueError("uv.lock and the installed ctok disagree on the version")
    if f"sha256:{wheel['sha256']}" not in {w["hash"] for w in package.get("wheels", [])}:
        raise ValueError("uv.lock does not pin the ctok wheel recorded in the manifest")
    return wheel["sha256"]


def _routing() -> dict:
    """What the installed ctok does with each probed version label."""
    observed = {}
    for label in ROUTING_PROBES:
        try:
            observed[label] = ctok_main._family(label)
        except NotImplementedError:
            observed[label] = None
    rule = ", ".join(
        f"version >= {'.'.join(map(str, fam.min_version))} -> {key}"
        for key, fam in sorted(ctok_main.FAMILIES.items(), key=lambda kv: kv[1].min_version)
    )
    return {
        "defaultVersions": list(ctok_main.DEFAULT_VERSIONS),
        "observed": observed,
        "rule": f"{rule} (highest match wins; below 3.0 raises NotImplementedError)",
    }


def _families() -> list[tuple[str, str, ctok_main.Family]]:
    """``(version label, family key, family)`` for every reconstructed family, oldest first."""
    rows = [
        (".".join(map(str, fam.min_version)), key, fam)
        for key, fam in ctok_main.FAMILIES.items()
        if fam.pieces is not None
    ]
    return sorted(rows, key=lambda row: row[2].min_version)


# --------------------------------------------------------------------------- cases


def _trailing_newlines(text: str, label: str) -> int:
    norm = ctok.normalize(text, label)
    return len(norm) - len(norm.rstrip("\n"))


def _build_case(case: dict, label: str, overhead: int) -> dict:
    """One corpus case under one ctok version (no cross-check)."""
    text = case["text"]
    pieces = ctok.tokenize(text, label)
    if len(pieces) != ctok.token_count(text, label) or pieces[:overhead] != [FRAME_PIECE] * overhead:
        raise ValueError(f"{case['name']}@{label}: unexpected frame or count")
    content = pieces[overhead:]
    target = nfc(text)
    out = {
        "contentCount": len(content),
        "frameCount": overhead,
        "name": case["name"],
        "pieces": pieces,
        "text": text,
        "totalCount": len(pieces),
        "utf8Len": common.utf8_len(target),
    }
    if target != text:
        out["nfcText"] = target
    try:
        alignment = align(text, content)
    except SpanError as exc:
        out.update(ids=None, tokens=None, spansNullReason=str(exc))
        return out
    tokens = [
        common.token_entry(None, alignment.data[start:end], start, piece=piece)
        for piece, (start, end) in zip(content, alignment.spans, strict=True)
    ]
    out.update(ids=[None] * len(tokens), tokens=tokens)
    if alignment.absorbed:
        out["absorbed"] = [
            {"end": a.end, "reason": a.reason, "start": a.start, "token": a.token} for a in alignment.absorbed
        ]
    return out


def _build_version(label: str, key: str, family: ctok_main.Family, cases: list[dict]) -> dict:
    """The family-specific part of the fixture for one ctok family."""
    data_file, document = _data_file(family.pieces)
    meta = {**document["meta"], **dict(family.meta)}
    vocab = Vocabulary(document)
    aliases = [a for a in ALIAS_LABELS if ctok_main._family(a) == key]
    built, disagreed = [], []
    for case in cases:
        entry = _build_case(case, label, meta["message_overhead"])
        content = entry["pieces"][entry["frameCount"] :]
        stream = ctok.marked_stream(case["text"], label)
        if check_case(vocab, content, stream, _trailing_newlines(case["text"], label)):
            disagreed.append(case["name"])
        for alias in aliases:
            if ctok.tokenize(case["text"], alias) != entry["pieces"]:
                raise ValueError(f"{case['name']}: ctok '{alias}' differs from '{label}'")
        built.append(entry)
    groups = document["tokens"]
    return {
        "aliases": aliases,
        "byteFallbackPieces": len(groups["bytes_fallback"]),
        "cases": built,
        "crossCheck": {
            "agreedCases": len(cases) - len(disagreed),
            "disagreedCases": disagreed,
            "library": CROSS_CHECK_LIBRARY,
            "scope": CROSS_CHECK_SCOPE,
            "version": f"ctok {common.library_version('ctok')} marked stream",
        },
        "ctokFamily": key,
        "dataFile": data_file,
        "frame": {
            "count": meta["message_overhead"],
            "endsInBow": meta.get("frame_bow", True),
            "piece": FRAME_PIECE,
            "position": "prefix",
        },
        "knownGaps": KNOWN_GAPS.get(key, []),
        "models": FAMILY_MODELS.get(key, ""),
        "normalization": {"allcapsMin": meta["allcaps_min"], "foldQuotes": meta["fold_quotes"]},
        "sourceModel": family.source_model,
        "tokenizer": f"{TOKENIZER_ID}-{key}",
        "version": label,
        "vocabGroups": {group: len(pieces) for group, pieces in groups.items()},
        "vocabSha256": data_file["sha256"],
        "vocabSha256Of": f"{data_file['path']} (member of the pinned ctok wheel, see wheelSha256)",
        "vocabSize": len(ctok.pieces(label)),
    }


# --------------------------------------------------------------------------- document


def _policy() -> dict:
    return {
        "addBos": False,
        "notes": (
            "COMMUNITY RECONSTRUCTION, NOT ANTHROPIC'S TOKENIZER: ctok calibrates counts only; piece "
            "boundaries are one valid minimum-cost tiling. Special-token look-alikes are plain text. "
            "ctok has no token ids, so ids and token id are null; compare pieces instead. "
            "There is one fixture per ctok family (anthropic-ctok-v3, -v4.7, -v4.8); version is the ctok "
            "version label used and versionRouting records which labels route to which family. "
            "pieces is the verbatim ctok.tokenize() output including the frame; tokens covers only the "
            "content pieces, with byte offsets into UTF-8(NFC(text)) (nfcText is present when NFC changes "
            "the text). Span walk: a byte atom covers 1 byte, a marker atom is zero-width, a text "
            "character covers the source character it spells (case-, quote- and space-folded characters "
            "cover the source bytes). Source bytes no piece spells are listed in absorbed and attached to "
            "a piece: bow-space to the piece holding the absorbing marker, stripped to the next spelled "
            "piece, frame-newlines to the last piece. When no faithful alignment exists, tokens is null "
            "and spansNullReason says why."
        ),
        "specialTokens": "as-text",
    }


def _research_check(entry: dict) -> None:
    """Fail loudly if the known answer from the research document no longer holds."""
    expected = RESEARCH_CHECKS.get(entry["version"])
    if expected is None:
        return
    text, total, content = expected
    pieces = ctok.tokenize(text, entry["version"])
    if len(pieces) != total or pieces[entry["frame"]["count"] :] != content:
        raise ValueError(f"research known answer failed for {text}@{entry['version']}: {pieces}")


def build_fixture(key: str, cases: list[dict]) -> dict:
    """Build ``fixtures/anthropic-ctok-<key>.json`` for one ctok family from the corpus cases."""
    label, _, family = next(row for row in _families() if row[1] == key)
    entry = _build_version(label, key, family, cases)
    _research_check(entry)
    doc = {
        **entry,
        "caveat": CAVEAT,
        "description": DESCRIPTION,
        "family": FAMILY,
        "generatedOn": common.GENERATED_ON,
        "lab": "Anthropic",
        "oracle": {"library": "ctok", "version": common.library_version("ctok")},
        "policy": _policy(),
        "versionRouting": _routing(),
        "vocabAsset": VOCAB_ASSET,
        "wheelSha256": _wheel_sha256(),
    }
    _report(doc)
    return doc


def _report(doc: dict) -> None:
    unmapped = [c["name"] for c in doc["cases"] if c["tokens"] is None]
    with_partial = sum(any(t["partial"] for t in c["tokens"] or []) for c in doc["cases"])
    print(
        f"  {doc['tokenizer']}: {len(doc['cases'])} cases, {with_partial} with partial tokens, "
        f"{len(unmapped)} unmapped {unmapped}, cross-check disagreed {doc['crossCheck']['disagreedCases']}",
        file=sys.stderr,
    )


#: Tokenizer id -> fixture builder, one per reconstructed ctok family.
TOKENIZERS = {f"{TOKENIZER_ID}-{key}": partial(build_fixture, key) for _, key, _ in _families()}
NORMALIZE = dict.fromkeys(TOKENIZERS, nfc)
