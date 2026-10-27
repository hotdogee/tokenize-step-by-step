<script lang="ts">
  /**
   * A character of the comparison table's header box (PA-19): a `columnheader` over the code point's byte columns with
   * the board's two-layer char look (`.bd-box`: the glyph drawn once — stand-ins in the subset font, combining marks on
   * a dotted-circle base — and the U+ label, which CSS shows from 480 px). No tint: the header is shared by every row.
   * `col`/`span` are its placement in the column window (rebased, clipped); `aria-colindex` is absolute.
   */
  import type { ResolvedTextLang } from '@tsbs/core';
  import { placeClass } from '../board/cell-state.ts';
  import type { CompareCharModel } from './compare-cells.ts';

  interface Props {
    cell: CompareCharModel;
    /** Placement in the window (0-based rebased column, clipped span). */
    col: number;
    span: number;
    lang: ResolvedTextLang;
  }
  let { cell, col, span, lang }: Props = $props();
</script>

<div
  role="columnheader"
  class={`cmp-cell cmp-char ${placeClass(col, span)}`}
  aria-colindex={cell.col + 1}
  aria-colspan={cell.span}
  aria-label={cell.label}
  data-col={cell.col}
  {lang}
>
  <div class="bd-vis bd-box" aria-hidden="true">
    <span class="bd-glyph" class:cjk={cell.cjk} class:standin={cell.standIn} class:combining={cell.combining}
      >{cell.glyph}</span
    >
    {#if cell.uLabel !== null}<span class="bd-ulabel mono">{cell.uLabel}</span>{/if}
  </div>
</div>
