/**
 * The board choreography of 05 §7, applied to the board's DOM around one commit: `prepare(grid, change, reduced)` runs
 * before Svelte updates the board, `play()` after it. Lazy chunk (the director imports it on the first interaction with
 * the page). Only rows in the viewport take part.
 *
 * No layout is read after the commit (06 §3: no frame over 32 ms at ≤ 600 cells): `prepare` reads the viewport rows and
 * the column width while the old layout is still clean, and FLIP spans come from the byte-stable column model (flip.ts
 * `Geometry`, AD-17). A stage change keeps its First state on screen in the frame that paints the commit — the char
 * boxes keep their stop 1–2 `--dx` / `--w` for that frame, entering layers their first keyframe — and creates its
 * animations in the next frame (flip.ts `Plan.startAfterPaint`), so the commit frame costs what the board's render
 * costs and the compositor layers of hundreds of animated elements are created in a frame of their own. A merge step
 * re-renders a few chips, so it animates at once.
 *
 * | Change | Full motion | Reduced motion |
 * |---|---|---|
 * | stop 1→2 | U+ labels: opacity + translateY(4px), stagger 6 ms (cap 180), 200 ms ease-out | 120 ms opacity |
 * | stop 2→3 | char boxes FLIP (translate + scaleX; glyphs and U+ labels counter-scaled, so they only translate), byte cells unfold (translateY(−8px) + opacity, stagger 8 ms, cap 180), 350 ms | 120 ms opacity |
 * | stop 3→4 | chunk brackets `clip-path` reveal, marker chips scale in, parts fade in, 240 ms | 120 ms opacity |
 * | stop 5→6 / 6→5 | ids fade in, chips crossfade, chunk brackets fade out (a detached copy of the leaving chunk row), 200 ms | 120 ms opacity |
 * | merge step | chips FLIP keyed by byte span (the merged chip grows out of its left part) while a copy of the right part slides the 2 px gap to abut it and fades into the merged chip, 280 ms; pulse on the merged part (600 ms) | discrete swap, 600 ms static outline |
 * | split step (spm byte fallback) | the byte chips FLIP out of the parent's span, 280 ms | discrete swap |
 * | fast scrub (> 1 step / 100 ms) | changed chips crossfade, 80 ms opacity | same |
 * | bottom sheet expands / collapses | slides up from its collapsed height + fades in, 200 ms / fades, 200 ms | 120 ms opacity |
 *
 * Above `MAX_FLIP_CELLS` changed cells the visible rows crossfade instead of a per-cell FLIP. Above `DETAIL_CELLS` the
 * morph keeps one compositor layer per box and glyph and no more (measured: every animated element costs ≈ 0.07 ms in
 * the frame that starts it): the byte tier unfolds row by row instead of cell by cell, and the U+ labels are hidden
 * while the boxes scale (`data-mo-morph` on the grid, motion.css) instead of being counter-scaled.
 */
import {
  cancelAll,
  flip,
  Plan,
  snapshot,
  unchanged,
  type CoverOf,
  type FlipPair,
  type Geometry,
  type Hold,
  type Scopes,
  type Snapshot,
} from './flip.ts';

export { cancelAll };

/** Per-cell FLIP up to this many changed cells; above it the rows crossfade (05 §7). */
export const MAX_FLIP_CELLS = 600;
/** Up to this many changed cells every cell animates on its own (see the module comment). */
export const DETAIL_CELLS = 120;
const EASE = 'cubic-bezier(.2,0,0,1)';
/** Reduced motion: opacity swaps only, ≤ 150 ms. */
const REDUCED_MS = 120;
/** The visible box / chip is inset this many px inside its gridcell (board.css: "the visible box/chip is inset 1 px"). */
const INSET = 1;
/** The gap between two neighbouring chips (two insets): what the right part slides to abut its left neighbour. */
const GAP = 2 * INSET;

export type Change =
  | { readonly kind: 'stage'; readonly from: number; readonly to: number }
  | {
      readonly kind: 'step';
      readonly fast: boolean;
      readonly forward: boolean;
      /** A single forward merge: the right part's index before the commit (its chips slide into the left part). */
      readonly mergeRight: number | null;
    };

