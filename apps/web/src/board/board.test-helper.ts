/**
 * Test-only helpers for the board: results from the golden fixtures (`fromFixtureCase`) and synthetic long results, an
 * AppState over a client that never answers (the board shows exactly the result it is given), and mounting the board in
 * a browser-mode test. Never imported by app code.
 */
import type { Fixture, TokenizationResult, TokenizerClientLike, TokenizerId } from '@tsbs/core';
import { buildResult } from '@tsbs/core/model/build-result';
import { ChunkKind, TokenKind } from '@tsbs/core/model/result';
import { fromFixtureCase, type FromFixtureOptions } from '@tsbs/core/fixture/from-fixture-case';
import { analyzeText } from '@tsbs/core/text/analyze';
import { flushSync, mount, unmount } from 'svelte';
import { AppState, type Stage } from '../app/app-state.svelte.ts';
import { SHIPPING_FIXTURES } from '../app/fixtures.test-helper.ts';
import { tokenizerEntry } from '../app/registry.ts';
import BoardHarness from './BoardHarness.test-helper.svelte';

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
  const app = new AppState(idleClient(), result);
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
  // The inspector's catalog is a lazy chunk: wait for it so tests see the panel's content.
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
