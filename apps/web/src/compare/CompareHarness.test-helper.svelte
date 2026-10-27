<script lang="ts">
  /**
   * Test-only host for the comparison table's browser tests (`compare-render.browser.test.ts`): provides the AppState
   * context and renders the table in the page frame (`.frame`: the 16 px gutters it breaks out of), after the textarea
   * its Esc key returns to.
   */
  import type { AppState } from '../app/app-state.svelte.ts';
  import { provideAppState } from '../app/context.ts';
  import CompareTable from './CompareTable.svelte';

  interface Props {
    app: AppState;
  }
  let { app }: Props = $props();
  // svelte-ignore state_referenced_locally (one AppState per mounted harness)
  provideAppState(app);
</script>

<textarea id="text-input" aria-label="text" value={app.text}></textarea>
<main class="frame">
  <CompareTable />
</main>
