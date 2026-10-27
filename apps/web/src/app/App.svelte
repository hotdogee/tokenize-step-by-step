<script lang="ts">
  /**
   * The `/` page frame (05 §1, PA-19): regions in DOM order = tab order — the sticky header (wordmark, language, theme,
   * help) → the input panel (text box, Examples menu, the text-language note, the example's sentence) → the comparison
   * table of the newest tokenizer of each lab (edge to edge) → the Advanced disclosure (closed by default: the tokenizer
   * picker, the pipeline rail and the board — a lazy chunk —, the options, the counts line, the long-input banner and
   * Copy link) → the notices strip (the union over the tokenizers on screen) + footer → the live-check drawer. Also owns
   * the global single-key shortcuts (AD-22; those that act on the board open Advanced first) and the two dialogs, which
   * load on first open: neither is needed for first paint, and the picker brings the model rows and licence tags with it
   * (registry-details.ts), so both stay out of the initial Main JS of `/` (06 §3).
   *
   * WP13 wiring: the URL writer (`history.replaceState`, debounced 500 ms, everything but the text — `t` and `s` only
   * while Advanced is open, `r` for the table's row choices — and a `q` that no longer equals the text removed —
   * url-state.ts). PA-19: once the board's tokenizer is on its way, the other default rows' vocabularies are prefetched
   * 10 s later (`hub.prefetchIdle`, skipped under Save-Data).
   */
  import { onMount } from 'svelte';
  import type { TokenizerId } from '@tsbs/core';
  import { openLiveCheck } from '../byok/drawer.svelte.ts';
  import LiveCheckDrawer from '../byok/LiveCheckDrawer.svelte';
  import { i18n } from '../i18n/locale.svelte.ts';
  import CompareTable from '../compare/CompareTable.svelte';
  import Advanced from '../shell/Advanced.svelte';
  import ExamplesMenu from '../shell/ExamplesMenu.svelte';
  import Footer from '../shell/Footer.svelte';
  import Header from '../shell/Header.svelte';
  import type HelpDialogComponent from '../shell/HelpDialog.svelte';
  import LiveRegions from '../shell/LiveRegions.svelte';
  import NoticesStrip from '../shell/NoticesStrip.svelte';
  import type PickerDialogComponent from '../shell/PickerDialog.svelte';
  import { isEditableTarget, matchShortcut } from '../shell/shortcuts.ts';
  import { setViewResolvers } from '../board/view-cache.ts';
  import TextInput from '../shell/TextInput.svelte';
  import type { AppState } from './app-state.svelte.ts';
  import { createAppState } from './bootstrap.ts';
  import { provideAppState } from './context.ts';
  import { EXAMPLES_INDEX, tokenizerEntry } from './registry.ts';
  import { stageParam, URL_WRITE_DELAY_MS, urlFor } from './url-state.ts';

  interface Props {
    /** Tests pass their own; the page builds one (bootstrap.ts). */
    app?: AppState;
  }
  let { app = createAppState() }: Props = $props();
  // svelte-ignore state_referenced_locally (the AppState instance is created once per page and never replaced)
  provideAppState(app);

  let pickerOpen = $state(false);
  let helpOpen = $state(false);
  let PickerDialog: typeof PickerDialogComponent | null = $state.raw(null);
  let HelpDialog: typeof HelpDialogComponent | null = $state.raw(null);
  let textarea: HTMLTextAreaElement | undefined = $state();

  /** The tokenizers on screen, whose notices the strip shows: every row's, and the board's while Advanced is open. */
  const shown = $derived(
    [...app.rows.visibleTokenizers(), ...(app.advancedOpen ? [app.tokenizer] : [])].map((id) => tokenizerEntry(id)),
  );

  /** A dialog chunk that fails to load means a page older than the deploy: the `fetch` alert offers the reload (AD-11). */
  function staleChunk(error: unknown): void {
    app.error = { code: 'fetch', message: String(error), retryable: false, tokenizer: app.tokenizer, previous: null };
  }

  // URL state (05 §1.1): everything but the text, 500 ms after the last change; a `q` already in the URL (a deep link,
  // "Copy link") stays while the text equals it and goes 500 ms after an edit, so the address bar never brings back a text
  // that is no longer in the textarea. The state the page opened with is never rewritten.
  let urlKey: string | null = null;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const snapshot = app.urlSnapshot();
    const text = app.text;
    const key = [
      snapshot.advanced ? snapshot.tokenizer : '',
      snapshot.advanced ? stageParam(snapshot.stage, snapshot.step) : '',
      snapshot.rows.join(','),
      snapshot.byteView,
      snapshot.locale,
      snapshot.textLang,
    ].join('|');
    const first = urlKey === null;
    const changed = urlKey !== key;
    urlKey = key;
    if (first || (!changed && !staleQuery(text))) return;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const q = new URL(location.href).searchParams.get('q');
      history.replaceState(history.state, '', urlFor(location.href, snapshot, q === text ? text : undefined));
    }, URL_WRITE_DELAY_MS);
  });

  /** True when the URL carries a `q` that is not the current text. */
  function staleQuery(text: string): boolean {
    const q = new URL(location.href).searchParams.get('q');
    return q !== null && q !== text;
  }

  function openPicker(): void {
    pickerOpen = true;
    if (PickerDialog !== null) return;
    import('../shell/PickerDialog.svelte').then(
      (module) => {
        PickerDialog = module.default;
      },
      (error: unknown) => {
        pickerOpen = false;
        staleChunk(error);
      },
    );
  }

  function openHelp(): void {
    helpOpen = true;
    if (HelpDialog !== null) return;
    import('../shell/HelpDialog.svelte').then(
      (module) => {
        HelpDialog = module.default;
      },
      (error: unknown) => {
        helpOpen = false;
        staleChunk(error);
      },
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    const action = matchShortcut(event, {
      enabled: app.singleKeyShortcuts,
      inEditable: isEditableTarget(event.target),
      inDialog: pickerOpen || helpOpen || document.querySelector('dialog[open]') !== null,
    });
    if (action === null) return;
    event.preventDefault();
    // The keys that act on the board (stops, steps, the picker) open Advanced first (PA-19).
    if (action.kind === 'stage' || action.kind === 'jump' || action.kind === 'step' || action.kind === 'picker')
      app.openAdvanced();
    switch (action.kind) {
      case 'stage':
        app.moveStage(action.delta);
        app.announceStage();
        break;
      case 'jump':
        app.setStage(action.stage);
        app.announceStage();
        break;
      case 'step':
        app.moveStep(action.delta);
        app.announceStage();
        break;
      case 'byteView':
        app.cycleByteView(window.matchMedia('(min-width: 1024px)').matches);
        break;
      case 'graphemes':
        app.setGraphemes(!app.graphemes);
        break;
      case 'picker':
        openPicker();
        break;
      case 'focusText':
        textarea?.focus();
        break;
      case 'help':
        openHelp();
        break;
    }
  }

  onMount(() => {
    i18n.setPage('main');
    setViewResolvers(app.viewResolvers);
    void app.start().then(() => {
      // The other default rows' vocabularies, into the Cache API only, 10 s after the load trigger (PA-19 §2.3).
      const others: TokenizerId[] = EXAMPLES_INDEX.defaults
        .map((entry) => entry.tokenizer)
        .filter((id) => id !== app.tokenizer);
      void app.hub.prefetchIdle(others);
    });
    return () => {
      setViewResolvers(null);
      clearTimeout(urlTimer);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<Header home skipTarget="#compare" skipLabel={i18n.t('nav.skip')} onhelp={openHelp} />

<main class="main frame" id="main">
  <LiveRegions />
  <section class="input-panel" aria-label={i18n.t('input.label')}>
    <TextInput bind:element={textarea} />
    <ExamplesMenu />
  </section>

  <CompareTable />

  <Advanced onpicker={openPicker} onstale={staleChunk} />

  {#if PickerDialog !== null}
    <PickerDialog
      open={pickerOpen}
      assets={app.assets}
      onclose={() => {
        pickerOpen = false;
      }}
      onlivecheck={() => {
        openLiveCheck('anthropic-count');
      }}
    />
  {/if}
  {#if HelpDialog !== null}
    <HelpDialog
      open={helpOpen}
      onclose={() => {
        helpOpen = false;
      }}
    />
  {/if}
</main>

<Footer>
  {#snippet notices()}
    <NoticesStrip entries={shown} />
  {/snippet}
</Footer>

<LiveCheckDrawer />

<style>
  .main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    padding-block: 1rem;
  }

  .input-panel {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
</style>
