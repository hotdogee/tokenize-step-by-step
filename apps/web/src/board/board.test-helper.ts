/**
 * Test-only helpers for the board: results from the golden fixtures (`fromFixtureCase`), synthetic long results and a
 * part cut by the row end (`rowEndSplit`), an AppState over a client that never answers (the board shows exactly the
 * result it is given), and mounting the board in a browser-mode test. Never imported by app code.
 */
import type { Fixture, TokenizationResult, TokenizerClientLike, TokenizerId } from '@tsbs/core';
import { buildResult } from '@tsbs/core/model/build-result';
import { ALIVE, ChunkKind, StepKind, TokenKind } from '@tsbs/core/model/result';
import { fromFixtureCase, type FromFixtureOptions } from '@tsbs/core/fixture/from-fixture-case';
import { analyzeText } from '@tsbs/core/text/analyze';
import { flushSync, mount, unmount } from 'svelte';
import { AppState, type Stage } from '../app/app-state.svelte.ts';
import { hubOf } from '../app/fake-client.test-helper.ts';
import { SHIPPING_FIXTURES } from '../app/fixtures.test-helper.ts';
import { tokenizerEntry } from '../app/registry.ts';
import BoardHarness from './BoardHarness.test-helper.svelte';
import { columnsFor } from './geometry.ts';

/** The fixture of `tokenizer` (throws when missing). */
export function fixtureOf(tokenizer: TokenizerId): Fixture {
  const fixture = SHIPPING_FIXTURES.get(tokenizer);
  if (fixture === undefined) throw new Error(`no fixture for ${tokenizer}`);
  return fixture;
}

/** A fixture case as a `TokenizationResult` (byte-level cases carry their merge timeline). */
export function fixtureResult(
  tokenizer: TokenizerId,
  caseName: string,
  options: FromFixtureOptions = {},
): TokenizationResult {
  return fromFixtureCase(fixtureOf(tokenizer), caseName, tokenizerEntry(tokenizer), options);
}

/** A client that never settles: the AppState keeps the result the test puts on screen. */
export function idleClient(): TokenizerClientLike {
  const never = new Promise<never>(() => undefined);
  return {
    features: never,
    assets: never,
    resident: null,
    onResident: () => () => undefined,
    load: () => never,
    prefetch: () => never,
    encode: () => never,
    lookup: () => never,
    unload: () => Promise.resolve(),
    terminate: () => undefined,
  };
}

export interface BoardSetup {
  readonly stage?: Stage;
  readonly step?: number;
  readonly byteView?: 'hex' | 'dec' | 'both';
  readonly width?: number;
}

/** An AppState showing `result` (its tokenizer and text) at `stage`. */
export function appWith(result: TokenizationResult, setup: BoardSetup = {}): AppState {
  const app = new AppState(hubOf(idleClient(), { seeds: [result] }));
  app.tokenizer = result.tokenizer;
  app.text = result.input.text;
  app.textLang = 'auto';
  app.result = result;
  app.stage = setup.stage ?? 6;
  app.step = setup.step ?? result.timeline?.stepCount ?? 0;
  app.byteView = setup.byteView ?? 'hex';
  return app;
}

export interface MountedBoard {
  readonly app: AppState;
  readonly target: HTMLElement;
  readonly grid: HTMLElement;
  destroy(): void;
}

/** Mounts the board for `app` in a fresh container and waits two frames for the ResizeObserver to settle K. */
export async function mountBoard(app: AppState, width?: number): Promise<MountedBoard> {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(BoardHarness, { target, props: { app, width } });
  flushSync();
  await frames(3);
  // The inspector's catalog is a lazy chunk loaded on the first interaction with the page: interact once (a pointer
  // move between two positions; a resting pointer's move is none), then wait for it so tests see the panel's content.
  for (const clientX of [1, 2])
    document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX }));
  for (let i = 0; i < 200 && target.querySelector('[data-inspector="ready"]') === null; i++) await frames(1);
  const grid = target.querySelector<HTMLElement>('[role="grid"]');
  if (grid === null) throw new Error('board grid not rendered');
  return {
    app,
    target,
    grid,
    destroy() {
      void unmount(component);
      target.remove();
    },
  };
}

