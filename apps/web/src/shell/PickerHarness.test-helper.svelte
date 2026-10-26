<script lang="ts">
  /**
   * Test-only host for `picker-dialog.browser.test.ts`: provides the AppState context and owns the picker the way
   * App.svelte does (an `open` flag the opener sets and `onclose` clears); `onlivecheck` is the test's spy.
   */
  import type { AppState } from '../app/app-state.svelte.ts';
  import { provideAppState } from '../app/context.ts';
  import PickerDialog from './PickerDialog.svelte';

  interface Props {
    app: AppState;
    onlivecheck: () => void;
  }
  let { app, onlivecheck }: Props = $props();
  // svelte-ignore state_referenced_locally (one AppState per mounted harness)
  provideAppState(app);
  let open = $state(false);
</script>

<button
  type="button"
  data-testid="opener"
  onclick={() => {
    open = true;
  }}>Open</button
>
<PickerDialog
  {open}
  assets={null}
  onclose={() => {
    open = false;
  }}
  {onlivecheck}
/>
