<script lang="ts">
  /**
   * Test-only host for the rail's component tests (`*.browser.test.ts`): provides the AppState context and renders the
   * rail above the board inside the page frame, as App.svelte does, plus the textarea the board syncs with and,
   * optionally, the header's picker chip (its loading bar is the reduced-motion `transition: none` check).
   */
  import type { AppState } from '../app/app-state.svelte.ts';
  import { provideAppState } from '../app/context.ts';
  import Board from '../board/Board.svelte';
  import PickerButton from '../shell/PickerButton.svelte';
  import PipelineRail from './PipelineRail.svelte';

  interface Props {
    app: AppState;
    picker?: boolean;
  }
  let { app, picker = false }: Props = $props();
  // svelte-ignore state_referenced_locally (one AppState per mounted harness)
  provideAppState(app);
</script>

<textarea id="text-input" aria-label="text" value={app.text}></textarea>
<div class="frame">
  {#if picker}<PickerButton onopen={() => undefined} />{/if}
  <PipelineRail />
  <Board />
</div>
