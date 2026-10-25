<script lang="ts">
  /**
   * The merge list (05 §1, §2, §9; lazy chunk, loaded when the list is first opened): the merge sentences of the replay
   * scope as buttons — the current step `aria-current="step"`, a click scrubs to it — grouped under "chunk n" headings for
   * byte-level (one global sequence for SentencePiece). At most `WINDOW` rows around the current (or keyboard-focused) row
   * are mounted.
   *
   * - One tab stop (roving `tabindex`, 05 §8): Tab lands on the current step's row; ↑/↓ move between rows, Home/End to the
   *   first/last step of the scope; Enter/Space scrub to the focused row. So the list costs keyboard users a single stop on
   *   the way from the rail to the board, wherever WP13 places it.
   * - The current row is kept in view by scrolling **the list only** (never the page: `scrollIntoView` would also scroll
   *   the window and pull the user back to the rail on every step after a manual scroll, 05 §2), with the reduced-motion
   *   scroll behaviour.
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
  /** Scrubber position of the row holding keyboard focus inside the list; null when focus is elsewhere. */
  let focused: number | null = $state(null);

  interface Row {
    readonly position: number;
    readonly step: number;
    readonly chunk: number | null;
  }

  const at = $derived(Math.max(1, positionOf(scope, current)));
  /** The row that takes the list's single tab stop. */
  const tabRow = $derived(focused ?? at);

  const rows: Row[] = $derived.by(() => {
    const timeline = view.result.timeline;
    if (timeline === null) return [];
    const centre = focused ?? at;
    const from = Math.max(1, centre - WINDOW);
    const to = Math.min(scope.count, centre + WINDOW);
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

  /** Scrolls the list (only the list) so that `row` is fully inside it. */
  function keepInView(row: Element): void {
    if (list === undefined) return;
    const box = list.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const delta = rect.top < box.top ? rect.top - box.top : rect.bottom > box.bottom ? rect.bottom - box.bottom : 0;
    if (delta !== 0) list.scrollBy({ top: delta, behavior: motionPrefs.scrollBehavior });
  }

  $effect(() => {
    if (current < 0 || focused !== null) return;
    // In the next frame's animation phase: the layout read is the one the frame does anyway.
    const frame = requestAnimationFrame(() => {
      const row = list?.querySelector('[aria-current="step"]');
      if (row) keepInView(row);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  async function moveFocus(position: number): Promise<void> {
    focused = Math.min(Math.max(1, position), scope.count);
    await tick();
    const row = list?.querySelector<HTMLButtonElement>(`[data-position="${String(focused)}"]`);
    row?.focus({ preventScroll: true });
    if (row) keepInView(row);
  }

  function onkeydown(event: KeyboardEvent): void {
    const position = Number((event.target as HTMLElement).dataset['position']);
    if (!Number.isInteger(position)) return;
    const next =
      event.key === 'ArrowDown'
        ? position + 1
        : event.key === 'ArrowUp'
          ? position - 1
          : event.key === 'Home'
            ? 1
            : event.key === 'End'
              ? scope.count
              : null;
    if (next === null) return;
    event.preventDefault();
    void moveFocus(next);
  }
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
        tabindex={row.position === tabRow ? 0 : -1}
        data-position={row.position}
        aria-current={row.step === current ? 'step' : undefined}
        {onkeydown}
        onfocus={() => {
          focused = row.position;
        }}
        onblur={() => {
          // Checked a frame later: moving the window unmounts the row that had focus before the next one takes it.
          requestAnimationFrame(() => {
            if (!(list?.contains(document.activeElement) ?? false)) focused = null;
          });
        }}
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
