"""Golden fixtures for the byte-level BPE (tiktoken-format) family.

Oracle: Python tiktoken 0.14.0. One builder per tokenizer (see
:data:`TOKENIZERS`); each returns a fixture document as described in
:mod:`oracles.common`. For every case the builder

* encodes with ``Encoding.encode_ordinary`` (special-token strings are text)
  and, only where the result differs, records ``encode(text,
  allowed_special="all")`` as ``idsWithSpecials``;
* takes token bytes from ``decode_single_token_bytes`` (never from decoded
  strings, which lose partial UTF-8);
* splits the text with ``regex.finditer(pat_str)`` into byte-span ``chunks``;
* re-encodes every chunk with :mod:`oracles.bpe_reference` and **raises** if
  it disagrees with tiktoken, recording the merge steps.

Research anchors (ids quoted in docs/research/01-tokenizers-and-platform.md
sections 3 and 5.3) are asserted too, so a silent drift fails the generator.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import tempfile
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

import regex
import tiktoken
from tiktoken.load import load_tiktoken_bpe
from tokenizers import Regex, Tokenizer
from tokenizers.pre_tokenizers import Split

from oracle_lib.paths import raw_path

from . import common
from .bpe_reference import byte_pair_merge, encode_chunk

FAMILY = "tiktoken-bpe"

#: meta-llama/llama-models ``models/llama3/tokenizer.py`` ``Tokenizer.pat_str``
#: (equal to the pre-0.8.0 cl100k_base pattern; asserted equal to the Split
#: regex in Xenova/llama3-tokenizer's tokenizer.json below).
LLAMA3_PAT_STR = (
    r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}"
    r"| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+"
)
#: SGLang ``tiktoken_tokenizer.py`` ``PAT_STR_B``: the pattern for Grok-2's
#: ``word_split: "V1"`` (like LLAMA3_PAT_STR but every digit is its own chunk).
GROK2_V1_PAT_STR = (
    r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}"
    r"| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+"
)

#: Plain-text cases on which o200k_harmony must equal o200k_base.
HARMONY_CHECK_CASES = (
    "zh-tw-tainan",
    "ja-text",
    "en-hello-world",
    "mixed-hello-taiwan-tokyo",
    "en-contraction-code",
    "emoji-family-zwj",
    "bopomofo",
    "zh-tw-paragraph",
    "ja-paragraph",
    "en-paragraph",
)

#: Expected ids from the research report (section 5.3 and the per-lab hands-on notes).
RESEARCH_ANCHORS: dict[str, dict[str, list[int]]] = {
    "openai-o200k_base": {
        "台灣台南": [3735, 133072, 3735, 14609],
        "日本語のテキスト": [9048, 40909, 3385, 16056, 18368, 38236],
        "Hello, world!": [13225, 11, 2375, 0],
    },
    "openai-cl100k_base": {
        "台灣台南": [55038, 66285, 96, 55038, 59563],
        "日本語のテキスト": [9080, 22656, 45918, 252, 16144, 57933, 62903, 71634],
        "Hello, world!": [9906, 11, 1917, 0],
    },
    "meta-llama4-muse": {
        "台灣台南": [85838, 8569, 7499],
        "日本語のトークン化": [21764, 16728, 1169, 3697, 26965, 2113, 3792],
        "Hello, world!": [19873, 24, 3817, 13],
        " \U0001f44d": [138200],
    },
    "meta-llama3": {
        "台灣台南": [117342, 55038, 59563],
        "日本語のトークン化": [102433, 102158, 16144, 20251, 105048, 16073, 33208],
        "Hello, world!": [9906, 11, 1917, 0],
    },
    "xai-grok2": {
        "台灣台南": [15721, 7489, 291, 15721, 12048],
        "東京都渋谷区のラーメン屋さん": [120316, 5626, 267, 27850, 12029, 1741, 5889, 4242, 289, 2917, 23210, 48398],
        "Hello world!": [13902, 1749, 161],  # docs.x.ai /v1/tokenize-text example
        "Hello, world! The quick brown fox.": [13902, 172, 1749, 161, 547, 3139, 9883, 36497, 174],
    },
    "anthropic-claude-legacy": {
        "台灣台南": [28984, 36261, 101, 28984, 21422],
        "日本語のトークン化": [12956, 12163, 23598, 257, 6211, 15337, 20094, 112, 14171, 12838],
        "Hello, world!": [10002, 16, 2253, 5],
    },
}

_COMMON_NOTES = (
    "ids = tiktoken Encoding.encode_ordinary(text): special-token strings are encoded as plain text; "
    "idsWithSpecials = encode(text, allowed_special='all'), present only where it differs. No BOS/EOS. "
    "tokens[].bytes = decode_single_token_bytes(id). chunks = regex.finditer(pat_str, text) as UTF-8 byte spans. "
    "merges: one entry per chunk from tools/oracle/oracles/bpe_reference.py (a port of tiktoken's "
    "_byte_pair_merge, asserted equal to tiktoken on every chunk); steps are [position, rank], where position "
    "is the index of the left part in the current part list (parts start as single bytes) and rank is the "
    "rank (= token id) of the merged bytes; directHit means the whole chunk is a vocabulary entry and is "
    "emitted without merging (steps = [])."
)


# --------------------------------------------------------------------------- loading


def _seed_tiktoken_cache() -> None:
    """Point tiktoken at a cache pre-filled from data/vocab/raw so get_encoding works offline.

    tiktoken keys its cache by ``sha1(url)`` and re-verifies the expected
    SHA-256 on every read, so a seeded file can only be used if it is the
    exact upstream file. A user-provided TIKTOKEN_CACHE_DIR/DATA_GYM_CACHE_DIR
    is left untouched.
    """
    if "TIKTOKEN_CACHE_DIR" in os.environ or "DATA_GYM_CACHE_DIR" in os.environ:
        return
    cache_dir = Path(tempfile.gettempdir()) / "tokenize-step-by-step" / "tiktoken-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    for asset, name in (("openai-o200k_base", "o200k_base.tiktoken"), ("openai-cl100k_base", "cl100k_base.tiktoken")):
        url = f"https://openaipublic.blob.core.windows.net/encodings/{name}"
        target = cache_dir / hashlib.sha1(url.encode()).hexdigest()
        source = raw_path(asset, name)
        if source.exists() and not target.exists():
            shutil.copyfile(source, target)
    os.environ["TIKTOKEN_CACHE_DIR"] = str(cache_dir)


def _openai_encoding(name: str, asset: str, file_name: str) -> tiktoken.Encoding:
    """``tiktoken.get_encoding(name)``, asserting its ranks equal the shipped asset file."""
    _seed_tiktoken_cache()
    enc = tiktoken.get_encoding(name)
    sha = common.vocab_sha256(asset, file_name)
    shipped = load_tiktoken_bpe(str(raw_path(asset, file_name)), expected_hash=sha)
    if shipped != enc._mergeable_ranks:
        raise AssertionError(f"{asset}/{file_name} ranks differ from tiktoken.get_encoding({name!r})")
    return enc


def _load_json(asset: str, file_name: str) -> dict:
    """Parse a raw vocabulary JSON file."""
    return json.loads(raw_path(asset, file_name).read_text(encoding="utf-8"))


def _bytes_to_unicode() -> dict[int, str]:
    """GPT-2's byte -> printable-character table used by HF ByteLevel vocabularies."""
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return dict(zip(bs, map(chr, cs), strict=True))


