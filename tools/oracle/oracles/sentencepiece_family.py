"""Golden fixtures for the SentencePiece-BPE-with-byte-fallback family.

Three tokenizers belong to the family ``sentencepiece-bpe``:

* ``google-gemma4`` -- oracle: HF ``tokenizers`` on the Gemma 4
  ``tokenizer.json`` (``add_special_tokens=False``,
  ``encode_special_tokens=True``); cross-check: the ``sentencepiece`` library
  on the Gemma 3 ``.spiece.model``, which has the same 262,144-slot vocabulary.
* ``google-gemma2`` -- oracle: ``sentencepiece`` on the Gemma 1/2
  ``tokenizer.model`` (256,000 pieces; Gemini 1.0/1.5), no BOS/EOS;
  cross-check: :mod:`spm_bpe_ref`.
* ``xai-grok1`` -- oracle: ``sentencepiece`` on Grok-1's ``tokenizer.model``
  (no BOS/EOS); cross-check: :mod:`spm_bpe_ref`, a pure-Python
  re-implementation of SentencePiece BPE that shares no code with the library.

Per-token byte spans follow research section 5.2. The UTF-8 input is walked
with a cursor while consuming pieces in order:

* a BYTE piece covers exactly one byte, whose value is ``id - first_byte_id``
  (the byte range is derived from the model's piece types, never hard-coded);
* any other piece covers the UTF-8 encoding of its text, except that each
  ``'▁'`` matches whichever of ``0x20`` (an escaped space) or ``E2 96 81`` (a
  literal U+2581 in the input) is actually at the cursor;
* with ``add_dummy_prefix`` the first ``'▁'`` of the first piece is the
  dummy prefix and covers zero bytes, unconditionally (an input that already
  starts with spaces still gets its own dummy ``'▁'``).

The walk asserts that every byte is consumed exactly once.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Any

import sentencepiece as spm
from sentencepiece import sentencepiece_model_pb2 as pb
from tokenizers import Tokenizer

from oracle_lib.paths import raw_path

from . import common
from .spm_bpe_ref import REFERENCE_VERSION, SpmBpeReference

FAMILY = "sentencepiece-bpe"
SP_MARK = "\u2581"  # '▁', SentencePiece's whitespace symbol
SP_MARK_UTF8 = SP_MARK.encode("utf-8")  # E2 96 81

GEMMA4_ASSET, GEMMA4_FILE = "google-gemma4", "tokenizer.json"
GEMMA3_ASSET, GEMMA3_FILE = "google-gemma3-spiece", "gemma3_cleaned_262144_v2.spiece.model"
GROK1_ASSET, GROK1_FILE = "xai-grok1", "tokenizer.model"
GEMMA2_ASSET, GEMMA2_FILE = "google-gemma2", "tokenizer.model"
#: Research sections 3.3 and 5.2: the Gemma 1/2 BYTE pieces are ids 217..472.
GEMMA2_FIRST_BYTE_ID = 217

# Fixture "type" names for ModelProto.SentencePiece.Type (UNKNOWN is shortened to UNK).
_TYPE_NAMES = {
    value: ("UNK" if name == "UNKNOWN" else name) for name, value in pb.ModelProto.SentencePiece.Type.items()
}
# An HTML/bracket-like literal, used to recognise special-token strings in text.
_MARKUP = re.compile(r"<[^<>\s]+>|\[[^\[\]\s]+\]")


class SentencePieceFixtureError(ValueError):
    """An oracle result or invariant check failed; fixture generation must stop."""


# --------------------------------------------------------------------------
# SentencePiece model protobuf
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SpModel:
    """Facts parsed from a SentencePiece ``.model`` protobuf."""

    proto: pb.ModelProto
    pieces: tuple[str, ...]
    types: tuple[str, ...]
    first_byte_id: int

    @classmethod
    def load(cls, path: Path) -> SpModel:
        """Parse ``path`` and derive the BYTE-piece range from the piece types."""
        proto = pb.ModelProto()
        proto.ParseFromString(path.read_bytes())
        pieces = tuple(p.piece for p in proto.pieces)
        types = tuple(_TYPE_NAMES[p.type] for p in proto.pieces)
        byte_ids = [i for i, kind in enumerate(types) if kind == "BYTE"]
        if not byte_ids:
            raise SentencePieceFixtureError(f"{path.name}: no BYTE pieces (byte_fallback off?)")
        first = byte_ids[0]
        if byte_ids != list(range(first, first + 256)):
            raise SentencePieceFixtureError(f"{path.name}: BYTE pieces are not 256 contiguous ids")
        for value, pid in enumerate(byte_ids):
            if pieces[pid] != f"<0x{value:02X}>":
                raise SentencePieceFixtureError(f"{path.name}: BYTE id {pid} is {pieces[pid]!r}")
        return cls(proto, pieces, types, first)

    @property
    def add_dummy_prefix(self) -> bool:
        """Whether SentencePiece prepends a zero-width ``'▁'`` to the input."""
        return self.proto.normalizer_spec.add_dummy_prefix

    @cached_property
    def _ids_by_piece(self) -> dict[str, int]:
        return {piece: i for i, piece in enumerate(self.pieces)}

    def piece_id(self, piece: str) -> int | None:
        """Return the id whose piece text is exactly ``piece``, or ``None``."""
        return self._ids_by_piece.get(piece)

    def ids_of_type(self, kind: str) -> list[int]:
        """All ids whose piece type is ``kind`` (fixture spelling, e.g. ``"UNK"``)."""
        return [i for i, t in enumerate(self.types) if t == kind]

    def describe(self) -> str:
        """Render the proto parameters that matter for encoding as one sentence."""
        ts, ns = self.proto.trainer_spec, self.proto.normalizer_spec
        flags = {
            "model_type": pb.TrainerSpec.ModelType.Name(ts.model_type),
            "byte_fallback": ts.byte_fallback,
            "add_dummy_prefix": ns.add_dummy_prefix,
            "escape_whitespaces": ns.escape_whitespaces,
            "remove_extra_whitespaces": ns.remove_extra_whitespaces,
            "split_by_unicode_script": ts.split_by_unicode_script,
            "split_by_whitespace": ts.split_by_whitespace,
            "split_digits": ts.split_digits,
            "normalizer": ns.name,
        }
        rendered = ", ".join(f"{k}={_render(v)}" for k, v in flags.items())
        counts = Counter(self.types)
        order = ("NORMAL", "USER_DEFINED", "BYTE", "CONTROL", "UNK", "UNUSED")
        kinds = ", ".join(
            f"{kind} {counts[kind]}"
            + (f" (ids {self.first_byte_id}..{self.first_byte_id + 255})" if kind == "BYTE" else "")
            for kind in order
            if counts[kind]
        )
        return (
            f"{rendered} (precompiled_charsmap {len(ns.precompiled_charsmap)} bytes, so input"
            f" text is never rewritten except spaces); {len(self.pieces)} pieces: {kinds};"
            f" unk_id={ts.unk_id}, bos_id={ts.bos_id}, eos_id={ts.eos_id}, pad_id={ts.pad_id}."
        )


def _render(value: Any) -> str:
    return str(value).lower() if isinstance(value, bool) else str(value)


# --------------------------------------------------------------------------
# Byte alignment (research section 5.2)
# --------------------------------------------------------------------------


def align_tokens(
    text: str,
    ids: Sequence[int],
    pieces: Sequence[str],
    types: Sequence[str],
    first_byte_id: int,
    add_dummy_prefix: bool,
) -> list[dict[str, Any]]:
    """Return one fixture token per id with byte spans into ``text``'s UTF-8.

    ``pieces``/``types`` are indexed by id. Raises :class:`SentencePieceFixtureError`
    if a piece does not match the input at the cursor or bytes are left over.
    """
    utf8 = text.encode("utf-8")
    cursor = 0
    dummy_pending = add_dummy_prefix and bool(utf8)
    tokens: list[dict[str, Any]] = []
    for tid in ids:
        piece, kind, start = pieces[tid], types[tid], cursor
        if kind == "BYTE":
            value = tid - first_byte_id
            if cursor >= len(utf8) or utf8[cursor] != value:
                raise SentencePieceFixtureError(
                    f"BYTE token {tid} (0x{value:02X}) does not match input at byte {cursor}"
                )
            cursor += 1
        elif kind in ("NORMAL", "USER_DEFINED"):
            for char in piece:
                if dummy_pending:
                    if char != SP_MARK:
                        raise SentencePieceFixtureError(f"first piece {piece!r} lacks the dummy prefix")
                    dummy_pending = False
                    continue
                cursor = _consume(utf8, cursor, char, piece)
        else:
            raise SentencePieceFixtureError(f"token {tid} has type {kind}; cannot cover input bytes")
        if dummy_pending:
            raise SentencePieceFixtureError("dummy prefix not found in the first token")
        token = common.token_entry(tid, utf8[start:cursor], start, piece=piece)
        token["type"] = kind
        tokens.append(token)
    if cursor != len(utf8):
        raise SentencePieceFixtureError(f"pieces cover {cursor} of {len(utf8)} bytes")
    return tokens


def _consume(utf8: bytes, cursor: int, char: str, piece: str) -> int:
    """Advance past ``char`` of ``piece`` at ``cursor``; ``'▁'`` matches 0x20 or U+2581."""
    if char == SP_MARK:
        if utf8.startswith(b" ", cursor):
            return cursor + 1
        if utf8.startswith(SP_MARK_UTF8, cursor):
            return cursor + len(SP_MARK_UTF8)
    else:
        encoded = char.encode("utf-8")
        if utf8.startswith(encoded, cursor):
            return cursor + len(encoded)
    raise SentencePieceFixtureError(f"piece {piece!r}: {char!r} does not match input at byte {cursor}")


def _case(name: str, text: str, ids: Sequence[int], tokens: list[dict[str, Any]]) -> dict[str, Any]:
    """Assemble one fixture case and assert the byte-concatenation invariant."""
    utf8 = text.encode("utf-8")
    joined = b"".join(bytes.fromhex(t["bytes"]) for t in tokens)
    if joined != utf8:
        raise SentencePieceFixtureError(f"{name}: concatenated token bytes differ from the UTF-8 input")
    return {"name": name, "text": text, "utf8Len": len(utf8), "ids": list(ids), "tokens": tokens}


def _id_ranges(ids: Iterable[int]) -> str:
    """Render sorted ids compactly, e.g. ``"4..13, 24..31"``."""
    out: list[str] = []
    run: list[int] = []
    for i in sorted(ids):
        if run and i != run[-1] + 1:
            out.append(f"{run[0]}..{run[-1]}" if len(run) > 1 else str(run[0]))
            run = []
        run.append(i)
    if run:
        out.append(f"{run[0]}..{run[-1]}" if len(run) > 1 else str(run[0]))
    return ", ".join(out)


# --------------------------------------------------------------------------
# Research section 5.3 expectations
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ResearchClaim:
    """A hands-on result from the research report that the oracle must reproduce."""

    text: str
    claim: str
    ids: tuple[int, ...] | None = None
    spans: tuple[tuple[int, int], ...] | None = None
    check: Callable[[list[dict[str, Any]]], bool] | None = None


def _types(*expected: str) -> Callable[[list[dict[str, Any]]], bool]:
    return lambda tokens: [t["type"] for t in tokens] == list(expected)


GEMMA4_CLAIMS = (
    ResearchClaim("台灣台南", "§5.3 台灣|台|南", (44953, 237838, 238162), ((0, 6), (6, 9), (9, 12))),
    ResearchClaim(
        "東京都渋谷区のラーメン屋",
        "§5.3 東京都|渋谷|区|の|ラーメン|屋",
        (118981, 172121, 237835, 236945, 112116, 238678),
    ),
    ResearchClaim("\U00030edd", "§3.3 𰻝 = 4 byte pieces", (478, 414, 425, 395), ((0, 1), (1, 2), (2, 3), (3, 4))),
    ResearchClaim(
        "Hello world, tokenizers!", "§5.3 Hello|▁world|,|▁token|izers|!", (9259, 1902, 236764, 8369, 19804, 236888)
    ),
    ResearchClaim(
        "12345", "§3.3 12345 → 5 single-digit tokens", check=lambda t: [x["end"] - x["start"] for x in t] == [1] * 5
    ),
    ResearchClaim("龘", "§3.3 龘 → 3 byte pieces", check=_types("BYTE", "BYTE", "BYTE")),
    ResearchClaim("鬱", "§3.3 鬱 is a whole piece", check=_types("NORMAL")),
    ResearchClaim("\t", "§5.2 tab is USER_DEFINED piece 255968", (255968,), check=_types("USER_DEFINED")),
)

GEMMA2_CLAIMS = (
    ResearchClaim("台灣台南", "§3.3 Gemma 1/2 (Gemini 1.x) 台灣|台南", (40911, 139274), ((0, 6), (6, 12))),
    ResearchClaim(
        "東京都渋谷区", "§5.3 Gemma 1/2 東京都|渋谷|区", (98973, 101041, 236149), ((0, 9), (9, 15), (15, 18))
    ),
    ResearchClaim("\t", "§5.2 tab is BYTE piece 226 in Gemma 1/2", (226,), ((0, 1),), check=_types("BYTE")),
)

GROK1_CLAIMS = (
    ResearchClaim(
        "台灣台南",
        "§5.3 ▁(0 B)|台|E7|81|A3|台|南",
        (130089, 130876, 300, 198, 232, 130876, 130899),
        ((0, 0), (0, 3), (3, 4), (4, 5), (5, 6), (6, 9), (9, 12)),
    ),
    ResearchClaim(
        "Hello, world! The quick brown fox.",
        "§5.3 Hello, world! The quick brown fox.",
        (11770, 130111, 1135, 130166, 422, 2057, 6708, 24277, 130109),
    ),
    ResearchClaim("Hello world!", "§3.5 Grok-1 on the xAI docs example", (11770, 1135, 130166)),
    ResearchClaim(
        "東京都渋谷区のラーメン屋さん",
        "§5.3 13 tokens; 渋谷 = 6 byte pieces; ラー, メン, さん whole",
        check=lambda t: (
            len(t) == 13
            and sum(x["type"] == "BYTE" for x in t) == 6
            and {"ラー", "メン", "さん"} <= {x["piece"] for x in t}
        ),
    ),
)


def _check_claims(
    label: str,
    claims: Sequence[ResearchClaim],
    encode: Callable[[str], list[int]],
    align: Callable[[str, list[int]], list[dict[str, Any]]],
) -> list[str]:
    """Return a description of every research claim the oracle does not reproduce."""
    problems: list[str] = []
    for claim in claims:
        ids = encode(claim.text)
        tokens = align(claim.text, ids)
        spans = tuple((t["start"], t["end"]) for t in tokens)
        ok = (claim.ids is None or tuple(ids) == claim.ids) and (claim.spans is None or spans == claim.spans)
        if claim.check is not None:
            ok = ok and claim.check(tokens)
        if not ok:
            problems.append(f"{label}: research claim {claim.claim!r} not reproduced: ids={ids} spans={list(spans)}")
    return problems


def _require(problems: list[str]) -> None:
    """Raise one error listing every problem, if there are any."""
    if problems:
        raise SentencePieceFixtureError("\n".join(problems))


# --------------------------------------------------------------------------
# google-gemma4: HF tokenizers on tokenizer.json, cross-checked by sentencepiece
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Gemma4Vocab:
    """Gemma 4 piece strings and types, indexed by id.

    Gemma 4 ships no ``.model``, so piece types come from the Gemma 3 proto,
    which has the same 262,144 slots: an id whose piece text is identical takes
    the Gemma 3 type; an id Gemma 4 renamed (all USER_DEFINED in Gemma 3) is
    CONTROL when Gemma 4 declares it a special added token, else USER_DEFINED.
    """

    pieces: tuple[str, ...]
    types: tuple[str, ...]
    renamed: tuple[int, ...]
    added: dict[int, Any]

    @classmethod
    def build(cls, tok: Tokenizer, gemma3: SpModel) -> Gemma4Vocab:
        """Derive the vocabulary and check it against the Gemma 3 layout."""
        size = tok.get_vocab_size(with_added_tokens=True)
        if size != len(gemma3.pieces):
            raise SentencePieceFixtureError(f"Gemma 4 has {size} ids, Gemma 3 {len(gemma3.pieces)}")
        added = tok.get_added_tokens_decoder()
        pieces = tuple(tok.id_to_token(i) for i in range(size))
        types: list[str] = []
        renamed: list[int] = []
        for i, piece in enumerate(pieces):
            if piece == gemma3.pieces[i]:
                types.append(gemma3.types[i])
                continue
            if gemma3.types[i] != "USER_DEFINED":
                raise SentencePieceFixtureError(f"Gemma 4 renamed non-USER_DEFINED Gemma 3 id {i}")
            renamed.append(i)
            types.append("CONTROL" if i in added and added[i].special else "USER_DEFINED")
        for value in range(256):
            if tok.token_to_id(f"<0x{value:02X}>") != gemma3.first_byte_id + value:
                raise SentencePieceFixtureError(f"Gemma 4 byte piece <0x{value:02X}> is not at the Gemma 3 id")
        return cls(pieces, tuple(types), tuple(renamed), dict(added))


def _gemma_disagreement(text: str, gemma3: SpModel, vocab: Gemma4Vocab, tok: Tokenizer) -> str:
    """Explain why sentencepiece (Gemma 3) and HF tokenizers (Gemma 4) differ on ``text``.

    Only literal special-token strings may cause a disagreement: a Gemma 3
    USER_DEFINED piece written in the text is matched atomically by
    SentencePiece, while Gemma 4 either lacks that string or declares it a
    special added token (plain text under ``encode_special_tokens``).
    Raises if no such string explains the difference.
    """
    reasons: list[str] = []
    for literal in sorted(set(_MARKUP.findall(text))):
        g3_id = gemma3.piece_id(literal)
        if g3_id is None or gemma3.types[g3_id] != "USER_DEFINED":
            continue
        g4_id = tok.token_to_id(literal)
        head = (
            f"{literal!r} is USER_DEFINED piece {g3_id} in the Gemma 3 model, which SentencePiece"
            " always matches as one atomic token; "
        )
        if g4_id is None:
            tail = (
                f"Gemma 4 renamed id {g3_id} to {vocab.pieces[g3_id]!r} and has no {literal!r} entry,"
                " so HF tokenizers BPE-encodes the string as ordinary text"
            )
        elif g4_id in vocab.added and vocab.added[g4_id].special:
            tail = (
                f"Gemma 4 declares it (id {g4_id}) a special:true added token, which"
                " encode_special_tokens=True treats as ordinary text"
            )
        else:
            tail = f"in Gemma 4 it is plain vocabulary entry {g4_id}, which no BPE merge path reaches"
        reasons.append(head + tail)
    if not reasons:
        raise SentencePieceFixtureError(f"unexplained Gemma 3/Gemma 4 disagreement on {text!r}")
    return "; ".join(reasons) + "."


def build_gemma4(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Fixture for ``google-gemma4`` (HF tokenizers; sentencepiece cross-check)."""
    tok_sha = common.vocab_sha256(GEMMA4_ASSET, GEMMA4_FILE)
    spm_sha = common.vocab_sha256(GEMMA3_ASSET, GEMMA3_FILE)
    gemma3 = SpModel.load(raw_path(GEMMA3_ASSET, GEMMA3_FILE))
    tok = Tokenizer.from_file(str(raw_path(GEMMA4_ASSET, GEMMA4_FILE)))
    sp = spm.SentencePieceProcessor(model_file=str(raw_path(GEMMA3_ASSET, GEMMA3_FILE)))
    vocab = Gemma4Vocab.build(tok, gemma3)
    if gemma3.add_dummy_prefix or tok.normalizer.normalize_str(" a b") != "▁a▁b":
        raise SentencePieceFixtureError("Gemma normaliser is not Replace(' ', '▁') without a dummy prefix")

    def encode(text: str, *, as_text: bool = True) -> list[int]:
        tok.encode_special_tokens = as_text
        return tok.encode(text, add_special_tokens=False).ids

    def align(text: str, ids: list[int]) -> list[dict[str, Any]]:
        return align_tokens(text, ids, vocab.pieces, vocab.types, gemma3.first_byte_id, False)

    _require(_check_claims(GEMMA4_ASSET, GEMMA4_CLAIMS, encode, align))
    out_cases: list[dict[str, Any]] = []
    disagreements: list[dict[str, Any]] = []
    with_specials: list[str] = []
    for case in cases:
        name, text = case["name"], case["text"]
        ids = encode(text)
        entry = _case(name, text, ids, align(text, ids))
        matched = encode(text, as_text=False)
        if matched != ids:
            entry["idsWithSpecials"] = matched
            with_specials.append(name)
        cross = sp.encode(text, add_bos=False, add_eos=False)
        if cross != ids:
            disagreements.append(
                {
                    "crossCheckIds": cross,
                    "explanation": _gemma_disagreement(text, gemma3, vocab, tok),
                    "ids": ids,
                    "name": name,
                }
            )
        out_cases.append(entry)
    return {
        "cases": out_cases,
        "crossCheck": {
            "agreedCases": len(cases) - len(disagreements),
            "disagreedCases": [d["name"] for d in disagreements],
            "disagreements": disagreements,
            "library": "sentencepiece",
            "version": common.library_version("sentencepiece"),
            "vocabAsset": GEMMA3_ASSET,
            "vocabSha256": spm_sha,
        },
        "family": FAMILY,
        "generatedOn": common.GENERATED_ON,
        "lab": "Google DeepMind",
        "oracle": {"library": "tokenizers", "version": common.library_version("tokenizers")},
        "policy": {
            "addBos": False,
            "notes": _gemma4_notes(gemma3, vocab, with_specials),
            "specialTokens": "as-text",
        },
        "tokenizer": GEMMA4_ASSET,
        "vocabAsset": GEMMA4_ASSET,
        "vocabSha256": tok_sha,
    }


