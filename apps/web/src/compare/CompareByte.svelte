<script lang="ts">
  /**
   * A byte of the comparison table's header box (PA-19): a `columnheader` with the board's byte face (`.bd-face`: `E5`
   * hex or `229` dec, mono; lead bytes bolder), untinted (the header is shared by every row). `col` is its rebased
   * column in the window; `aria-colindex` is absolute.
   */
  import { placeClass } from '../board/cell-state.ts';
  import type { CompareByteModel } from './compare-cells.ts';

  interface Props {
    cell: CompareByteModel;
    view: 'hex' | 'dec';
    /** Placement in the window (0-based rebased column). */
    col: number;
  }
  let { cell, view, col }: Props = $props();
</script>

<div
  role="columnheader"
  class={`cmp-cell cmp-byte ${placeClass(col, 1)}`}
  aria-colindex={cell.col + 1}
  aria-label={cell.label}
  data-col={cell.col}
>
  <div class="bd-vis bd-face mono" class:lead={cell.lead} aria-hidden="true">
    {view === 'hex' ? cell.hex : cell.dec}
  </div>
</div>