def _hf_vocab_as_bytes(tokenizer_json: dict) -> dict[bytes, int]:
    """HF ByteLevel ``model.vocab`` with each token string mapped back to raw bytes."""
    inverse = {ch: b for b, ch in _bytes_to_unicode().items()}
    return {bytes(inverse[ch] for ch in tok): tid for tok, tid in tokenizer_json["model"]["vocab"].items()}


def _hf_split_regex(tokenizer_json: dict) -> str:
    """The Split pre-tokenizer regex of an HF tokenizer.json (Sequence[Split, ByteLevel])."""
    for pre in tokenizer_json["pre_tokenizer"]["pretokenizers"]:
        if pre["type"] == "Split":
            return pre["pattern"]["Regex"]
    raise ValueError("no Split pre-tokenizer")


def _hf_specials(tokenizer_json: dict) -> dict[str, int]:
    """``added_tokens`` of an HF tokenizer.json as ``{content: id}``."""
    return {t["content"]: t["id"] for t in tokenizer_json["added_tokens"]}


# --------------------------------------------------------------------------- encoding


@dataclass
class _Stats:
    """Counters gathered while encoding a fixture (reported in the notes)."""

    direct_hits: int = 0
    unreachable: int = 0  # direct hits that merging alone would not reproduce


def _encode_case(
    enc: tiktoken.Encoding, ranks: Mapping[bytes, int], pattern: regex.Pattern, name: str, text: str, stats: _Stats
) -> dict:
    """Build one fixture case, asserting the reference BPE equals tiktoken on every chunk."""
    data = text.encode("utf-8")
    offsets = common.char_byte_offsets(text)
    ids = enc.encode_ordinary(text)
    chunks: list[list[int]] = []
    merges: list[dict] = []
    reference_ids: list[int] = []
    for index, match in enumerate(pattern.finditer(text)):
        start, end = offsets[match.start()], offsets[match.end()]
        piece = data[start:end]
        result = encode_chunk(ranks, piece)
        native = enc._encode_single_piece(piece)
        if result.ids != native:
            raise AssertionError(
                f"{enc.name}/{name} chunk {index} {piece!r}: reference {result.ids} != tiktoken {native}"
            )
        if result.direct_hit and len(piece) > 1:
            stats.direct_hits += 1
            boundaries, _ = byte_pair_merge(ranks, piece)
            stats.unreachable += len(boundaries) != 2
        chunks.append([start, end])
        merges.append({"chunk": index, "directHit": result.direct_hit, "steps": [list(s) for s in result.steps]})
        reference_ids += result.ids
    if reference_ids != ids:
        raise AssertionError(f"{enc.name}/{name}: chunk-wise reference ids {reference_ids} != encode_ordinary {ids}")
    tokens = []
    pos = 0
    for token_id in ids:
        token_bytes = enc.decode_single_token_bytes(token_id)
        tokens.append(common.token_entry(token_id, token_bytes, pos))
        pos += len(token_bytes)
    case = {
        "chunks": chunks,
        "ids": ids,
        "merges": merges,
        "name": name,
        "text": text,
        "tokens": tokens,
        "utf8Len": len(data),
    }
    with_specials = enc.encode(text, allowed_special="all")
    if with_specials != ids:
        case["idsWithSpecials"] = with_specials
    return case