def _gemma4_notes(gemma3: SpModel, vocab: Gemma4Vocab, with_specials: list[str]) -> str:
    """Describe the special-token, cross-check and alignment policy for Gemma 4."""
    specials = ", ".join(f"{t.content} {i}" for i, t in sorted(vocab.added.items()) if t.special)
    n_plain = sum(not t.special for t in vocab.added.values())
    tab_id = vocab.pieces.index("\t")
    return " ".join(
        [
            f"Oracle: HF tokenizers {common.library_version('tokenizers')} on {GEMMA4_ASSET}/{GEMMA4_FILE},"
            " Tokenizer.encode(text, add_special_tokens=False) with Tokenizer.encode_special_tokens=True."
            " No BOS: add_special_tokens=False, and Gemma 4's post_processor adds nothing anyway.",
            f"The JSON declares {len(vocab.added)} added tokens, {n_plain} of them special:false; the"
            f" special:true ones are {specials}. encode_special_tokens=True stops HF from matching any"
            " special:true added token in the input, so literal '<bos>' or '<|think|>' text is BPE-encoded"
            " like other text, the same way SentencePiece never matches CONTROL pieces.",
            "Because Gemma 4 has no special:false added tokens, nothing is matched ahead of BPE: the strings"
            f" that are USER_DEFINED pieces in the Gemma 3 model (newline runs, the tab character = id {tab_id},"
            " U+2581 runs for space runs, HTML-like tags) are ordinary vocab entries in tokenizer.json, and BPE"
            " merges still produce newline, tab and space runs as single tokens (checked against SentencePiece"
            " on every corpus case).",
            "idsWithSpecials is the result with encode_special_tokens=False (special:true added tokens matched),"
            f" present only where it differs: {', '.join(with_specials) or 'no case'}.",
            f"Cross-check: sentencepiece {common.library_version('sentencepiece')} on"
            f" {GEMMA3_ASSET}/{GEMMA3_FILE}, encode(text, add_bos=False, add_eos=False). Ids must agree"
            " except on literal special-token strings; crossCheck.disagreements explains each difference.",
            f"Gemma 3 model proto (Gemma 4 ships none; same vocabulary): {gemma3.describe()}",
            "Token 'type': the Gemma 3 proto piece type where the Gemma 4 piece text is identical"
            f" ({len(vocab.pieces) - len(vocab.renamed)} ids). For the {len(vocab.renamed)} ids that Gemma 4"
            " renamed (all USER_DEFINED in Gemma 3) it is CONTROL for special added tokens, else USER_DEFINED.",
            "Byte spans: research section 5.2 cursor walk. A BYTE piece covers the one byte id -"
            f" {gemma3.first_byte_id}; other pieces cover their UTF-8 text, with each U+2581 matching a 0x20"
            " space or a literal U+2581 (E2 96 81) at the cursor. add_dummy_prefix=false, so no token is"
            " zero-width.",
        ]
    )


