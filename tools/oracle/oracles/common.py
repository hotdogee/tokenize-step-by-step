"""Shared helpers for every golden-fixture oracle family.

The public API is deliberately small:

Corpus
    :data:`CORPUS_PATH`, :func:`load_corpus`
UTF-8 helpers
    :func:`utf8_len`, :func:`char_byte_offsets`, :func:`byte_spans`,
    :func:`is_partial_utf8`
Fixture building
    :data:`GENERATED_ON`, :data:`FIXTURES_DIR`, :func:`token_entry`,
    :func:`vocab_sha256`, :func:`library_version`
Fixture output and checks
    :func:`fixture_dumps`, :func:`write_fixture`, :func:`check_fixture`

Fixture documents follow the schema described in ``tools/oracle/README.md``
("Golden fixtures"). A *case* inside a fixture is a dict with ``name``, ``text``,
``utf8Len``, ``ids`` and ``tokens``; the tiktoken family adds ``chunks`` and
``merges``, and any family may add ``idsWithSpecials``.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

from oracle_lib.fsio import write_bytes_if_changed
from oracle_lib.paths import MANIFEST_PATH, ORACLE_DIR, REPO_ROOT, raw_path

#: The canonical corpus written by ``tools/oracle/make_corpus.py``.
CORPUS_PATH = ORACLE_DIR / "corpus.json"
#: Where committed fixtures live (``fixtures/<tokenizer-id>.json``).
FIXTURES_DIR = REPO_ROOT / "fixtures"
#: Fixed generation date so that regenerated fixtures are byte-identical.
GENERATED_ON = "2026-10-25"

#: Top-level keys every fixture document must carry.
REQUIRED_FIXTURE_KEYS = (
    "cases",
    "crossCheck",
    "family",
    "generatedOn",
    "lab",
    "oracle",
    "policy",
    "tokenizer",
    "vocabAsset",
    "vocabSha256",
)
#: Top-level keys whose value is a list of cases (checked by :func:`check_fixture`).
CASE_LIST_KEYS = ("cases", "normalizedNFKC")


# --------------------------------------------------------------------------- corpus


def load_corpus(path: Path = CORPUS_PATH) -> list[dict[str, Any]]:
    """Return the corpus cases as ``[{"name", "text", "tags"}, ...]`` in file order.

    Raises ``ValueError`` if the file has a BOM, a case lacks a field, or two
    cases share a name.
    """
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"{path} starts with a UTF-8 BOM")
    cases = json.loads(raw.decode("utf-8"))["cases"]
    seen: set[str] = set()
    for case in cases:
        if not {"name", "text", "tags"} <= case.keys():
            raise ValueError(f"corpus case is missing a field: {case!r}")
        if case["name"] in seen:
            raise ValueError(f"duplicate corpus case name: {case['name']}")
        seen.add(case["name"])
    return cases


# --------------------------------------------------------------------------- UTF-8


def utf8_len(text: str) -> int:
    """Number of bytes in the UTF-8 encoding of ``text``."""
    return len(text.encode("utf-8"))


def char_byte_offsets(text: str) -> list[int]:
    """Byte offset of every code-point boundary in ``text`` (``len(text) + 1`` entries).

    ``offsets[i]`` is the UTF-8 byte offset where code point ``i`` starts, and
    ``offsets[-1]`` is the total byte length; use it to turn ``str`` indices
    (e.g. from ``regex.finditer``) into byte spans.
    """
    offsets = [0]
    for ch in text:
        offsets.append(offsets[-1] + len(ch.encode("utf-8")))
    return offsets


def byte_spans(pieces: Iterable[bytes], start: int = 0) -> list[tuple[int, int]]:
    """Cumulative ``(start, end)`` byte spans of consecutive ``pieces``."""
    spans = []
    pos = start
    for piece in pieces:
        spans.append((pos, pos + len(piece)))
        pos += len(piece)
    return spans


def is_partial_utf8(data: bytes) -> bool:
    """True if non-empty ``data`` is not a complete, valid UTF-8 sequence on its own.

    A token is "partial" when it starts with a continuation byte, ends inside
    a multi-byte character, or both (e.g. ``E3 83 BC E3 83``). Inside valid
    UTF-8 text this is equivalent to "the token does not start and end on
    character boundaries". Zero-width tokens are never partial.
    """
    try:
        data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return True
    return False


# --------------------------------------------------------------------------- building


def token_entry(token_id: int, data: bytes, start: int, *, piece: str | None = None) -> dict:
    """Build one fixture token dict covering ``data`` from byte offset ``start``.

    ``piece`` is the SentencePiece piece string; leave it ``None`` for byte-level
    BPE families so the key is omitted.
    """
    entry = {
        "bytes": data.hex(),
        "end": start + len(data),
        "id": token_id,
        "partial": is_partial_utf8(data),
        "start": start,
        "zeroWidth": len(data) == 0,
    }
    if piece is not None:
        entry["piece"] = piece
    return entry


def sha256_file(path: Path) -> str:
    """Hex SHA-256 of a file's bytes."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def vocab_sha256(asset_id: str, file_name: str) -> str:
    """SHA-256 of ``data/vocab/raw/<asset_id>/<file_name>``, verified against the manifest.

    Raises ``ValueError`` when the manifest has no hash for the file or the
    local copy differs (run ``fetch_vocab.py`` to repair).
    """
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    expected = None
    for asset in manifest["assets"]:
        if asset["id"] == asset_id:
            for entry in asset["files"]:
                if entry["name"] == file_name:
                    expected = entry.get("sha256")
    if not expected:
        raise ValueError(f"manifest has no sha256 for {asset_id}/{file_name}")
    actual = sha256_file(raw_path(asset_id, file_name))
    if actual != expected:
        raise ValueError(f"{asset_id}/{file_name}: sha256 {actual} != manifest {expected}")
    return actual


