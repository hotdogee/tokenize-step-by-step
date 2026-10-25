/**
 * The board choreography of 05 §7, applied to the board's DOM around one commit: `prepare(grid, change, reduced)` runs
 * before Svelte updates the board (First rects), `play()` after it (Last rects → animations). Lazy chunk (the director
 * imports it on the first interaction with the page). Only rows in the viewport take part.
 *
 * | Change | Full motion | Reduced motion |
 * |---|---|---|
 * | stop 1→2 | U+ labels: opacity + translateY(4px), stagger 6 ms (cap 180), 200 ms ease-out | 120 ms opacity |
 * | stop 2→3 | char boxes FLIP (translate + scaleX; glyph and label counter-scaled, so they only translate), byte cells unfold (translateY(−8px) + opacity, stagger 8 ms, cap 180), 350 ms | 120 ms opacity |
 * | stop 3→4 | chunk brackets `clip-path` reveal, marker chips scale in, parts fade in, 240 ms | 120 ms opacity |
 * | stop 5→6 / 6→5 | ids fade in, chips crossfade, 200 ms | 120 ms opacity |
 * | merge / split step | chips FLIP keyed by part start (a merge grows out of its left part, a split shatters out of its parent), 280 ms, pulse on the merged part (600 ms) | discrete swap, 600 ms static outline |
 * | fast scrub (> 1 step / 100 ms) | changed chips crossfade, 80 ms opacity | same |
 *
 * Above `MAX_FLIP_CELLS` changed cells the visible rows crossfade instead of a per-cell FLIP.
 */
import { cancelAll, flip, run, snapshot, unchanged, type CoverOf, type KeyOf, type Snapshot } from './flip.ts';

export { cancelAll };

/** Per-cell FLIP up to this many changed cells; above it the rows crossfade (05 §7). */
export const MAX_FLIP_CELLS = 600;
/**
 * Above this many changed cells the morph keeps its shape with fewer composited layers (each animated element is one,
 * and layerizing hundreds of them costs main-thread frames): the byte tier unfolds row by row instead of cell by cell,
 * and only the glyphs (not the U+ labels) are counter-scaled.
 */
export const DETAIL_CELLS = 120;
const EASE = 'cubic-bezier(.2,0,0,1)';
/** Reduced motion: opacity swaps only, ≤ 150 ms. */
const REDUCED_MS = 120;

export type Change =
  | { readonly kind: 'stage'; readonly from: number; readonly to: number }
  | { readonly kind: 'step'; readonly fast: boolean; readonly forward: boolean };

export interface Prepared {
  play(): void;
}

const CHIP = '.bd-cell-token > .bd-vis';
/** Layers that only enter (fade, unfold, reveal): which elements are new matters, their rects do not. */
const ENTERING = { measure: false } as const;

function rowOf(el: Element): string | null {
  return el.closest<HTMLElement>('.bd-row')?.dataset['row'] ?? null;
}

function cellOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[role="gridcell"]');
}

/** Rows of `grid` intersecting the viewport. */
function visibleRows(grid: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  const height = window.innerHeight;
  for (const row of grid.querySelectorAll<HTMLElement>('.bd-row')) {
    const { top, bottom } = row.getBoundingClientRect();
    if (bottom > 0 && top < height) rows.set(row.dataset['row'] ?? '', row);
  }
  return rows;
}

/** A chip's key: row, first column and span of its gridcell (columns are byte-stable, AD-17, so this is its byte span). */
function chipKey(el: HTMLElement, row: string): string | null {
  const cell = cellOf(el);
  if (cell === null) return null;
  return `${row}:${cell.getAttribute('aria-colindex') ?? ''}:${cell.getAttribute('aria-colspan') ?? '1'}`;
}

/** The old chip of the same row whose columns contain the new chip's first column. */
const coverChip: CoverOf = (key, firsts) => {
  const [row, col] = key.split(':').map(Number);
  for (const old of firsts.keys()) {
    const [r, c, s] = old.split(':').map(Number);
    if (r === row && c !== undefined && s !== undefined && col !== undefined && c <= col && col < c + s) return old;
  }
  return null;
};

function fade(el: Element, duration: number, from = 0, delay = 0): void {
  run(el, [{ opacity: from }, { opacity: 1 }], { duration, delay, easing: 'ease-out', fill: 'backwards' });
}

function crossfadeRows(rows: Iterable<HTMLElement>, duration: number): void {
  for (const row of rows) fade(row, duration, 0.25);
}

function column(el: Element): number {
  return Number(cellOf(el)?.getAttribute('aria-colindex') ?? 1) - 1;
}

