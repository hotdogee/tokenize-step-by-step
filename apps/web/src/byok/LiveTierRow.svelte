<script lang="ts">
  /**
   * One packed row of the live token tier (05 §13), drawn by the board's extra-tier hook under the Grok-2 token tier
   * (board/extra-tier.svelte.ts; decorative — the drawer's token list is the accessible form). Each live token's
   * fragment is a chip over its byte columns in its tint, with the board's continuation edges and the id inside when it
   * has room; every boundary that differs from Grok-2 is a two-tone hatched cut at the left edge of its byte's column.
   * Partial tokens are not hatched here: on this tier the hatch means "differs".
   */
  import { placeClass } from '../board/cell-state.ts';
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
    >
      {#if fragment.first && fragment.span >= 2}<span class="lv-id mono">{id}</span>{/if}
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

  .lv-id {
    font-size: 0.625rem;
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
