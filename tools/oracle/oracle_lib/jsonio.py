"""Deterministic JSON serialisation.

All JSON written by the tooling uses sorted keys, two-space indentation,
literal (non-escaped) Unicode, LF line endings, a trailing newline and UTF-8
without a byte-order mark, so re-running a script on unchanged inputs
produces a byte-identical file.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fsio import write_bytes_if_changed


def dumps(data: Any) -> str:
    """Serialise ``data`` in the canonical project style."""
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def load(path: Path) -> Any:
    """Read a UTF-8 JSON file; a byte-order mark is rejected loudly."""
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"{path} starts with a UTF-8 BOM; project JSON must not")
    return json.loads(raw.decode("utf-8"))


def write(path: Path, data: Any) -> bool:
    """Write ``data`` canonically; return ``True`` if the file content changed."""
    return write_bytes_if_changed(path, dumps(data).encode("utf-8"))
