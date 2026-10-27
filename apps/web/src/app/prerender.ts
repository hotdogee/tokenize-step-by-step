/**
 * Server entry of the static first paint of `/` (PA-15). `plugins/first-paint.ts` builds this module for SSR during
 * `vite build` (the hydration-parity test loads it through Vite too) and renders the page's first state — the
 * precomputed default example at stop 6 (AD-16), from an AppState whose result hub is seeded with the inlined default
 * rows (PA-19) — once per UI locale and board view; boot.js clones the matching markup into `#app` before the first
 * paint and main.ts hydrates it (app/first-paint.ts).
 *
 * Not part of the client bundle: nothing in the app imports it.
 */
import { render } from 'svelte/server';
import { i18n } from '../i18n/locale.svelte.ts';
import type { Locale } from '../i18n/types.ts';
import App from './App.svelte';
import { createAppState } from './bootstrap.ts';
import { setFirstPaintView, type FirstPaintView } from './first-paint.ts';
import { STORAGE_KEYS } from './storage.ts';
import { urlFor } from './url-state.ts';

export { LOCALES } from '../i18n/types.ts';
export type { FirstPaintView } from './first-paint.ts';

/** `/`'s first render in `locale` with its board packed and laid out for `view`: the markup `hydrate()` adopts. */
export function renderFirstPaint(locale: Locale, view: FirstPaintView): string {
  const previous = i18n.current;
  i18n.current = locale;
  setFirstPaintView(view);
  try {
    return render(App, { props: { app: createAppState() } }).body;
  } finally {
    setFirstPaintView(null);
    i18n.current = previous;
  }
}

/**
 * The page state the static first paint shows, as boot.js checks it before cloning (`#app[data-keep]`): `URLSearchParams`
 * text of the query parameters (url-state.ts; `lang` left out — every locale has its template) and the localStorage keys
 * that change the first render, each with the value that keeps it. A key that is unset, or set to this value, in both the
 * query and storage keeps the first render; any other value does not, and the page mounts from scratch. Read from a
 * fresh AppState and written by the app's own URL writer, so it follows the app's defaults. The theme, the locale, the
 * motion override and the single-key setting are not listed: they change no structure of the first render (the locale
 * picks the template; the others check a radio or a checkbox, which hydration sets).
 */
export function firstPaintKeep(): string {
  const app = createAppState();
  const href = urlFor(
    'https://first-paint.invalid/',
    {
      tokenizer: app.tokenizer,
      stage: app.stage,
      step: app.step,
      byteView: app.byteView,
      locale: i18n.current,
      textLang: app.textLang,
    },
    app.text,
  );
  const keep = new URL(href).searchParams;
  keep.delete('lang');
  keep.set(STORAGE_KEYS.byteView, app.byteView);
  keep.set(STORAGE_KEYS.graphemes, String(app.graphemes));
  keep.set(STORAGE_KEYS.cellSize, app.cellSize);
  keep.set(STORAGE_KEYS.boardKeysUsed, 'false');
  return keep.toString();
}
