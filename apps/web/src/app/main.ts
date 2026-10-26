/**
 * Entry of `/` (index.html). boot.js has already set `<html lang>` and `data-theme`; when the page starts in the state
 * the build prerendered, the clone script after `#app` (first-paint-script.ts) has put that static first paint into
 * `#app`, with its board view in `#app[data-fp]` (PA-15). The app then hydrates it — adopting every node, with the same
 * initial state — once the browser reports the first paint, in two tasks (the state, then the DOM), so the first paint
 * never waits for the app and no task holds the main thread for long; otherwise it mounts at once. On `/` this module
 * is an `async` script after the clone script (plugins/first-paint.ts). Either way App builds on an AppState from
 * bootstrap.ts with the precomputed default example on screen and loads o200k after first paint (06 §3).
 * `#app[data-boot]` says which happened (`hydrated` | `mounted`; e2e and diagnostics read it).
 */
import '../theme/base.css';
import { hydrate, mount } from 'svelte';
import App from './App.svelte';
import { createAppState } from './bootstrap.ts';
import { parseFirstPaintView, setFirstPaintView, type FirstPaintView } from './first-paint.ts';
import { afterPaintEntry } from './load-trigger.ts';

/** Hydrates the static first paint in `target` (rendered for `view`): the state in this task, the DOM in the next. */
function adopt(target: HTMLElement, view: FirstPaintView): void {
  const app = createAppState();
  setTimeout(() => {
    // Text typed into the static textarea before now is the visitor's: hydration writes the state's text over it.
    const typed = target.querySelector('textarea')?.value;
    setFirstPaintView(view);
    hydrate(App, { target, props: { app } });
    setFirstPaintView(null);
    target.dataset['boot'] = 'hydrated';
    if (typed !== undefined && typed !== app.text) app.setText(typed);
  });
}

const target = document.getElementById('app');
if (target === null) throw new Error('index.html is missing #app');
const view = parseFirstPaintView(target.dataset['fp']);
if (view === null) {
  mount(App, { target, props: { app: createAppState() } });
  target.dataset['boot'] = 'mounted';
} else {
  void afterPaintEntry().then(() => {
    setTimeout(() => {
      adopt(target, view);
    });
  });
}
