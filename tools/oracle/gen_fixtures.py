"""Generate (or check) the golden tokenizer fixtures in ``fixtures/``.

Usage, from the repository root::

    uv run --project tools/oracle tools/oracle/gen_fixtures.py                 # all families
    uv run --project tools/oracle tools/oracle/gen_fixtures.py --family tiktoken
    uv run --project tools/oracle tools/oracle/gen_fixtures.py --tokenizer openai-o200k_base
    uv run --project tools/oracle tools/oracle/gen_fixtures.py --check         # regenerate to a temp dir and diff

Family modules
    Each family is a module ``oracles/<name>_family.py`` exposing::

        TOKENIZERS: dict[str, Callable[[list[dict]], dict]]

    mapping a tokenizer id to a builder that receives the corpus cases
    (``oracles.common.load_corpus()``) and returns one fixture document. A
    builder may also export ``NORMALIZE: dict[str, Callable[[str], str]]`` to
    tell the invariant checker which text the token bytes cover (e.g. NFC).

    Families are found two ways: the explicit :data:`FAMILIES` registry below
    and auto-discovery of ``oracles/*_family.py``. A registered module that does
    not exist yet is skipped with a warning (other families are developed in
    parallel); asking for it with ``--family`` is an error.

Orphans
    A full run (no ``--family``/``--tokenizer`` filter, no failures) also looks
    for ``fixtures/*.json`` files that no builder produced (e.g. after a
    tokenizer is renamed or split). A normal run deletes them; ``--check``
    reports them as ``ORPHAN`` and fails.

Exit status is 1 if any builder fails, any fixture invariant fails, or (with
``--check``) any committed fixture differs from a fresh regeneration or is an
orphan.
"""

from __future__ import annotations

import argparse
import difflib
import importlib
import pkgutil
import sys
import tempfile
import traceback
from pathlib import Path

from oracles import common

# --- family registry: one line per family, each owned by its stage-2 author -----------
FAMILIES: dict[str, str] = {
    # >>> tiktoken-bpe family (stage 2a)
    "tiktoken": "oracles.tiktoken_family",
    # <<< tiktoken-bpe family (stage 2a)
    # >>> sentencepiece-bpe family (stage 2b)
    "sentencepiece": "oracles.sentencepiece_family",
    # <<< sentencepiece-bpe family (stage 2b)
    # >>> ctok-tiling family (stage 2c)
    "ctok": "oracles.ctok_family",
    # <<< ctok-tiling family (stage 2c)
}
# --- end of family registry ------------------------------------------------------------


def discover_families() -> dict[str, str]:
    """Registry entries plus every ``oracles/*_family.py`` module (short name -> module)."""
    found = dict(FAMILIES)
    pkg_dir = Path(common.__file__).resolve().parent
    for info in pkgutil.iter_modules([str(pkg_dir)]):
        if info.name.endswith("_family"):
            found.setdefault(info.name.removesuffix("_family"), f"oracles.{info.name}")
    return dict(sorted(found.items()))


def load_family(module_name: str, *, required: bool):
    """Import a family module; return ``None`` if it does not exist and is optional."""
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if exc.name == module_name and not required:
            print(f"warning: family module {module_name} not found; skipped", file=sys.stderr)
            return None
        raise


def generate(families: list[str], tokenizers: set[str] | None, out_dir: Path) -> tuple[list[Path], int]:
    """Build, check and write fixtures; return (written paths, failure count)."""
    available = discover_families()
    cases = common.load_corpus()
    written: list[Path] = []
    failures = 0
    explicit = bool(families)
    for name in families or list(available):
        module_name = available.get(name) or FAMILIES.get(name) or f"oracles.{name}_family"
        try:
            module = load_family(module_name, required=explicit)
        except Exception:  # noqa: BLE001 - report and keep going with other families
            traceback.print_exc()
            failures += 1
            continue
        if module is None:
            continue
        normalizers = getattr(module, "NORMALIZE", {})
        for tok_id, builder in sorted(module.TOKENIZERS.items()):
            if tokenizers and tok_id not in tokenizers:
                continue
            print(f"[{name}] {tok_id} ...", file=sys.stderr, flush=True)
            try:
                doc = builder(cases)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                failures += 1
                continue
            errors = common.check_fixture(doc, normalize=normalizers.get(tok_id))
            if errors:
                failures += 1
                for err in errors[:50]:
                    print(f"INVARIANT FAILED {err}", file=sys.stderr)
                print(f"{tok_id}: {len(errors)} invariant failure(s); fixture not written", file=sys.stderr)
                continue
            written.append(common.write_fixture(doc, out_dir))
    return written, failures


def diff_against_committed(generated: list[Path]) -> int:
    """Compare freshly generated files with ``fixtures/``; return the number that differ."""
    stale = 0
    for path in generated:
        committed = common.FIXTURES_DIR / path.name
        new = path.read_bytes()
        old = committed.read_bytes() if committed.exists() else b""
        if new == old:
            print(f"ok      fixtures/{path.name}")
            continue
        stale += 1
        print(f"STALE   fixtures/{path.name}")
        diff = difflib.unified_diff(
            old.decode("utf-8").splitlines(),
            new.decode("utf-8").splitlines(),
            f"fixtures/{path.name}",
            "regenerated",
            lineterm="",
            n=1,
        )
        for i, line in enumerate(diff):
            if i >= 40:
                print("    ... (diff truncated)")
                break
            print(f"    {line}")
    return stale


def find_orphans(generated: list[Path]) -> list[Path]:
    """Committed ``fixtures/*.json`` files whose name is not among ``generated``."""
    names = {path.name for path in generated}
    return sorted(p for p in common.FIXTURES_DIR.glob("*.json") if p.name not in names)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--family", action="append", default=[], help="family short name (repeatable)")
    parser.add_argument("--tokenizer", action="append", default=[], help="only this tokenizer id (repeatable)")
    parser.add_argument("--check", action="store_true", help="regenerate into a temp dir and diff against fixtures/")
    parser.add_argument("--list", action="store_true", help="list known families and exit")
    args = parser.parse_args(argv)
    if args.list:
        for name, module in discover_families().items():
            print(f"{name:16} {module}")
        return 0
    tokenizers = set(args.tokenizer) or None
    full_run = not args.family and not tokenizers
    if args.check:
        with tempfile.TemporaryDirectory(prefix="fixtures-check-") as tmp:
            written, failures = generate(args.family, tokenizers, Path(tmp))
            stale = diff_against_committed(written)
            orphans = find_orphans(written) if full_run and not failures else []
        for path in orphans:
            print(f"ORPHAN  fixtures/{path.name} (no builder produces it; a full run deletes it)")
        print(f"{len(written)} fixture(s) checked, {stale} stale, {len(orphans)} orphan(s), {failures} failure(s)")
        return 1 if stale or orphans or failures or not written else 0
    common.FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    written, failures = generate(args.family, tokenizers, common.FIXTURES_DIR)
    for path in written:
        print(f"wrote {path.relative_to(common.REPO_ROOT).as_posix()}")
    if full_run and not failures:
        for path in find_orphans(written):
            path.unlink()
            print(f"removed {path.relative_to(common.REPO_ROOT).as_posix()} (no builder produces it)")
    print(f"{len(written)} fixture(s) written, {failures} failure(s)")
    return 1 if failures or not written else 0


if __name__ == "__main__":
    sys.exit(main())
