<script lang="ts">
  /**
   * A token-tier fragment (05 §4, §4.1): a final token (stop 6) or a live part (stops 4–5) as a chip in its token tint
   * with the 1 px border. Partial tokens get the SVG hatch mark and a squared, two-tone hatched edge on each side that cuts
   * a code point; byte-fallback pieces show `<0xF0>` under their id; USER_DEFINED symbols the lock; matched specials a
   * SPECIAL badge and a dashed border. Fragments over several rows carry the SVG continuation marks and reference their
   * `frag-…` description. Every chip with an id shows it inside, at any width (PA-17, ChipId): the digits subset
   * narrows, then shrinks, to the room left by the paddings and the marks beside it. Chips of ≤ 2 columns and live parts
   * are `stacked`: the id has the first line to itself and the marks (and a part's hex) share one clipped line under it
   * (`.bd-chip-line`, left out when empty: a bare 1-column chip holds its id alone, on two lines from 5 digits).
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import BoardIcon from './BoardIcon.svelte';
  import type { TokenCellModel } from './cells.ts';
  import ChipId from './ChipId.svelte';
  import { placeClass, tintClass, type CellState } from './cell-state.ts';

  interface Props {
    cell: TokenCellModel;
    state: CellState;
  }
  let { cell, state }: Props = $props();

  const hatchMark = $derived(cell.partial && cell.first && cell.variant === 'token' && cell.bytePiece === null);
  const stacked = $derived(cell.bytePiece === null && (cell.span <= 2 || cell.variant === 'part'));
  /** Something shares the chip with the id (a stacked chip draws it on the line under the id). */
  const marked = $derived(
    !cell.first || !cell.last || cell.userDefined || cell.text !== null || hatchMark || cell.special,
  );
</script>

<!-- The chip's marks in reading order: these before its id, … -->
{#snippet lead()}
  {#if !cell.first}<BoardIcon name="continued" size={10} />{/if}
  {#if cell.userDefined}<BoardIcon name="lock" size={11} />{/if}
{/snippet}

<!-- … these after it (a stacked chip draws both on the line under its id). -->
{#snippet trail()}
  {#if cell.text !== null}<span class={cell.variant === 'part' ? 'bd-part-text mono' : 'bd-chip-text'}>{cell.text}</span
    >{/if}
  {#if hatchMark}<BoardIcon name="hatch" size={10} />{/if}
  {#if cell.special}<span class="bd-badge">{i18n.t('board.special')}</span>{/if}
  {#if !cell.last}<BoardIcon name="continues" size={10} />{/if}
{/snippet}

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
    <!-- A byte-fallback piece is one byte in one column: never a fragment, never hatched; `<0x…>` says it is a byte. -->
    {#if !stacked}{@render lead()}{/if}
    {#if cell.id !== null}<ChipId id={cell.id} digits={cell.digits} lines={cell.idLines} />{/if}
    {#if cell.bytePiece !== null}<span class="bd-piece mono">{cell.bytePiece}</span>
    {:else if !stacked}{@render trail()}
    {:else if marked}<span class="bd-chip-line">{@render lead()}{@render trail()}</span>{/if}
  </div>
</div>