# --------------------------------------------------------------------------
# xai-grok1: sentencepiece on tokenizer.model, cross-checked by spm_bpe_ref
# --------------------------------------------------------------------------


def _build_spm(
    asset: str,
    file_name: str,
    lab: str,
    claims: Sequence[ResearchClaim],
    notes: Callable[[SpModel], str],
    special_tokens: str,
    cases: list[dict[str, Any]],
    first_byte_id: int | None = None,
) -> dict[str, Any]:
    """Fixture from ``sentencepiece`` on a ``.model``, cross-checked by :mod:`spm_bpe_ref`.

    ``first_byte_id``, when given, is the research value the BYTE range derived
    from the piece types must start at.
    """
    sha = common.vocab_sha256(asset, file_name)
    path = raw_path(asset, file_name)
    model = SpModel.load(path)
    if first_byte_id is not None and model.first_byte_id != first_byte_id:
        raise SentencePieceFixtureError(f"{asset}: BYTE pieces start at {model.first_byte_id}, not {first_byte_id}")
    sp = spm.SentencePieceProcessor(model_file=str(path))
    reference = SpmBpeReference(model.proto)
    if [sp.id_to_piece(i) for i in range(sp.get_piece_size())] != list(model.pieces):
        raise SentencePieceFixtureError("sentencepiece and the parsed proto disagree on piece strings")

    def encode(text: str) -> list[int]:
        return sp.encode(text, add_bos=False, add_eos=False)

    def align(text: str, ids: list[int]) -> list[dict[str, Any]]:
        return align_tokens(text, ids, model.pieces, model.types, model.first_byte_id, model.add_dummy_prefix)

    _require(_check_claims(asset, claims, encode, align))
    out_cases: list[dict[str, Any]] = []
    disagreed: list[str] = []
    for case in cases:
        name, text = case["name"], case["text"]
        ids = encode(text)
        out_cases.append(_case(name, text, ids, align(text, ids)))
        if reference.encode(text) != ids:
            disagreed.append(name)
    _require([f"{asset}: spm_bpe_ref disagrees with sentencepiece on {n}" for n in disagreed])
    return {
        "cases": out_cases,
        "crossCheck": {
            "agreedCases": len(cases) - len(disagreed),
            "disagreedCases": disagreed,
            "library": "tools/oracle/oracles/spm_bpe_ref.py (pure-Python SentencePiece BPE)",
            "version": REFERENCE_VERSION,
        },
        "family": FAMILY,
        "generatedOn": common.GENERATED_ON,
        "lab": lab,
        "oracle": {"library": "sentencepiece", "version": common.library_version("sentencepiece")},
        "policy": {"addBos": False, "notes": notes(model), "specialTokens": special_tokens},
        "tokenizer": asset,
        "vocabAsset": asset,
        "vocabSha256": sha,
    }


