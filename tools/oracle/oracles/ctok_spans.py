"""Align ctok's rendered pieces with byte spans of ``UTF-8(NFC(text))``.

ctok does not tile the input text. It tiles a *marked stream* derived from it:
NFC, control and private-use stripping, curly-quote folding (v3 only), exotic
spaces folded to U+0020, case markers (``⟨shift⟩``/``⟨caps⟩`` followed by the
lower-cased word), and word-boundary markers (``⟨bow⟩``/``⟨eow⟩``) that absorb
the single space they stand for. Its pieces therefore cannot simply be
concatenated back into the input.

The walk below uses the same method as the SentencePiece family: it walks the
source bytes while consuming each piece's atoms in order.

* A byte atom ``⟨0xNN⟩`` covers exactly one source byte, which must equal NN.
* A marker atom (``⟨bow⟩``, ``⟨eow⟩``, ``⟨shift⟩``, ``⟨caps⟩``) is zero-width.
* A text character covers the source character it spells: normally itself
  (its UTF-8 length), or the source character that ctok folded into it
  (``Hello`` is spelled ``⟨shift⟩⟨bow⟩hello``; U+2028 is spelled as a space;
  v3 spells U+2019 as ``'``). The source bytes are covered, never the
  piece's own spelling.
* A source character that no piece spells is *absorbed* and recorded:

  - ``bow-space``: a space (or a character folded to one) that a ``⟨bow⟩``
    stands for -- the seam ``⟨eow⟩ ⟨bow⟩`` or the frame's leading ``⟨bow⟩``.
    It is attached to the piece holding that ``⟨bow⟩``.
  - ``stripped``: a C0/C1 control (e.g. the CR of CRLF, NEL) or BMP
    private-use character that ctok deletes. It is attached to the piece
    holding the next spelled character (or the last piece at the end).
  - ``frame-newlines``: trailing newlines that the message frame's own
    closing ``⏎⏎`` token absorbs. Attached to the last content piece.

* One spelled character has no source: when a message opens with a
  word-opening apostrophe (``'Hi``), v3 and v4.7 write the frame's ``⟨bow⟩``
  as a literal space in front of it. That space covers zero bytes.

Anything else that fails to match makes the case unmappable
(:class:`SpanError`), so the fixture records ``"tokens": null`` and the reason
instead of a guessed alignment.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

import ctok.normalize
from ctok.constants import BOW_G, FUNNY_SPACE, QUOTE_FOLD, STRIP_CONTROL, STRIP_PRIVATE
from ctok.notation import atoms

# ctok composes decomposed Thai SARA AM after NFC: stream char -> source sequence.
_SEQUENCE_FOLDS = {"ำ": "ํา"}
# Case pairs from Unicode 16 that ctok lowers although Python 3.13's tables do not.
_EXTRA_LOWER: dict[str, str] = dict(getattr(ctok.normalize, "_NEW_CASE_PAIRS", {}))


class SpanError(ValueError):
    """No faithful byte alignment exists; the message is recorded as the reason."""


@dataclass(frozen=True)
class Absorbed:
    """A source byte range that no piece spells, and the piece it is attached to."""

    start: int
    end: int
    reason: str
    token: int


@dataclass(frozen=True)
class Alignment:
    """Byte spans for each content piece over ``data`` (= UTF-8 of NFC(text))."""

    data: bytes
    spans: list[tuple[int, int]]
    absorbed: list[Absorbed]


def _spellings(source: str) -> set[str]:
    """Every single stream character ctok may write for one source character."""
    out = {source, source.lower()}
    if source in _EXTRA_LOWER:
        out.add(_EXTRA_LOWER[source])
    if source == "Σ":  # capital sigma: ⟨caps⟩ bodies always use σ
        out.update("σς")
    folded = QUOTE_FOLD.get(ord(source))
    if folded:
        out.add(folded)
    if _is_space_like(source):
        out.add(" ")
    return out


def _is_space_like(ch: str) -> bool:
    """A character ctok writes as U+0020 (and which a ``⟨bow⟩`` may therefore absorb)."""
    return ch in (" ", "\x00") or FUNNY_SPACE.fullmatch(ch) is not None


def _is_stripped(ch: str) -> bool:
    """A character ctok deletes before tokenizing (cost 0)."""
    return STRIP_CONTROL.fullmatch(ch) is not None or STRIP_PRIVATE.fullmatch(ch) is not None


class _Walker:
    """Cursor over the source bytes that records which piece owns each byte."""

    def __init__(self, target: str) -> None:
        self.text = target
        try:
            self.data = target.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise SpanError(f"text is not UTF-8 encodable ({exc.reason})") from None
        self.char_index: dict[int, int] = {}
        offset = 0
        for index, ch in enumerate(target):
            self.char_index[offset] = index
            offset += len(ch.encode("utf-8"))
        self.pos = 0
        self.owner: list[int] = []
        self.absorbed: list[Absorbed] = []

    def at_end(self) -> bool:
        return self.pos >= len(self.data)

    def char(self) -> str | None:
        """The source character starting at the cursor, or None mid-character/at end."""
        index = self.char_index.get(self.pos)
        return None if index is None else self.text[index]

    def take(self, nbytes: int, token: int) -> None:
        self.owner.extend([token] * nbytes)
        self.pos += nbytes

    def absorb(self, ch: str, token: int, reason: str) -> None:
        start = self.pos
        self.take(len(ch.encode("utf-8")), token)
        last = self.absorbed[-1] if self.absorbed else None
        if last and last.end == start and last.reason == reason and last.token == token:
            self.absorbed[-1] = Absorbed(last.start, self.pos, reason, token)
        else:
            self.absorbed.append(Absorbed(start, self.pos, reason, token))

    def match_char(self, spelled: str, token: int) -> bool:
        """Consume the source character(s) that ``spelled`` stands for, if at the cursor."""
        index = self.char_index.get(self.pos)
        if index is None:
            return False
        sequence = _SEQUENCE_FOLDS.get(spelled)
        if sequence and self.text.startswith(sequence, index):
            self.take(len(sequence.encode("utf-8")), token)
            return True
        source = self.text[index]
        if spelled in _spellings(source):
            self.take(len(source.encode("utf-8")), token)
            return True
        return False

    def match_byte(self, value: int, token: int) -> bool:
        if not self.at_end() and self.data[self.pos] == value:
            self.take(1, token)
            return True
        return False


def align(text: str, content: list[str]) -> Alignment:
    """Map ctok's content pieces (frame ``⟨pad⟩`` tokens removed) onto NFC(text) bytes.

    Raises :class:`SpanError` when the pieces cannot be aligned faithfully.
    """
    walker = _Walker(unicodedata.normalize("NFC", text))
    bow_owner: int | None = None  # piece holding a ⟨bow⟩ not yet followed by text
    spelled_any = False  # whether any text atom has been consumed yet
    for token, piece in enumerate(content):
        for kind, value in atoms(piece):
            if kind == "marker":
                if value == "⟨pad⟩":
                    raise SpanError("frame token inside the content")
                if value == BOW_G:
                    bow_owner = token
                continue
            while not _match(walker, kind, value, token):
                ch = walker.char()
                if ch is not None and _is_stripped(ch):
                    walker.absorb(ch, token, "stripped")
                elif ch is not None and _is_space_like(ch) and bow_owner is not None:
                    walker.absorb(ch, bow_owner, "bow-space")
                    bow_owner = None
                elif _is_head_quote_space(kind, value, spelled_any, ch):
                    break  # the frame's ⟨bow⟩ spelled as a space: zero-width
                else:
                    raise SpanError(_mismatch(walker, piece, kind, value))
            bow_owner = None
            spelled_any = True
    _absorb_tail(walker, len(content))
    return Alignment(walker.data, _spans(walker.owner, len(content)), walker.absorbed)


def _is_head_quote_space(kind: str, value, spelled_any: bool, source: str | None) -> bool:
    """Whether a piece's space is the frame ``⟨bow⟩`` written before a leading apostrophe."""
    return kind == "char" and value == " " and not spelled_any and source is not None and "'" in _spellings(source)


