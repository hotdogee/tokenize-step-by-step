"""Pure-Python port of tiktoken's byte-pair merge, recording every merge step.

This mirrors ``_byte_pair_merge`` / ``byte_pair_encode`` in tiktoken's
``src/lib.rs`` (0.14.0) line for line, so the merge order is exactly the one
tiktoken uses:

1. The chunk starts as one part per byte.
2. Repeatedly find the adjacent pair whose concatenated bytes have the
   **lowest rank** in the vocabulary (strict ``<`` scan, so the leftmost pair
   wins ties) and merge it.
3. Stop when no adjacent pair is a vocabulary entry.

Before any of that, tiktoken looks the whole chunk up in the vocabulary and,
if it is present, emits it directly (``directHit``); no merge steps happen.

Merge steps are recorded as ``(position, rank)``: ``position`` is the index,
in the *current* list of parts, of the left part of the merged pair, and
``rank`` is the rank (= token id) of the merged bytes. Replaying the steps on
the single-byte parts reproduces the final tokens.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from itertools import pairwise

#: tiktoken's ``Rank::MAX`` (``u32::MAX``): "this pair is not in the vocabulary".
NO_RANK = 2**32 - 1


@dataclass(frozen=True)
class ChunkEncoding:
    """Result of encoding one pre-tokenizer chunk."""

    ids: list[int]
    #: ``[(position, rank), ...]`` in merge order; empty for a direct hit.
    steps: list[tuple[int, int]]
    #: The whole chunk is a vocabulary entry and was emitted without merging.
    direct_hit: bool


def byte_pair_merge(ranks: Mapping[bytes, int], piece: bytes) -> tuple[list[int], list[tuple[int, int]]]:
    """Run tiktoken's merge loop on ``piece`` (``len(piece) >= 2``).

    Returns ``(boundaries, steps)`` where ``boundaries`` are the start offsets
    of the final parts followed by ``len(piece)``.
    """
    # parts[i] = (start offset, rank of the pair starting at part i), plus the
    # two sentinels tiktoken appends; see the Rust source for the layout.
    parts: list[list[int]] = []
    min_rank, min_i = NO_RANK, -1
    for i in range(len(piece) - 1):
        rank = ranks.get(piece[i : i + 2], NO_RANK)
        if rank < min_rank:
            min_rank, min_i = rank, i
        parts.append([i, rank])
    parts.append([len(piece) - 1, NO_RANK])
    parts.append([len(piece), NO_RANK])

    def get_rank(i: int) -> int:
        # parts[i + 1] is still present (it is removed after this call), hence +3.
        if i + 3 < len(parts):
            return ranks.get(piece[parts[i][0] : parts[i + 3][0]], NO_RANK)
        return NO_RANK

    steps: list[tuple[int, int]] = []
    while min_rank != NO_RANK:
        i = min_i
        steps.append((i, min_rank))
        if i > 0:
            parts[i - 1][1] = get_rank(i - 1)
        parts[i][1] = get_rank(i)
        del parts[i + 1]

        min_rank, min_i = NO_RANK, -1
        for j in range(len(parts) - 1):
            if parts[j][1] < min_rank:
                min_rank, min_i = parts[j][1], j
    return [p[0] for p in parts[:-1]] + [len(piece)], steps


def encode_chunk(ranks: Mapping[bytes, int], piece: bytes) -> ChunkEncoding:
    """Encode one chunk exactly like tiktoken's ``encode_single_piece``."""
    if piece in ranks:
        return ChunkEncoding([ranks[piece]], [], True)
    if len(piece) < 2:
        raise KeyError(f"single byte {piece!r} is missing from the vocabulary")
    boundaries, steps = byte_pair_merge(ranks, piece)
    ids = [ranks[piece[a:b]] for a, b in pairwise(boundaries)]
    return ChunkEncoding(ids, steps, False)
