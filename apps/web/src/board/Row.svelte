<script lang="ts">
  /**
   * One packed row (05 §3.1, §8): fixed height per breakpoint; one ARIA `row` per shown tier (`aria-rowindex` =
   * packedRow × tiers + tier + 1), each a K-column grid of gridcells with `aria-colindex`/`aria-colspan` of the fragment;
   * the grapheme brackets, the NFKC source runs and the id line are decorative layers; the visually hidden `frag-…`
   * descriptions of fragmented spans live in a hidden container referenced by `aria-describedby`.
   */
  import type { RowModel } from '@tsbs/core';
  import BoardIcon from './BoardIcon.svelte';
  import BracketLayer from './BracketLayer.svelte';
  import ByteCell from './ByteCell.svelte';
  import CharCell from './CharCell.svelte';
  import ChunkCell from './ChunkCell.svelte';
  import { cellState, placeClass, type InteractionState } from './cell-state.ts';
  import { rowCells, type BoardContext } from './cells.ts';
  import { ariaRowIndex, type BoardTier } from './geometry.ts';
  import MarkerCell from './MarkerCell.svelte';
  import TokenChip from './TokenChip.svelte';

  interface Props {
    row: RowModel;
    ctx: BoardContext;
    interaction: InteractionState;
    emptyLabel: string;
  }
  let { row, ctx, interaction, emptyLabel }: Props = $props();

  /** Row names per tier (both byte rows are "Bytes"). */
  const TIER_NAMES = {
    char: 'board.tier.char',
    hex: 'board.tier.byte',
    dec: 'board.tier.byte',
    chunk: 'board.tier.chunk',
    token: 'board.tier.token',
  } as const;

  const cells = $derived(rowCells(row, ctx));
  const byteTiers = $derived(ctx.tiers.filter((tier) => tier === 'hex' || tier === 'dec'));

  function trackClass(tier: BoardTier): string {
    if (tier === 'hex' || tier === 'dec') return byteTiers.indexOf(tier) === 0 ? 'bd-track-bytes1' : 'bd-track-bytes2';
    return '';
  }
</script>

<div class="bd-row" role="none" data-row={row.index}>
  {#if cells.sources.length > 0}
    <div class="bd-sources" aria-hidden="true">
      {#each cells.sources as source (source.key)}
        <span class={`bd-src ${placeClass(source.col, source.span)}`} class:changed={source.changed}
          >{#if source.changed}<BoardIcon name="normalized" size={9} />{/if}{source.text}</span
        >
      {/each}
    </div>
  {/if}
  {#if cells.brackets.length > 0}<BracketLayer brackets={cells.brackets} />{/if}

  {#each ctx.tiers as tier, tierIndex (tier)}
    <div
      role="row"
      class={`bd-tier bd-tier-${tier} ${trackClass(tier)}`}
      aria-rowindex={ariaRowIndex(row.index, tierIndex, ctx.tiers.length)}
      aria-label={ctx.t(TIER_NAMES[tier])}
    >
      {#if tier === 'char'}
        {#each cells.chars as cell (cell.index)}
          <CharCell
            {cell}
            lang={ctx.lang}
            state={cellState(interaction, 'char', cell.index, cell.start, cell.end, true)}
          />
        {:else}
          <div
            role="gridcell"
            class="bd-cell bd-cell-empty"
            aria-colindex={1}
            aria-colspan={Math.max(1, row.columns)}
            aria-label={emptyLabel}
          ></div>
        {/each}
      {:else if tier === 'hex' || tier === 'dec'}
        {#each cells.bytes as cell (cell.index)}
          <ByteCell {cell} {tier} state={cellState(interaction, tier, cell.index, cell.index, cell.index + 1, true)} />
        {:else}
          <div
            role="gridcell"
            class="bd-cell bd-cell-empty"
            aria-colindex={1}
            aria-colspan={Math.max(1, row.columns)}
            aria-label={emptyLabel}
          ></div>
        {/each}
      {:else if tier === 'chunk'}
        {#each cells.chunks as cell (cell.index)}
          <ChunkCell {cell} state={cellState(interaction, 'chunk', cell.index, cell.start, cell.end, cell.first)} />
        {:else}
          <div
            role="gridcell"
            class="bd-cell bd-cell-empty"
            aria-colindex={1}
            aria-colspan={Math.max(1, row.columns)}
            aria-label={emptyLabel}
          ></div>
        {/each}
      {:else}
        {#each cells.tokens as cell (`${cell.variant}:${String(cell.index)}`)}
          {#if cell.variant === 'marker'}
            <MarkerCell {cell} state={cellState(interaction, 'token', cell.index, cell.start, cell.end, true)} />
          {:else}
            <TokenChip {cell} state={cellState(interaction, 'token', cell.index, cell.start, cell.end, cell.first)} />
          {/if}
        {:else}
          <div
            role="gridcell"
            class="bd-cell bd-cell-empty"
            aria-colindex={1}
            aria-colspan={Math.max(1, row.columns)}
            aria-label={emptyLabel}
          ></div>
        {/each}
      {/if}
    </div>
  {/each}

  {#if cells.ids.length > 0}
    <div class="bd-ids" aria-hidden="true">
      {#each cells.ids as id (id.index)}
        <span class={`bd-idl mono ${placeClass(id.col, id.span)}`} class:odd={id.odd}>{id.text}</span>
      {/each}
    </div>
  {/if}
  {#if cells.descriptions.length > 0}
    <div hidden>
      {#each cells.descriptions as description (description.id)}
        <span id={description.id}>{description.text}</span>
      {/each}
    </div>
  {/if}
</div>