export interface Prepared {
  play(): void;
}

type Rows = ReadonlyMap<string, HTMLElement>;

const BOX = '.bd-cell-char > .bd-box';
const CHIP = '.bd-cell-token > .bd-vis';
/** The byte tier rows of a packed row (hex, dec). */
const BYTE_ROWS = ':scope > .bd-tier-hex, :scope > .bd-tier-dec';
/** Attributes a detached copy must not keep: it is decoration, never a cell (no role, focus, ids, data hooks). */
const GHOST_STRIP = /^(?:role|tabindex|id|aria-.*|data-.*)$/;

let morphs = 0;

function cellOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[role="gridcell"]');
}

/** Rows of `grid` intersecting the viewport (read before the commit, while the layout is clean). */
function visibleRows(grid: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  const height = window.innerHeight;
  for (const row of grid.querySelectorAll<HTMLElement>('.bd-row')) {
    const { top, bottom } = row.getBoundingClientRect();
    if (bottom > 0 && top < height) rows.set(row.dataset['row'] ?? '', row);
  }
  return rows;
}

/** One column in px: the grid is exactly K columns wide (board.css `.bd-grid`, `aria-colcount` = K). */
function columnWidth(grid: HTMLElement): number {
  const k = Number(grid.getAttribute('aria-colcount'));
  return k > 0 ? grid.getBoundingClientRect().width / k : 0;
}

/** A gridcell's first column (0-based) and span, from its ARIA attributes. */
function columnsOf(cell: HTMLElement | null): { readonly col: number; readonly span: number } | null {
  if (cell === null) return null;
  const col = Number(cell.getAttribute('aria-colindex')) - 1;
  const span = Number(cell.getAttribute('aria-colspan') ?? 1);
  return col >= 0 && span > 0 ? { col, span } : null;
}

/**
 * A char box: its gridcell's columns, shifted and sized by the box's `--dx` / `--w` (board.css `.bd-box`); an unset one
 * is the CSS default — no shift, the cell's span (CharCell.svelte writes only the values that differ).
 */
function boxGeometry(column: number): Geometry {
  return (el) => {
    const at = columnsOf(cellOf(el));
    if (at === null) return null;
    const dx = Number(el.style.getPropertyValue('--dx') || 0);
    const w = Number(el.style.getPropertyValue('--w') || at.span);
    return { left: (at.col + dx) * column + INSET, width: w * column - 2 * INSET };
  };
}

/** A chip: the columns of its gridcell, inset. */
function chipGeometry(column: number): Geometry {
  return (el) => {
    const at = columnsOf(cellOf(el));
    return at === null ? null : { left: at.col * column + INSET, width: at.span * column - 2 * INSET };
  };
}

/** A cell layer's key: row, tier and index of its gridcell. */
function cellKey(el: HTMLElement, row: string): string | null {
  const cell = cellOf(el);
  return cell === null ? null : `${row}:${cell.dataset['tier'] ?? ''}:${cell.dataset['index'] ?? ''}`;
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

function variantOf(el: HTMLElement): string {
  return cellOf(el)?.dataset['variant'] ?? '';
}

function column(el: Element): number {
  return Number(cellOf(el)?.getAttribute('aria-colindex') ?? 1) - 1;
}

function fade(plan: Plan, el: Element, duration: number, from = 0): void {
  plan.add(el, [{ opacity: from }, { opacity: 1 }], { duration, easing: 'ease-out', fill: 'backwards' });
}

function crossfadeRows(plan: Plan, rows: Rows, duration: number): void {
  for (const row of rows.values()) fade(plan, row, duration, 0.25);
}

/**
 * A decorative copy of `source` appended to `parent` (aria-hidden, inert, no roles, ids or data hooks, so neither the
 * board's queries nor assistive technology ever see it); the caller removes it when its animation ends.
 */
function ghost(source: HTMLElement, parent: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll('*')])
    for (const { name } of [...el.attributes]) if (GHOST_STRIP.test(name)) el.removeAttribute(name);
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.classList.add('mo-ghost');
  parent.append(copy);
  return copy;
}

