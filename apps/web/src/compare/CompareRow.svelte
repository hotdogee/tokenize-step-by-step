<script lang="ts">
  /**
   * One lab's row of the comparison table (PA-19, 05 §4): a caption line pinned to the left edge — the lab, the row's
   * tokenizer `<select>` (the lab's tokenizers; Anthropic also "Claude 5.5 · API key"), the token count, the
   * partial-character count (short, "2 partial"; the long form for assistive tech), the fidelity badge when it is not "confirmed", the loading progress or the error with its
   * action (Retry; Reload; back to the lab's primary tokenizer), and a visually hidden source badge (`span[data-source]`: precomputed · live · pending) — then the chips, an
   * ARIA row of the table's grid (`cmp-row-<lab>`, owned through `aria-owns`; the caption with its select stays outside
   * the grid). In the API mode there are no chips: a note and the "Live check…" button instead (no boundaries, 05 §13).
   */
  import type { ResolvedTextLang, TokenizationResult } from '@tsbs/core';
  import type { TokenizerEntry } from '@tsbs/registry';
  import { appState } from '../app/context.ts';
  import { errorView, type ErrorAction } from '../app/errors.ts';
  import { DEFAULT_TOKENIZER, tokenizerEntry } from '../app/registry.ts';
  import type { HubEntry } from '../app/result-hub.svelte.ts';
  import { answers } from '../byok/live-state.svelte.ts';
  import { openLiveCheck } from '../byok/drawer.svelte.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { formatPercent } from '../i18n/t.ts';
  import FidelityBadge from '../shell/FidelityBadge.svelte';
  import { preferences } from '../shell/preferences.svelte.ts';
  import { progressPercent } from '../shell/progress.ts';
  import { fusesDummy, rowChips } from './compare-cells.ts';
  import CompareChip from './CompareChip.svelte';
  import { placeIn, type ColumnWindow } from './compare-window.ts';
  import { ANTHROPIC_API, type LabRow, type RowChoice, type RowState } from './rows.svelte.ts';

  interface Props {
    row: LabRow;
    choice: RowChoice;
    entry: TokenizerEntry | null;
    hub: HubEntry | null;
    /** What the row draws (`state` current or stale), else null. */
    result: TokenizationResult | null;
    state: RowState;
    window: ColumnWindow;
    marker: number;
    cols: number;
    /** `aria-rowindex` of the chip row. */
    rowIndex: number;
    /** The token index with the grid's tab stop, the focused one (while the grid has focus). */
    tabStop: number | null;
    active: number | null;
    lang: ResolvedTextLang;
    /** The row's select changed. */
    onselect: (lab: LabRow['lab'], value: RowChoice) => void;
  }
  let {
    row,
    choice,
    entry,
    hub,
    result,
    state,
    window,
    marker,
    cols,
    rowIndex,
    tabStop,
    active,
    lang,
    onselect,
  }: Props = $props();
  const app = appState();

  const LAB = {
    openai: 'lab.openai',
    anthropic: 'lab.anthropic',
    google: 'lab.google',
    meta: 'lab.meta',
    xai: 'lab.xai',
  } as const;

  const labName = $derived(i18n.t(LAB[row.lab]));
  const chips = $derived(
    result === null || entry === null
      ? []
      : rowChips(result, {
          window,
          marker,
          t: i18n.t,
          fusedDummy: fusesDummy(result, entry),
          hatchMark: preferences.chipHatch,
        }),
  );
  const source = $derived(state === 'current' ? (hub?.source ?? 'precomputed') : 'pending');
  const onPrimary = $derived(choice === row.primary.id);
  const error = $derived(
    state === 'error' && hub?.error !== null && hub?.error !== undefined
      ? errorView(
          hub.error,
          (id) => tokenizerEntry(id).displayName[i18n.current],
          onPrimary ? DEFAULT_TOKENIZER : row.primary.id,
        )
      : null,
  );
  /** The error's action on this row: back is the lab's primary tokenizer, and on the primary already a retry. */
  const action: ErrorAction | null = $derived(
    error?.action === 'back' && onPrimary ? 'retry' : (error?.action ?? null),
  );
  const ACTION_LABEL = { retry: 'action.retry', reload: 'action.reload', back: 'action.back' } as const;

  function act(): void {
    if (action === 'reload') location.reload();
    else if (action === 'back') onselect(row.lab, row.primary.id);
    else app.retryRow(row.lab);
  }
  const status = $derived.by(() => {
    if (state === 'loading' && hub?.progress !== null && hub?.progress !== undefined)
      return i18n.t('compare.loading', { percent: formatPercent(progressPercent(hub.progress) / 100, i18n.current) });
    if (state === 'onDemand') return i18n.t('counts.tokensOnDemand');
    if (error !== null) return i18n.t(error.key, error.params);
    return i18n.t('counts.tokensPending');
  });
  /** An API count of the text on screen (the drawer's answer, 05 §13). */
  const apiCount = $derived(
    state === 'api' && answers.anthropic !== null && answers.anthropic.text === app.text ? answers.anthropic : null,
  );

  /**
   * The select shows the short name (the display name without its parenthetical; "Claude 1/2 legacy" for the longest);
   * the row's name says it whole.
   */
  function shortName(candidate: TokenizerEntry): string {
    if (candidate.id === 'anthropic-claude-legacy') return i18n.t('compare.claudeLegacy');
    return candidate.displayName[i18n.current].replace(/\s*[(（][^()（）]*[)）]\s*$/u, '');
  }