def _oniguruma_disagreements(pat_str: str, cases: list[dict]) -> list[str]:
    """Names of cases where HF tokenizers' Split (Oniguruma) chunks differ from Python ``regex``."""
    split = Split(Regex(pat_str), behavior="isolated")
    pattern = regex.compile(pat_str)
    return [
        c["name"]
        for c in cases
        if [piece for piece, _ in split.pre_tokenize_str(c["text"])] != pattern.findall(c["text"])
    ]


def _assert_anchors(tokenizer_id: str, enc: tiktoken.Encoding) -> None:
    """Fail loudly if any research-report anchor encodes differently."""
    for text, expected in RESEARCH_ANCHORS[tokenizer_id].items():
        got = enc.encode_ordinary(text)
        if got != expected:
            raise AssertionError(f"{tokenizer_id}: {text!r} -> {got}, research report says {expected}")


def _reference_cross_check(cases: list[dict]) -> dict:
    """crossCheck block for tokenizers verified only by the reference BPE (fatal on mismatch)."""
    return {
        "agreedCases": len(cases),
        "disagreedCases": [],
        "library": "oracles.bpe_reference + regex (pure-Python port of tiktoken _byte_pair_merge)",
        "version": common.library_version("regex"),
    }


def _hf_cross_check(tokenizer_path: Path, enc: tiktoken.Encoding, cases: list[dict]) -> dict:
    """Compare HF tokenizers ids with tiktoken on every case; raise on any disagreement.

    Plain ids use ``encode_special_tokens=True`` (special strings stay text);
    ``idsWithSpecials`` uses ``encode_special_tokens=False``. Both pass
    ``add_special_tokens=False`` (no BOS).
    """
    tok = Tokenizer.from_file(str(tokenizer_path))
    disagreed = []
    for case in cases:
        text = case["text"]
        tok.encode_special_tokens = True
        plain = tok.encode(text, add_special_tokens=False).ids
        tok.encode_special_tokens = False
        matched = tok.encode(text, add_special_tokens=False).ids
        if plain != enc.encode_ordinary(text) or matched != enc.encode(text, allowed_special="all"):
            disagreed.append(case["name"])
    if disagreed:
        raise AssertionError(f"{enc.name}: HF tokenizers disagrees with tiktoken on {disagreed}")
    return {
        "agreedCases": len(cases),
        "disagreedCases": disagreed,
        "library": "tokenizers",
        "version": common.library_version("tokenizers"),
    }