def _match(walker: _Walker, kind: str, value, token: int) -> bool:
    if kind == "byte":
        return walker.match_byte(value, token)
    return walker.match_char(value, token)


def _absorb_tail(walker: _Walker, n_tokens: int) -> None:
    """Attach trailing frame-absorbed newlines and stripped characters to the last piece."""
    while not walker.at_end():
        ch = walker.char()
        if n_tokens == 0:
            raise SpanError(f"no content piece: all {len(walker.data)} bytes are absorbed by the message frame")
        if ch == "\n":
            walker.absorb(ch, n_tokens - 1, "frame-newlines")
        elif ch is not None and _is_stripped(ch):
            walker.absorb(ch, n_tokens - 1, "stripped")
        else:
            raise SpanError(f"unspelled source text at byte {walker.pos}: {walker.text!r}")


def _spans(owner: list[int], n_tokens: int) -> list[tuple[int, int]]:
    """Turn per-byte ownership into ordered, contiguous [start, end) spans."""
    spans: list[tuple[int, int]] = []
    cursor = 0
    for token in range(n_tokens):
        end = cursor
        while end < len(owner) and owner[end] == token:
            end += 1
        spans.append((cursor, end))
        cursor = end
    if cursor != len(owner):
        raise SpanError("piece ownership is not monotonic over the source bytes")
    return spans


def _mismatch(walker: _Walker, piece: str, kind: str, value) -> str:
    shown = f"0x{value:02X}" if kind == "byte" else repr(value)
    return (
        f"piece {piece!r} spells {shown} but the source at byte {walker.pos} is "
        f"{walker.data[walker.pos : walker.pos + 4].hex() or 'end of text'}"
    )
