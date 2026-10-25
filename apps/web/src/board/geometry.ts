/**
 * Board geometry (05 §3.1, §3.3, §8; AD-17, AD-18): the column count K, the tiers a packed row shows, and the ARIA row
 * index arithmetic of the layout grid. Pure functions; the Board measures the inputs (container width, `--cell` in px)
 * with a ResizeObserver and never uses a literal K.
 */
import type { Stage, Tier } from '../app/app-state.svelte.ts';

/** `--gutter` (05 §3.3): the board container's inline padding on each side. */
export const GUTTER = 16;
/** K = clamp(MIN_COLUMNS, …, MAX_COLUMNS) (05 §3.3); MAX_COLUMNS equals the generated `.c64`/`.s64` classes. */
export const MIN_COLUMNS = 8;
export const MAX_COLUMNS = 64;

/**
 * K = clamp(8, floor((boardWidth − 2·gutter) / cell), 64) (05 §3.3). `boardWidth` is the board container's width with its
 * gutters (viewport minus the side rail where one exists, capped by the board max-width). A tiny epsilon keeps a measured
 * 1087.9999 px from dropping a column that the CSS grid still fits.
 */
export function columnsFor(boardWidth: number, cell: number, gutter: number = GUTTER): number {
  if (!(cell > 0) || !Number.isFinite(boardWidth)) return MIN_COLUMNS;
  const fit = Math.floor((boardWidth - 2 * gutter) / cell + 1e-6);
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, fit));
}

/**
 * The board's ARIA rows per packed row, in order (05 §8): char, byte-hex, byte-dec, chunk, token. `hex`/`dec` are the two
 * byte rows; `token` shows the live parts at stops 4–5 and the final tokens at stop 6.
 */
export type BoardTier = 'char' | 'hex' | 'dec' | 'chunk' | 'token';

export interface TierOptions {
  readonly stage: Stage;
  readonly byteView: 'hex' | 'dec' | 'both';
  /** Viewport ≥ 1024 px: hex **and** dec rows are available (05 §3.3). */
  readonly wide: boolean;
  /** Viewport ≥ 480 px: chunk brackets sit on the board (below that they move into the sheet). */
  readonly chunkTier: boolean;
  /** A tokenizer result is on screen (stops 4–6 wait for the engine otherwise). */
  readonly tokens: boolean;
}

/** The tiers shown at this stage and viewport, in ARIA row order. */
export function tiersFor(options: TierOptions): BoardTier[] {
  const { stage, byteView, wide, chunkTier, tokens } = options;
  const tiers: BoardTier[] = ['char'];
  if (stage >= 3) {
    if (byteView === 'dec') tiers.push('dec');
    else tiers.push('hex');
    if (byteView === 'both' && wide) tiers.push('dec');
  }
  if (tokens && chunkTier && (stage === 4 || stage === 5)) tiers.push('chunk');
  if (tokens && stage >= 4) tiers.push('token');
  return tiers;
}

/** `aria-rowindex` of a tier row: packedRow × tiers + tier + 1 (05 §8). */
export function ariaRowIndex(packedRow: number, tierIndex: number, tierCount: number): number {
  return packedRow * tierCount + tierIndex + 1;
}

/** The AppState tier (05 §1.1) of a board tier: both byte rows are the `byte` tier. */
export function appTier(tier: BoardTier): Tier {
  return tier === 'hex' || tier === 'dec' ? 'byte' : tier;
}

/** Whether the token tier shows live parts (stops 4–5) or the final tokens (stop 6). */
export function tokenMode(stage: Stage): 'parts' | 'tokens' {
  return stage === 4 || stage === 5 ? 'parts' : 'tokens';
}