</script>

<div class="cmp-rowgroup" data-row={row.lab} data-tokenizer={choice} data-state={state}>
  <div class="cmp-caption">
    <span class="cmp-cap">
      <b>{labName}</b>
      <select
        aria-label={i18n.t('compare.selectLabel', { lab: labName })}
        value={choice}
        onchange={(event) => {
          onselect(row.lab, event.currentTarget.value as RowChoice);
        }}
        data-testid={`row-select-${row.lab}`}
      >
        {#each row.entries as candidate (candidate.id)}
          <option value={candidate.id}>{shortName(candidate)}</option>
        {/each}
        {#if row.api}<option value={ANTHROPIC_API}>{i18n.t('compare.anthropicApi')}</option>{/if}
      </select>
      <!-- Each "·" sits in one piece with the item after it (.cmp-item), so a wrapped caption never ends a line on it. -->
      {#if state === 'api'}
        {#if apiCount !== null}<span class="cmp-item"
            ><span aria-hidden="true">·</span><span class="cmp-count cmp-wrap"
              >{i18n.t('compare.apiTotal', { total: apiCount.summary.total, frame: apiCount.summary.frame })}</span
            ></span
          >{/if}
      {:else}
        {#if result !== null}
          <span class="cmp-item"
            ><span aria-hidden="true">·</span><span class="cmp-count"
              >{i18n.t('counts.tokens', { n: result.stats.tokens })}</span
            ></span
          >
          {#if result.stats.partialTokens > 0}<span class="cmp-item" data-testid="row-partial"
              ><span aria-hidden="true">·</span><span aria-hidden="true"
                >{i18n.t('compare.partial', { n: result.stats.partialTokens })}</span
              ><span class="visually-hidden">{i18n.t('counts.partial', { n: result.stats.partialTokens })}</span></span
            >{/if}
        {:else}
          <span class="cmp-item"
            ><span aria-hidden="true">·</span><span class="cmp-wrap" data-testid="row-status">{status}</span></span
          >
          {#if action !== null}
            <button type="button" class="btn btn-quiet" data-testid="row-action" data-action={action} onclick={act}
              >{i18n.t(ACTION_LABEL[action])}</button
            >
          {/if}
        {/if}
        {#if entry !== null && entry.fidelity !== 'confirmed'}<FidelityBadge fidelity={entry.fidelity} />{/if}
        <span class="visually-hidden" data-source={source}
          >{i18n.t(
            source === 'live' ? 'badge.live' : source === 'precomputed' ? 'badge.precomputed' : 'counts.tokensPending',
          )}</span
        >
      {/if}
    </span>
  </div>
  {#if state === 'api'}
    <div class="cmp-api">
      <div class="cmp-api-in">
        <span class="prose">{i18n.t('compare.apiNote')}</span>
        <button
          type="button"
          class="btn"
          data-testid="row-live-check"
          onclick={() => {
            openLiveCheck('anthropic-count');
          }}>{i18n.t('compare.liveCheck')}</button
        >
      </div>
    </div>
  {:else}
    <div
      role="row"
      id={`cmp-row-${row.lab}`}
      class="cmp-row cmp-chips"
      aria-rowindex={rowIndex}
      aria-label={i18n.t('compare.caption', {
        lab: labName,
        tokenizer: entry === null ? '' : entry.displayName[i18n.current],
      })}
      data-pending={state === 'stale' ? '' : undefined}
      {lang}
    >
      {#each chips as chip (chip.index)}
        {@const place = placeIn(window, chip.col, chip.span)}
        <CompareChip
          {chip}
          lab={row.lab}
          col={place.col}
          span={place.span}
          tabbable={chip.index === tabStop}
          active={chip.index === active}
        />
      {:else}
        <div
          role="gridcell"
          class="cmp-cell cmp-empty"
          aria-colindex={1}
          aria-colspan={Math.max(1, cols)}
          aria-label={result === null ? status : i18n.t('a11y.cell.empty')}
        ></div>
      {/each}
    </div>
  {/if}
</div>
