"""Reference-tokenizer oracles that produce the golden fixtures under ``fixtures/``.

Each tokenizer family lives in ``oracles/<name>_family.py`` and exposes
``TOKENIZERS: dict[str, Callable[[list[dict]], dict]]`` (tokenizer id -> builder
that turns the corpus cases into a fixture document). Shared helpers are in
:mod:`oracles.common`; ``tools/oracle/gen_fixtures.py`` drives everything.
"""
