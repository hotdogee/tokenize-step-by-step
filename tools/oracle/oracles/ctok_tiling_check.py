"""Independent re-check of ctok's tiling: every piece is legal and the count is minimal.

ctok's *model* (normalization, case and boundary markers, the frame) is taken
as given through its public ``ctok.marked_stream`` and ``ctok.normalize``.
What this module re-derives without ctok's engine is the *tiling*:

1. the content pieces concatenate exactly to the marked stream;
2. each piece is legal: a vocabulary piece (or glued contraction ``'t⟨eow⟩``),
   a single character priced at 1, or a byte chunk that is a single byte or a
   ``bytes_fallback`` prefix;
3. the number of content pieces equals an independent minimum-cost tiling of
   the stream (cost-1 pieces plus a per-character byte floor);
4. the frame tail (trailing newlines) has the length an independent tiling of
   ``n + 2`` newlines predicts, minus the frame's own closing token.

Agreement means ctok's output is one valid minimum-cost tiling of its own
stream; it says nothing about Anthropic's real segmentation.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

from ctok.constants import EOW, GLYPH_TO_ATOM
from ctok.notation import atoms

Unit = str | bytes  # one char, one marker atom ("⟨bow⟩"), or a sub-character byte chunk


def units(public: str) -> tuple[Unit, ...]:
    """Split a rendered string into units; byte runs that decode become characters."""
    out: list[Unit] = []
    buf = bytearray()

    def flush() -> None:
        if buf:
            try:
                out.extend(bytes(buf).decode("utf-8"))
            except UnicodeDecodeError:
                out.append(bytes(buf))
            buf.clear()

    for kind, value in atoms(public):
        if kind == "byte":
            buf.append(value)
            continue
        flush()
        out.append(value if kind == "char" else GLYPH_TO_ATOM.get(value, value))
    flush()
    return tuple(out)


def _encode(seq: tuple[Unit, ...]) -> bytes:
    """Bytes for comparing unit sequences; markers cannot collide with text."""
    parts = []
    for unit in seq:
        if isinstance(unit, bytes):
            parts.append(unit)
        elif len(unit) > 1:
            parts.append(b"\x00" + unit.encode("utf-8") + b"\x00")
        else:
            parts.append(unit.encode("utf-8"))
    return b"".join(parts)


def _is_marker(unit: Unit) -> bool:
    return isinstance(unit, str) and len(unit) > 1


@dataclass(frozen=True)
class Vocabulary:
    """The tiling vocabulary of one ctok pieces file, rebuilt from the raw document."""

    document: dict

    @cached_property
    def pieces(self) -> frozenset[tuple[Unit, ...]]:
        tokens = self.document["tokens"]
        out = {units(p) for group, ps in tokens.items() if group != "bytes_fallback" for p in ps}
        out.update(units(p + EOW) for p in tokens["contractions"])
        return frozenset(out)

    @cached_property
    def max_len(self) -> int:
        return max(len(p) for p in self.pieces)

    @cached_property
    def unit_chars(self) -> frozenset[str]:
        return frozenset(p[0] for p in self.pieces if len(p) == 1 and not _is_marker(p[0]))

    @cached_property
    def byte_prefixes(self) -> frozenset[bytes]:
        hexes = set(self.document["tokens"]["bytes_fallback"])
        hexes.update(c.encode("utf-8").hex() for c in self.unit_chars)
        return frozenset(bytes.fromhex(h) for h in hexes)

    def byte_floor(self, data: bytes) -> int:
        """Minimum number of byte chunks (single bytes or known prefixes) covering ``data``."""
        best = [0] + [len(data) + 1] * len(data)
        for end in range(1, len(data) + 1):
            for start in range(end):
                if end - start == 1 or data[start:end] in self.byte_prefixes:
                    best[end] = min(best[end], best[start] + 1)
        return best[-1]

    def unit_cost(self, unit: Unit) -> int:
        """Cost of one stream unit standing alone."""
        if _is_marker(unit) or (unit,) in self.pieces:
            return 1
        return self.byte_floor(unit.encode("utf-8"))

    def min_cost(self, stream: tuple[Unit, ...]) -> int:
        """Independent minimum-cost tiling of a unit stream."""
        best = [0] + [0] * len(stream)
        for end in range(1, len(stream) + 1):
            best[end] = best[end - 1] + self.unit_cost(stream[end - 1])
            for start in range(max(0, end - self.max_len), end - 1):
                if best[start] + 1 < best[end] and stream[start:end] in self.pieces:
                    best[end] = best[start] + 1
        return best[-1]

    def is_legal(self, piece: tuple[Unit, ...]) -> bool:
        """Whether one emitted piece is a token this vocabulary can produce."""
        if piece in self.pieces:
            return True
        if len(piece) != 1:
            return False
        unit = piece[0]
        if isinstance(unit, bytes):
            return len(unit) == 1 or unit in self.byte_prefixes
        return not _is_marker(unit) and self.unit_cost(unit) == 1


def check_case(vocab: Vocabulary, content: list[str], stream: str, trailing_newlines: int) -> list[str]:
    """Return the list of problems (empty when ctok's tiling re-checks cleanly)."""
    problems: list[str] = []
    tail_len = 0
    if trailing_newlines:
        tail_len = vocab.min_cost(("\n",) * (trailing_newlines + 2)) - 1
    body, tail = content[: len(content) - tail_len], content[len(content) - tail_len :]
    if any(set(t) != {"\n"} for t in tail):
        problems.append(f"expected {tail_len} newline-only frame-tail pieces, got {tail!r}")
    body_units = [units(p) for p in body]
    stream_units = units(stream)
    if _encode(tuple(u for p in body_units for u in p)) != _encode(stream_units):
        problems.append("pieces do not concatenate to the marked stream")
    illegal = [p for p, u in zip(body, body_units, strict=True) if not vocab.is_legal(u)]
    if illegal:
        problems.append(f"pieces outside the vocabulary: {illegal!r}")
    expected = vocab.min_cost(stream_units)
    if expected != len(body):
        problems.append(f"independent minimum cost {expected} != {len(body)} pieces")
    return problems
