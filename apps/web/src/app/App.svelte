<script lang="ts">
  /**
   * The `/` page frame (05 §1): regions in DOM order = tab order — header (wordmark, picker, language, theme, help) →
   * input panel → pipeline rail → board → notices strip + footer → live-check drawer. The rail is WP09's (it must stay
   * before the board: its motion director's `$effect.pre` snapshots FLIP geometry before the board commits), the board
   * WP08's and the drawer WP10's. Also owns the global single-key shortcuts (AD-22) and the two dialogs,
   * which load on first open: neither is needed for first paint, and the picker brings the model rows and licence tags
   * with it (registry-details.ts), so both stay out of the initial Main JS of `/` (06 §3).
   *
   * WP13 wiring: the long-input banners and "Copy link" in the input panel, the URL writer (`history.replaceState`,
   * debounced 500 ms, everything but the text — url-state.ts) and the crossfade a result swap runs in (precomputed →
   * live, one tokenizer's answer → another's: the board's View Transition of motion/view-transition.ts).
   */
  import { onMount } from 'svelte';
  import { motionPrefs } from '../motion/motion-prefs.svelte.ts';
  import { crossfade } from '../motion/view-transition.ts';
  import Board from '../board/Board.svelte';
  import { openLiveCheck } from '../byok/drawer.svelte.ts';
  import LiveCheckDrawer from '../byok/LiveCheckDrawer.svelte';
  import { i18n } from '../i18n/locale.svelte.ts';
  import CountsLine from '../shell/CountsLine.svelte';
  import ExampleChips from '../shell/ExampleChips.svelte';
  import Footer from '../shell/Footer.svelte';
  import Header from '../shell/Header.svelte';
  import type HelpDialogComponent from '../shell/HelpDialog.svelte';
  import LiveRegions from '../shell/LiveRegions.svelte';
  import NoticesStrip from '../shell/NoticesStrip.svelte';
  import OptionsRow from '../shell/OptionsRow.svelte';
  import PickerButton from '../shell/PickerButton.svelte';
  import type PickerDialogComponent from '../shell/PickerDialog.svelte';
  import { isEditableTarget, matchShortcut } from '../shell/shortcuts.ts';
  import PipelineRail from '../pipeline/PipelineRail.svelte';
  import TextInput from '../shell/TextInput.svelte';
  import type { AppState } from './app-state.svelte.ts';
  import { createAppState } from './bootstrap.ts';
  import { provideAppState } from './context.ts';
  import CopyLink from './CopyLink.svelte';
  import type LongInputBannerComponent from './LongInputBanner.svelte';
  import { isOnDemand } from './long-input.ts';
  import { stageParam, URL_WRITE_DELAY_MS, urlFor, type UrlSnapshot } from './url-state.ts';

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
  /** The long-input banner (AD-27) loads the first time a text reaches an on-demand tier. */
  let LongInputBanner: typeof LongInputBannerComponent | null = $state.raw(null);
  $effect(() => {
    if (!isOnDemand(app.longInput) || LongInputBanner !== null) return;
    import('./LongInputBanner.svelte').then(
      (module) => {
        LongInputBanner = module.default;
      },
      (error: unknown) => {
        staleChunk(error);
      },
    );
  });

  /** A dialog chunk that fails to load means a page older than the deploy: the `fetch` alert offers the reload (AD-11). */
  function staleChunk(error: unknown): void {
    app.error = { code: 'fetch', message: String(error), retryable: false, tokenizer: app.tokenizer, previous: null };
  }

  // URL state (05 §1.1): everything but the text, 500 ms after the last change; a `q` already in the URL stays while the
  // text is unchanged. The state the page opened with is never rewritten.
  let urlKey: string | null = null;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const snapshot: UrlSnapshot = {
      tokenizer: app.tokenizer,
      stage: app.stage,
      step: app.step,
      byteView: app.byteView,
      locale: i18n.current,
      textLang: app.textLang,
    };
    const text = app.text;
    const key = [
      snapshot.tokenizer,
      stageParam(snapshot.stage, snapshot.step),
      snapshot.byteView,
      snapshot.locale,
      snapshot.textLang,
    ].join('|');
    if (urlKey === null || urlKey === key) {
      urlKey = key;
      return;
    }
    urlKey = key;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const q = new URL(location.href).searchParams.get('q');
      history.replaceState(history.state, '', urlFor(location.href, snapshot, q === text ? text : undefined));
    }, URL_WRITE_DELAY_MS);
  });

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
    app.setResultTransition((update) => crossfade(document.getElementById('board'), update, motionPrefs.reduced));
    void app.start();
    return () => {
      app.setResultTransition(null);
      clearTimeout(urlTimer);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<Header home skipTarget="#board" skipLabel={i18n.t('nav.skip')} onhelp={openHelp}>
  {#snippet picker()}
    <PickerButton onopen={openPicker} />
  {/snippet}
</Header>

<main class="main frame" id="main">
  <LiveRegions />
  <section class="input-panel" aria-label={i18n.t('input.label')}>
    <TextInput bind:element={textarea} />
    <ExampleChips />
    <OptionsRow />
    <CountsLine />
    {#if LongInputBanner !== null}<LongInputBanner />{/if}
    <CopyLink />
  </section>
  <PipelineRail />
  <Board />

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

<Footer entry={app.entry}>
  {#snippet notices()}
    <NoticesStrip entry={app.entry} />
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
