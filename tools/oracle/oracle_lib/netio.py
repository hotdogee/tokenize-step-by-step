"""Minimal HTTP client built on :mod:`urllib` with an explicit User-Agent.

Only GET and HEAD are needed; urllib follows redirects. HTTP errors surface as
:class:`HttpError`, so callers can treat 401/403 (gated or forbidden content)
differently from genuine failures. Gated content is recorded and skipped,
never bypassed.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

USER_AGENT = "tokenize-step-by-step-oracle/0.1 (provenance fetcher; python-urllib)"
TIMEOUT_SECONDS = 180
#: Status codes meaning "access controlled".
GATED_STATUSES = frozenset({401, 403})


class HttpError(RuntimeError):
    """An HTTP request finished with a non-2xx status."""

    def __init__(self, url: str, status: int, reason: str) -> None:
        super().__init__(f"HTTP {status} {reason} for {url}")
        self.url = url
        self.status = status
        self.reason = reason

    @property
    def gated(self) -> bool:
        """True when the server refused access (401/403)."""
        return self.status in GATED_STATUSES


@dataclass(frozen=True)
class Response:
    """A completed HTTP response (header names are lower-cased)."""

    url: str
    final_url: str
    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""

    def header(self, name: str) -> str | None:
        """Case-insensitive header lookup."""
        return self.headers.get(name.lower())


def _request(url: str, method: str, accept: str | None) -> Response:
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    token = os.environ.get("GITHUB_TOKEN")
    if token and url.startswith("https://api.github.com/"):
        # Optional; lifts the unauthenticated 60 requests/hour limit. Never logged.
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            body = resp.read() if method == "GET" else b""
            return Response(
                url=url,
                final_url=resp.geturl(),
                status=resp.status,
                headers={k.lower(): v for k, v in resp.headers.items()},
                body=body,
            )
    except urllib.error.HTTPError as exc:
        raise HttpError(url, exc.code, str(exc.reason)) from None


def get(url: str, accept: str | None = None) -> Response:
    """GET ``url`` and return the full body."""
    return _request(url, "GET", accept)


def head(url: str) -> Response:
    """HEAD ``url`` (headers only)."""
    return _request(url, "HEAD", None)


def get_json(url: str) -> Any:
    """GET ``url`` and decode a JSON body."""
    return json.loads(get(url, accept="application/json").body.decode("utf-8"))
