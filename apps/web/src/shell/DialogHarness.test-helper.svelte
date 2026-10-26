<script lang="ts">
  /**
   * Test-only host for `dialog.browser.test.ts`: an opener button and the modal `Dialog` it opens, owned the way
   * App.svelte owns the picker and help dialogs (an `open` flag the opener sets and `onclose` clears).
   */
  import Dialog from './Dialog.svelte';

  let open = $state(false);
</script>

<button
  type="button"
  data-testid="opener"
  onclick={() => {
    open = true;
  }}>Open</button
>
<Dialog
  {open}
  labelledby="harness-title"
  onclose={() => {
    open = false;
  }}
>
  <h2 id="harness-title">Harness</h2>
  <button type="button" data-testid="inside">Inside</button>
</Dialog>
