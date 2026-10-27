/**
 * Preferences shared by `/` and `/about/` (05 §1.1 persistence). The "Single-key shortcuts" setting (AD-22, WCAG 2.1.4)
 * lives here because both the `?` dialog and About › Keyboard edit it; AppState reads it from this store. The two chip
 * toggles (PA-19: "Show token text", "Mark partial-character tokens"; both off by default) are read by the comparison
 * table and the board alike: chips carry their id only unless they are on.
 */
import { readStored, STORAGE_KEYS, writeStored } from '../app/storage.ts';

export class Preferences {
  singleKeyShortcuts: boolean = $state(true);
  /** Token text inside the chips (`tsbs:chipText`). */
  chipText: boolean = $state(false);
  /** The partial-character mark inside partial chips (`tsbs:chipHatch`); the hatched cut edges are always drawn. */
  chipHatch: boolean = $state(false);

  constructor(
    singleKeyShortcuts: boolean = readStored(STORAGE_KEYS.singleKeyShortcuts) !== 'false',
    chipText: boolean = readStored(STORAGE_KEYS.chipText) === 'true',
    chipHatch: boolean = readStored(STORAGE_KEYS.chipHatch) === 'true',
  ) {
    this.singleKeyShortcuts = singleKeyShortcuts;
    this.chipText = chipText;
    this.chipHatch = chipHatch;
  }

  setSingleKeyShortcuts(on: boolean): void {
    this.singleKeyShortcuts = on;
    writeStored(STORAGE_KEYS.singleKeyShortcuts, String(on));
  }

  setChipText(on: boolean): void {
    this.chipText = on;
    writeStored(STORAGE_KEYS.chipText, String(on));
  }

  setChipHatch(on: boolean): void {
    this.chipHatch = on;
    writeStored(STORAGE_KEYS.chipHatch, String(on));
  }
}

/** The app-wide preferences store. */
export const preferences = new Preferences();
