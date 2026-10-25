"""Shared helpers for the tokenize-step-by-step oracle tooling.

The modules here are deliberately small and use only the standard library, so
the provenance and fetch logic can be audited at a glance:

* :mod:`oracle_lib.paths`     -- repository-relative locations.
* :mod:`oracle_lib.jsonio`    -- deterministic JSON read/write.
* :mod:`oracle_lib.fsio`      -- atomic "write only if changed".
* :mod:`oracle_lib.netio`     -- HTTP with an explicit User-Agent.
* :mod:`oracle_lib.manifest`  -- manifest schema helpers and validation.
* :mod:`oracle_lib.resolvers` -- turn a file "source" into a pinned URL.
* :mod:`oracle_lib.archives`  -- read single members out of .tgz/.whl files.
* :mod:`oracle_lib.htmltext`  -- plain text from a snapshotted HTML licence page.
* :mod:`oracle_lib.report`    -- plain-text tables for script output.
"""
