/**
 * Pre-paint bootstrap (AD-15, AD-29; 05 §10–§11). Compiled by the `bootScript()` Vite plugin into a standalone IIFE
 * (`assets/boot-<hash>.js`, ≤ 0.5 KB) that runs as the first classic `<script>` in `<head>`, before first paint:
 *
 * - `<html lang>`: `?lang` → `localStorage` → `navigator.languages` (zh-TW / zh-Hant* / zh → zh-TW; ja* → ja; else en).
 * - `<html data-theme>`: the persisted choice `auto | light | dark` (default `auto`; tokens.css follows the OS for `auto`).
 * - `<html data-cell-size>`: the persisted board cell size `S | M | L` (default `M`), so `--cell` — and with it the board's
 *   reserved height — is right on first paint (05 §1.1, §3.3; CLS ≈ 0).
 *
 * No imports: this file is transformed on its own, not bundled. Storage access is guarded (private mode, blocked storage).
 */

/** localStorage keys shared with src/app/storage.ts (this file cannot import it). */
const LOCALE_KEY = 'tsbs:locale';
const THEME_KEY = 'tsbs:theme';
const CELL_SIZE_KEY = 'tsbs:cellSize';

type Locale = 'zh-TW' | 'ja' | 'en';

/** Maps a BCP 47 tag to a UI locale, or null when the tag names none of the three. */
function toLocale(tag: string | null | undefined): Locale | null {
  const t = (tag ?? '').toLowerCase();
  if (t === 'zh' || t === 'zh-tw' || t.startsWith('zh-hant')) return 'zh-TW';
  if (t === 'ja' || t.startsWith('ja-')) return 'ja';
  if (t === 'en' || t.startsWith('en-')) return 'en';
  return null;
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function resolveLocale(): Locale {
  const fromQuery = toLocale(new URLSearchParams(location.search).get('lang'));
  if (fromQuery) return fromQuery;
  const fromStorage = toLocale(stored(LOCALE_KEY));
  if (fromStorage) return fromStorage;
  for (const tag of navigator.languages) {
    const locale = toLocale(tag);
    if (locale) return locale;
  }
  return 'en';
}

function resolveTheme(): 'auto' | 'light' | 'dark' {
  const theme = stored(THEME_KEY);
  return theme === 'light' || theme === 'dark' ? theme : 'auto';
}

function resolveCellSize(): 'S' | 'M' | 'L' {
  const size = stored(CELL_SIZE_KEY);
  return size === 'S' || size === 'L' ? size : 'M';
}

const root = document.documentElement;
root.lang = resolveLocale();
root.dataset['theme'] = resolveTheme();
root.dataset['cellSize'] = resolveCellSize();

export {};