def _fixture(
    *,
    tokenizer_id: str,
    lab: str,
    enc: tiktoken.Encoding,
    vocab_asset: str,
    vocab_file: str,
    cases: list[dict],
    cross_check: dict,
    notes: str,
    extra_case_lists: Mapping[str, list[dict]] | None = None,
) -> dict:
    """Encode all cases and assemble the fixture document."""
    _assert_anchors(tokenizer_id, enc)
    ranks = enc._mergeable_ranks
    pattern = regex.compile(enc._pat_str)
    stats = _Stats()
    out_cases = [_encode_case(enc, ranks, pattern, c["name"], c["text"], stats) for c in cases]
    split_bad = _oniguruma_disagreements(enc._pat_str, cases)
    agree = f"{len(cases) - len(split_bad)}/{len(cases)}"
    notes += (
        f" Pre-tokenizer chunks from Python regex {common.library_version('regex')} agree with HF tokenizers "
        f"Split (Oniguruma) on {agree} cases" + (f" (differ: {', '.join(split_bad)})." if split_bad else ".")
    )
    notes += (
        f" {stats.direct_hits} multi-byte chunks are direct hits; merging alone would give a different result "
        f"for {stats.unreachable} of them."
    )
    doc = {
        "cases": out_cases,
        "crossCheck": cross_check,
        "family": FAMILY,
        "generatedOn": common.GENERATED_ON,
        "lab": lab,
        "oracle": {"library": "tiktoken", "version": common.library_version("tiktoken")},
        "policy": {"addBos": False, "notes": f"{_COMMON_NOTES} {notes}", "specialTokens": "as-text"},
        "tokenizer": tokenizer_id,
        "vocabAsset": vocab_asset,
        "vocabSha256": common.vocab_sha256(vocab_asset, vocab_file),
    }
    for key, extra in (extra_case_lists or {}).items():
        doc[key] = [_encode_case(enc, ranks, pattern, c["name"], c["text"], stats) for c in extra]
    return doc


# --------------------------------------------------------------------------- builders


def build_openai_o200k_base(cases: list[dict]) -> dict:
    """OpenAI o200k_base (GPT-4o / 4.1 / 5.x) via ``tiktoken.get_encoding``."""
    enc = _openai_encoding("o200k_base", "openai-o200k_base", "o200k_base.tiktoken")
    harmony = tiktoken.get_encoding("o200k_harmony")
    by_name = {c["name"]: c["text"] for c in cases}
    for name in HARMONY_CHECK_CASES:
        if harmony.encode_ordinary(by_name[name]) != enc.encode_ordinary(by_name[name]):
            raise AssertionError(f"o200k_harmony differs from o200k_base on {name}")
    notes = (
        "o200k_harmony (gpt-oss) gave identical encode_ordinary ids on the 10 plain-text cases "
        f"{', '.join(HARMONY_CHECK_CASES)}; it shares the ranks and pat_str and only adds special tokens."
    )
    return _fixture(
        tokenizer_id="openai-o200k_base",
        lab="OpenAI",
        enc=enc,
        vocab_asset="openai-o200k_base",
        vocab_file="o200k_base.tiktoken",
        cases=cases,
        cross_check=_reference_cross_check(cases),
        notes=notes,
    )


