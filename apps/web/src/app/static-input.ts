/**
 * What a visitor did to the static first paint before the app took over (PA-15, PA-19). The first paint is live HTML long
 * before main.js has run — seconds on a slow phone: the text box takes text, the Advanced summary opens its `<details>`
 * and a row's `<select>` switches, natively, and `hydrate()` then writes the app's first state over all three.
 *
 * main.ts reads them just before `hydrate()` and replays them once it has flushed its effects, in the same task.
 * Hydration itself runs on the first state, the one the markup shows, so it adopts every node without a mismatch; no
 * frame is painted between the two, so nothing snaps back on screen; and the replay goes through the app's own paths, so
 * what follows is what a click on the hydrated page does: the lazy board loads, the row's tokenizer loads and encodes,
 * the URL writer sees a change (`t` and `s` only while Advanced is open). Replaying any earlier would give hydration a
 * first state with a body the markup does not have, and the URL writer a first state it never writes.
 *
 * The rest of the static page holds no input to lose: a sideways scroll stays on its element (CompareTable brings the
 * other scrollers to it on mount), focus stays on its node, links work, and a button (Examples, language, theme, help,
 * Live check) or a single-key shortcut does nothing until the app has attached its handler, so a press before that is
 * simply not taken.
 */
import type { AppState } from './app-state.svelte.ts';

/** The parts of AppState the replay uses. */
type Replayed = Pick<AppState, 'text' | 'setText' | 'setCaret' | 'openAdvanced'>;

/** Reads what the visitor did under `root` (before `hydrate()`); the function it returns replays it (after). */
export function readStaticInput(root: ParentNode): (app: Replayed) => void {
  const textarea = root.querySelector('textarea');
  const text = textarea?.value;
  const start = textarea?.selectionStart ?? 0;
  const end = textarea?.selectionEnd ?? start;
  const advanced = root.querySelector<HTMLDetailsElement>('details#advanced')?.open === true;
  // The markup's `selected` is the first state: an option the visitor chose instead is theirs. (Svelte resets a select
  // from a MutationObserver, a microtask later than any point here, so its live value says nothing after `hydrate()`.)
  const selects = [...root.querySelectorAll('select')]
    .filter((select) => select.selectedOptions[0]?.defaultSelected === false)
    .map((select) => ({ select, value: select.value }));
  return (app) => {
    if (textarea !== null && text !== undefined && text !== app.text) {
      // The same value again keeps the caret, and the state's write that follows finds nothing to change.
      textarea.value = text;
      textarea.setSelectionRange(start, end);
      app.setText(text);
      app.setCaret(start);
    }
    if (advanced) app.openAdvanced();
    for (const { select, value } of selects) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true })); // as the browser's: Svelte delegates it to the root
    }
  };
}
