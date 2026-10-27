<script lang="ts">
  /**
   * The comparison table's header box (PA-19, 05 §4): the first of the three horizontal scrollers, pinned under the
   * sticky app header (`position: sticky; top: var(--header-h)`) while the page scrolls past the table. A caption (the
   * text's code points and bytes, and the scroll hint, shown while the table is wider than the screen — its line is held
   * in the static first paint too, so hydration shifts nothing, PA-15) above the character row
   * and the byte row(s) in the chosen byte view (`b=both`: hex and decimal), all on the rows' byte-column axis and in the
   * same column window. Both rows are ARIA rows of the table's grid (`cmp-r-char`, `cmp-r-hex`, `cmp-r-dec`, owned
   * through `aria-owns`) with `columnheader` cells. Above 20,000 code points (AD-27) the caption also says the rows wait
   * and offers "Tokenize now" (the board's run, then the rows'), so the closed Advanced disclosure that holds the
   * long-input banner is not the only way to tokenize a long text.
   */
  import type { ResolvedTextLang } from '@tsbs/core';
  import { appState } from '../app/context.ts';
  import { isOnDemand } from '../app/long-input.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { headerCells, type HeaderText } from './compare-cells.ts';
  import CompareByte from './CompareByte.svelte';
  import CompareChar from './CompareChar.svelte';
  import { placeIn, type ColumnWindow } from './compare-window.ts';

  interface Props {
    source: HeaderText;
    window: ColumnWindow;
    marker: number;
    byteViews: ReadonlyArray<'hex' | 'dec'>;
    lang: ResolvedTextLang;
    /** The table is wider than the screen (the caption's scroll hint shows; hidden, it keeps its room). */
    overflow: boolean;
    /** Pinned under the app header (its shadow). */
    pinned: boolean;
    element?: HTMLDivElement | undefined;
  }
  let { source, window, marker, byteViews, lang, overflow, pinned, element = $bindable() }: Props = $props();

  const app = appState();
  const cells = $derived(headerCells(source, { window, marker, t: i18n.t }));
</script>

<div class="cmp-thead" class:pinned bind:this={element} data-testid="compare-head">
  <div class="cmp-track">
    <div class="cmp-caption">
      <span class="cmp-cap"
        ><b>{i18n.t('stage.1')}</b><span>{i18n.t('counts.codePoints', { n: source.codePoints })}</span><span
          class="cmp-item"
          ><span aria-hidden="true">·</span><span>{i18n.t('counts.bytes', { n: source.utf8.length })}</span></span
        ><span
          class="cmp-item cmp-hint"
          class:off={!overflow}
          aria-hidden={overflow ? undefined : 'true'}
          data-testid="compare-hint"><span aria-hidden="true">·</span><span>{i18n.t('compare.scrollHint')}</span></span
        >{#if isOnDemand(app.longInput)}<span class="cmp-item"
            ><span aria-hidden="true">·</span><span class="cmp-wrap">{i18n.t('longInput.banner')}</span></span
          ><button
            type="button"
            class="btn"
            aria-disabled={app.running}
            data-testid="compare-run"
            onclick={() => {
              if (!app.running) void app.runOnDemand();
            }}>{i18n.t('longInput.run')}</button
          >{/if}</span
      >
    </div>
    <div role="row" id="cmp-r-char" class="cmp-row" aria-rowindex={1} aria-label={i18n.t('board.tier.char')}>
      {#each cells.chars as cell (cell.index)}
        {@const place = placeIn(window, cell.col, cell.span)}
        <CompareChar {cell} col={place.col} span={place.span} {lang} />
      {:else}
        <div
          role="columnheader"
          class="cmp-cell cmp-empty cmp-char"
          aria-colindex={1}
          aria-label={i18n.t('a11y.cell.empty')}
        ></div>
      {/each}
    </div>
    {#each byteViews as view, k (view)}
      <div
        role="row"
        id={`cmp-r-${view}`}
        class="cmp-row cmp-bytes"
        aria-rowindex={2 + k}
        aria-label={i18n.t('board.tier.byte')}
      >
        {#each cells.bytes as cell (cell.index)}
          <CompareByte {cell} {view} col={placeIn(window, cell.col, 1).col} />
        {:else}
          <div
            role="columnheader"
            class="cmp-cell cmp-empty cmp-byte"
            aria-colindex={1}
            aria-label={i18n.t('a11y.cell.empty')}
          ></div>
        {/each}
      </div>
    {/each}
  </div>
</div>