/** Snapshots the board for `change`; call `play()` once Svelte has committed it. */
export function prepare(grid: HTMLElement, change: Change, reduced: boolean): Prepared {
  cancelAll();
  const rows = visibleRows(grid);
  const keyed =
    (key: (el: HTMLElement, row: string) => string | null): KeyOf =>
    (el) => {
      const row = rowOf(el);
      return row !== null && rows.has(row) ? key(el, row) : null;
    };
  const byCell = keyed((el, row) => {
    const cell = cellOf(el);
    return cell === null ? null : `${row}:${cell.dataset['tier'] ?? ''}:${cell.dataset['index'] ?? ''}`;
  });

  if (change.kind === 'step') {
    const chips = snapshot(grid, CHIP, keyed(chipKey), { cover: coverChip });
    return {
      play: () => {
        playStep(chips, rows.values(), change, reduced);
      },
    };
  }
  const layers = {
    boxes: snapshot(grid, '.bd-cell-char > .bd-box', byCell),
    labels: snapshot(grid, '.bd-ulabel', byCell, ENTERING),
    bytes: snapshot(grid, '.bd-cell-byte > .bd-vis', byCell, ENTERING),
    chunks: snapshot(grid, '.bd-cell-chunk > .bd-vis', byCell, ENTERING),
    chips: snapshot(
      grid,
      CHIP,
      keyed((el, row) => `${byCell(el) ?? row}:${cellOf(el)?.dataset['variant'] ?? ''}`),
      ENTERING,
    ),
    ids: snapshot(
      grid,
      '.bd-id, .bd-idl',
      keyed((el, row) => `${row}:${el.textContent}:${String(column(el))}`),
      ENTERING,
    ),
  };
  return {
    play() {
      const boxes = layers.boxes.commit().pairs.filter((pair) => !unchanged(pair));
      const added = {
        labels: layers.labels.commit().added,
        bytes: layers.bytes.commit().added,
        chunks: layers.chunks.commit().added,
        chips: layers.chips.commit().added,
        ids: layers.ids.commit().added,
      };
      const entering = Object.values(added).flat();
      if (boxes.length + entering.length > MAX_FLIP_CELLS) {
        crossfadeRows(rows.values(), reduced ? REDUCED_MS : 200);
        return;
      }
      if (reduced) {
        for (const el of [...boxes.map((pair) => pair.el), ...entering]) fade(el, REDUCED_MS);
        return;
      }
      const detailed = boxes.length + entering.length <= DETAIL_CELLS;
      const counter = detailed ? '.bd-glyph, .bd-ulabel' : '.bd-glyph';
      for (const pair of boxes)
        flip(pair, { duration: 350, easing: EASE }, pair.el.querySelectorAll(counter), detailed);
      added.labels.forEach((el, i) => {
        run(
          el,
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 200, delay: Math.min(i * 6, 180), easing: 'ease-out', fill: 'backwards' },
          detailed,
        );
      });
      const unfold = detailed ? added.bytes : [...new Set(added.bytes.map((el) => el.closest('[role="row"]') ?? el))];
      unfold.forEach((el, i) => {
        run(
          el,
          [
            { opacity: 0, transform: 'translateY(-8px)' },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: 350,
            delay: Math.min((detailed ? column(el) : i) * 8, 180),
            easing: EASE,
            fill: 'backwards',
          },
        );
      });
      for (const el of added.chunks)
        run(el, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 240, easing: EASE });
      const chipMs = change.to === 4 ? 240 : 200;
      for (const el of added.chips) {
        if (el.classList.contains('marker'))
          run(
            el,
            [
              { opacity: 0, transform: 'scale(.6)' },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: chipMs,
              easing: EASE,
            },
          );
        else fade(el, chipMs);
      }
      for (const el of added.ids) fade(el, 200);
    },
  };
}

function playStep(chips: Snapshot, rows: Iterable<HTMLElement>, change: Change, reduced: boolean): void {
  const { pairs, added } = chips.commit();
  const moved = pairs.filter((pair) => !unchanged(pair));
  if (moved.length + added.length > MAX_FLIP_CELLS) {
    crossfadeRows(rows, 80);
    return;
  }
  if (reduced) return; // discrete swap; the director draws the static outline
  const fast = change.kind === 'step' && change.fast;
  for (const pair of moved) {
    if (fast) fade(pair.el, 80);
    else {
      flip(pair, { duration: 280, easing: EASE }, pair.el.children);
      fade(pair.el, 280, 0.55);
    }
  }
  for (const el of added) fade(el, fast ? 80 : 280);
}

/** The merged part's 600 ms pulse: an opacity keyframe on the cell's `::before` outline (reduced motion: the director's
 *  static outline instead, no animation). */
export function pulse(cells: Iterable<HTMLElement>): void {
  for (const cell of cells) {
    try {
      run(cell, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 600, pseudoElement: '::before' });
    } catch {
      // No pseudo-element animations (old engines): the star alone marks the merged part.
    }
  }
}
