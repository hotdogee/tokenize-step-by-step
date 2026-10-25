"""Plain-text table rendering for script output."""

from __future__ import annotations

from collections.abc import Sequence


def format_table(headers: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    """Render ``rows`` as a left-aligned, space-padded text table."""
    cells = [[str(c) for c in headers]] + [[str(c) for c in row] for row in rows]
    widths = [max(len(row[i]) for row in cells) for i in range(len(headers))]
    lines = ["  ".join(c.ljust(w) for c, w in zip(row, widths, strict=True)).rstrip() for row in cells]
    lines.insert(1, "  ".join("-" * w for w in widths))
    return "\n".join(lines)
