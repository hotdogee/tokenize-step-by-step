/**
 * Per-cell interaction state the Row derives for each cell (05 §5, §6, §8): the roving tab stop, the active logical cell
 * (all fragments get `data-active`), the pinned cell, the vertical slice of the inspected cell and the textarea
 * selection — all as plain booleans so the cell components only map them to attributes.
 */
import type { BoardTier } from './geometry.ts';
import type { CellRef, Span } from './units.ts';

export interface CellState {
  readonly tabbable: boolean;
  readonly active: boolean;
  readonly pinned: boolean;
  readonly slice: boolean;
  readonly selected: boolean;
}

/** What the Row needs to decide each cell's state. */
export interface InteractionState {
  readonly focus: CellRef | null;
  readonly pinned: CellRef | null;
  /** Byte span of the inspected cell (vertical slice across tiers), or null. */
  readonly slice: Span | null;
  /** Byte span of the textarea selection, or null. */
  readonly selected: Span | null;
}

function overlaps(span: Span | null, start: number, end: number): boolean {
  if (span === null) return false;
  if (span.start === span.end) return start === end && start === span.start;
  return start < span.end && end > span.start;
}

/** The state of the cell (`tier`, `index`) whose fragment covers bytes [start, end). */
export function cellState(
  interaction: InteractionState,
  tier: BoardTier,
  index: number,
  start: number,
  end: number,
  first: boolean,
): CellState {
  const { focus, pinned } = interaction;
  const isFocus = focus !== null && focus.tier === tier && focus.index === index;
  return {
    tabbable: isFocus && first,
    active: isFocus,
    pinned: pinned !== null && pinned.tier === tier && pinned.index === index,
    slice: overlaps(interaction.slice, start, end),
    selected: overlaps(interaction.selected, start, end),
  };
}

/** The tint classes of tint index `tint` (−1: none). */
export function tintClass(tint: number): string {
  return tint < 0 ? '' : `bd-t${String(tint)} tinted`;
}

/** Placement classes of a cell at 0-based column `col` spanning `span` columns (AD-15 generated classes). */
export function placeClass(col: number, span: number): string {
  return `c${String(col + 1)} s${String(Math.max(1, span))}`;
}
