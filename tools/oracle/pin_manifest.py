"""Pin every file in ``manifest.json`` to an immutable URL and revision.

For each file this re-resolves its ``source`` (see ``oracle_lib/resolvers.py``)
and rewrites ``url``, ``revision`` and, for hosts without revisions,
``httpHeaders``. It also derives ``license.sourceUrl`` and
``license.snapshotPath`` from the asset's ``license.file``.

It never touches ``bytes``/``sha256``: if a new pin serves different content,
``fetch_vocab.py`` fails on the hash until a human re-runs it with
``--update-manifest``.

Usage (from the repository root)::

    uv run --project tools/oracle tools/oracle/pin_manifest.py [--asset ID ...]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from oracle_lib import manifest as mf
from oracle_lib import paths, resolvers
from oracle_lib.report import format_table


def pin_asset(asset: mf.Asset) -> tuple[list[list[str]], bool]:
    """Pin all files of ``asset`` in place; return table rows and an error flag."""
    rows: list[list[str]] = []
    failed = False
    for entry in asset["files"]:
        old = entry.get("revision")
        try:
            pin = resolvers.resolve(asset, entry)
        except resolvers.ResolveError as exc:
            failed = failed or not exc.gated
            rows.append([asset["id"], entry["name"], str(old), "GATED" if exc.gated else f"ERROR: {exc}"])
            continue
        entry["url"] = pin.url
        entry["revision"] = pin.revision
        if pin.http_headers:
            entry["httpHeaders"] = pin.http_headers
        status = "unchanged" if old == pin.revision else ("pinned" if old is None else "CHANGED")
        rows.append([asset["id"], entry["name"], pin.revision[:24], status])
    lic = asset["license"]
    lic["sourceUrl"] = mf.file_by_name(asset, lic["file"])["url"]
    lic["snapshotPath"] = paths.repo_relative(paths.license_snapshot_path(asset["id"], lic["file"]))
    return rows, failed


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--manifest", type=Path, default=paths.MANIFEST_PATH)
    parser.add_argument("--asset", action="append", help="limit to this asset id (repeatable)")
    args = parser.parse_args(argv)

    manifest = mf.load(args.manifest)
    rows: list[list[str]] = []
    failed = False
    for asset in manifest["assets"]:
        if args.asset and asset["id"] not in args.asset:
            continue
        asset_rows, asset_failed = pin_asset(asset)
        rows.extend(asset_rows)
        failed = failed or asset_failed
    print(format_table(["asset", "file", "revision", "status"], rows))
    changed = mf.save(args.manifest, manifest)
    print(f"\nmanifest {'updated' if changed else 'unchanged'}: {paths.repo_relative(args.manifest)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
