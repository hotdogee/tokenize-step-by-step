<script lang="ts">
  /** Test-only host for the drawer's component tests: provides the AppState context and renders the drawer. */
  import type { AppState } from '../app/app-state.svelte.ts';
  import { provideAppState } from '../app/context.ts';
  import LiveCheckDrawer from './LiveCheckDrawer.svelte';

  interface Props {
    app: AppState;
  }
  let { app }: Props = $props();
  // svelte-ignore state_referenced_locally (one AppState per mounted harness)
  provideAppState(app);
</script>

<LiveCheckDrawer />