/** The px width of `--cell` as the page resolves it now. */
export function cellPx(): number {
  const probe = document.createElement('div');
  probe.style.width = 'var(--cell)';
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/** boardWidth at a viewport width: minus the side rail where one exists, capped by the board max-width (05 §3.3). */
export function boardWidthFor(viewport: number): number {
  const rail = viewport >= 2560 ? 420 : viewport >= 1024 ? 320 : 0;
  const cap = viewport >= 2560 ? 2400 : viewport >= 1440 ? 1600 : Number.POSITIVE_INFINITY;
  return Math.min(viewport - rail, cap);
}

/** K the 05 §3.3 formula gives for a full-width board at `viewport` px with the measured `--cell` (never a literal). */
export function expectedColumns(viewport: number): number {
  return columnsFor(boardWidthFor(viewport), cellPx());
}

/** Resolves after `n` animation frames (layout, ResizeObserver callbacks and Svelte flushes in between). */
export async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
    flushSync();
  }
}

/**
 * A synthetic byte-level result of `text` with one token per code point (ids = code point) in one regex chunk, for long
 * inputs the fixtures do not cover (virtualization, 60k bytes).
 */
export function syntheticResult(text: string, tokenizer: TokenizerId = 'openai-o200k_base'): TokenizationResult {
  const analysis = analyzeText(text);
  const { chars, utf8 } = analysis;
  const ids: number[] = [];
  const starts: number[] = [0];
  for (let i = 0; i < chars.count; i++) {
    ids.push(chars.cp[i] ?? 0);
    starts.push(chars.byteStart[i + 1] ?? utf8.length);
  }
  return buildResult({
    tokenizer,
    family: 'bytelevel-bpe',
    analysis,
    chunks: { byteStart: utf8.length > 0 ? [0, utf8.length] : [0], kind: utf8.length > 0 ? [ChunkKind.Regex] : [] },
    tokens: { id: ids, byteStart: starts, kind: ids.map(() => TokenKind.Normal) },
    timeline: null,
  });
}

/**
 * K + `tail` ASCII bytes in one-byte tokens (`ids`, then filler ids) but the last, a token of 1 + `tail` bytes (`last`)
 * that the row end cuts into a 1-column fragment and a `tail`-column one, each with a continuation mark under its id.
 * Its merges join its tail bytes left to right (ids 300, 301, …), then its first byte to them, so at stop 5 the last
 * step (`tail`) forms it: a live part cut 1 | `tail` by the row end (1 | 1 by default, one merge step).
 */
export function rowEndSplit(k: number, ids: readonly number[], last: number, tail = 1): TokenizationResult {
  const single = Array.from({ length: k - 1 }, (_, i) => ids[i] ?? 10 + i);
  const end = k + tail;
  const died = new Int32Array(end + 1).fill(ALIVE);
  for (let j = 1; j < tail; j++) died[k + j] = j; // step j joins byte k + j to the tail
  died[k] = tail; // the row end's boundary inside the last token, removed by the last step
  const steps = Array.from({ length: tail }, (_, j) =>
    j < tail - 1 ? { left: k, mid: k + j + 1, end: k + j + 2, id: 300 + j } : { left: k - 1, mid: k, end, id: last },
  );
  return buildResult({
    tokenizer: 'openai-o200k_base',
    family: 'bytelevel-bpe',
    analysis: analyzeText('a'.repeat(end)),
    chunks: { byteStart: [0, end], kind: [ChunkKind.Regex] },
    tokens: {
      id: [...single, last],
      byteStart: [...single.map((_, i) => i), k - 1, end],
      kind: Array.from({ length: k }, () => TokenKind.Normal),
    },
    timeline: {
      stepCount: tail,
      leadingZeroWidthPart: false,
      boundaryBorn: new Int32Array(end + 1),
      boundaryDied: died,
      stepKind: Uint8Array.from(steps, () => StepKind.Merge),
      stepLeft: Uint32Array.from(steps, (step) => step.left),
      stepMid: Uint32Array.from(steps, (step) => step.mid),
      stepEnd: Uint32Array.from(steps, (step) => step.end),
      stepRank: Float32Array.from(steps, (step) => step.id),
      stepResultId: Int32Array.from(steps, (step) => step.id),
      stepChunk: new Uint32Array(tail),
      truncated: false,
    },
  });
}
