<script lang="ts">
  /**
   * A chunk-tier fragment (05 §2 stop 4): the pre-tokenizer chunk as a bracket under its bytes with "chunk N · rule r"
   * (and "no merges" for a multi-byte direct hit at stop 5). A chunk wrapped over rows is one logical cell: every fragment
   * carries the SVG continuation marks and references its `frag-…` description.
   */
  import BoardIcon from './BoardIcon.svelte';
  import type { ChunkCellModel } from './cells.ts';
  import { placeClass, type CellState } from './cell-state.ts';

  interface Props {
    cell: ChunkCellModel;
    state: CellState;
  }
  let { cell, state }: Props = $props();
</script>

<div
  role="gridcell"
  class={`bd-cell bd-cell-chunk ${placeClass(cell.col, cell.span)}`}
  aria-colindex={cell.col + 1}
  aria-colspan={cell.span}
  aria-label={cell.label}
  aria-describedby={cell.describedBy ?? undefined}
  tabindex={state.tabbable ? 0 : -1}
  data-tier="chunk"
  data-index={cell.index}
  data-first={cell.first ? '' : undefined}
  data-active={state.active ? '' : undefined}
  data-pinned={state.pinned ? '' : undefined}
  data-slice={state.slice ? '' : undefined}
>
  <div class="bd-vis bd-chunk" class:open-start={!cell.first} class:open-end={!cell.last} aria-hidden="true">
    {#if !cell.first}<BoardIcon name="continued" size={10} />{/if}
    {#if cell.first}<span class="bd-chunk-text">{cell.text}</span>{/if}
    {#if !cell.last}<BoardIcon name="continues" size={10} />{/if}
  </div>
</div>