def build_grok1(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Fixture for ``xai-grok1`` (sentencepiece; pure-Python reference cross-check)."""
    return _build_spm(GROK1_ASSET, GROK1_FILE, "xAI", GROK1_CLAIMS, _grok1_notes, "as-text", cases)


def _grok1_notes(model: SpModel) -> str:
    """Describe the special-token, dummy-prefix and alignment policy for Grok-1."""
    reserved = ", ".join(f"{model.pieces[i]} {i}" for i in model.ids_of_type("CONTROL") + model.ids_of_type("UNK"))
    user_defined = model.ids_of_type("USER_DEFINED")
    named = ", ".join(f"{model.pieces[i]} {i}" for i in user_defined if _MARKUP.fullmatch(model.pieces[i]))
    spaced = [i for i in user_defined if " " in model.pieces[i]]
    bare_mark = model.piece_id(SP_MARK)
    return " ".join(
        [
            f"Oracle: sentencepiece {common.library_version('sentencepiece')} on {GROK1_ASSET}/{GROK1_FILE},"
            " encode(text, add_bos=False, add_eos=False).",
            f"Model proto: {model.describe()}",
            "Special tokens: SentencePiece has no switch. It never matches CONTROL or UNK pieces in input"
            f" text ({reserved}) and always matches the {len(user_defined)} USER_DEFINED pieces (ids"
            f" {_id_ranges(user_defined)}: newline runs, digits 0-9, tab runs, space runs, {named}). The"
            f" space-run pieces (ids {_id_ranges(spaced)}) contain U+0020 and can never match, because"
            " escape_whitespaces rewrites every space to U+2581 before matching. No corpus special-token"
            " string is a Grok-1 piece, so the policy is as-text and idsWithSpecials is never emitted.",
            "add_dummy_prefix=true: SentencePiece prepends one U+2581 to every non-empty input. It is always"
            " the first character of the first piece and covers zero bytes. When the first piece is the bare"
            f" U+2581 (id {bare_mark}) the token is zeroWidth with start == end == 0; when it is fused (for"
            " example U+2581 + 'Hello', or four U+2581 for three leading spaces) only the remaining characters"
            " consume input bytes. The dummy is skipped unconditionally, never by testing for a space at the"
            " cursor, so leading spaces in the input stay covered (research section 5.2 case b). The empty"
            " string encodes to no tokens.",
            "Byte spans: research section 5.2 cursor walk. A BYTE piece (ids"
            f" {model.first_byte_id}..{model.first_byte_id + 255}, from the proto piece types) covers the one"
            f" byte id - {model.first_byte_id}; other pieces cover their UTF-8 text, with each U+2581 matching a"
            " 0x20 space or a literal U+2581 (E2 96 81) at the cursor.",
            "Cross-check: tools/oracle/oracles/spm_bpe_ref.py re-implements SentencePiece BPE encoding in pure"
            " Python (no code shared with the library) and must reproduce every case.",
        ]
    )


# --------------------------------------------------------------------------
# google-gemma2: sentencepiece on the Gemma 1/2 tokenizer.model, cross-checked by spm_bpe_ref
# --------------------------------------------------------------------------


def build_gemma2(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Fixture for ``google-gemma2`` (sentencepiece; pure-Python reference cross-check)."""
    return _build_spm(
        GEMMA2_ASSET,
        GEMMA2_FILE,
        "Google DeepMind",
        GEMMA2_CLAIMS,
        _gemma2_notes,
        "user-defined-atomic",
        cases,
        first_byte_id=GEMMA2_FIRST_BYTE_ID,
    )


def _gemma2_notes(model: SpModel) -> str:
    """Describe the special-token, dummy-prefix and alignment policy for Gemma 1/2."""
    reserved = ", ".join(f"{model.pieces[i]} {i}" for i in model.ids_of_type("CONTROL") + model.ids_of_type("UNK"))
    user_defined = model.ids_of_type("USER_DEFINED")
    markup = [i for i in user_defined if _MARKUP.fullmatch(model.pieces[i])]
    unused = [i for i in markup if model.pieces[i].startswith("<unused")]
    named = ", ".join(
        f"{model.pieces[i]} {i}"
        for i in markup
        if i not in unused and not re.fullmatch(r"</?[a-z0-9]+>", model.pieces[i])
    )
    html = [i for i in markup if re.fullmatch(r"</?[a-z0-9]+>", model.pieces[i]) and i not in unused]
    tab_runs = [i for i in user_defined if set(model.pieces[i]) == {"\t"}]
    tab_byte = model.first_byte_id + 0x09
    return " ".join(
        [
            f"Oracle: sentencepiece {common.library_version('sentencepiece')} on {GEMMA2_ASSET}/{GEMMA2_FILE},"
            " encode(text, add_bos=False, add_eos=False). This is the Gemma 1/2 256k tokenizer that the Vertex AI"
            " SDK local tokenizer (vertexai/tokenization/_tokenizer_loading.py) pins, at the same commit and"
            " sha256, for gemini-1.0-pro and gemini-1.5-pro/flash; Gemini 2.0+ use the 262k Gemma 3/4 vocabulary"
            " instead (google-gemma4).",
            f"Model proto: {model.describe()}",
            "Special tokens: SentencePiece has no switch. It never matches CONTROL or UNK pieces in input text"
            f" ({reserved}), so a literal '<bos>' is encoded as ordinary text. It always matches each of the"
            f" {len(user_defined)} USER_DEFINED pieces (ids {_id_ranges(user_defined)}) as one atomic token:"
            f" newline runs, U+2581 runs, tab runs (ids {_id_ranges(tab_runs)}, 2 or more tabs),"
            f" {len(unused)} <unusedN> slots, {len(html)} HTML tags such as <table> and </code>, and {named}."
            " Because the chat-turn markers <start_of_turn> and <end_of_turn> are USER_DEFINED, the corpus case"
            " special-start-of-turn begins with id 106; that is why specialTokens is user-defined-atomic rather"
            " than as-text. The library has no other mode, so idsWithSpecials is never emitted.",
            "add_dummy_prefix=false: nothing is prepended, so no token is zero-width, and a leading space is"
            " covered by an ordinary U+2581 piece (alone or fused with the following text).",
            "Byte spans: research section 5.2 cursor walk. A BYTE piece (ids"
            f" {model.first_byte_id}..{model.first_byte_id + 255}, derived from the proto piece types and asserted"
            f" to equal research sections 3.3/5.2) covers the one byte id - {model.first_byte_id}; other pieces"
            " cover their UTF-8 text, with each U+2581 matching a 0x20 space or a literal U+2581 (E2 96 81) at the"
            " cursor.",
            f"Tab: a single tab has no piece of its own and falls back to BYTE id {tab_byte}"
            f" ({model.pieces[tab_byte]}). Port caveat (research section 5.2): the Hugging Face tokenizer.json for"
            f" Gemma 1/2 keys byte id {tab_byte} as a literal tab character instead of <0x09>, so a JSON-based port"
            f" must take a BYTE token's value from its id (id - {model.first_byte_id}), never from its piece string."
            " This fixture reads the .model, where the piece is <0x09>, so it is unaffected.",
            "Cross-check: tools/oracle/oracles/spm_bpe_ref.py re-implements SentencePiece BPE encoding in pure"
            " Python (no code shared with the library) and must reproduce every case.",
        ]
    )


#: Tokenizer id -> fixture builder (the registry read by ``gen_fixtures.py``).
TOKENIZERS: dict[str, Callable[[list[dict[str, Any]]], dict[str, Any]]] = {
    GEMMA2_ASSET: build_gemma2,
    GEMMA4_ASSET: build_gemma4,
    GROK1_ASSET: build_grok1,
}
