/**
 * The modal `Dialog` wrapper in chromium (05 §8): Esc and a backdrop click tell the owner at once, focus returns to the
 * opener, and a reopen that lands before the engine's queued `close` event is kept (Chromium queues `close` 50–110 ms
 * after Esc at 2560 × 1440, long enough for a click or a key to reopen the dialog first).
 */
import '../theme/base.css';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import DialogHarness from './DialogHarness.test-helper.svelte';

const mounted: Array<() => void> = [];
afterEach(() => {
  for (const destroy of mounted.splice(0)) destroy();
});

interface Mounted {
  readonly opener: HTMLButtonElement;
  readonly dialog: HTMLDialogElement;
}

/** Mounts the harness and opens the dialog from its opener (focus starts on the opener, as after a click). */
function openDialog(): Mounted {
  const root = document.createElement('div');
  document.body.append(root);
  const component = mount(DialogHarness, { target: root });
  mounted.push(() => {
    void unmount(component);
    root.remove();
  });
  flushSync();
  const opener = root.querySelector<HTMLButtonElement>('[data-testid="opener"]');
  const dialog = root.querySelector('dialog');
  if (opener === null || dialog === null) throw new Error('harness not mounted');
  opener.focus();
  opener.click();
  flushSync();
  expect(dialog.open).toBe(true);
  return { opener, dialog };
}

/** Resolves once the dialog's next `close` event has been dispatched (the engine queues it as a task). */
function nextClose(dialog: HTMLDialogElement): Promise<void> {
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

describe('Dialog', () => {
  it('closes on Esc and returns focus to the opener', async () => {
    const { opener, dialog } = openDialog();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const closed = nextClose(dialog);
    await userEvent.keyboard('{Escape}');
    await closed;
    flushSync();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps a reopen that lands between Esc and the queued close event', async () => {
    const { opener, dialog } = openDialog();
    // Esc as the engine runs it: `cancel`, whose default action closes the dialog and queues `close` as a task (a
    // synthetic key event would not reach the dialog's close watcher).
    const closed = nextClose(dialog);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.close();
    flushSync();
    // The opener is clicked before the queued `close` arrives.
    opener.click();
    flushSync();
    await closed;
    flushSync();
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keeps a reopen that lands between a backdrop click and the queued close event', async () => {
    const { opener, dialog } = openDialog();
    const closed = nextClose(dialog);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })); // a click on ::backdrop targets the dialog
    flushSync();
    expect(dialog.open).toBe(false);
    opener.click();
    flushSync();
    await closed;
    flushSync();
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
