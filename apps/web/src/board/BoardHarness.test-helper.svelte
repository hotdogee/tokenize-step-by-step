<script lang="ts">
  /**
   * Test-only host for the board's component tests (`*.browser.test.ts`): provides the AppState context and wraps the
   * board in the page frame (`.frame`: full width with the 16 px gutters, the 05 §3.3 board container), optionally with a
   * fixed container width so K can be asserted from the formula. Also renders the textarea the board syncs with.
   */
  import type { AppState } from '../app/app-state.svelte.ts';
  import { provideAppState } from '../app/context.ts';
  import Board from './Board.svelte';

  interface Props {
    app: AppState;
    /** Container width in px (default: the viewport). */
    width?: number | undefined;
  }
  let { app, width }: Props = $props();
  // svelte-ignore state_referenced_locally (one AppState per mounted harness)
  provideAppState(app);
</script>

<textarea id="text-input" aria-label="text" value={app.text}></textarea>
<div class="frame" data-testid="frame" style:width={width === undefined ? undefined : `${String(width)}px`}>
  <Board />
</div>
