"""Repository-relative paths used by the oracle scripts.

Everything is derived from the location of this file, so the tooling works
from any checkout location and never embeds an absolute path.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

#: ``tools/oracle`` -- the uv project directory.
ORACLE_DIR = Path(__file__).resolve().parent.parent
#: Repository root (two levels above ``tools/oracle``).
REPO_ROOT = ORACLE_DIR.parent.parent
#: The provenance manifest (committed).
MANIFEST_PATH = ORACLE_DIR / "manifest.json"
#: Raw upstream downloads (gitignored).
RAW_VOCAB_DIR = REPO_ROOT / "data" / "vocab" / "raw"
#: Verbatim licence snapshots (committed).
LICENSES_DIR = REPO_ROOT / "docs" / "licenses"


def safe_relative(name: str) -> PurePosixPath:
    """Return ``name`` as a relative POSIX path, rejecting anything unsafe.

    Manifest file names may contain ``/`` to group files in sub-folders, but
    they must never be absolute or climb out of their asset directory.
    """
    if "\\" in name or ":" in name:
        raise ValueError(f"manifest names must use '/' and no drive letters: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(p in ("", ".", "..") for p in path.parts):
        raise ValueError(f"unsafe manifest name: {name!r}")
    return path


def raw_path(asset_id: str, name: str) -> Path:
    """Local path of a raw download: ``data/vocab/raw/<asset-id>/<name>``."""
    return RAW_VOCAB_DIR / safe_relative(asset_id) / safe_relative(name)


def license_snapshot_path(asset_id: str, name: str) -> Path:
    """Local path of a licence snapshot: ``docs/licenses/<asset-id>/<name>``."""
    return LICENSES_DIR / safe_relative(asset_id) / safe_relative(name)


def repo_relative(path: Path) -> str:
    """Render ``path`` relative to the repository root with forward slashes.

    Paths outside the repository (e.g. a scratch manifest) are returned as-is.
    """
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()
