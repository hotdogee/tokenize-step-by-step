<script lang="ts">
  /**
   * Modal `<dialog>` wrapper (PD-5: `<dialog>`, not the Popover API). `showModal()` makes the rest of the page inert and
   * traps focus natively; Esc closes it (the `cancel` → `close` events), a click on the backdrop closes it, and focus
   * returns to the element that was focused before it opened (05 §8).
   *
   * The owner hears of a close at once — on `cancel` (Esc) and on a backdrop click — not from the `close` event, which
   * engines queue as a task (Chromium at 2560 × 1440: 50–110 ms after Esc). A click or shortcut that reopens the dialog in
   * that gap is kept: the queued `close` finds the dialog open again and is ignored.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    labelledby: string;
    onclose: () => void;
    /** Element to focus when the dialog opens (default: the first focusable element). */
    initialFocus?: () => HTMLElement | null | undefined;
    wide?: boolean;
    children: Snippet;
  }
  let { open, labelledby, onclose, initialFocus, wide = false, children }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let returnTo: HTMLElement | null = null;

  $effect(() => {
    const el = dialog;
    if (el === undefined) return;
    if (open && !el.open) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      initialFocus?.()?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  });

  function handleClose(): void {
    if (dialog?.open === true) return; // a close queued before a reopen
    onclose();
    returnTo?.focus();
    returnTo = null;
  }

  function handleClick(event: MouseEvent): void {
    // A click on the ::backdrop targets the dialog element itself.
    if (event.target !== dialog) return;
    dialog.close();
    onclose();
  }
</script>

<dialog
  bind:this={dialog}
  class="dialog"
  class:wide
  aria-labelledby={labelledby}
  oncancel={() => {
    onclose();
  }}
  onclose={handleClose}
  onclick={handleClick}
>
  <div class="dialog-body">
    {@render children()}
  </div>
</dialog>

<style>
  .dialog {
    width: min(36rem, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100dvh - 2 * var(--gutter));
    padding: 0;
    border: var(--border-width) solid var(--border);
    border-radius: calc(var(--radius) * 2);
    overflow: auto;
  }

  .dialog.wide {
    width: min(56rem, calc(100vw - 2 * var(--gutter)));
  }

  .dialog-body {
    padding: 1rem var(--gutter) 1.25rem;
  }
</style>
