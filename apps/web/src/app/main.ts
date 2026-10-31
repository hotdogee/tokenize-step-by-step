/**
 * Entry of `/` (index.html). boot.js has already set `<html lang>` and `data-theme`; when the page starts in the state
 * the build prerendered, the clone script after `#app` (first-paint-script.ts) has put that static first paint — the
 * whole page with the comparison table's precomputed default rows, Advanced closed (PA-15, PA-19) — into `#app`. The app
 * then hydrates it — adopting every node, with the same initial state — once the browser reports the first paint, in two
 * tasks (the state, then the DOM), so the first paint never waits for the app and no task holds the main thread for long;
 * otherwise it mounts at once. On `/` this module is an `async` script after the clone script (plugins/first-paint.ts).
 * Either way App builds on an AppState from bootstrap.ts with the precomputed default rows on screen and loads o200k
 * after first paint (06 §3). What the visitor did to the static page meanwhile survives hydration (static-input.ts).
 * `#app[data-boot]` says which happened (`hydrated` | `mounted`; e2e and diagnostics read it).
 */
import '../theme/base.css';
// The in-app reduced-motion choice (`tsbs:motion`) applies from boot (`<html data-motion>`, theme/base.css), not only
// once Advanced has loaded the board.
import '../motion/motion-prefs.svelte.ts';
import { flushSync, hydrate, mount } from 'svelte';
import App from './App.svelte';
import { createAppState } from './bootstrap.ts';
import { afterPaintEntry } from './load-trigger.ts';
import { readStaticInput } from './static-input.ts';

/** Hydrates the static first paint in `target`: the state in this task, the DOM in the next. */
function adopt(target: HTMLElement): void {
  const app = createAppState();
  setTimeout(() => {
    // Hydration writes the first state over what the visitor did to the static page: read now, replayed after it.
    const replay = readStaticInput(target);
    hydrate(App, { target, props: { app } });
    target.dataset['boot'] = 'hydrated';
    flushSync(); // hydrate() leaves its effects to a microtask: the selects' first write, the URL writer's first run
    replay(app);
  });
}

const target = document.getElementById('app');
if (target === null) throw new Error('index.html is missing #app');
if (!target.hasChildNodes()) {
  mount(App, { target, props: { app: createAppState() } });
  target.dataset['boot'] = 'mounted';
} else {
  void afterPaintEntry().then(() => {
    setTimeout(() => {
      adopt(target);
    });
  });
}
