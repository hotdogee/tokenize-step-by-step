/**
 * Replay scope and playback timing (05 §2, AD-27), pure: which merge steps the scrubber and Play cover, how a scrubber
 * position maps to a timeline step, where the chunk-boundary ticks go, and how long one played step lasts.
 *
 * - Up to `SCOPE_LIMIT` (2,000) steps the whole timeline is replayed: position p ↦ step p.
 * - Above it, byte-level replays the focused chunk only (its steps are contiguous: steps are grouped by chunk in execution
 *   order, 03 §B.2), position p ↦ step first − 1 + p; SentencePiece replays the steps inside a 2,000-byte window around the
 *   focused byte (one global sequence, so the scoped steps are a sorted list): position 0 ↦ the step before the first one,
 *   position i ↦ the i-th listed step. The rail states the scope in its `role="status"` line.
 * - A step outside the scope (moved there by the keyboard or the inspector) moves the scope to it (`scopeAround`).
 * - Step duration = clamp(60 ms, 12 s / steps, 450 ms) at ×1, divided by the speed (×0.5 / ×1 / ×2).
 */
import type { TokenizationResult } from '@tsbs/core';
import { StepKind } from '@tsbs/core/model/result';

/** Replay is scoped above this many steps (05 §2). */
export const SCOPE_LIMIT = 2000;
/** Bytes in the SentencePiece replay window (05 §2). */
export const WINDOW_BYTES = 2000;
/** Tick marks are drawn only up to this many chunk boundaries (a datalist of thousands helps nobody). */
export const MAX_TICKS = 64;

export type Speed = 0.5 | 1 | 2;

export interface ReplayScope {
  readonly kind: 'all' | 'chunk' | 'window';
  /** Number of steps in scope; scrubber positions run 0…count. */
  readonly count: number;
  /** Contiguous scopes: the first step (1-based) in scope. */
  readonly first: number;
  /** 'window': the scoped steps (1-based, ascending); null for contiguous scopes. */
  readonly steps: Uint32Array | null;
  /** 'chunk': the replayed chunk (0-based) of `chunks`. */
  readonly chunk: number;
  readonly chunks: number;
  /** 'window': the byte window [start, end). */
  readonly start: number;
  readonly end: number;
}

/** clamp(60 ms, 12 s / steps, 450 ms) / speed (05 §2: any input replays in ≤ 12 s at ×1 while steps ≥ 27). */
export function stepDuration(steps: number, speed: Speed): number {
  const base = Math.min(450, Math.max(60, 12_000 / Math.max(1, steps)));
  return base / speed;
}

/** First and last step (1-based, 0 = none) of every chunk, from `stepChunk`. */
function chunkSteps(result: TokenizationResult): { first: Uint32Array; last: Uint32Array } {
  const count = result.chunks.count;
  const first = new Uint32Array(count);
  const last = new Uint32Array(count);
  const timeline = result.timeline;
  if (timeline === null) return { first, last };
  for (let k = 1; k <= timeline.stepCount; k++) {
    const c = timeline.stepChunk[k - 1] ?? 0;
    if (c >= count) continue;
    if (first[c] === 0) first[c] = k;
    last[c] = k;
  }
  return { first, last };
}

const chunkCache = new WeakMap<TokenizationResult, { first: Uint32Array; last: Uint32Array }>();

function cachedChunkSteps(result: TokenizationResult): { first: Uint32Array; last: Uint32Array } {
  let steps = chunkCache.get(result);
  if (steps === undefined) {
    steps = chunkSteps(result);
    chunkCache.set(result, steps);
  }
  return steps;
}

