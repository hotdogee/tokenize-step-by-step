/**
 * Selection sync (05 §6, hex-editor pattern): the textarea's UTF-16 selection maps to the byte range of the code points
 * it touches, whose cells the board marks with `data-selected`; where the CSS Custom Highlight API exists (Chrome 105,
 * Firefox 140, Safari 17.2) the covered glyphs are also painted through `::highlight(tsbs-selection)`. Elsewhere the
 * highlight is a no-op. The reverse direction ("select in text") is an explicit inspector action, never automatic.
 */
import type { TokenizationResult } from '@tsbs/core';
import type { Span } from './units.ts';

/** The highlight registered for the textarea selection. */
export const SELECTION_HIGHLIGHT = 'tsbs-selection';

/** Index of the code point containing UTF-16 offset `unit` (binary search over `utf16Start`). */
function charAtUnit(result: TokenizationResult, unit: number): number {
  const { utf16Start, count } = result.chars;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((utf16Start[mid] ?? 0) <= unit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Byte range of the code points covered by the UTF-16 selection [from, to), or null for a collapsed selection. A
 * normalized result (NFKC) maps input offsets through the source-run table.
 */
export function byteRangeOfSelection(result: TokenizationResult, from: number, to: number): Span | null {
  const { chars } = result;
  if (to <= from || chars.count === 0) return null;
  const runStart = chars.sourceRunStart;
  const runEnd = chars.sourceRunEnd;
  if (result.normalization !== null && runStart !== null && runEnd !== null) {
    let inputIndex = 0;
    let offset = 0;
    let first = -1;
    let last = -1;
    for (const ch of result.input.text) {
      if (offset < to && offset + ch.length > from) {
        if (first < 0) first = inputIndex;
        last = inputIndex;
      }
      offset += ch.length;
      inputIndex++;
    }
    if (first < 0) return null;
    let startChar = -1;
    let endChar = -1;
    for (let i = 0; i < chars.count; i++) {
      if ((runStart[i] ?? 0) <= last && (runEnd[i] ?? 0) > first) {
        if (startChar < 0) startChar = i;
        endChar = i;
      }
    }
    if (startChar < 0) return null;
    return { start: chars.byteStart[startChar] ?? 0, end: chars.byteStart[endChar + 1] ?? 0 };
  }
  const first = charAtUnit(result, from);
  const last = charAtUnit(result, Math.max(from, to - 1));
  return { start: chars.byteStart[first] ?? 0, end: chars.byteStart[last + 1] ?? 0 };
}

interface HighlightRegistryLike {
  set(name: string, value: unknown): unknown;
  delete(name: string): unknown;
}
type HighlightConstructor = new (...ranges: Range[]) => unknown;

/** Paints the glyphs of selected char cells inside `grid` (or clears the highlight). */
export function highlightSelection(grid: HTMLElement | undefined, span: Span | null): void {
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS?.highlights;
  const HighlightImpl = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  if (registry === undefined || HighlightImpl === undefined) return;
  if (grid === undefined || span === null) {
    registry.delete(SELECTION_HIGHLIGHT);
    return;
  }
  const ranges: Range[] = [];
  for (const glyph of grid.querySelectorAll<HTMLElement>('[data-tier="char"][data-selected] .bd-glyph')) {
    const range = document.createRange();
    range.selectNodeContents(glyph);
    ranges.push(range);
  }
  if (ranges.length === 0) registry.delete(SELECTION_HIGHLIGHT);
  else registry.set(SELECTION_HIGHLIGHT, new HighlightImpl(...ranges));
}
