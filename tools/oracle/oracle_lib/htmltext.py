"""Extract readable plain text from a server-rendered HTML page.

Some licence texts exist only as web pages (e.g. the Gemma Terms of Use at
https://ai.google.dev/gemma/terms). The raw HTML is snapshotted as served, and
this module derives a plain-text copy from it for the ``html-text`` source type.

Only elements whose ``class`` attribute contains one of the requested classes
are rendered (outermost match, in document order), so page chrome outside them
(scripts, navigation, per-request CSP nonces) never affects the result: the same
article always gives byte-identical text. Rendering rules:

* headings become ``#``-prefixed lines (``<h2>`` -> ``## ...``);
* each paragraph, list item or other block becomes one line, with runs of
  whitespace (including source line wraps and no-break spaces) collapsed to one
  space; ``<ol>`` items are numbered ``1.``, ``<ul>`` items get ``-``, nested
  lists are indented by two spaces per level;
* blocks are separated by one blank line and the text ends with one newline;
* ``<script>``, ``<style>``, ``<template>``, ``<button>`` and custom
  ``devsite-*`` elements are skipped; link targets are dropped (link text kept).

Only the standard library is used.
"""

from __future__ import annotations

from html.parser import HTMLParser

_HEADINGS = {f"h{n}": n for n in range(1, 7)}
_BLOCKS = frozenset(
    "address article aside blockquote dd div dl dt figcaption figure footer header hr li main ol p pre "
    "section table td th tr ul".split()
)
_SKIP = frozenset({"script", "style", "template", "noscript", "button", "svg"})
_VOID = frozenset("area base br col embed hr img input link meta source track wbr".split())


class _Extractor(HTMLParser):
    def __init__(self, classes: frozenset[str]) -> None:
        super().__init__(convert_charrefs=True)
        self.classes = classes
        self.stack: list[tuple[str, bool, bool]] = []  # (tag, opens a selected element, skipped)
        self.inside = 0  # open selected elements (0 or 1: only the outermost match counts)
        self.skipping = 0  # open skipped elements inside a selected one
        self.lists: list[list] = []  # [tag, item counter] per open <ul>/<ol>
        self.blocks: list[str] = []
        self.fragments: list[str] = []
        self.prefix = ""

    def _flush(self) -> None:
        text = " ".join("".join(self.fragments).split())
        self.fragments = []
        if text:
            self.blocks.append(self.prefix + text)
            self.prefix = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _VOID:
            if self.inside and not self.skipping and tag in ("br", "hr"):
                self._flush()
            return
        classes = set((dict(attrs).get("class") or "").split())
        selected = not self.inside and bool(classes & self.classes)
        skipped = bool(self.inside or selected) and (tag in _SKIP or tag.startswith("devsite-"))
        self.stack.append((tag, selected, skipped))
        self.inside += selected
        self.skipping += skipped
        if not self.inside or self.skipping:
            return
        if tag in _HEADINGS:
            self._flush()
            self.prefix = "#" * _HEADINGS[tag] + " "
        elif tag in ("ul", "ol"):
            self._flush()
            self.lists.append([tag, 0])
        elif tag == "li":
            self._flush()
            indent = "  " * max(len(self.lists) - 1, 0)
            if self.lists:
                self.lists[-1][1] += 1
                kind, count = self.lists[-1]
                self.prefix = indent + (f"{count}. " if kind == "ol" else "- ")
            else:
                self.prefix = "- "
        elif tag in _BLOCKS:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in _VOID or not any(entry[0] == tag for entry in self.stack):
            return  # stray end tag
        while self.stack:
            open_tag, selected, skipped = self.stack.pop()
            active = self.inside and not self.skipping
            if active and (open_tag in _HEADINGS or open_tag in _BLOCKS):
                self._flush()
            if active and open_tag in ("ul", "ol") and self.lists:
                self.lists.pop()
            self.skipping -= skipped
            if selected:
                self._flush()
                self.inside -= 1
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        if self.inside and not self.skipping:
            self.fragments.append(data)


def extract(html: str, classes: list[str] | tuple[str, ...]) -> str:
    """Return the plain text of the elements carrying any of ``classes`` (see module docstring).

    Raises ``ValueError`` if no element matches, so a page redesign fails loudly
    instead of producing an empty licence text.
    """
    parser = _Extractor(frozenset(classes))
    parser.feed(html)
    parser.close()
    parser._flush()
    if not parser.blocks:
        raise ValueError(f"no element with class {sorted(classes)} found, or it holds no text")
    return "\n\n".join(parser.blocks) + "\n"