/** Plans `keyframes` on a ghost of `source` in `parent`, removed when the animation ends or is cancelled. */
function animateGhost(
  plan: Plan,
  source: HTMLElement,
  parent: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): HTMLElement {
  const copy = ghost(source, parent);
  plan.add(
    copy,
    keyframes,
    { ...options, fill: 'forwards' },
    {
      hint: false,
      onEnd: () => {
        copy.remove();
      },
    },
  );
  return copy;
}

const chunked = (stage: number): boolean => stage === 4 || stage === 5;

/** The layers a stage change can add, move or remove (the others are not even looked at). */
function stageLayers(from: number, to: number): Record<'boxes' | 'labels' | 'bytes' | 'chunks' | 'chips', boolean> {
  return {
    boxes: from <= 2 !== to <= 2, // uniform left-packed boxes at stops 1–2, byte spans from stop 3 (AD-17)
    labels: from < 2 && to >= 2,
    bytes: from < 3 && to >= 3,
    chunks: !chunked(from) && chunked(to),
    chips: to >= 4, // parts at stops 4–5, final tokens with ids at stop 6
  };
}

/** The chunk tier of each row and the row (the tier leaves when the stage drops below 4 or reaches 6). */
function chunkRows(rows: Rows): Array<readonly [HTMLElement, HTMLElement]> {
  const out: Array<readonly [HTMLElement, HTMLElement]> = [];
  for (const row of rows.values()) {
    const tier = row.querySelector<HTMLElement>(':scope > .bd-tier-chunk');
    if (tier !== null) out.push([tier, row]);
  }
  return out;
}

/** The box keeps its First `--dx` / `--w` (as the board wrote them before the commit) until its FLIP starts. */
function holdBox(el: HTMLElement, first: readonly [string, string]): Hold {
  return () => {
    const last = [el.style.getPropertyValue('--dx'), el.style.getPropertyValue('--w')] as const;
    el.style.setProperty('--dx', first[0]);
    el.style.setProperty('--w', first[1]);
    // Restores exactly what the board wrote, so the board's own record of these values stays true — unless the board
    // has written newer values in the meantime (a resize re-packed the rows): those stay.
    return () => {
      if (el.style.getPropertyValue('--dx') === first[0]) el.style.setProperty('--dx', last[0]);
      if (el.style.getPropertyValue('--w') === first[1]) el.style.setProperty('--w', last[1]);
    };
  };
}

interface Entering {
  readonly labels: readonly HTMLElement[];
  /** Byte tier rows (their cells unfold one by one in a detailed morph). */
  readonly bytes: readonly HTMLElement[];
  readonly chunks: readonly HTMLElement[];
  readonly chips: readonly HTMLElement[];
  readonly ids: readonly HTMLElement[];
}

