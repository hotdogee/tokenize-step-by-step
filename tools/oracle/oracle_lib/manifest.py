"""Schema helpers for ``tools/oracle/manifest.json``.

The manifest is the single source of truth for upstream vocabulary assets.
Each asset has human-curated metadata (lab, description, licence obligations,
ship intent, notes) and a list of files. Every file carries:

* ``source``   -- how to locate it upstream (see :mod:`oracle_lib.resolvers`);
* ``url`` / ``revision`` -- the pinned, immutable location (written by
  ``pin_manifest.py``);
* ``bytes`` / ``sha256`` / ``retrievedOn`` / ``contentType`` -- observed
  facts, written only by ``fetch_vocab.py --update-manifest``;
* ``volatile`` (optional) -- why a re-download can never reproduce the
  recorded hash (e.g. a per-request nonce in a web page); such a file is
  restored from its committed ``docs/licenses`` snapshot instead.

An asset's ``license`` may also carry ``notice`` (``{file, text}``): an
attribution Notice file that the licence requires the distributor to write
(not an upstream file). ``render_license_docs.py`` renders it to
``docs/licenses/<asset-id>/<file>``.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from . import jsonio
from .paths import safe_relative

SCHEMA_VERSION = 1
SHIP_INTENTS = frozenset({"ship", "oracle-only", "phase-2"})
SOURCE_TYPES = frozenset({"url", "huggingface", "github", "npm", "pypi", "archive-member", "html-text"})
#: Source types derived from another file of the same asset (processed after it).
DERIVED_SOURCE_TYPES = frozenset({"archive-member", "html-text"})
#: Roles whose files are copied verbatim into ``docs/licenses/<asset-id>/``.
SNAPSHOT_ROLES = frozenset({"license", "notice", "policy", "license-evidence"})
FILE_ROLES = frozenset({"vocab", "config", "archive"}) | SNAPSHOT_ROLES

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ASSET_ID = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")

Asset = dict[str, Any]
FileEntry = dict[str, Any]


class ManifestError(ValueError):
    """The manifest violates the schema; the message lists every problem."""


def load(path: Path) -> dict[str, Any]:
    """Load and validate a manifest."""
    data = jsonio.load(path)
    validate(data)
    return data


def save(path: Path, manifest: dict[str, Any]) -> bool:
    """Validate and write a manifest canonically; return ``True`` if it changed."""
    validate(manifest)
    return jsonio.write(path, manifest)


def file_by_name(asset: Asset, name: str) -> FileEntry:
    """Return the file entry called ``name`` within ``asset``."""
    for entry in asset["files"]:
        if entry["name"] == name:
            return entry
    raise KeyError(f"{asset['id']}: no file named {name!r}")


def ordered_files(asset: Asset) -> Iterator[FileEntry]:
    """Yield directly downloadable files first, then files derived from them."""
    files = asset["files"]
    yield from (f for f in files if f["source"]["type"] not in DERIVED_SOURCE_TYPES)
    yield from (f for f in files if f["source"]["type"] in DERIVED_SOURCE_TYPES)


def validate(manifest: dict[str, Any]) -> None:
    """Raise :class:`ManifestError` describing every schema violation found."""
    problems: list[str] = []
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion must be {SCHEMA_VERSION}")
    seen_ids: set[str] = set()
    for asset in manifest.get("assets", []):
        problems.extend(_asset_problems(asset, seen_ids))
    if problems:
        raise ManifestError("invalid manifest:\n  - " + "\n  - ".join(problems))


def _asset_problems(asset: Asset, seen_ids: set[str]) -> list[str]:
    aid = asset.get("id", "<missing id>")
    out: list[str] = []
    if not _ASSET_ID.match(str(aid)):
        out.append(f"{aid}: bad asset id")
    if aid in seen_ids:
        out.append(f"{aid}: duplicate asset id")
    seen_ids.add(aid)
    for key in ("lab", "description", "notes"):
        if not isinstance(asset.get(key), str) or not asset[key]:
            out.append(f"{aid}: missing {key}")
    if asset.get("shipIntent") not in SHIP_INTENTS:
        out.append(f"{aid}: shipIntent must be one of {sorted(SHIP_INTENTS)}")
    lic = asset.get("license") or {}
    for key in ("spdx", "sourceUrl", "snapshotPath", "obligations", "file"):
        if key not in lic:
            out.append(f"{aid}: license.{key} missing")
    names: set[str] = set()
    for entry in asset.get("files", []):
        out.extend(_file_problems(aid, entry, names))
    if lic.get("file") and lic["file"] not in names:
        out.append(f"{aid}: license.file {lic['file']!r} is not one of the asset's files")
    if "notice" in lic:
        out.extend(_notice_problems(aid, lic["notice"], names))
    for entry in asset.get("files", []):
        src = entry.get("source", {})
        if src.get("type") == "archive-member" and src.get("archive") not in names:
            out.append(f"{aid}/{entry.get('name')}: archive {src.get('archive')!r} not in asset")
        if src.get("type") == "html-text":
            if src.get("document") not in names:
                out.append(f"{aid}/{entry.get('name')}: document {src.get('document')!r} not in asset")
            if not src.get("classes") or not all(isinstance(c, str) and c for c in src["classes"]):
                out.append(f"{aid}/{entry.get('name')}: html-text needs a non-empty classes list")
    return out


def _notice_problems(aid: str, notice: Any, names: set[str]) -> list[str]:
    """Check ``license.notice``: an authored Notice file rendered into ``docs/licenses/<asset-id>/``."""
    if not isinstance(notice, dict) or set(notice) != {"file", "text"}:
        return [f"{aid}: license.notice must be an object with exactly 'file' and 'text'"]
    out: list[str] = []
    try:
        safe_relative(str(notice["file"]))
    except ValueError as exc:
        out.append(f"{aid}: license.notice.file: {exc}")
    if notice["file"] in names:
        out.append(f"{aid}: license.notice.file {notice['file']!r} collides with an upstream file name")
    if not isinstance(notice["text"], str) or not notice["text"].strip() or "\n" in notice["text"]:
        out.append(f"{aid}: license.notice.text must be one non-empty line")
    return out


def _file_problems(aid: str, entry: FileEntry, names: set[str]) -> list[str]:
    name = entry.get("name", "<missing name>")
    where = f"{aid}/{name}"
    out: list[str] = []
    try:
        safe_relative(name)
    except ValueError as exc:
        out.append(f"{where}: {exc}")
    if name in names:
        out.append(f"{where}: duplicate file name")
    names.add(name)
    if entry.get("role") not in FILE_ROLES:
        out.append(f"{where}: role must be one of {sorted(FILE_ROLES)}")
    if entry.get("source", {}).get("type") not in SOURCE_TYPES:
        out.append(f"{where}: source.type must be one of {sorted(SOURCE_TYPES)}")
    sha = entry.get("sha256")
    if sha is not None and not _SHA256.match(sha):
        out.append(f"{where}: sha256 must be 64 lowercase hex chars")
    size = entry.get("bytes")
    if size is not None and (not isinstance(size, int) or size < 0):
        out.append(f"{where}: bytes must be a non-negative integer")
    date = entry.get("retrievedOn")
    if date is not None and not _DATE.match(date):
        out.append(f"{where}: retrievedOn must be YYYY-MM-DD")
    for key in ("url", "revision", "contentType"):
        if key not in entry:
            out.append(f"{where}: {key} missing (use null until known)")
    if "volatile" in entry:
        if not isinstance(entry["volatile"], str) or not entry["volatile"]:
            out.append(f"{where}: volatile must be a non-empty reason string")
        if entry.get("role") not in SNAPSHOT_ROLES:
            out.append(f"{where}: only snapshotted roles can be volatile")
    return out
