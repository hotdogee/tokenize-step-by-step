<script lang="ts">
  /**
   * One packed row of the live token tier (05 §13), drawn by the board's extra-tier hook under the Grok-2 token tier
   * (board/extra-tier.svelte.ts; decorative — the drawer's token list is the accessible form). Each live token's
   * fragment is a chip over its byte columns in its tint, with the board's continuation edges (no continuation icons)
   * and its id inside by the board's rule (PA-17, ChipId): on every fragment, narrowed then shrunk to the room, alone on
   * two lines in a 1-column chip from 5 digits, chips of ≤ 2 columns `stacked` with the board's 1 px paddings; the cells
   * are as tall as the board's token cells at every breakpoint. Every boundary that differs from Grok-2 is a two-tone
   * hatched cut at the left edge of its byte's column, under the ids (a cut inside a chip never strikes through its id).
   * Partial tokens are not hatched here: on this tier the hatch means "differs".
   */
  import { placeClass } from '../board/cell-state.ts';
  import { digitsOf, idLines } from '../board/cells.ts';
  import ChipId from '../board/ChipId.svelte';
  import type { ExtraTierProps } from '../board/extra-tier.svelte.ts';
  import { answers } from './live-state.svelte.ts';
  import { diffFor, rowCuts, rowFragments } from './live-tier.ts';

  let { row, result }: ExtraTierProps = $props();

  const answer = $derived(answers.xai);
  const tier = $derived(answer?.alignment.aligned === true ? answer.alignment : null);
  const diff = $derived(tier === null ? null : diffFor(tier, result));
  const fragments = $derived(tier === null ? [] : rowFragments(row, tier));
  const cuts = $derived(diff === null ? [] : rowCuts(row, diff));
</script>

{#each fragments as fragment (fragment.token)}
  {@const id = answer?.tokens[fragment.token]?.id ?? 0}
  {@const digits = digitsOf(id)}
  <div
    class={`lv-cell ${placeClass(fragment.col, fragment.span)}`}
    data-live-token={fragment.token}
    data-live-id={id}
    data-first={fragment.first ? '' : undefined}
  >
    <div
      class={`bd-vis bd-chip bd-t${String(fragment.token % 8)}`}
      class:cont-start={!fragment.first}
      class:cont-end={!fragment.last}
      class:stacked={fragment.span <= 2}
    >
      <ChipId {id} {digits} lines={idLines(id, digits, fragment.span, true)} />
    </div>
  </div>
{/each}
{#each cuts as cut (cut.boundary)}
  <span class={`lv-cut ${placeClass(cut.col, 1)}`} data-boundary={cut.boundary}></span>
{/each}

<style>
  .lv-cell,
  .lv-cut {
    grid-row: 1;
    position: relative;
    height: 28px;
  }

  /* The board's token-cell height from 2560 px (board.css .bd-cell-token), so the ids' two lines stay inside. */
  @media (min-width: 2560px) {
    .lv-cell,
    .lv-cut {
      height: calc(var(--cell) * 0.75 + 5px);
    }
  }

  /* This tier draws no continuation icons: its continued chips give the id the room the board's marks would take. */
  .lv-cell > .bd-chip {
    --m-cs: 0px;
    --m-ce: 0px;
  }

  /* The id paints over a cut inside its chip (z-index 1; the chip makes no stacking context), on the chip's tint. */
  .lv-cell :global(.bd-id) {
    position: relative;
    z-index: 2;
    background: var(--tint, var(--surface));
    padding-inline: 1px;
  }

  .lv-cut {
    z-index: 1;
    pointer-events: none;
  }

  .lv-cut::before {
    content: '';
    position: absolute;
    inset-block: -2px;
    left: -3px;
    width: 6px;
    border: 1px solid var(--fg);
    border-radius: 1px;
    background: repeating-linear-gradient(45deg, var(--fg) 0 1.5px, var(--bg) 1.5px 3px);
  }

  @media (forced-colors: active) {
    .lv-cut::before {
      forced-color-adjust: none;
      border-color: CanvasText;
      background: repeating-linear-gradient(45deg, Highlight 0 1.5px, Canvas 1.5px 3px);
    }
  }
</style>