/** Snapshots the board for `change`; call `play()` once Svelte has committed it. */
export function prepare(grid: HTMLElement, change: Change, reduced: boolean): Prepared {
  cancelAll();
  const rows = visibleRows(grid);
  const width = columnWidth(grid);

  if (change.kind === 'step') {
    const chips = snapshot(rows, CHIP, chipKey, { geometry: chipGeometry(width), cover: coverChip });
    // The right part's chips are about to be re-rendered (cells are keyed by part index): copy them now.
    const right: Array<readonly [HTMLElement, HTMLElement]> = [];
    if (change.mergeRight !== null && !change.fast && !reduced)
      for (const row of rows.values())
        for (const cell of row.querySelectorAll<HTMLElement>(
          `[data-tier="token"][data-index="${String(change.mergeRight)}"]`,
        ))
          if (cell.parentElement !== null) right.push([cell.cloneNode(true) as HTMLElement, cell.parentElement]);
    return {
      play: () => {
        playStep(chips, right, rows, change.fast, reduced);
      },
    };
  }

  const take = stageLayers(change.from, change.to);
  const none: Rows = new Map();
  const scope = (on: boolean): Scopes => (on ? rows : none);
  const firstVars = new Map<HTMLElement, readonly [string, string]>();
  if (take.boxes)
    for (const row of rows.values())
      for (const box of row.querySelectorAll<HTMLElement>(BOX))
        firstVars.set(box, [box.style.getPropertyValue('--dx'), box.style.getPropertyValue('--w')]);
  const byteRowKey = (el: HTMLElement, row: string): string =>
    `${row}:${el.classList.contains('bd-tier-dec') ? 'dec' : 'hex'}`;
  const layers = {
    boxes: snapshot(scope(take.boxes), BOX, cellKey, { geometry: boxGeometry(width) }),
    labels: snapshot(scope(take.labels), '.bd-ulabel', cellKey),
    bytes: snapshot(scope(take.bytes), BYTE_ROWS, byteRowKey),
    chunks: snapshot(scope(take.chunks), '.bd-cell-chunk > .bd-vis', cellKey),
    chips: snapshot(scope(take.chips), CHIP, (el, row) => `${cellKey(el, row) ?? row}:${variantOf(el)}`),
    ids: snapshot(scope(take.chips), '.bd-id, .bd-idl', (el, row) => `${row}:${el.textContent}:${String(column(el))}`),
  };
  const leaving = chunked(change.from) && !chunked(change.to) ? chunkRows(rows) : [];
  return {
    play() {
      const plan = new Plan();
      const boxes = layers.boxes.commit().pairs.filter((pair) => !unchanged(pair));
      const added: Entering = {
        labels: layers.labels.commit().added,
        bytes: layers.bytes.commit().added,
        chunks: layers.chunks.commit().added,
        chips: layers.chips.commit().added,
        ids: layers.ids.commit().added,
      };
      for (const [tier, row] of leaving)
        if (!tier.isConnected && row.isConnected)
          animateGhost(plan, tier, row, [{ opacity: 1 }, { opacity: 0 }], {
            duration: reduced ? REDUCED_MS : 200,
            easing: 'ease-out',
          });
      const byteCells = added.bytes.reduce((sum, row) => sum + row.childElementCount, 0);
      const cells =
        boxes.length + added.labels.length + byteCells + added.chunks.length + added.chips.length + added.ids.length;
      if (cells > MAX_FLIP_CELLS) crossfadeRows(plan, rows, reduced ? REDUCED_MS : 200);
      else if (reduced)
        for (const el of [
          ...boxes.map((pair) => pair.el),
          ...added.labels,
          ...added.bytes,
          ...added.chunks,
          ...added.chips,
          ...added.ids,
        ])
          fade(plan, el, REDUCED_MS);
      else playStage(plan, grid, { boxes, firstVars, added, to: change.to, detailed: cells <= DETAIL_CELLS });
      plan.startAfterPaint();
    },
  };
}

interface StageMotion {
  readonly boxes: readonly FlipPair[];
  readonly firstVars: ReadonlyMap<HTMLElement, readonly [string, string]>;
  readonly added: Entering;
  readonly to: number;
  readonly detailed: boolean;
}

