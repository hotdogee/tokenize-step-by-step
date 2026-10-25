<script lang="ts">
  /**
   * Test-only host for the WP13 component tests (`integration.browser.test.ts`): provides the AppState context and renders
   * the counts line, the long-input banner and the live regions (status + alert toast) as the input panel does.
   */
  import CountsLine from '../shell/CountsLine.svelte';
  import LiveRegions from '../shell/LiveRegions.svelte';
  import type { AppState } from './app-state.svelte.ts';
  import { provideAppState } from './context.ts';
  import LongInputBanner from './LongInputBanner.svelte';

  interface Props {
    app: AppState;
  }
  let { app }: Props = $props();
  // svelte-ignore state_referenced_locally (one AppState per mounted harness)
  provideAppState(app);
</script>

<main class="frame">
  <LiveRegions />
  <CountsLine />
  <LongInputBanner />
</main>
