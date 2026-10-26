<script lang="ts">
  /**
   * Test-only host for `dialog.browser.test.ts`: an opener button and the modal `Dialog` it opens, owned the way
   * App.svelte owns the picker and help dialogs (an `open` flag the opener sets and `onclose` clears). "Hand off" closes
   * the dialog and focuses "Elsewhere" once it has closed, the way the picker's live-check row opens the drawer.
   */
  import Dialog from './Dialog.svelte';

  let open = $state(false);
  let handoff = false;
  let elsewhere: HTMLButtonElement | undefined = $state();
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
  onclosed={() => {
    if (handoff) elsewhere?.focus();
    handoff = false;
  }}
>
  <h2 id="harness-title">Harness</h2>
  <button type="button" data-testid="inside">Inside</button>
  <button
    type="button"
    data-testid="handoff"
    onclick={() => {
      handoff = true;
      open = false;
    }}>Hand off</button
  >
</Dialog>
<button type="button" data-testid="elsewhere" bind:this={elsewhere}>Elsewhere</button>