function playStage(plan: Plan, grid: HTMLElement, { boxes, firstVars, added, to, detailed }: StageMotion): void {
  const counter = detailed ? '.bd-glyph, .bd-ulabel' : '.bd-glyph';
  for (const pair of boxes) {
    const first = firstVars.get(pair.el);
    flip(plan, pair, { duration: 350, easing: EASE }, pair.el.querySelectorAll(counter), {
      hint: detailed,
      ...(first === undefined ? {} : { hold: holdBox(pair.el, first) }),
    });
  }
  added.labels.forEach((el, i) => {
    plan.add(
      el,
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 200, delay: Math.min(i * 6, 180), easing: 'ease-out', fill: 'backwards' },
      { hint: detailed },
    );
  });
  const unfold = detailed
    ? added.bytes.flatMap((row) => [...row.querySelectorAll<HTMLElement>('.bd-cell-byte > .bd-vis')])
    : added.bytes;
  unfold.forEach((el, i) => {
    plan.add(
      el,
      [
        { opacity: 0, transform: 'translateY(-8px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 350, delay: Math.min((detailed ? column(el) : i) * 8, 180), easing: EASE, fill: 'backwards' },
      { hint: detailed },
    );
  });
  for (const el of added.chunks)
    plan.add(el, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 240, easing: EASE });
  const chipMs = to === 4 ? 240 : 200;
  for (const el of added.chips) {
    if (el.classList.contains('marker'))
      plan.add(
        el,
        [
          { opacity: 0, transform: 'scale(.6)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: chipMs, easing: EASE },
      );
    else fade(plan, el, chipMs);
  }
  for (const el of added.ids) fade(plan, el, 200);
  if (!detailed && boxes.length > 0) {
    // The U+ labels sit inside the scaled boxes: hidden until every animation of the plan has ended.
    const token = String(++morphs);
    grid.dataset['moMorph'] = token;
    plan.onSettled(() => {
      if (grid.dataset['moMorph'] === token) delete grid.dataset['moMorph'];
    });
  }
}

function playStep(
  chips: Snapshot,
  right: ReadonlyArray<readonly [HTMLElement, HTMLElement]>,
  rows: Rows,
  fast: boolean,
  reduced: boolean,
): void {
  const plan = new Plan();
  const { pairs, added } = chips.commit();
  const moved = pairs.filter((pair) => !unchanged(pair));
  if (moved.length + added.length > MAX_FLIP_CELLS) crossfadeRows(plan, rows, 80);
  else if (!reduced) {
    // (reduced motion: a discrete swap; the director draws the static outline)
    for (const pair of moved) {
      if (fast) fade(plan, pair.el, 80);
      else {
        flip(plan, pair, { duration: 280, easing: EASE }, pair.el.children);
        fade(plan, pair.el, 280, 0.55);
      }
    }
    for (const el of added) fade(plan, el, fast ? 80 : 280);
    for (const [source, parent] of right) {
      if (!parent.isConnected) continue;
      const copy = animateGhost(
        plan,
        source,
        parent,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: `translateX(${String(-GAP)}px)` },
        ],
        { duration: 280, easing: EASE },
      );
      copy.style.setProperty('grid-row', '1'); // over the merged chip, not auto-placed into a row of its own
    }
  }
  plan.start();
}

/** The merged part's 600 ms pulse: an opacity keyframe on the cell's `::before` outline (reduced motion: the director's
 *  static outline instead, no animation). */
export function pulse(cells: Iterable<HTMLElement>): void {
  pseudo(cells, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], 600);
}

/** The byte-tier caret under the junction of a merge (05 §7, `data-merge-caret`, motion.css): fades in with the move. */
export function revealCaret(cells: Iterable<HTMLElement>): void {
  pseudo(cells, [{ opacity: 0 }, { opacity: 1 }], 280);
}

function pseudo(cells: Iterable<HTMLElement>, keyframes: Keyframe[], duration: number): void {
  const plan = new Plan();
  for (const cell of cells) plan.add(cell, keyframes, { duration, pseudoElement: '::before' });
  try {
    plan.start();
  } catch {
    // No pseudo-element animations (old engines): the static mark alone shows it.
  }
}

/**
 * The bottom sheet (< 768 px, 05 §5) slides up and fades in when it expands — translateY from its collapsed height +
 * opacity, 200 ms (reduced motion: 120 ms opacity) — and fades when it collapses (its height drops at once, so there is
 * nothing to slide). Watches `data-expanded` on the inspector host; returns the function that stops watching.
 */
export function watchSheet(root: Node, reduced: () => boolean): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver((records) => {
    for (const { target } of records) {
      if (!(target instanceof HTMLElement) || target.dataset['surface'] !== 'sheet') continue;
      const expanded = target.dataset['expanded'] === 'true';
      const plan = new Plan();
      if (reduced()) plan.add(target, [{ opacity: 0.6 }, { opacity: 1 }], { duration: REDUCED_MS, easing: 'ease-out' });
      else if (expanded)
        plan.add(
          target,
          [
            { transform: 'translateY(calc(40vh - 56px))', opacity: 0.6 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 200, easing: EASE },
        );
      else plan.add(target, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      plan.start();
    }
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-expanded'] });
  return () => {
    observer.disconnect();
  };
}
