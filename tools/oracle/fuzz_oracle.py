"""Batch oracle for ``pnpm test:fuzz`` (docs/design/00-decisions.md PA-9, 04-engines.md section 7).

For every shipped tokenizer it encodes a list of strings exactly as the golden fixtures do (the fixture policy:
special-token strings are text, no BOS/EOS, no NFKC) and returns the ids and the per-token UTF-8 byte spans, plus
the ids of an independent Python cross-check where the fixture lane has one:

==========================  =========================================  =========================================
tokenizer                   oracle (ids + spans)                       cross-check (ids)
==========================  =========================================  =========================================
openai-o200k_base           tiktoken ``encode_ordinary``               --- (gpt-tokenizer in Node)
openai-cl100k_base          tiktoken ``encode_ordinary``               --- (gpt-tokenizer in Node)
meta-llama4-muse            tiktoken on the Llama 4 ranks              --- (@huggingface/tokenizers in Node)
meta-llama3                 tiktoken on the Llama 3 ranks              HF tokenizers on Xenova/llama3-tokenizer
xai-grok2                   tiktoken on tokenizer.tok.json             ``oracles.bpe_reference`` per regex chunk
anthropic-claude-legacy     tiktoken on claude.json (raw, no NFKC)     ``oracles.bpe_reference`` per regex chunk
google-gemma4               HF tokenizers on tokenizer.json            sentencepiece on the Gemma 3 .spiece.model
google-gemma2               sentencepiece on tokenizer.model           ``oracles.spm_bpe_ref``
xai-grok1                   sentencepiece on tokenizer.model           ``oracles.spm_bpe_ref``
==========================  =========================================  =========================================

The encoders are built with the same helpers as the fixture builders in ``oracles/`` (raw files from
``data/vocab/raw``, SHA-256 checked against the manifest); byte spans come from ``decode_single_token_bytes``
(tiktoken family) or the research section 5.2 cursor walk ``oracles.sentencepiece_family.align_tokens``.

Usage, from the repository root::

    uv run --project tools/oracle python tools/oracle/fuzz_oracle.py --input req.json --output res.json
    uv run --project tools/oracle python tools/oracle/fuzz_oracle.py --serve    # JSON lines on stdin/stdout

A request is ``{"<tokenizer-id>": ["text", ...], ...}``. The answer is ``{"results": {...}, "oracles": {...}}``:
``results`` has the request's keys, each a list with one result per text, ``{"ids": [...], "spans": [[start, end],
...], "cross": [...] | null, "crossNote": str | null}`` or ``{"error": "..."}`` when the oracle cannot encode the text;
``oracles`` names the library behind each tokenizer's answers and its cross-check. ``--serve`` prints ``{"ready":
true, "tokenizers": [...]}`` once, then answers each input line ``{"id": n, "texts": <request>}`` with one line
``{"id": n, "results": ..., "oracles": ...}`` (or ``{"id": n, "error": ...}``). All output is ASCII JSON, so the pipe
encoding never matters. The Node side is ``packages/core/test/fuzz/oracle-client.ts`` (``pnpm test:fuzz``).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

import regex
import sentencepiece as spm
import tiktoken
from tiktoken.load import load_tiktoken_bpe
from tokenizers import Tokenizer

from oracle_lib.paths import raw_path
from oracles import common
from oracles.bpe_reference import encode_chunk
from oracles.sentencepiece_family import (
    GEMMA2_ASSET,
    GEMMA2_FILE,
    GEMMA3_ASSET,
    GEMMA3_FILE,
    GEMMA4_ASSET,
    GEMMA4_FILE,
    GROK1_ASSET,
    GROK1_FILE,
    Gemma4Vocab,
    SentencePieceFixtureError,
    SpModel,
    _gemma_disagreement,
    align_tokens,
)
from oracles.spm_bpe_ref import SpmBpeReference
from oracles.tiktoken_family import (
    GROK2_V1_PAT_STR,
    LLAMA3_PAT_STR,
    _claude_legacy_ranks,
    _hf_specials,
    _load_json,
    _openai_encoding,
)

#: One encoded text: ids, spans and the cross-check (``None`` where there is none).
Result = dict[str, Any]


@dataclass(frozen=True)
class FuzzOracle:
    """The encoder of one tokenizer and a description of what produced its answers."""

    library: str
    cross_library: str | None
    encode: Callable[[str], Result]


def _versions(*names: str) -> str:
    return ", ".join(f"{name} {common.library_version(name)}" for name in names)


# --------------------------------------------------------------------------- tiktoken family


def _tiktoken_result(enc: tiktoken.Encoding, text: str) -> Result:
    """``encode_ordinary`` ids and the cumulative byte spans of ``decode_single_token_bytes``."""
    ids = enc.encode_ordinary(text)
    spans: list[list[int]] = []
    pos = 0
    for token_id in ids:
        size = len(enc.decode_single_token_bytes(token_id))
        spans.append([pos, pos + size])
        pos += size
    if pos != len(text.encode("utf-8")):
        raise AssertionError(f"token bytes cover {pos} of {len(text.encode('utf-8'))} bytes")
    return {"ids": ids, "spans": spans, "cross": None, "crossNote": None}


def _reference_ids(enc: tiktoken.Encoding, pattern: regex.Pattern, text: str) -> list[int]:
    """Ids from ``oracles.bpe_reference`` over the ``regex`` chunks (the fixtures' cross-check)."""
    data = text.encode("utf-8")
    offsets = common.char_byte_offsets(text)
    ids: list[int] = []
    for match in pattern.finditer(text):
        ids += encode_chunk(enc._mergeable_ranks, data[offsets[match.start()] : offsets[match.end()]]).ids
    return ids


def _tiktoken_oracle(
    enc: tiktoken.Encoding, *, library: str, cross: Callable[[str], list[int]] | None = None, cross_library: str | None
) -> FuzzOracle:
    def encode(text: str) -> Result:
        result = _tiktoken_result(enc, text)
        if cross is not None:
            result["cross"] = cross(text)
        return result

    return FuzzOracle(library, cross_library, encode)


@cache
def _o200k() -> tiktoken.Encoding:
    return _openai_encoding("o200k_base", "openai-o200k_base", "o200k_base.tiktoken")


def _openai(tokenizer_id: str) -> FuzzOracle:
    enc = (
        _o200k()
        if tokenizer_id == "openai-o200k_base"
        else _openai_encoding("cl100k_base", "openai-cl100k_base", "cl100k_base.tiktoken")
    )
    return _tiktoken_oracle(enc, library=f"tiktoken {common.library_version('tiktoken')}", cross_library=None)


def _llama4_muse() -> FuzzOracle:
    sha = common.vocab_sha256("meta-llama4-model", "tokenizer.model")
    ranks = load_tiktoken_bpe(str(raw_path("meta-llama4-model", "tokenizer.model")), expected_hash=sha)
    enc = tiktoken.Encoding("llama4-muse", pat_str=_o200k()._pat_str, mergeable_ranks=ranks, special_tokens={})
    return _tiktoken_oracle(
        enc, library=f"tiktoken {common.library_version('tiktoken')} (Llama 4 ranks)", cross_library=None
    )


def _llama3() -> FuzzOracle:
    sha = common.vocab_sha256("meta-llama3-model", "tokenizer.model")
    ranks = load_tiktoken_bpe(str(raw_path("meta-llama3-model", "tokenizer.model")), expected_hash=sha)
    xenova = _load_json("meta-llama3-model", "xenova/tokenizer.json")
    enc = tiktoken.Encoding(
        "llama3", pat_str=LLAMA3_PAT_STR, mergeable_ranks=ranks, special_tokens=_hf_specials(xenova)
    )
    hf = Tokenizer.from_file(str(raw_path("meta-llama3-model", "xenova/tokenizer.json")))
    hf.encode_special_tokens = True

    def cross(text: str) -> list[int]:
        return hf.encode(text, add_special_tokens=False).ids

    return _tiktoken_oracle(
        enc,
        library=f"tiktoken {common.library_version('tiktoken')} (Llama 3 ranks)",
        cross=cross,
        cross_library=f"tokenizers {common.library_version('tokenizers')} (Xenova/llama3-tokenizer)",
    )


def _with_reference(enc: tiktoken.Encoding, library: str) -> FuzzOracle:
    pattern = regex.compile(enc._pat_str)
    return _tiktoken_oracle(
        enc,
        library=library,
        cross=lambda text: _reference_ids(enc, pattern, text),
        cross_library=f"oracles.bpe_reference + {_versions('regex')}",
    )


def _grok2() -> FuzzOracle:
    tok = _load_json("xai-grok2", "tokenizer.tok.json")
    common.vocab_sha256("xai-grok2", "tokenizer.tok.json")
    enc = tiktoken.Encoding(
        "xai-grok2",
        pat_str=GROK2_V1_PAT_STR,
        mergeable_ranks={bytes(t["bytes"]): t["token"] for t in tok["regular_tokens"]},
        special_tokens={bytes(t["bytes"]).decode("utf-8"): t["token"] for t in tok["special_tokens"]},
        explicit_n_vocab=tok["vocab_size"],
    )
    return _with_reference(enc, f"tiktoken {common.library_version('tiktoken')} (tokenizer.tok.json, V1 pattern)")


def _claude_legacy() -> FuzzOracle:
    data = _load_json("anthropic-claude-legacy", "claude.json")
    common.vocab_sha256("anthropic-claude-legacy", "claude.json")
    enc = tiktoken.Encoding(
        "claude-legacy",
        pat_str=data["pat_str"],
        mergeable_ranks=_claude_legacy_ranks(data["bpe_ranks"]),
        special_tokens=data["special_tokens"],
    )
    return _with_reference(enc, f"tiktoken {common.library_version('tiktoken')} (claude.json, raw text)")


# --------------------------------------------------------------------------- sentencepiece family


def _spm_model(asset: str, file_name: str) -> FuzzOracle:
    """sentencepiece on a ``.model`` (no BOS/EOS), cross-checked by the pure-Python ``spm_bpe_ref``."""
    common.vocab_sha256(asset, file_name)
    path = raw_path(asset, file_name)
    model = SpModel.load(path)
    sp = spm.SentencePieceProcessor(model_file=str(path))
    reference = SpmBpeReference(model.proto)

    def encode(text: str) -> Result:
        ids = sp.encode(text, add_bos=False, add_eos=False)
        tokens = align_tokens(text, ids, model.pieces, model.types, model.first_byte_id, model.add_dummy_prefix)
        try:
            cross: list[int] | None = reference.encode(text)
            note = None
        except NotImplementedError as exc:  # UNUSED-piece resegmentation is outside the reference
            cross, note = None, f"spm_bpe_ref: {exc}"
        return {"ids": ids, "spans": [[t["start"], t["end"]] for t in tokens], "cross": cross, "crossNote": note}

    return FuzzOracle(
        f"sentencepiece {common.library_version('sentencepiece')}",
        f"oracles.spm_bpe_ref (pure-Python SentencePiece BPE) + {_versions('protobuf')}",
        encode,
    )


def _gemma4() -> FuzzOracle:
    """HF tokenizers on the Gemma 4 JSON; sentencepiece on the Gemma 3 model as the cross-check (04 section 7)."""
    common.vocab_sha256(GEMMA4_ASSET, GEMMA4_FILE)
    common.vocab_sha256(GEMMA3_ASSET, GEMMA3_FILE)
    gemma3 = SpModel.load(raw_path(GEMMA3_ASSET, GEMMA3_FILE))
    tok = Tokenizer.from_file(str(raw_path(GEMMA4_ASSET, GEMMA4_FILE)))
    tok.encode_special_tokens = True
    sp = spm.SentencePieceProcessor(model_file=str(raw_path(GEMMA3_ASSET, GEMMA3_FILE)))
    vocab = Gemma4Vocab.build(tok, gemma3)

    def encode(text: str) -> Result:
        ids = tok.encode(text, add_special_tokens=False).ids
        tokens = align_tokens(text, ids, vocab.pieces, vocab.types, gemma3.first_byte_id, False)
        cross = sp.encode(text, add_bos=False, add_eos=False)
        note = None
        if cross != ids:
            try:
                note = _gemma_disagreement(text, gemma3, vocab, tok)
            except SentencePieceFixtureError:
                note = None  # no literal Gemma 3 USER_DEFINED string explains it: the HF/SentencePiece tie-break class
        return {"ids": ids, "spans": [[t["start"], t["end"]] for t in tokens], "cross": cross, "crossNote": note}

    return FuzzOracle(
        f"tokenizers {common.library_version('tokenizers')} (Gemma 4 tokenizer.json)",
        f"sentencepiece {common.library_version('sentencepiece')} (Gemma 3 .spiece.model)",
        encode,
    )


#: tokenizer id -> oracle factory (built on first use, then cached).
FACTORIES: dict[str, Callable[[], FuzzOracle]] = {
    "openai-o200k_base": lambda: _openai("openai-o200k_base"),
    "openai-cl100k_base": lambda: _openai("openai-cl100k_base"),
    "meta-llama4-muse": _llama4_muse,
    "meta-llama3": _llama3,
    "xai-grok2": _grok2,
    "anthropic-claude-legacy": _claude_legacy,
    "google-gemma4": _gemma4,
    "google-gemma2": lambda: _spm_model(GEMMA2_ASSET, GEMMA2_FILE),
    "xai-grok1": lambda: _spm_model(GROK1_ASSET, GROK1_FILE),
}

_built: dict[str, FuzzOracle] = {}


def oracle(tokenizer_id: str) -> FuzzOracle:
    """The (cached) oracle of ``tokenizer_id``; raises ``KeyError`` for an unknown id."""
    if tokenizer_id not in _built:
        _built[tokenizer_id] = FACTORIES[tokenizer_id]()
    return _built[tokenizer_id]


def encode_one(fuzz: FuzzOracle, text: str) -> Result:
    """One text; any oracle failure becomes ``{"error": ...}`` so the batch continues."""
    try:
        return fuzz.encode(text)
    except Exception as exc:  # noqa: BLE001 - reported to the caller per text
        return {"error": f"{type(exc).__name__}: {exc}"}


def answer(request: dict[str, list[str]]) -> dict[str, list[Result]]:
    """Encode every text of every tokenizer in ``request``."""
    out: dict[str, list[Result]] = {}
    for tokenizer_id, texts in request.items():
        fuzz = oracle(tokenizer_id)
        out[tokenizer_id] = [encode_one(fuzz, text) for text in texts]
    return out


def describe(tokenizer_ids: list[str]) -> dict[str, dict[str, str | None]]:
    """``{"<id>": {"library": ..., "crossLibrary": ...}}`` for the given tokenizers (builds them)."""
    return {t: {"library": oracle(t).library, "crossLibrary": oracle(t).cross_library} for t in tokenizer_ids}


def serve() -> int:
    """JSON-lines loop: one request per input line, one response per output line (see the module docstring)."""
    print(json.dumps({"ready": True, "tokenizers": sorted(FACTORIES)}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        try:
            body: dict[str, Any] = {"results": answer(message["texts"]), "oracles": describe(list(message["texts"]))}
        except Exception as exc:  # noqa: BLE001 - a broken request must not kill the server
            body = {"error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps({"id": message.get("id"), **body}), flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, help="request JSON file (default: stdin)")
    parser.add_argument("--output", type=Path, help="response JSON file (default: stdout)")
    parser.add_argument("--serve", action="store_true", help="answer JSON lines on stdin until EOF")
    args = parser.parse_args(argv)
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    if args.serve:
        return serve()
    request = json.loads(args.input.read_text(encoding="utf-8") if args.input else sys.stdin.read())
    unknown = sorted(set(request) - set(FACTORIES))
    if unknown:
        parser.error(f"unknown tokenizer id(s): {', '.join(unknown)}")
    body = {"results": answer(request), "oracles": describe(list(request))}
    text = json.dumps(body)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
