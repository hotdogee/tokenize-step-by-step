/**
 * Server entry of the static first paint of `/` (PA-15). `plugins/first-paint.ts` builds this module for SSR during
 * `vite build` (the hydration-parity test loads it through Vite too) and renders the page's first state — the comparison
 * table with the five precomputed default rows of 台灣台南 (AD-16; an AppState whose result hub is seeded with the inlined
 * wires, PA-19) and the Advanced disclosure closed — once per UI locale; the clone script puts the matching markup into
 * `#app` before the first paint and main.ts hydrates it.
 *
 * Not part of the client bundle: nothing in the app imports it.
 */
import { render } from 'svelte/server';
import { i18n } from '../i18n/locale.svelte.ts';
import type { Locale } from '../i18n/types.ts';
import App from './App.svelte';
import { createAppState } from './bootstrap.ts';
import { STORAGE_KEYS } from './storage.ts';
import { urlFor } from './url-state.ts';

export { LOCALES } from '../i18n/types.ts';

/** `/`'s first render in `locale`: the markup `hydrate()` adopts. */
export function renderFirstPaint(locale: Locale): string {
  const previous = i18n.current;
  i18n.current = locale;
  try {
    return render(App, { props: { app: createAppState() } }).body;
  } finally {
    i18n.current = previous;
  }
}

/**
 * The page state the static first paint shows, as the clone script checks it before cloning (`#app[data-keep]`):
 * `URLSearchParams` text of the query parameters (url-state.ts; `lang` left out — every locale has its template) and the
 * localStorage keys that change the first render, each with the value that keeps it. A key that is unset, or set to this
 * value, in both the query and storage keeps the first render; any other value does not, and the page mounts from
 * scratch. An empty value means "must be unset": `t` and `s` (they open the Advanced disclosure, PA-19), `r` and
 * `tsbs:rows` (the table's row choices). Read from a fresh AppState and written by the app's own URL writer, so it
 * follows the app's defaults. The theme, the locale, the motion override, the grapheme brackets, the board's keyboard
 * hint and the single-key setting are not listed: they change no structure of the first render (the locale picks the
 * template; the others check a radio or a checkbox, which hydration sets, or belong to the board, which is not in it).
 */
export function firstPaintKeep(): string {
  const app = createAppState();
  const href = urlFor('https://first-paint.invalid/', app.urlSnapshot(), app.text);
  const keep = new URLSearchParams();
  for (const key of ['t', 'q', 'r', 's', 'b', 'tl'] as const) keep.set(key, new URL(href).searchParams.get(key) ?? '');
  keep.set(STORAGE_KEYS.byteView, app.byteView);
  keep.set(STORAGE_KEYS.cellSize, app.cellSize);
  keep.set(STORAGE_KEYS.rows, '');
  keep.set(STORAGE_KEYS.chipText, 'false');
  keep.set(STORAGE_KEYS.chipHatch, 'false');
  return keep.toString();
}
