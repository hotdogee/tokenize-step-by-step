<script lang="ts">
  /**
   * A zero-width token (AD-25): BOS or Grok-1's bare dummy `▁` occupies a real full-width column — never `--cell/2` — as a
   * focusable chip with a dotted border (the zero-width cue) and its id over `▁`/`BOS` (PA-17: the 2 px border is the
   * chip's `--border-width`, so the id's room counts it; the dummy prefix sets an id of ≥ 5 digits on two lines over a
   * 2 px bar, the shape `▁` draws); its `aria-label` says "dummy prefix, 0 bytes, id 130089" /
   * "beginning-of-sequence token, 0 bytes, id …" (≥ 36 × 28 on coarse pointers).
   */
  import type { TokenCellModel } from './cells.ts';
  import ChipId from './ChipId.svelte';
  import { placeClass, type CellState } from './cell-state.ts';

  interface Props {
    cell: TokenCellModel;
    state: CellState;
  }
  let { cell, state }: Props = $props();
</script>

<div
  role="gridcell"
  class={`bd-cell bd-cell-token bd-cell-marker ${placeClass(cell.col, 1)}`}
  aria-colindex={cell.col + 1}
  aria-colspan={1}
  aria-label={cell.label}
  tabindex={state.tabbable ? 0 : -1}
  data-tier="token"
  data-index={cell.index}
  data-first=""
  data-variant="marker"
  data-marker={cell.marker ?? undefined}
  data-active={state.active ? '' : undefined}
  data-pinned={state.pinned ? '' : undefined}
  data-slice={state.slice ? '' : undefined}
>
  <div class="bd-vis bd-chip marker" aria-hidden="true">
    {#if cell.id !== null}<ChipId id={cell.id} digits={cell.digits} lines={cell.idLines} />{/if}
    <span class="bd-marker-text mono">{cell.markerText}</span>
  </div>
</div>
