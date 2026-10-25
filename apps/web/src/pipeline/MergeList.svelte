<script lang="ts">
  /**
   * The merge list (05 §1, §2, §9; lazy chunk, loaded when the list is first opened): the merge sentences of the replay
   * scope as buttons — the current step `aria-current="step"`, a click scrubs to it — grouped under "chunk n" headings for
   * byte-level (one global sequence for SentencePiece). At most `WINDOW` rows around the current step are mounted; the
   * current row is kept in view (`block: 'nearest'`, reduced-motion behaviour).
   */
  import { tick } from 'svelte';
  import type { TokenizationView } from '@tsbs/core';
  import type { Translate } from '../board/labels.ts';
  import { motionPrefs } from '../motion/motion-prefs.svelte.ts';
  import { positionOf, stepAt, type ReplayScope } from './scope.ts';
  import { stepText } from './sentence.ts';

  interface Props {
    id: string;
    view: TokenizationView;
    scope: ReplayScope;
    /** The timeline step on the board. */
    current: number;
    t: Translate;
    onseek: (position: number) => void;
  }
  let { id, view, scope, current, t, onseek }: Props = $props();

  /** Rows mounted on each side of the current one. */
  const WINDOW = 60;
  let list: HTMLOListElement | undefined = $state();

  interface Row {
    readonly position: number;
    readonly step: number;
    readonly chunk: number | null;
  }

  const rows: Row[] = $derived.by(() => {
    const timeline = view.result.timeline;
    if (timeline === null) return [];
    const at = positionOf(scope, current);
    const from = Math.max(1, at - WINDOW);
    const to = Math.min(scope.count, at + WINDOW);
    const out: Row[] = [];
    let chunk = -1;
    for (let p = from; p <= to; p++) {
      const k = stepAt(scope, p);
      const c = view.result.family === 'bytelevel-bpe' ? (timeline.stepChunk[k - 1] ?? 0) : 0;
      out.push({ position: p, step: k, chunk: c !== chunk && view.result.family === 'bytelevel-bpe' ? c : null });
      chunk = c;
    }
    return out;
  });

  $effect(() => {
    if (current < 0) return;
    void tick().then(() => {
      list
        ?.querySelector('[aria-current="step"]')
        ?.scrollIntoView({ block: 'nearest', behavior: motionPrefs.scrollBehavior });
    });
  });
</script>

<ol class="merges" {id} bind:this={list} data-testid="merge-list">
  {#each rows as row (row.position)}
    {#if row.chunk !== null}<li class="group control-label" aria-hidden="true">
        {t('board.chunk', { index: row.chunk + 1 })}
      </li>{/if}
    <li>
      <button
        type="button"
        class="row prose"
        aria-current={row.step === current ? 'step' : undefined}
        onclick={() => {
          onseek(row.position);
        }}>{stepText(view, row.step, t)}</button
      >
    </li>
  {/each}
</ol>

<style>
  .merges {
    max-height: 12rem;
    margin: 0;
    padding: 0.25rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .group {
    padding: 0.25rem 0.5rem 0;
    color: var(--fg-muted);
    font-size: 0.75rem;
  }

  .row {
    display: block;
    width: 100%;
    min-height: 2rem;
    padding: 0.25rem 0.5rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    text-align: start;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface-2);
  }

  .row[aria-current='step'] {
    background: var(--surface-3);
    font-weight: 600;
  }

  @media (forced-colors: active) {
    .row:focus-visible,
    .row[aria-current='step'] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
</style>
