/**
 * The picker's live-check row in chromium (05 §6, §8): choosing it closes the picker and opens the drawer once the dialog
 * has handed focus back, exactly once — a reopen that lands before the queued `close` event (Dialog drops that close)
 * must not leave the request pending for the next close for another reason.
 */
import '../theme/base.css';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { AppState } from '../app/app-state.svelte.ts';
import { defaultResult } from '../app/bootstrap.ts';
import { FakeClient, hubOf } from '../app/fake-client.test-helper.ts';
import { i18n } from '../i18n/locale.svelte.ts';
import PickerHarness from './PickerHarness.test-helper.svelte';

const mounted: Array<() => void> = [];
afterEach(() => {
  for (const destroy of mounted.splice(0)) destroy();
});

interface Mounted {
  readonly opener: HTMLButtonElement;
  readonly dialog: HTMLDialogElement;
  readonly liveChecks: () => number;
}

/** Mounts the harness and opens the picker from its opener. */
function openPicker(): Mounted {
  i18n.set('en');
  let calls = 0;
  const root = document.createElement('div');
  document.body.append(root);
  const component = mount(PickerHarness, {
    target: root,
    props: {
      app: new AppState(hubOf(new FakeClient(), { seeds: [defaultResult()] })),
      onlivecheck: () => {
        calls++;
      },
    },
  });
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
  return { opener, dialog, liveChecks: () => calls };
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

/** The live-check row's button. */
function liveCheckButton(dialog: HTMLDialogElement): HTMLButtonElement {
  const button = [...dialog.querySelectorAll<HTMLButtonElement>('.live button')].find((el) =>
    el.textContent.includes('live check'),
  );
  if (button === undefined) throw new Error('no live-check button');
  return button;
}

/** Esc as the engine runs it: `cancel`, whose default action closes the dialog and queues `close` as a task. */
async function escape(dialog: HTMLDialogElement): Promise<void> {
  const closed = nextClose(dialog);
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  dialog.close();
  flushSync();
  await closed;
  flushSync();
}

describe('PickerDialog live-check row', () => {
  it('closes the picker and asks for the drawer once the close has arrived', async () => {
    const { dialog, liveChecks } = openPicker();
    const closed = nextClose(dialog);
    liveCheckButton(dialog).click();
    flushSync();
    expect(dialog.open).toBe(false);
    expect(liveChecks()).toBe(0);
    await closed;
    flushSync();
    expect(liveChecks()).toBe(1);
  });

  it('forgets the request when the picker is reopened before the queued close arrives', async () => {
    const { opener, dialog, liveChecks } = openPicker();
    const dropped = nextClose(dialog);
    liveCheckButton(dialog).click();
    flushSync();
    // Reopened before the queued close: Dialog drops that close, so no drawer — and none at the next close either.
    opener.click();
    flushSync();
    await dropped;
    flushSync();
    expect(dialog.open).toBe(true);
    expect(liveChecks()).toBe(0);
    await escape(dialog);
    expect(dialog.open).toBe(false);
    expect(liveChecks()).toBe(0);
  });
});
