"""Pure-Python re-implementation of SentencePiece BPE encoding (cross-check only).

This mirrors ``bpe_model.cc`` and ``sentencepiece_processor.cc`` from
SentencePiece 0.2.x for models with an identity normaliser:

1. Normalise: replace ``' '`` with ``'▁'`` (``escape_whitespaces``) and, when
   ``add_dummy_prefix`` is set, prepend one ``'▁'``.
2. Split into symbols: at each position take the longest USER_DEFINED piece
   (frozen, never merged), otherwise one code point.
3. Merge: repeatedly join the adjacent pair whose concatenation is a vocabulary
   piece with the highest score; ties go to the leftmost pair.
4. Map each symbol to its id; a symbol that is not in the vocabulary becomes
   one BYTE piece per UTF-8 byte when ``byte_fallback`` is on.

It exists so the fixtures are checked by an engine that shares no code with
the ``sentencepiece`` library, and as a readable reference for a future
TypeScript port that shows merge steps.
"""

from __future__ import annotations

import heapq

from sentencepiece import sentencepiece_model_pb2 as pb

#: Bumped whenever the encoding logic changes; recorded in fixture ``crossCheck.version``.
REFERENCE_VERSION = "1.0"

_Type = pb.ModelProto.SentencePiece.Type
_MERGEABLE = {_Type.Value("NORMAL"), _Type.Value("USER_DEFINED"), _Type.Value("UNUSED")}


class SpmBpeReference:
    """Encode text to ids with SentencePiece BPE semantics, from a parsed ModelProto."""

    def __init__(self, proto: pb.ModelProto) -> None:
        if proto.trainer_spec.model_type != pb.TrainerSpec.BPE:
            raise ValueError("only BPE models are supported")
        norm = proto.normalizer_spec
        if norm.name != "identity" or norm.precompiled_charsmap or norm.remove_extra_whitespaces:
            raise ValueError("only identity normalisers without whitespace folding are supported")
        self.add_dummy_prefix = norm.add_dummy_prefix
        self.escape_whitespaces = norm.escape_whitespaces
        self.byte_fallback = proto.trainer_spec.byte_fallback
        self._pieces: dict[str, int] = {}
        self._reserved: dict[str, int] = {}
        self._scores: list[float] = []
        self._unused: set[int] = set()
        user_defined: set[str] = set()
        self.unk_id = -1
        for i, sp in enumerate(proto.pieces):
            self._scores.append(sp.score)
            (self._pieces if sp.type in _MERGEABLE else self._reserved)[sp.piece] = i
            if sp.type == _Type.Value("USER_DEFINED"):
                user_defined.add(sp.piece)
            elif sp.type == _Type.Value("UNUSED"):
                self._unused.add(i)
            elif sp.type == _Type.Value("UNKNOWN"):
                self.unk_id = i
        self._user_defined = user_defined
        self._ud_lengths = sorted({len(p) for p in user_defined}, reverse=True)

    def piece_to_id(self, piece: str) -> int:
        """Return the id of ``piece`` (reserved pieces first), or the unknown id."""
        return self._reserved.get(piece, self._pieces.get(piece, self.unk_id))

    def _symbols(self, normalized: str) -> list[tuple[str, bool]]:
        """Split into (symbol, frozen) pairs using longest USER_DEFINED prefix matches."""
        out: list[tuple[str, bool]] = []
        i = 0
        while i < len(normalized):
            for length in self._ud_lengths:
                if normalized[i : i + length] in self._user_defined:
                    out.append((normalized[i : i + length], True))
                    i += length
                    break
            else:
                out.append((normalized[i], False))
                i += 1
        return out

    def encode(self, text: str) -> list[int]:
        """Encode ``text`` to ids without BOS/EOS."""
        if not text:
            return []
        normalized = text.replace(" ", "▁") if self.escape_whitespaces else text
        if self.add_dummy_prefix:
            normalized = "▁" + normalized
        symbols = self._symbols(normalized)
        piece = [s for s, _ in symbols]
        frozen = [f for _, f in symbols]
        nxt = list(range(1, len(piece))) + [-1]
        prv = list(range(-1, len(piece) - 1))
        agenda: list[tuple[float, int, int, int]] = []

        def push(left: int, right: int) -> None:
            if left < 0 or right < 0 or frozen[left] or frozen[right]:
                return
            merged = piece[left] + piece[right]
            pid = self._pieces.get(merged)
            if pid is None:
                return
            if pid in self._unused:
                raise NotImplementedError("UNUSED-piece resegmentation is not implemented")
            heapq.heappush(agenda, (-self._scores[pid], left, right, len(merged)))

        for i in range(len(piece) - 1):
            push(i, i + 1)
        while agenda:
            _, left, right, size = heapq.heappop(agenda)
            if not piece[left] or not piece[right] or len(piece[left]) + len(piece[right]) != size:
                continue
            piece[left] += piece[right]
            piece[right] = ""
            nxt[left] = nxt[right]
            if nxt[right] >= 0:
                prv[nxt[right]] = left
            push(prv[left], left)
            push(left, nxt[left])

        ids: list[int] = []
        for sym in piece:
            if not sym:
                continue
            pid = self.piece_to_id(sym)
            if pid == self.unk_id and self.byte_fallback:
                ids.extend(self._reserved[f"<0x{b:02X}>"] for b in sym.encode("utf-8"))
            else:
                ids.append(pid)
        return ids