def build_openai_cl100k_base(cases: list[dict]) -> dict:
    """OpenAI cl100k_base (GPT-4 / GPT-3.5) via ``tiktoken.get_encoding``."""
    enc = _openai_encoding("cl100k_base", "openai-cl100k_base", "cl100k_base.tiktoken")
    legacy = tiktoken.Encoding(
        "cl100k_base-pre-0.8.0", pat_str=LLAMA3_PAT_STR, mergeable_ranks=enc._mergeable_ranks, special_tokens={}
    )
    current, old = regex.compile(enc._pat_str), regex.compile(LLAMA3_PAT_STR)
    chunk_diff = []
    for case in cases:
        if legacy.encode_ordinary(case["text"]) != enc.encode_ordinary(case["text"]):
            raise AssertionError(f"pre-0.8.0 cl100k pattern gives different ids on {case['name']}")
        if current.findall(case["text"]) != old.findall(case["text"]):
            chunk_diff.append(case["name"])
    onig_old = _oniguruma_disagreements(LLAMA3_PAT_STR, cases)
    notes = (
        "pat_str is tiktoken's current cl100k pattern (possessive quantifiers; invalid in JavaScript). The "
        "pre-0.8.0 pattern (= the Llama 3 pattern, used by js-tiktoken) gives identical ids on all "
        f"{len(cases)} cases but different chunks on {len(chunk_diff)} ({', '.join(chunk_diff) or 'none'}): the "
        "current pattern's \\s++$ keeps whitespace at the very end of the text as one chunk. Oniguruma (HF "
        "tokenizers) parses \\p{N}{1,3}+ as a nested greedy repeat, not a possessive one, so it keeps whole "
        "digit runs together; that is the cause of the Oniguruma differences reported below. With the pre-0.8.0 "
        f"pattern Oniguruma agrees with Python regex on {len(cases) - len(onig_old)}/{len(cases)} cases."
    )
    return _fixture(
        tokenizer_id="openai-cl100k_base",
        lab="OpenAI",
        enc=enc,
        vocab_asset="openai-cl100k_base",
        vocab_file="cl100k_base.tiktoken",
        cases=cases,
        cross_check=_reference_cross_check(cases),
        notes=notes,
    )


def build_meta_llama4_muse(cases: list[dict]) -> dict:
    """Meta Llama 4 / Muse 202k: Llama 4 ranks, o200k pattern, Muse Glimmer specials."""
    o200k = _openai_encoding("o200k_base", "openai-o200k_base", "o200k_base.tiktoken")
    glimmer = _load_json("meta-muse-glimmer", "tokenizer.json")
    if _hf_split_regex(glimmer) != o200k._pat_str:
        raise AssertionError("Muse Glimmer Split regex differs from tiktoken o200k_base pat_str")
    sha = common.vocab_sha256("meta-llama4-model", "tokenizer.model")
    ranks = load_tiktoken_bpe(str(raw_path("meta-llama4-model", "tokenizer.model")), expected_hash=sha)
    if sorted(ranks.values()) != list(range(200_000)):
        raise AssertionError("Llama 4 ranks are not exactly 0..199999")
    if _hf_vocab_as_bytes(glimmer) != ranks:
        raise AssertionError("Muse Glimmer vocab bytes differ from Llama 4 tokenizer.model ranks")
    specials = _hf_specials(glimmer)
    if sorted(specials.values()) != list(range(200_000, 202_048)):
        raise AssertionError("Muse Glimmer added_tokens are not exactly ids 200000..202047")
    enc = tiktoken.Encoding("llama4-muse", pat_str=o200k._pat_str, mergeable_ranks=ranks, special_tokens=specials)
    notes = (
        "Ranks from Llama 4 tokenizer.model (meta-llama4-model) loaded with tiktoken.load.load_tiktoken_bpe; "
        "all 200,000 rank byte strings are identical to Muse Glimmer tokenizer.json model.vocab (decoded via the "
        "GPT-2 bytes_to_unicode inverse map), so vocabAsset/vocabSha256 name the Apache-2.0 Glimmer file. pat_str "
        "is byte-identical to tiktoken o200k_base pat_str and to Glimmer's Split regex (asserted), and to "
        "llama-models llama4/tokenizer.py O200K_PATTERN. Special tokens for idsWithSpecials are Glimmer's 2,048 "
        "added_tokens (ids 200000-202047; names differ from Llama 4's). Cross-check: HF tokenizers on Glimmer "
        "tokenizer.json with add_special_tokens=False (BOS off) and encode_special_tokens=True for ids."
    )
    return _fixture(
        tokenizer_id="meta-llama4-muse",
        lab="Meta",
        enc=enc,
        vocab_asset="meta-muse-glimmer",
        vocab_file="tokenizer.json",
        cases=cases,
        cross_check=_hf_cross_check(raw_path("meta-muse-glimmer", "tokenizer.json"), enc, cases),
        notes=notes,
    )


