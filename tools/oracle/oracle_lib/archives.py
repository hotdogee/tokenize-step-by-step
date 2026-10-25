"""Read individual members out of downloaded archives without extracting them.

Archives are untrusted input: members are read into memory by exact name and
nothing is ever written to disk using a path taken from the archive.
"""

from __future__ import annotations

import io
import tarfile
import zipfile
from pathlib import Path


def read_member(archive: Path, member: str) -> bytes:
    """Return the bytes of ``member`` inside ``archive`` (.tgz/.tar.gz or .whl/.zip)."""
    name = archive.name.lower()
    data = archive.read_bytes()
    if name.endswith((".tgz", ".tar.gz")):
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            info = tar.getmember(member)
            if not info.isfile():
                raise ValueError(f"{member!r} in {archive.name} is not a regular file")
            handle = tar.extractfile(info)
            if handle is None:
                raise ValueError(f"cannot read {member!r} from {archive.name}")
            return handle.read()
    if name.endswith((".whl", ".zip")):
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return zf.read(member)
    raise ValueError(f"unsupported archive type: {archive.name}")