def library_version(distribution: str) -> str:
    """Installed version of a Python distribution (e.g. ``"tiktoken"``)."""
    return importlib.metadata.version(distribution)


# --------------------------------------------------------------------------- output


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, str | int | float | bool)


def _is_flat_array(value: Any) -> bool:
    """True for a list of scalars, or of lists of scalars (e.g. ``ids``, ``chunks``, ``steps``)."""
    return isinstance(value, list) and all(
        _is_scalar(item) or (isinstance(item, list) and all(_is_scalar(x) for x in item)) for item in value
    )


def _dump(value: Any, level: int) -> str:
    """Render ``value`` at nesting ``level`` (one space of indent per level)."""
    if isinstance(value, dict) and value:
        inner = " " * (level + 1)
        items = [
            f"{inner}{json.dumps(key, ensure_ascii=False)}: {_dump(value[key], level + 1)}" for key in sorted(value)
        ]
        return "{\n" + ",\n".join(items) + "\n" + " " * level + "}"
    if isinstance(value, list) and value and not _is_flat_array(value):
        inner = " " * (level + 1)
        return "[\n" + ",\n".join(inner + _dump(item, level + 1) for item in value) + "\n" + " " * level + "]"
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def fixture_dumps(doc: dict) -> str:
    """Serialise a fixture: sorted keys, literal Unicode, trailing LF.

    Objects are indented one space per level, exactly as ``json.dumps(indent=1)``
    writes them, but every array of scalars or of arrays of scalars (``ids``,
    ``chunks``, merge ``steps``, ctok ``pieces``) is written on one line, e.g.
    ``"ids": [3735, 133072]`` or ``"steps": [[0, 948], [5, 948]]``. Arrays that
    hold objects (``cases``, ``tokens``, ``merges``) keep one element per line,
    so diffs stay per token while the file is roughly half the size.
    """
    return _dump(doc, 0) + "\n"


def write_fixture(doc: dict, out_dir: Path = FIXTURES_DIR) -> Path:
    """Write ``doc`` to ``<out_dir>/<doc["tokenizer"]>.json`` (UTF-8, no BOM, LF).

    The write is atomic and skipped when the file already holds the same bytes.
    Returns the path.
    """
    path = out_dir / f"{doc['tokenizer']}.json"
    write_bytes_if_changed(path, fixture_dumps(doc).encode("utf-8"))
    return path


# --------------------------------------------------------------------------- checks


def check_fixture(doc: dict, *, normalize: Callable[[str], str] | None = None) -> list[str]:
    """Return a list of invariant violations in ``doc`` (empty when all pass).

    ``normalize`` maps a case's ``text`` to the string whose UTF-8 bytes the
    tokens must cover (e.g. ``NFC`` for ctok); by default the text itself.
    Checked for every case in every list named in :data:`CASE_LIST_KEYS`:

    * ``tokens`` may be ``null`` only with a non-empty ``spansNullReason`` and
      ``ids`` ``null`` (ctok cases that have no faithful byte alignment);
      only ``utf8Len`` is checked for such a case;
    * ``concat(token bytes) == utf8(normalize(text))`` and ``utf8Len`` matches;
    * ``ids`` equals the token ids; spans are contiguous from 0 to ``utf8Len``;
    * ``partial`` / ``zeroWidth`` agree with the bytes, and a non-partial token
      starts and ends on character boundaries;
    * ``chunks`` (if present) tile the text and no token crosses a chunk edge;
    * ``merges`` (if present) replay from single bytes to exactly the chunk's
      tokens, the last merge forming each multi-byte token records that token's
      id as its rank, ``directHit`` chunks have no steps and one token, and
      across the whole fixture every rank always names the same bytes (and
      vice versa), counting token ids as ranks.
    """
    tokenizer = doc.get("tokenizer", "?")
    errors = [f"{tokenizer}: missing top-level key {k!r}" for k in REQUIRED_FIXTURE_KEYS if k not in doc]
    ranks = _RankTable()
    for key in CASE_LIST_KEYS:
        for case in doc.get(key, []):
            where = f"{tokenizer}/{key}/{case.get('name', '?')}"
            errors += [f"{where}: {msg}" for msg in _check_case(case, normalize, ranks)]
    return errors


