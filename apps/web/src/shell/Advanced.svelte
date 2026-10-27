<script lang="ts">
  /**
   * The Advanced disclosure (PA-19, 05 §1): `<details id="advanced">` under the comparison table, closed by default and
   * URL-driven (AppState `advancedOpen`: a link with `t` or `s` opens it; the summary, the table's Enter and the board's
   * global keys open it too; never persisted). Its body, in order:
   *
   * - the step-by-step group: the tokenizer picker button, then the pipeline rail and the board with its inspector, which
   *   arrive as a lazy chunk (`AdvancedBoard.svelte`) the first time the disclosure opens — a one-line status holds the
   *   space meanwhile, so the summary does not move;
   * - the options group: the options row (text language, special tokens, byte values, grapheme brackets, the two chip
   *   toggles), the counts line of the board's tokenizer, the long-input banner (lazy, on-demand tiers only) and Copy link.
   */
  import type AdvancedBoardComponent from '../board/AdvancedBoard.svelte';
  import CopyLink from '../app/CopyLink.svelte';
  import { appState } from '../app/context.ts';
  import type LongInputBannerComponent from '../app/LongInputBanner.svelte';
  import { isOnDemand } from '../app/long-input.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import CountsLine from './CountsLine.svelte';
  import OptionsRow from './OptionsRow.svelte';
  import PickerButton from './PickerButton.svelte';

  interface Props {
    /** Opens the tokenizer picker dialog (App.svelte owns it). */
    onpicker: () => void;
    /** A lazy chunk failed to load: a page older than the deploy (the `fetch` alert offers the reload, AD-11). */
    onstale: (error: unknown) => void;
  }
  let { onpicker, onstale }: Props = $props();
  const app = appState();

  let AdvancedBoard: typeof AdvancedBoardComponent | null = $state.raw(null);
  let boardImport = false;
  $effect(() => {
    if (!app.advancedOpen || boardImport) return;
    boardImport = true;
    import('../board/AdvancedBoard.svelte').then(
      (module) => {
        AdvancedBoard = module.default;
      },
      (error: unknown) => {
        boardImport = false;
        onstale(error);
      },
    );
  });

  /** The long-input banner (AD-27) loads the first time a text reaches an on-demand tier. */
  let LongInputBanner: typeof LongInputBannerComponent | null = $state.raw(null);
  $effect(() => {
    if (!isOnDemand(app.longInput) || LongInputBanner !== null) return;
    import('../app/LongInputBanner.svelte').then(
      (module) => {
        LongInputBanner = module.default;
      },
      (error: unknown) => {
        onstale(error);
      },
    );
  });
</script>

<details
  class="advanced"
  id="advanced"
  open={app.advancedOpen}
  ontoggle={(event) => {
    app.advancedOpen = event.currentTarget.open;
  }}
  data-testid="advanced"
>
  <summary class="summary" data-testid="advanced-summary">
    <span class="title">{i18n.t('advanced.label')}</span>
    <span class="sub prose">{i18n.t('advanced.summary')}</span>
  </summary>
  <div class="body">
    <section class="group" aria-labelledby="advanced-steps">
      <h3 id="advanced-steps" class="group-title">{i18n.t('advanced.stepByStep')}</h3>
      <div class="picker"><PickerButton onopen={onpicker} /></div>
      {#if AdvancedBoard !== null}
        <AdvancedBoard />
      {:else}
        <p class="loading" data-testid="advanced-loading">
          {i18n.t('status.loading', { name: i18n.t('advanced.stepByStep') })}
        </p>
      {/if}
    </section>
    <section class="group" aria-labelledby="advanced-options">
      <h3 id="advanced-options" class="group-title">{i18n.t('advanced.options')}</h3>
      <OptionsRow />
      <CountsLine />
      {#if LongInputBanner !== null}<LongInputBanner />{/if}
      <CopyLink />
    </section>
  </div>
</details>

<style>
  .advanced {
    min-width: 0;
    border: var(--border-width) solid var(--border);
    border-radius: calc(var(--radius) * 2);
    background: var(--surface);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    min-height: 2.75rem;
    padding: 0.625rem 1rem;
    border-radius: calc(var(--radius) * 2);
    cursor: pointer;
    list-style: none;
  }

  .summary::-webkit-details-marker {
    display: none;
  }

  /* The disclosure chevron: a CSS border, so forced colours keep it. */
  .title {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    font-weight: 700;
  }

  .title::before {
    content: '';
    width: 0.45rem;
    height: 0.45rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(-45deg);
    transition: transform var(--dur) var(--ease);
  }

  .advanced[open] .title::before {
    transform: rotate(45deg);
  }

  .sub {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
    padding: 0.25rem 1rem 1rem;
  }

  .group {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    min-width: 0;
  }

  .group-title {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* The picker chip keeps its natural width (it filled the header line below 768 px before PA-19). */
  .picker {
    justify-self: start;
    max-width: 100%;
  }

  .loading {
    margin: 0;
    min-height: 1.5rem;
    color: var(--fg-muted);
    font-size: 0.875rem;
  }
</style>
