<script lang="ts">
  /**
   * A token of a comparison-table row (PA-19, 05 §4): a `gridcell` over the token's byte columns with the board's chip
   * (`.bd-chip`: its tint, the 1 px border, the hatched cut edges of a partial token, the lock of a USER_DEFINED symbol,
   * the SPECIAL badge, `<0xNN>` under a byte-fallback id, the dotted zero-width marker with its id over `▁`) and the id
   * inside it at any width (ChipId, PA-17). The chip stacks: the id on the first line, the marks on one line under it
   * (44 px tall). The token text (from 4 columns) and the partial-character mark render only with the "Show token text"
   * and "Mark partial-character tokens" preferences. `col`/`span` are its placement in the column window (rebased,
   * clipped at the window edges, which lie off screen); `aria-colindex`/`aria-colspan` are absolute.
   */
  import BoardIcon from '../board/BoardIcon.svelte';
  import { placeClass, tintClass } from '../board/cell-state.ts';
  import ChipId from '../board/ChipId.svelte';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { preferences } from '../shell/preferences.svelte.ts';
  import type { CompareChipModel } from './compare-cells.ts';

  interface Props {
    chip: CompareChipModel;
    /** The row's lab (keyboard navigation reads it back from the cell). */
    lab: string;
    col: number;
    span: number;
    tabbable: boolean;
    active: boolean;
  }
  let { chip, lab, col, span, tabbable, active }: Props = $props();

  const text = $derived(preferences.chipText ? chip.text : null);
  const hatchMark = $derived(preferences.chipHatch && chip.partial && chip.bytePiece === null);
  const marked = $derived(chip.userDefined || text !== null || hatchMark || chip.special);
</script>

<div
  role="gridcell"
  class={`cmp-cell cmp-chip ${placeClass(col, span)}`}
  aria-colindex={chip.col + 1}
  aria-colspan={chip.span}
  aria-label={chip.label}
  tabindex={tabbable ? 0 : -1}
  data-lab={lab}
  data-index={chip.index}
  data-byte={chip.marker === null ? chip.start : -1}
  data-col={chip.col}
  data-partial={chip.partial ? '' : undefined}
  data-marker={chip.marker ?? undefined}
  data-active={active ? '' : undefined}
>
  {#if chip.marker !== null}
    <div class="bd-vis bd-chip marker" aria-hidden="true">
      <ChipId id={chip.id} digits={chip.digits} lines={chip.idLines} />
      <span class="bd-marker-text mono">{chip.markerText}</span>
    </div>
  {:else}
    <div
      class={`bd-vis bd-chip stacked ${tintClass(chip.tint)}`}
      class:hatch-start={chip.hatchStart}
      class:hatch-end={chip.hatchEnd}
      class:special={chip.special}
      class:byte-fallback={chip.bytePiece !== null}
      class:has-hatch={hatchMark}
      class:has-lock={chip.userDefined}
      aria-hidden="true"
    >
      <ChipId id={chip.id} digits={chip.digits} lines={chip.idLines} />
      {#if chip.bytePiece !== null}<span class="bd-piece mono">{chip.bytePiece}</span>
      {:else if marked}<span class="bd-chip-line"
          >{#if chip.userDefined}<BoardIcon name="lock" size={11} />{/if}{#if text !== null}<span class="bd-chip-text"
              >{text}</span
            >{/if}{#if hatchMark}<BoardIcon name="hatch" size={10} />{/if}{#if chip.special}<span class="bd-badge"
              >{i18n.t('board.special')}</span
            >{/if}</span
        >{/if}
    </div>
  {/if}
</div>
