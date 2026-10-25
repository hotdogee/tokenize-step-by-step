/**
 * Theme store (05 §11): `auto | light | dark`, persisted, written to `<html data-theme>`. boot.js applies the stored
 * choice before first paint; tokens.css follows `prefers-color-scheme` when the choice is `auto`.
 */
import { readStored, STORAGE_KEYS, writeStored } from '../app/storage.ts';

export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

/** Parses a stored or attribute value (anything else → `auto`, like boot.ts). */
export function toThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

function initialTheme(): ThemeChoice {
  if (typeof document !== 'undefined' && document.documentElement.dataset['theme'] !== undefined)
    return toThemeChoice(document.documentElement.dataset['theme']);
  return toThemeChoice(readStored(STORAGE_KEYS.theme));
}

export class ThemeStore {
  choice: ThemeChoice = $state('auto');

  constructor(initial: ThemeChoice = initialTheme()) {
    this.choice = initial;
  }

  set(choice: ThemeChoice): void {
    this.choice = choice;
    writeStored(STORAGE_KEYS.theme, choice);
    if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = choice;
  }
}

/** The app-wide theme store. */
export const theme = new ThemeStore();