class _RankTable:
    """Fixture-wide rank <-> bytes bijection built from merge steps and token ids."""

    def __init__(self) -> None:
        self.by_rank: dict[int, bytes] = {}
        self.by_bytes: dict[bytes, int] = {}

    def add(self, rank: int, data: bytes) -> str | None:
        """Record ``rank -> data``; return an error message on a conflict."""
        if self.by_rank.setdefault(rank, data) != data or self.by_bytes.setdefault(data, rank) != rank:
            return f"rank {rank} / bytes {data.hex()} conflict with an earlier merge or token"
        return None


def _check_case(case: dict, normalize: Callable[[str], str] | None, ranks: _RankTable) -> list[str]:
    """Invariant violations for a single fixture case (see :func:`check_fixture`)."""
    text = normalize(case["text"]) if normalize else case["text"]
    target = text.encode("utf-8")
    tokens = case["tokens"]
    errs: list[str] = []
    if case["utf8Len"] != len(target):
        errs.append(f"utf8Len {case['utf8Len']} != {len(target)}")
    if tokens is None:
        if not case.get("spansNullReason"):
            errs.append("tokens is null without a spansNullReason")
        if case.get("ids") is not None:
            errs.append("tokens is null but ids is not")
        return errs
    if case["ids"] != [t["id"] for t in tokens]:
        errs.append("ids differ from token ids")
    data = [bytes.fromhex(t["bytes"]) for t in tokens]
    if b"".join(data) != target:
        errs.append("concatenated token bytes != UTF-8 of text")
    boundaries = set(char_byte_offsets(text))
    pos = 0
    for i, (tok, raw) in enumerate(zip(tokens, data, strict=True)):
        if tok["start"] != pos or tok["end"] != pos + len(raw):
            errs.append(f"token {i} span [{tok['start']},{tok['end']}) expected [{pos},{pos + len(raw)})")
        if tok["partial"] != is_partial_utf8(raw):
            errs.append(f"token {i} partial flag wrong")
        if tok["zeroWidth"] != (len(raw) == 0):
            errs.append(f"token {i} zeroWidth flag wrong")
        if raw and not tok["partial"] and not {tok["start"], tok["end"]} <= boundaries:
            errs.append(f"token {i} is not partial but cuts a character")
        pos += len(raw)
    if "chunks" in case:
        errs += _check_chunks(case, tokens, target, ranks)
    return errs


def _check_chunks(case: dict, tokens: Sequence[dict], target: bytes, ranks: _RankTable) -> list[str]:
    """Check ``chunks`` tiling and, when present, ``merges`` replay."""
    errs: list[str] = []
    total = len(target)
    chunks = case["chunks"]
    pos = 0
    for start, end in chunks:
        if start != pos or end <= start:
            errs.append(f"chunk [{start},{end}) does not continue at {pos}")
        pos = end
    if pos != total:
        errs.append(f"chunks end at {pos}, text has {total} bytes")
    # Group token indices by chunk.
    per_chunk: list[list[int]] = [[] for _ in chunks]
    ci = 0
    for ti, tok in enumerate(tokens):
        while ci < len(chunks) and tok["start"] >= chunks[ci][1]:
            ci += 1
        if ci == len(chunks) or tok["end"] > chunks[ci][1]:
            errs.append(f"token {ti} crosses a chunk boundary")
            return errs
        per_chunk[ci].append(ti)
    if "merges" not in case:
        return errs
    merges = case["merges"]
    if [m["chunk"] for m in merges] != list(range(len(chunks))):
        errs.append("merges must list every chunk index in order")
        return errs
    for tok in tokens:
        if err := ranks.add(tok["id"], bytes.fromhex(tok["bytes"])):
            errs.append(err)
    for m, (start, end), tis in zip(merges, chunks, per_chunk, strict=True):
        want = [bytes.fromhex(tokens[t]["bytes"]) for t in tis]
        if m["directHit"]:
            if m["steps"] or len(tis) != 1:
                errs.append(f"chunk {m['chunk']}: directHit needs no steps and one token")
            continue
        parts = [target[i : i + 1] for i in range(start, end)]  # single bytes
        last_rank: list[int | None] = [None] * len(parts)
        for position, rank in m["steps"]:
            if not 0 <= position < len(parts) - 1:
                errs.append(f"chunk {m['chunk']}: merge position {position} out of range")
                break
            parts[position : position + 2] = [parts[position] + parts[position + 1]]
            last_rank[position : position + 2] = [rank]
            if err := ranks.add(rank, parts[position]):
                errs.append(f"chunk {m['chunk']}: {err}")
        if parts != want:
            got, exp = [p.hex() for p in parts], [w.hex() for w in want]
            errs.append(f"chunk {m['chunk']}: merges replay to {got}, tokens are {exp}")
            continue
        for t, rank in zip(tis, last_rank, strict=True):
            if rank is not None and rank != tokens[t]["id"]:
                errs.append(f"chunk {m['chunk']}: final merge rank {rank} != token id {tokens[t]['id']}")
    return errs
