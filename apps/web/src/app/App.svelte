<script lang="ts">
  /**
   * The `/` page frame (05 §1): regions in DOM order = tab order — header (wordmark, picker, language, theme, help) →
   * input panel → pipeline rail → board → notices strip + footer → live-check drawer. The rail, board and drawer are
   * placeholders until WP09 / WP08 / WP10 land. Also owns the global single-key shortcuts (AD-22) and the two dialogs.
   */
  import { onMount } from 'svelte';
  import { i18n } from '../i18n/locale.svelte.ts';
  import BoardPlaceholder from '../shell/BoardPlaceholder.svelte';
  import CountsLine from '../shell/CountsLine.svelte';
  import ExampleChips from '../shell/ExampleChips.svelte';
  import Footer from '../shell/Footer.svelte';
  import Header from '../shell/Header.svelte';
  import HelpDialog from '../shell/HelpDialog.svelte';
  import LiveCheckPlaceholder from '../shell/LiveCheckPlaceholder.svelte';
  import LiveRegions from '../shell/LiveRegions.svelte';
  import NoticesStrip from '../shell/NoticesStrip.svelte';
  import OptionsRow from '../shell/OptionsRow.svelte';
  import PickerButton from '../shell/PickerButton.svelte';
  import PickerDialog from '../shell/PickerDialog.svelte';
  import { isEditableTarget, matchShortcut } from '../shell/shortcuts.ts';
  import StagePlaceholder from '../shell/StagePlaceholder.svelte';
  import TextInput from '../shell/TextInput.svelte';
  import type { AppState, Stage } from './app-state.svelte.ts';
  import { createAppState } from './bootstrap.ts';
  import { provideAppState } from './context.ts';
  import { textStats } from './text-stats.ts';

  interface Props {
    /** Tests pass their own; the page builds one (bootstrap.ts). */
    app?: AppState;
  }
  let { app = createAppState() }: Props = $props();
  // svelte-ignore state_referenced_locally (the AppState instance is created once per page and never replaced)
  provideAppState(app);

  let pickerOpen = $state(false);
  let helpOpen = $state(false);
  let textarea: HTMLTextAreaElement | undefined = $state();
  let liveCheckHeading: HTMLHeadingElement | undefined = $state();

  const STAGE_NAME = {
    1: 'stage.1',
    2: 'stage.2',
    3: 'stage.3',
    4: 'stage.4.chunks',
    5: 'stage.5',
    6: 'stage.6',
  } as const;

  /** "UTF-8 bytes: 12 bytes" (05 §3.5 status announcements). */
  function announceStage(stage: Stage): void {
    const name = stage === 4 && app.entry.family === 'spm-bpe' ? i18n.t('stage.4.symbols') : i18n.t(STAGE_NAME[stage]);
    const stats = textStats(app.text, 0);
    const result = app.currentResult;
    let detail: string;
    if (stage <= 2) detail = i18n.t('counts.codePoints', { n: stats.codePoints });
    else if (stage === 3) detail = i18n.t('counts.bytes', { n: stats.bytes });
    else if (result !== null) detail = i18n.t('counts.tokens', { n: result.stats.tokens });
    else detail = i18n.t('counts.tokensPending');
    app.announce(i18n.t('status.stage', { name, detail }));
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
        announceStage(app.stage);
        break;
      case 'jump':
        app.setStage(action.stage);
        announceStage(app.stage);
        break;
      case 'step':
        app.moveStep(action.delta);
        announceStage(app.stage);
        break;
      case 'byteView':
        app.cycleByteView(window.matchMedia('(min-width: 1024px)').matches);
        break;
      case 'graphemes':
        app.setGraphemes(!app.graphemes);
        break;
      case 'picker':
        pickerOpen = true;
        break;
      case 'focusText':
        textarea?.focus();
        break;
      case 'help':
        helpOpen = true;
        break;
    }
  }

  onMount(() => {
    i18n.setPage('main');
    void app.start();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<Header
  home
  skipTarget="#board"
  skipLabel={i18n.t('nav.skip')}
  onhelp={() => {
    helpOpen = true;
  }}
>
  {#snippet picker()}
    <PickerButton
      onopen={() => {
        pickerOpen = true;
      }}
    />
  {/snippet}
</Header>

<main class="main frame" id="main">
  <LiveRegions />
  <section class="input-panel" aria-label={i18n.t('input.label')}>
    <TextInput bind:element={textarea} />
    <ExampleChips />
    <OptionsRow />
    <CountsLine />
  </section>
  <StagePlaceholder />
  <BoardPlaceholder />

  <PickerDialog
    open={pickerOpen}
    assets={app.assets}
    onclose={() => {
      pickerOpen = false;
    }}
    onlivecheck={() => {
      liveCheckHeading?.focus();
    }}
  />
  <HelpDialog
    open={helpOpen}
    onclose={() => {
      helpOpen = false;
    }}
  />
</main>

<Footer entry={app.entry}>
  {#snippet notices()}
    <NoticesStrip entry={app.entry} />
  {/snippet}
</Footer>

<LiveCheckPlaceholder bind:heading={liveCheckHeading} />

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
