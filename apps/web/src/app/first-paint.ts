/**
 * The static first paint of `/` (PA-15). The build server-renders the page's first state into `index.html` — one inert
 * `<template data-locale>` per UI locale, its board in a few viewport variants (`plugins/first-paint.ts`) — and boot.js
 * clones the matching template into `#app` before the first paint, copying the chosen variant's view to `#app[data-fp]`.
 * main.ts then hydrates that markup instead of mounting, so the client's first render must be the server's: the board
 * starts from this view (the K it was packed for and the viewport facts it was rendered with) and switches to the
 * measured ones once it is mounted (Board.svelte, board/viewport.svelte.ts). Without a static first paint (another page
 * state, `vite dev`) the view is null and the board measures from the start, as before.
 */

/** What a board variant of the static first paint was rendered for. */
export interface FirstPaintView {
  /** Board columns the variant's rows were packed for (05 §3.3: 8–64). */
  readonly k: number;
  /** BoardViewport facts: ≥ 1024 px (side rail), ≥ 768 px (no bottom sheet), ≥ 480 px (U+ labels, id line). */
  readonly wide: boolean;
  readonly medium: boolean;
  readonly small: boolean;
}

let current: FirstPaintView | null = null;

/** The view the page's first render reproduces; null when the page mounts from scratch. */
export function firstPaintView(): FirstPaintView | null {
  return current;
}

/** Set by the prerender around each render and by main.ts around `hydrate()`; null otherwise. */
export function setFirstPaintView(view: FirstPaintView | null): void {
  current = view;
}

/** `#app[data-fp]` (JSON written and checked by the build, copied by the clone script) → the view; null when absent. */
export function parseFirstPaintView(value: string | undefined): FirstPaintView | null {
  try {
    const view = JSON.parse(value ?? 'null') as FirstPaintView | null;
    return typeof view?.k === 'number' ? view : null;
  } catch {
    return null;
  }
}