def build_meta_llama3(cases: list[dict]) -> dict:
    """Meta Llama 3.x 128k: llama3 tokenizer.model ranks with the llama3 tokenizer.py pattern."""
    xenova = _load_json("meta-llama3-model", "xenova/tokenizer.json")
    if _hf_split_regex(xenova) != LLAMA3_PAT_STR:
        raise AssertionError("Xenova/llama3-tokenizer Split regex differs from llama3 tokenizer.py pat_str")
    sha = common.vocab_sha256("meta-llama3-model", "tokenizer.model")
    ranks = load_tiktoken_bpe(str(raw_path("meta-llama3-model", "tokenizer.model")), expected_hash=sha)
    if sorted(ranks.values()) != list(range(128_000)):
        raise AssertionError("Llama 3 ranks are not exactly 0..127999")
    if _hf_vocab_as_bytes(xenova) != ranks:
        raise AssertionError("Xenova/llama3-tokenizer vocab bytes differ from llama3 tokenizer.model ranks")
    specials = _hf_specials(xenova)
    enc = tiktoken.Encoding("llama3", pat_str=LLAMA3_PAT_STR, mergeable_ranks=ranks, special_tokens=specials)
    notes = (
        "Ranks from llama-models llama3/tokenizer.model; pat_str from llama3/tokenizer.py (the pre-0.8.0 cl100k "
        "pattern), byte-identical to the Split regex in Xenova/llama3-tokenizer tokenizer.json (asserted). All "
        "128,000 rank byte strings equal the Xenova vocab. Special tokens for idsWithSpecials are the Xenova "
        "(Llama 3.0) added_tokens, ids 128000-128255. Cross-check: HF tokenizers on Xenova tokenizer.json with "
        "add_special_tokens=False and encode_special_tokens=True for ids."
    )
    return _fixture(
        tokenizer_id="meta-llama3",
        lab="Meta",
        enc=enc,
        vocab_asset="meta-llama3-model",
        vocab_file="tokenizer.model",
        cases=cases,
        cross_check=_hf_cross_check(raw_path("meta-llama3-model", "xenova/tokenizer.json"), enc, cases),
        notes=notes,
    )


def build_xai_grok2(cases: list[dict]) -> dict:
    """xAI Grok-2 (Grok 2.5) from tokenizer.tok.json with the SGLang V1 pattern."""
    tok = _load_json("xai-grok2", "tokenizer.tok.json")
    if tok["word_split"] != "V1" or "pat_str" in tok:
        raise AssertionError("expected word_split V1 and no pat_str in tokenizer.tok.json")
    ranks = {bytes(t["bytes"]): t["token"] for t in tok["regular_tokens"]}
    specials = {bytes(t["bytes"]).decode("utf-8"): t["token"] for t in tok["special_tokens"]}
    enc = tiktoken.Encoding(
        "xai-grok2",
        pat_str=GROK2_V1_PAT_STR,
        mergeable_ranks=ranks,
        special_tokens=specials,
        explicit_n_vocab=tok["vocab_size"],
    )
    notes = (
        "Encoding built like SGLang's TiktokenTokenizer: mergeable_ranks = {bytes(t['bytes']): t['token']} for "
        "regular_tokens (ids 128-131071; rank = token id), special_tokens from special_tokens (ids 0-127), "
        "pat_str = SGLang PAT_STR_B for word_split 'V1' (single digits). Verified against the docs.x.ai "
        "/v1/tokenize-text example 'Hello world!' -> [13902, 1749, 161]."
    )
    return _fixture(
        tokenizer_id="xai-grok2",
        lab="xAI",
        enc=enc,
        vocab_asset="xai-grok2",
        vocab_file="tokenizer.tok.json",
        cases=cases,
        cross_check=_reference_cross_check(cases),
        notes=notes,
    )


