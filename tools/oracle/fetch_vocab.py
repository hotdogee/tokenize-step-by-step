"""Download, verify and snapshot every file listed in ``manifest.json``.

Files land in ``data/vocab/raw/<asset-id>/<name>`` (gitignored). Licence-like
files (roles ``license``, ``notice``, ``policy``, ``license-evidence``) are
also copied verbatim to ``docs/licenses/<asset-id>/<name>`` (committed).

Verification rules:

* A file already on disk whose SHA-256 and size match the manifest is skipped.
* A downloaded file whose SHA-256 differs from the manifest (or has none
  recorded) is NOT written and the run fails loudly. ``--update-manifest`` is
  the only way to accept a new or changed hash.
* Host-attested digests (PyPI ``sha256:``, npm ``sha512-`` integrity, a pinned
  ``Content-MD5`` header) are always checked, even with ``--update-manifest``.
* HTTP 401/403 (gated content) is reported and skipped, never bypassed.
* A ``volatile`` file (a page whose bytes change on every request) is restored
  from its committed ``docs/licenses`` snapshot when that snapshot matches the
  manifest; it is downloaded only when no valid snapshot exists.
* ``archive-member`` and ``html-text`` files are derived from another, already
  verified file of the same asset and checked like any download.

Usage (from the repository root)::

    uv run --project tools/oracle tools/oracle/fetch_vocab.py [--asset ID ...] [--update-manifest]
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from oracle_lib import archives, fsio, htmltext, netio, paths
from oracle_lib import manifest as mf
from oracle_lib.report import format_table

#: Content types for archive members (no HTTP response to read one from).
#: A fixed table keeps output identical across machines (``mimetypes`` reads
#: the Windows registry).
MEMBER_CONTENT_TYPES = {".json": "application/json", ".md": "text/markdown", ".txt": "text/plain", "": "text/plain"}
FAILING = frozenset({"MISMATCH", "UNRECORDED", "ERROR"})


class IntegrityError(RuntimeError):
    """Downloaded bytes contradict a registry-published digest."""


@dataclass(frozen=True)
class Obtained:
    """Bytes for one file plus the content type they were served with."""

    data: bytes
    content_type: str | None


def sha256_hex(data: bytes) -> str:
    """Hex SHA-256 of ``data``."""
    return hashlib.sha256(data).hexdigest()


def check_attested_digest(entry: mf.FileEntry, data: bytes) -> None:
    """Verify ``data`` against a digest published by PyPI, npm or the host, if any."""
    revision = entry.get("revision") or ""
    src_type = entry["source"]["type"]
    content_md5 = entry.get("httpHeaders", {}).get("contentMd5")
    checks: list[tuple[str, str, str]] = []  # (label, expected, actual)
    if src_type == "pypi" and revision.startswith("sha256:"):
        checks.append(("the PyPI sha256 digest", revision.removeprefix("sha256:"), sha256_hex(data)))
    if src_type == "npm" and revision.startswith("sha512-"):
        checks.append(("npm dist.integrity", revision.removeprefix("sha512-"), _b64(hashlib.sha512(data).digest())))
    if src_type == "url" and content_md5:
        checks.append(("the pinned Content-MD5 header", content_md5, _b64(hashlib.md5(data).digest())))
    for label, expected, actual in checks:
        if expected != actual:
            raise IntegrityError(f"{entry['name']}: content does not match {label}")


def _b64(digest: bytes) -> str:
    return base64.b64encode(digest).decode("ascii")


def _verified_sibling(asset: mf.Asset, name: str) -> Path:
    """Local path of another file of ``asset`` that is already on disk and verified."""
    sibling = mf.file_by_name(asset, name)
    path = paths.raw_path(asset["id"], sibling["name"])
    if not path.exists() or sha256_hex(path.read_bytes()) != sibling["sha256"]:
        raise RuntimeError(f"{name} is missing or unverified")
    return path


def obtain(asset: mf.Asset, entry: mf.FileEntry) -> Obtained:
    """Download ``entry`` from its pinned URL, or derive it from another file of the asset."""
    src = entry["source"]
    suffix = PurePosixPath(entry["name"]).suffix.lower()
    if src["type"] == "archive-member":
        archive_path = _verified_sibling(asset, src["archive"])
        content_type = MEMBER_CONTENT_TYPES.get(suffix, "application/octet-stream")
        return Obtained(archives.read_member(archive_path, src["member"]), content_type)
    if src["type"] == "html-text":
        page = _verified_sibling(asset, src["document"]).read_bytes().decode("utf-8")
        text = htmltext.extract(page, src["classes"])
        return Obtained(text.encode("utf-8"), "text/plain; charset=utf-8")
    if not entry.get("url"):
        raise RuntimeError("file is not pinned; run pin_manifest.py first")
    resp = netio.get(entry["url"])
    return Obtained(resp.body, resp.header("content-type"))


def snapshot_if_licence(asset: mf.Asset, entry: mf.FileEntry, data: bytes) -> None:
    """Copy verified licence-like files verbatim into ``docs/licenses``."""
    if entry["role"] in mf.SNAPSHOT_ROLES:
        fsio.write_bytes_if_changed(paths.license_snapshot_path(asset["id"], entry["name"]), data)


def _matches(data: bytes, entry: mf.FileEntry) -> bool:
    return sha256_hex(data) == entry.get("sha256") and len(data) == entry.get("bytes")


def process_file(asset: mf.Asset, entry: mf.FileEntry, update: bool, today: str) -> str:
    """Fetch/verify one file and return its status word (mutates ``entry`` on update)."""
    dest = paths.raw_path(asset["id"], entry["name"])
    recorded = entry.get("sha256")
    if recorded and dest.exists():
        on_disk = dest.read_bytes()
        if _matches(on_disk, entry):
            snapshot_if_licence(asset, entry, on_disk)
            return "cached"
    if recorded and entry.get("volatile"):
        snapshot = paths.license_snapshot_path(asset["id"], entry["name"])
        if snapshot.exists() and _matches(snapshot.read_bytes(), entry):
            fsio.write_bytes_if_changed(dest, snapshot.read_bytes())
            return "restored"
    try:
        got = obtain(asset, entry)
    except netio.HttpError as exc:
        if exc.gated:
            if update:
                entry["access"] = f"gated (HTTP {exc.status})"
            return "GATED"
        raise
    check_attested_digest(entry, got.data)
    observed = sha256_hex(got.data)
    if observed == recorded and len(got.data) == entry.get("bytes"):
        status = "fetched"
    elif not update:
        print(
            f"!! {asset['id']}/{entry['name']}: manifest sha256={recorded} bytes={entry.get('bytes')}"
            f" but observed sha256={observed} bytes={len(got.data)}",
            file=sys.stderr,
        )
        return "UNRECORDED" if recorded is None else "MISMATCH"
    else:
        status = "accepted" if recorded is None else "updated"
        entry.update(bytes=len(got.data), sha256=observed, retrievedOn=today, contentType=got.content_type)
        entry.pop("access", None)
    fsio.write_bytes_if_changed(dest, got.data)
    snapshot_if_licence(asset, entry, got.data)
    return status


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--manifest", type=Path, default=paths.MANIFEST_PATH)
    parser.add_argument("--asset", action="append", help="limit to this asset id (repeatable)")
    parser.add_argument(
        "--update-manifest",
        action="store_true",
        help="accept observed sizes/hashes into the manifest (the only way to change a hash)",
    )
    args = parser.parse_args(argv)

    manifest = mf.load(args.manifest)
    today = dt.datetime.now(dt.UTC).date().isoformat()
    rows: list[list[object]] = []
    for asset in manifest["assets"]:
        if args.asset and asset["id"] not in args.asset:
            continue
        for entry in mf.ordered_files(asset):
            try:
                status = process_file(asset, entry, args.update_manifest, today)
            except (OSError, RuntimeError, KeyError, ValueError) as exc:
                print(f"!! {asset['id']}/{entry['name']}: {exc}", file=sys.stderr)
                status = "ERROR"
            sha = entry.get("sha256") or ""
            rows.append([asset["id"], entry["name"], entry.get("bytes") or "", sha[:16], status])

    print(format_table(["asset", "file", "bytes", "sha256[:16]", "status"], rows))
    if args.update_manifest and mf.save(args.manifest, manifest):
        print(f"\nmanifest updated: {paths.repo_relative(args.manifest)}")
    failures = sum(1 for row in rows if row[-1] in FAILING)
    gated = sum(1 for row in rows if row[-1] == "GATED")
    print(f"\n{len(rows)} files: {failures} failed, {gated} gated (skipped)")
    if failures and not args.update_manifest:
        print("Hash problems are never auto-accepted; inspect, then re-run with --update-manifest.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
