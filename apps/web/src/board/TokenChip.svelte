<script lang="ts">
  /**
   * A token-tier fragment (05 §4, §4.1): a final token (stop 6) or a live part (stops 4–5) as a chip in its token tint
   * with the 1 px border. Partial tokens get the SVG hatch mark and a squared, two-tone hatched edge on each side that cuts
   * a code point; byte-fallback pieces show the Byte icon and `<0xF0>`; USER_DEFINED symbols the lock; matched specials a
   * SPECIAL badge and a dashed border. Fragments over several rows carry the SVG continuation marks and reference their
   * `frag-…` description. Every chip with an id (byte-fallback pieces aside) shows it inside, at any width (PA-17): the
   * digits subset narrows, then shrinks, to the room left by the paddings and the marks (`.d<n>` = digit count,
   * board.css). Chips of ≤ 2 columns and live parts are `stacked`: the id has the first line to itself and the marks
   * (and a part's hex) go on a line under it instead of beside it.
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import BoardIcon from './BoardIcon.svelte';
  import type { TokenCellModel } from './cells.ts';
  import { placeClass, tintClass, type CellState } from './cell-state.ts';

  interface Props {
    cell: TokenCellModel;
    state: CellState;
  }
  let { cell, state }: Props = $props();

  const hatchMark = $derived(cell.partial && cell.first && cell.variant === 'token' && cell.bytePiece === null);
  const stacked = $derived(cell.bytePiece === null && (cell.span <= 2 || cell.variant === 'part'));
</script>

<div
  role="gridcell"
  class={`bd-cell bd-cell-token ${placeClass(cell.col, cell.span)}`}
  aria-colindex={cell.col + 1}
  aria-colspan={cell.span}
  aria-label={cell.label}
  aria-describedby={cell.describedBy ?? undefined}
  tabindex={state.tabbable ? 0 : -1}
  data-tier="token"
  data-index={cell.index}
  data-first={cell.first ? '' : undefined}
  data-variant={cell.variant}
  data-partial={cell.partial ? '' : undefined}
  data-active={state.active ? '' : undefined}
  data-pinned={state.pinned ? '' : undefined}
  data-slice={state.slice ? '' : undefined}
  data-selected={state.selected ? '' : undefined}
>
  <div
    class={`bd-vis bd-chip ${tintClass(cell.tint)}`}
    class:hatch-start={cell.hatchStart}
    class:hatch-end={cell.hatchEnd}
    class:cont-start={!cell.first}
    class:cont-end={!cell.last}
    class:special={cell.special}
    class:byte-fallback={cell.bytePiece !== null}
    class:stacked
    class:has-hatch={hatchMark}
    class:has-lock={cell.userDefined}
    aria-hidden="true"
  >
    {#if !cell.first}<BoardIcon name="continued" size={10} />{/if}
    {#if cell.bytePiece !== null}
      <BoardIcon name="byte" size={11} /><span class="bd-piece mono">{cell.bytePiece}</span>
    {:else}
      {#if cell.userDefined}<BoardIcon name="lock" size={11} />{/if}
      {#if cell.id !== null}<span class={`bd-id d${String(cell.digits)}`}>{cell.id}</span>{/if}
      {#if cell.text !== null}<span class={cell.variant === 'part' ? 'bd-part-text mono' : 'bd-chip-text'}
          >{cell.text}</span
        >{/if}
    {/if}
    {#if hatchMark}<BoardIcon name="hatch" size={10} />{/if}
    {#if cell.special}<span class="bd-badge">{i18n.t('board.special')}</span>{/if}
    {#if !cell.last}<BoardIcon name="continues" size={10} />{/if}
  </div>
</div>