def _claude_legacy_ranks(bpe_ranks: str) -> dict[bytes, int]:
    """Parse claude.json's ``bpe_ranks`` (tiktoken/lite format: ``! <offset> <b64> <b64> ...`` lines)."""
    ranks: dict[bytes, int] = {}
    for line in bpe_ranks.split("\n"):
        if not line:
            continue
        marker, offset, *tokens = line.split(" ")
        if marker != "!":
            raise ValueError(f"unexpected bpe_ranks line prefix {marker!r}")
        for i, b64 in enumerate(tokens):
            token = base64.b64decode(b64)
            if token in ranks:
                raise ValueError(f"duplicate rank bytes {token!r}")
            ranks[token] = int(offset) + i
    return ranks


def build_anthropic_claude_legacy(cases: list[dict]) -> dict:
    """Anthropic legacy Claude 1/2 vocabulary (archived @anthropic-ai/tokenizer 0.0.4), no NFKC."""
    data = _load_json("anthropic-claude-legacy", "claude.json")
    ranks = _claude_legacy_ranks(data["bpe_ranks"])
    if sorted(ranks.values()) != list(range(5, 65_000)):
        raise AssertionError("claude.json ranks are not exactly 5..64999")
    enc = tiktoken.Encoding(
        "claude-legacy", pat_str=data["pat_str"], mergeable_ranks=ranks, special_tokens=data["special_tokens"]
    )
    nfkc_cases = [
        {"name": c["name"], "text": unicodedata.normalize("NFKC", c["text"])}
        for c in cases
        if unicodedata.normalize("NFKC", c["text"]) != c["text"]
    ]
    notes = (
        "Loaded like the archived package's getTokenizer(): new Tiktoken(claude.bpe_ranks, claude.special_tokens, "
        "claude.pat_str); bpe_ranks is one '! 5 <base64> ...' line giving ranks 5-64999, specials <EOT>=0 ... "
        f"<SOS>=4. claude.json also declares explicit_n_vocab {data['explicit_n_vocab']}, which matches neither the "
        "64,995 ranks nor 65,000 ids; it is ignored here, as the archived package ignored it. NO NFKC: ids encode "
        "the raw text. The archived countTokens() applied text.normalize('NFKC') (and encode(..., 'all')) first; "
        f"the {len(nfkc_cases)} cases whose NFKC form differs are repeated under normalizedNFKC with text = "
        f"NFKC(text) (Python unicodedata, Unicode {unicodedata.unidata_version})."
    )
    return _fixture(
        tokenizer_id="anthropic-claude-legacy",
        lab="Anthropic",
        enc=enc,
        vocab_asset="anthropic-claude-legacy",
        vocab_file="claude.json",
        cases=cases,
        cross_check=_reference_cross_check(cases),
        notes=notes,
        extra_case_lists={"normalizedNFKC": nfkc_cases},
    )


#: tokenizer id -> builder(corpus cases) -> fixture document
TOKENIZERS: dict[str, Callable[[list[dict]], dict]] = {
    "anthropic-claude-legacy": build_anthropic_claude_legacy,
    "meta-llama3": build_meta_llama3,
    "meta-llama4-muse": build_meta_llama4_muse,
    "openai-cl100k_base": build_openai_cl100k_base,
    "openai-o200k_base": build_openai_o200k_base,
    "xai-grok2": build_xai_grok2,
}
