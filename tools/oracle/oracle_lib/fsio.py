"""Small filesystem helpers."""

from __future__ import annotations

from pathlib import Path


def write_bytes_if_changed(path: Path, data: bytes) -> bool:
    """Atomically write ``data`` unless the file already holds exactly it.

    The bytes go to ``<name>.partial`` first and are then renamed over the
    target, so an interrupted run never leaves a truncated file behind.
    Returns ``True`` when the file was (re)written.
    """
    if path.exists() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".partial")
    tmp.write_bytes(data)
    tmp.replace(path)
    return True
