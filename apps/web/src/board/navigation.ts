/**
 * The board's keyboard state machine (05 §8, APG layout grid): pure functions from (units, shown tiers, focused cell, key)
 * to the next focused cell, or null when the key does nothing there.
 *
 * - ←/→: previous/next logical cell of the tier by its unit (a fragmented span is one cell), wrapping across rows;
 * - ↑/↓: change tier keeping the byte anchor (char ↔ byte ↔ chunk ↔ token, absent tiers skipped); no-op at the top/bottom;
 * - Home/End: row start/end; Ctrl+Home/End: board start/end; PageUp/PageDown: previous/next packed row, same tier,
 *   nearest column (rows entirely covered by the focused span are skipped so the key always makes progress).
 *
 * `resolveAnchor` maps the byte-offset focus anchor (AD-17) to the navigable cell that holds it now.
 */
import type { BoardTier } from './geometry.ts';
import type { Anchor, BoardUnits, CellRef } from './units.ts';

/** The board tiers top to bottom: the distance an absent tier's anchor travels to a shown one. */
const TIER_ORDER: readonly BoardTier[] = ['char', 'hex', 'dec', 'chunk', 'token'];

export type NavKey =
  'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'boardStart' | 'boardEnd' | 'pageUp' | 'pageDown';

/** Maps a keydown to a navigation key (`event.key` for the named keys; Ctrl/⌘ turns Home/End into board start/end). */
export function navKeyOf(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): NavKey | null {
  if (event.altKey) return null;
  const board = event.ctrlKey || event.metaKey;
  switch (event.key) {
    case 'ArrowLeft':
      return board ? null : 'left';
    case 'ArrowRight':
      return board ? null : 'right';
    case 'ArrowUp':
      return board ? null : 'up';
    case 'ArrowDown':
      return board ? null : 'down';
    case 'Home':
      return board ? 'boardStart' : 'home';
    case 'End':
      return board ? 'boardEnd' : 'end';
    case 'PageUp':
      return board ? null : 'pageUp';
    case 'PageDown':
      return board ? null : 'pageDown';
    default:
      return null;
  }
}

function step(units: BoardUnits, from: CellRef, delta: 1 | -1): CellRef | null {
  const total = units.count(from.tier);
  for (let index = from.index + delta; index >= 0 && index < total; index += delta) {
    const ref = { tier: from.tier, index };
    if (units.navigable(ref)) return ref;
  }
  return null;
}

function edge(units: BoardUnits, tier: BoardTier, last: boolean): CellRef | null {
  const total = units.count(tier);
  for (let k = 0; k < total; k++) {
    const ref = { tier, index: last ? total - 1 - k : k };
    if (units.navigable(ref)) return ref;
  }
  return null;
}

function changeTier(units: BoardUnits, tiers: readonly BoardTier[], from: CellRef, delta: 1 | -1): CellRef | null {
  const next = tiers[tiers.indexOf(from.tier) + delta];
  if (next === undefined) return null;
  const { start } = units.span(from.tier, from.index);
  const ref = units.resolve({ tier: next, byte: start, slot: -1 });
  return ref !== null && units.navigable(ref) ? ref : null;
}

function rowEdge(units: BoardUnits, from: CellRef, last: boolean): CellRef | null {
  const items = units.inRow(from.tier, units.rowOf(from));
  const item = last ? items.at(-1) : items[0];
  return item === undefined ? null : { tier: from.tier, index: item.index };
}

function pageRow(units: BoardUnits, from: CellRef, delta: 1 | -1): CellRef | null {
  const here = units.placed(from)[0];
  if (here === undefined) return null;
  const centre = here.col + here.span / 2;
  for (let row = here.row + delta; row >= 0 && row < units.rows.length; row += delta) {
    let best: CellRef | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of units.inRow(from.tier, row)) {
      if (item.index === from.index) continue;
      const distance = Math.abs(item.col + item.span / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { tier: from.tier, index: item.index };
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** The cell `key` moves focus to from `from`, or null (edge no-op, or nothing to move to). */
export function navigate(units: BoardUnits, tiers: readonly BoardTier[], from: CellRef, key: NavKey): CellRef | null {
  switch (key) {
    case 'left':
      return step(units, from, -1);
    case 'right':
      return step(units, from, 1);
    case 'up':
      return changeTier(units, tiers, from, -1);
    case 'down':
      return changeTier(units, tiers, from, 1);
    case 'home':
      return rowEdge(units, from, false);
    case 'end':
      return rowEdge(units, from, true);
    case 'boardStart':
      return edge(units, from.tier, false);
    case 'boardEnd':
      return edge(units, from.tier, true);
    case 'pageUp':
      return pageRow(units, from, -1);
    case 'pageDown':
      return pageRow(units, from, 1);
  }
}

/**
 * The navigable unit holding `anchor` among the shown `tiers`, or null when no shown tier has one. The anchor's tier is
 * tried first, then the other shown tiers by distance from it (ties in ARIA row order); within a tier, the unit covering
 * the byte, else its nearest navigable neighbour. A tier with no navigable unit (the empty char tier of an empty text
 * whose only token is a trailing BOS marker, AD-25) passes the anchor on, so the board always keeps its tab stop.
 */
export function resolveAnchor(units: BoardUnits, tiers: readonly BoardTier[], anchor: Anchor): CellRef | null {
  const distance = (tier: BoardTier): number => Math.abs(TIER_ORDER.indexOf(tier) - TIER_ORDER.indexOf(anchor.tier));
  for (const tier of [...tiers].sort((x, y) => distance(x) - distance(y))) {
    const ref = units.resolve({ tier, byte: anchor.byte, slot: tier === anchor.tier ? anchor.slot : -1 });
    if (ref === null) continue;
    if (units.navigable(ref)) return ref;
    const near = step(units, ref, 1) ?? step(units, ref, -1);
    if (near !== null) return near;
  }
  return null;
}
