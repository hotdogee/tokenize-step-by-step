/**
 * Test-only helpers for the rail: mounting PipelineRail above the Board over an AppState (and waiting for the lazy
 * choreography chunk), synthetic long results with a merge timeline (byte-level: one regex chunk per word; spm: one
 * global sequence), a manual clock for the playback controller, and the animation probes the motion tests share.
 * Never imported by app code.
 */
import type { Family, TokenizationResult } from '@tsbs/core';
import { buildResult } from '@tsbs/core/model/build-result';
import { ChunkKind, StepKind, TokenKind } from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';
import { TimelineRecorder } from '@tsbs/core/timeline/trace-recorder';
import { flushSync, mount, unmount } from 'svelte';
import type { AppState } from '../app/app-state.svelte.ts';
import { frames } from '../board/board.test-helper.ts';
import type { Clock } from './playback.svelte.ts';
import RailHarness from './RailHarness.test-helper.svelte';

/**
 * `words` × "abcd", each word merged in three steps (ab, cd, abcd → id 102): byte-level with one regex chunk per word
 * (steps grouped by chunk), or spm with one SpmText chunk (one global sequence). 3 × `words` steps.
 */
export function longResult(words: number, family: Family = 'bytelevel-bpe'): TokenizationResult {
  const text = 'abcd'.repeat(words);
  const analysis = analyzeText(text);
  const recorder = new TimelineRecorder(analysis.utf8.length, { rank: 'resultId' });
  const ids: number[] = [];
  const starts: number[] = [0];
  const bytelevel = family === 'bytelevel-bpe';
  for (let w = 0; w < words; w++) {
    const s = 4 * w;
    const chunk = bytelevel ? w : 0;
    recorder.record(StepKind.Merge, s, s + 1, s + 2, 100, 100, chunk);
    recorder.record(StepKind.Merge, s + 2, s + 3, s + 4, 101, 101, chunk);
    recorder.record(StepKind.Merge, s, s + 2, s + 4, 102, 102, chunk);
    ids.push(102);
    starts.push(s + 4);
  }
  const chunkStarts = bytelevel ? starts : [0, analysis.utf8.length];
  return buildResult({
    tokenizer: bytelevel ? 'openai-o200k_base' : 'google-gemma4',
    family,
    analysis,
    chunks: {
      byteStart: chunkStarts,
      kind: chunkStarts.slice(1).map(() => (bytelevel ? ChunkKind.Regex : ChunkKind.SpmText)),
    },
    tokens: { id: ids, byteStart: starts, kind: ids.map(() => TokenKind.Normal) },
    timeline: recorder.finish(),
  });
}

/** A clock whose timers run only when the test calls `advance()`. */
export interface ManualClock extends Clock {
  /** Delay of the pending timer, or null. */
  pending(): number | null;
  /** Runs the pending timer. */
  advance(): void;
}

export function manualClock(): ManualClock {
  let timer: { callback: () => void; ms: number } | null = null;
  return {
    setTimeout(callback, ms) {
      timer = { callback, ms };
      return timer;
    },
    clearTimeout(handle) {
      if (handle === timer) timer = null;
    },
    pending: () => timer?.ms ?? null,
    advance() {
      const current = timer;
      timer = null;
      current?.callback();
      flushSync();
    },
  };
}

export interface MountedRail {
  readonly app: AppState;
  readonly target: HTMLElement;
  readonly rail: HTMLElement;
  readonly grid: HTMLElement;
  destroy(): void;
}

/** Mounts rail + board for `app`; unless `motion: false`, interacts once and waits for the choreography chunk. */
export async function mountRail(
  app: AppState,
  options: { readonly picker?: boolean; readonly motion?: boolean } = {},
): Promise<MountedRail> {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(RailHarness, { target, props: { app, picker: options.picker ?? false } });
  flushSync();
  await frames(3);
  const rail = target.querySelector<HTMLElement>('[data-testid="pipeline"]');
  const grid = target.querySelector<HTMLElement>('[role="grid"]');
  if (rail === null || grid === null) throw new Error('rail or board not rendered');
  if (options.motion !== false) {
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
    for (let i = 0; i < 200 && rail.dataset['motion'] !== 'ready'; i++) await frames(1);
  }
  return {
    app,
    target,
    rail,
    grid,
    destroy() {
      void unmount(component);
      target.remove();
    },
  };
}

/** True when the animation animates `transform` (keyframes of a KeyframeEffect). */
export function animatesTransform(animation: Animation): boolean {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect)) return false;
  return effect.getKeyframes().some((frame) => 'transform' in frame);
}

/** Every running animation's duration in ms. */
export function durations(animations: readonly Animation[]): number[] {
  return animations.map((animation) => Number(animation.effect?.getTiming().duration ?? 0));
}
