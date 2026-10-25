"""Resolve a manifest file's ``source`` into a pinned, immutable location.

Source types and the pin each produces:

``huggingface`` ``{repo, path}``
    ``GET https://huggingface.co/api/models/<repo>`` -> field ``sha``; URL
    ``https://huggingface.co/<repo>/resolve/<sha>/<path>``.
``github`` ``{repo, path, ref?}``
    Latest commit touching ``path`` (``GET /repos/<repo>/commits?path=..&per_page=1``)
    unless an explicit ``ref`` commit is given; URL
    ``https://raw.githubusercontent.com/<repo>/<sha>/<path>``.
``url`` ``{url}``
    Hosts without a revision system (e.g. Azure blob, apache.org,
    ai.google.dev). ``revision`` is ``etag:<ETag>``, or
    ``last-modified:<Last-Modified>`` when the host sends no ETag; the
    ``ETag``/``Last-Modified``/``Content-MD5`` headers are recorded. The URL
    itself is mutable upstream: the recorded sha256 (and Content-MD5, when
    present) is the integrity guarantee.
``npm`` ``{package, version}``
    Registry ``dist.tarball``; ``revision`` is the registry ``dist.integrity``.
``pypi`` ``{package, version, filename}``
    PyPI JSON API file URL; ``revision`` is ``sha256:<digest>`` as published.
``archive-member`` ``{archive, member}``
    A member of another file of the same asset; URL is ``<archive url>#<member>``
    and ``revision`` is the archive's revision.
``html-text`` ``{document, classes}``
    Plain text extracted (:mod:`oracle_lib.htmltext`) from another file of the
    same asset, an HTML page; URL and ``revision`` are the page's.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cache
from typing import Any
from urllib.parse import quote

from . import netio
from .manifest import Asset, FileEntry, file_by_name


@dataclass(frozen=True)
class Pin:
    """A resolved immutable location for one file."""

    url: str
    revision: str
    http_headers: dict[str, str] = field(default_factory=dict)


class ResolveError(RuntimeError):
    """A source could not be resolved (missing file, API error, gated...)."""

    def __init__(self, message: str, gated: bool = False) -> None:
        super().__init__(message)
        self.gated = gated


@cache
def _hf_model_info(repo: str) -> dict[str, Any]:
    return netio.get_json(f"https://huggingface.co/api/models/{repo}")


@cache
def _github_last_commit(repo: str, path: str) -> str:
    url = f"https://api.github.com/repos/{repo}/commits?path={quote(path)}&per_page=1"
    commits = netio.get_json(url)
    if not commits:
        raise ResolveError(f"github {repo}: no commit touches {path!r} (file absent?)")
    return commits[0]["sha"]


def _resolve_huggingface(src: dict[str, Any]) -> Pin:
    info = _hf_model_info(src["repo"])
    siblings = {s["rfilename"] for s in info.get("siblings", [])}
    if src["path"] not in siblings:
        raise ResolveError(f"huggingface {src['repo']}: {src['path']!r} not in repo")
    sha = info["sha"]
    return Pin(f"https://huggingface.co/{src['repo']}/resolve/{sha}/{src['path']}", sha)


def _resolve_github(src: dict[str, Any]) -> Pin:
    sha = src.get("ref") or _github_last_commit(src["repo"], src["path"])
    return Pin(f"https://raw.githubusercontent.com/{src['repo']}/{sha}/{src['path']}", sha)


def _resolve_url(src: dict[str, Any]) -> Pin:
    resp = netio.head(src["url"])
    etag, last_modified = resp.header("etag"), resp.header("last-modified")
    if not etag and not last_modified:
        raise ResolveError(f"{src['url']}: server sent neither ETag nor Last-Modified")
    headers = {"etag": etag} if etag else {}
    for name, key in (("last-modified", "lastModified"), ("content-md5", "contentMd5")):
        if resp.header(name):
            headers[key] = resp.header(name)
    revision = f"etag:{etag}" if etag else f"last-modified:{last_modified}"
    return Pin(src["url"], revision, headers)


def _resolve_npm(src: dict[str, Any]) -> Pin:
    meta = netio.get_json(f"https://registry.npmjs.org/{src['package']}/{src['version']}")
    return Pin(meta["dist"]["tarball"], meta["dist"]["integrity"])


def _resolve_pypi(src: dict[str, Any]) -> Pin:
    meta = netio.get_json(f"https://pypi.org/pypi/{src['package']}/{src['version']}/json")
    for item in meta["urls"]:
        if item["filename"] == src["filename"]:
            return Pin(item["url"], f"sha256:{item['digests']['sha256']}")
    raise ResolveError(f"pypi {src['package']}=={src['version']}: no file {src['filename']!r}")


def resolve(asset: Asset, entry: FileEntry) -> Pin:
    """Resolve ``entry`` (a file of ``asset``) to its pinned location."""
    src = entry["source"]
    kind = src["type"]
    try:
        if kind == "huggingface":
            return _resolve_huggingface(src)
        if kind == "github":
            return _resolve_github(src)
        if kind == "url":
            return _resolve_url(src)
        if kind == "npm":
            return _resolve_npm(src)
        if kind == "pypi":
            return _resolve_pypi(src)
        if kind == "archive-member":
            archive = resolve(asset, file_by_name(asset, src["archive"]))
            return Pin(f"{archive.url}#{src['member']}", archive.revision)
        if kind == "html-text":
            page = resolve(asset, file_by_name(asset, src["document"]))
            return Pin(page.url, page.revision)
    except netio.HttpError as exc:
        raise ResolveError(str(exc), gated=exc.gated) from None
    raise ResolveError(f"unknown source type {kind!r}")
