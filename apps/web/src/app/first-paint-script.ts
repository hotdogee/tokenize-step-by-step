/**
 * The static first paint's clone (PA-15). `plugins/first-paint.ts` compiles this file like boot.ts (a standalone IIFE,
 * `assets/first-paint-<hash>.js`, ≤ 0.5 KB) and puts it in `index.html` as a classic `<script src>` right after `#app`, so
 * it runs while the parser stands at the end of the body: after boot.js has set `<html lang>` and before anything is
 * painted. Above it, `index.html` holds a `<template id="fp-<locale>">` per UI locale — the server-rendered first state of
 * the whole page (PA-19: the comparison table's precomputed default rows, the Advanced disclosure closed; no viewport
 * variants) — and `#app[data-keep]` names that state as `key=value` pairs that must be unset (an empty value: unset or
 * empty) or equal in both the query and localStorage.
 *
 * When the page starts in that state, the locale's template is cloned into `#app`, which main.ts then hydrates.
 * Otherwise `#app` stays empty and main.ts mounts as before. Running here rather than from boot.js keeps the first layout in the parser's task,
 * where the browser (and Lighthouse's simulation) count it as part of the first paint, not as a task after it.
 *
 * No imports: this file is transformed on its own, not bundled. Storage access is guarded (private mode, blocked storage).
 */

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True when every `key=value` of `#app[data-keep]` is unset or equal in both the query and localStorage. */
function keeps(app: HTMLElement): boolean {
  const query = new URLSearchParams(location.search);
  for (const [key, value] of new URLSearchParams(app.dataset['keep']))
    for (const actual of [query.get(key), stored(key)]) if (actual !== null && actual !== value) return false;
  return true;
}

function paint(): void {
  const app = document.getElementById('app');
  const page = document.getElementById(`fp-${document.documentElement.lang}`) as HTMLTemplateElement | null;
  if (app === null || page === null || app.hasChildNodes() || !keeps(app)) return;
  // Cloned inside the template's inert document and adopted on insertion: WebKit reports a `style-src-attr` violation
  // for every `<select>` created in a document with the strict CSP (importNode, innerHTML), not for one adopted into it.
  app.append(page.content.cloneNode(true));
}

paint();

export {};
