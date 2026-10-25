/**
 * Preferences shared by `/` and `/about/` (05 §1.1 persistence). The "Single-key shortcuts" setting (AD-22, WCAG 2.1.4)
 * lives here because both the `?` dialog and About › Keyboard edit it; AppState reads it from this store.
 */
import { readStored, STORAGE_KEYS, writeStored } from '../app/storage.ts';

export class Preferences {
  singleKeyShortcuts: boolean = $state(true);

  constructor(singleKeyShortcuts: boolean = readStored(STORAGE_KEYS.singleKeyShortcuts) !== 'false') {
    this.singleKeyShortcuts = singleKeyShortcuts;
  }

  setSingleKeyShortcuts(on: boolean): void {
    this.singleKeyShortcuts = on;
    writeStored(STORAGE_KEYS.singleKeyShortcuts, String(on));
  }
}

/** The app-wide preferences store. */
export const preferences = new Preferences();