/** The replay scope of `result` around byte `focus` (the focused or pinned cell; 0 when none). */
export function replayScope(result: TokenizationResult, focus: number, limit: number = SCOPE_LIMIT): ReplayScope {
  const timeline = result.timeline;
  const total = timeline?.stepCount ?? 0;
  const base = { first: 1, steps: null, chunk: 0, chunks: result.chunks.count, start: 0, end: result.utf8.length };
  if (timeline === null || total <= limit) return { kind: 'all', count: total, ...base };
  const byte = Math.min(Math.max(0, focus), Math.max(0, result.utf8.length - 1));
  if (result.family === 'bytelevel-bpe') {
    const { first, last } = cachedChunkSteps(result);
    let chunk = result.byteToChunk[byte] ?? 0;
    // A focused chunk without merges (direct hit, one byte) replays the next chunk that has some.
    let c = chunk;
    while (c < first.length && first[c] === 0) c++;
    if (c >= first.length) {
      c = chunk;
      while (c > 0 && first[c] === 0) c--;
    }
    chunk = c;
    const from = first[chunk] ?? 0;
    const to = last[chunk] ?? 0;
    return { ...base, kind: 'chunk', count: from === 0 ? 0 : to - from + 1, first: Math.max(1, from), chunk };
  }
  const start = Math.max(0, Math.min(byte - WINDOW_BYTES / 2, result.utf8.length - WINDOW_BYTES));
  const end = Math.min(result.utf8.length, start + WINDOW_BYTES);
  const steps: number[] = [];
  for (let k = 1; k <= total; k++) {
    if ((timeline.stepLeft[k - 1] ?? 0) >= start && (timeline.stepEnd[k - 1] ?? 0) <= end) steps.push(k);
  }
  return {
    ...base,
    kind: 'window',
    count: steps.length,
    first: steps[0] ?? 1,
    steps: Uint32Array.from(steps),
    start,
    end,
  };
}

/** Whether timeline step `k` is one of `scope`'s positions (position 0, the step before its first, included). */
export function inScope(scope: ReplayScope, k: number): boolean {
  if (scope.steps === null) return k >= scope.first - 1 && k <= scope.first - 1 + scope.count;
  return k === stepAt(scope, 0) || scope.steps.includes(k);
}

/**
 * The replay scope around byte `focus` (`replayScope`), moved to the step on the board when that step lies outside it:
 * a `,` / `.` step past the scope's end, or the inspector's "show this step" for another chunk, moves the scope with the
 * board instead of leaving the scrubber pinned at one end of a scope the board has left. `step` is null off stop 5.
 */
export function scopeAround(
  result: TokenizationResult,
  focus: number,
  step: number | null,
  limit: number = SCOPE_LIMIT,
): ReplayScope {
  const scope = replayScope(result, focus, limit);
  const timeline = result.timeline;
  if (scope.kind === 'all' || step === null || timeline === null || step < 1 || inScope(scope, step)) return scope;
  return replayScope(result, timeline.stepLeft[step - 1] ?? focus, limit);
}

/** The timeline step shown at scrubber position `p` (0 ≤ p ≤ count). */
export function stepAt(scope: ReplayScope, p: number): number {
  const q = Math.min(Math.max(0, Math.round(p)), scope.count);
  if (scope.steps === null) return scope.first - 1 + q;
  return q === 0 ? Math.max(0, (scope.steps[0] ?? 1) - 1) : (scope.steps[q - 1] ?? 0);
}

/** The scrubber position of timeline step `k` (clamped into the scope). */
export function positionOf(scope: ReplayScope, k: number): number {
  if (scope.steps === null) return Math.min(Math.max(0, k - (scope.first - 1)), scope.count);
  let p = 0;
  while (p < scope.count && (scope.steps[p] ?? 0) <= k) p++;
  return p;
}

/**
 * Scrubber tick positions (`<datalist>`): byte-level, the end of every chunk's merges inside the scope; SentencePiece,
 * the first byte-fallback split after the merges (05 §2: one global sequence, then the fallback splits). Empty above
 * `MAX_TICKS`.
 */
export function scopeTicks(result: TokenizationResult, scope: ReplayScope): number[] {
  const timeline = result.timeline;
  if (timeline === null || scope.count === 0) return [];
  const ticks: number[] = [];
  for (let p = 1; p < scope.count; p++) {
    const k = stepAt(scope, p);
    const next = stepAt(scope, p + 1);
    const boundary =
      result.family === 'bytelevel-bpe'
        ? timeline.stepChunk[k - 1] !== timeline.stepChunk[next - 1]
        : timeline.stepKind[k - 1] === StepKind.Merge && timeline.stepKind[next - 1] === StepKind.ByteFallbackSplit;
    if (boundary) ticks.push(p);
    if (ticks.length > MAX_TICKS) return [];
  }
  return ticks;
}
