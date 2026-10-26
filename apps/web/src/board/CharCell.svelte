<script lang="ts">
  /**
   * A char-tier cell (05 §4, §4.1): one gridcell over the code point's byte columns, two layers — `.bd-box` (translated
   * and sized: uniform and left-packed at stops 1–2, byte-proportional from stop 3; AD-17) holding the background sliced
   * per byte column into the owning tokens' tints with a hatched rule at each cut, and the glyph drawn once (stand-ins in
   * the subset font, combining marks on a dotted-circle base). `lang` is the resolved text language (Han glyph forms).
   * `--dx` / `--w` are written only where they differ from the box's CSS defaults (0, and the cell's span from its `.s<n>`
   * class): from stop 3 on the box is unshifted and as wide as its cell, so the server-rendered first paint (PA-15, stop 6)
   * carries no `style` attribute, which the strict CSP would block.
   */
  import type { ResolvedTextLang } from '@tsbs/core';
  import type { CharCellModel } from './cells.ts';
  import { placeClass, tintClass, type CellState } from './cell-state.ts';

  interface Props {
    cell: CharCellModel;
    state: CellState;
    lang: ResolvedTextLang;
  }
  let { cell, state, lang }: Props = $props();
</script>

<div
  role="gridcell"
  class={`bd-cell bd-cell-char ${placeClass(cell.col, cell.span)}`}
  aria-colindex={cell.col + 1}
  aria-colspan={cell.span}
  aria-label={cell.label}
  tabindex={state.tabbable ? 0 : -1}
  data-tier="char"
  data-index={cell.index}
  data-first=""
  data-active={state.active ? '' : undefined}
  data-pinned={state.pinned ? '' : undefined}
  data-slice={state.slice ? '' : undefined}
  data-selected={state.selected ? '' : undefined}
  {lang}
>
  <div
    class="bd-vis bd-box"
    style:--dx={cell.dx === 0 ? undefined : cell.dx}
    style:--w={cell.w === cell.span ? undefined : cell.w}
    aria-hidden="true"
  >
    <span class="bd-slices">
      {#each cell.slices as slice, k (k)}
        <span class={`bd-slice ${tintClass(slice.tint)}`} class:bd-cut={slice.cut}></span>
      {/each}
    </span>
    <span class="bd-glyph" class:cjk={cell.cjk} class:standin={cell.standIn} class:combining={cell.combining}
      >{cell.glyph}</span
    >
    {#if cell.uLabel !== null}<span class="bd-ulabel mono">{cell.uLabel}</span>{/if}
  </div>
</div>
