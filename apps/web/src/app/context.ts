/** Svelte context for the AppState instance (set once by App.svelte; components read it with `appState()`). */
import { getContext, setContext } from 'svelte';
import type { AppState } from './app-state.svelte.ts';

const KEY = Symbol('tsbs:app-state');

export function provideAppState(state: AppState): void {
  setContext(KEY, state);
}

export function appState(): AppState {
  const state = getContext<AppState | undefined>(KEY);
  if (state === undefined) throw new Error('appState() called outside App');
  return state;
}
