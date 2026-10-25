<script lang="ts">
  /**
   * A byte-tier cell (05 §4): `E5` (hex, uppercase, mono) or `229` (dec); lead bytes bolder than continuation bytes; the
   * owning token's tint at 40 % (the vertical alignment cue); a two-tone hatched rule where a token boundary cuts the code
   * point (`┆` in the 05 §3.4 sketch).
   */
  import type { ByteCellModel } from './cells.ts';
  import { placeClass, tintClass, type CellState } from './cell-state.ts';

  interface Props {
    cell: ByteCellModel;
    tier: 'hex' | 'dec';
    state: CellState;
  }
  let { cell, tier, state }: Props = $props();
</script>

<div
  role="gridcell"
  class={`bd-cell bd-cell-byte ${placeClass(cell.col, 1)}`}
  aria-colindex={cell.col + 1}
  aria-colspan={1}
  aria-label={cell.label}
  tabindex={state.tabbable ? 0 : -1}
  data-tier={tier}
  data-index={cell.index}
  data-first=""
  data-active={state.active ? '' : undefined}
  data-pinned={state.pinned ? '' : undefined}
  data-slice={state.slice ? '' : undefined}
  data-selected={state.selected ? '' : undefined}
>
  <div
    class={`bd-vis bd-face mono ${tintClass(cell.tint)}`}
    class:lead={cell.lead}
    class:bd-cut={cell.cut}
    aria-hidden="true"
  >
    {tier === 'hex' ? cell.hex : cell.dec}
  </div>
</div>
