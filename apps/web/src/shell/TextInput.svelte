<script lang="ts">
  /**
   * The input textarea (05 §1 region 2, §6 IME): auto-grows from 3 to 8 rows (height set through the CSSOM, which the
   * strict CSP allows), `lang` = the resolved text language, spellcheck/autocapitalize/autocorrect off.
   *
   * IME (05 §6): composing = `isComposing || key === 'Process' || keyCode === 229` (old Android keyboards send no
   * composition events). While composing the text is provisional: `input` events update the text — stops 1–3 and the
   * counts, shown muted — but no encode is sent. Browsers disagree on the order (Chromium sends the last `input` with
   * `isComposing: true` before `compositionend`; Firefox and WebKit send `compositionend`, then an `input` with
   * `isComposing: false`), so `compositionend` schedules the encode from `textarea.value` read in the next animation frame,
   * and a later `input` with `isComposing === false` is the authoritative trigger; the 40 ms debounce collapses the pair
   * into one request. A paste (`inputType` `insertFromPaste`) tokenizes at once. The caret position feeds the window a
   * long input's board shows (AD-27). WP13 wiring.
   */
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';
  import { isComposing } from './shortcuts.ts';

  interface Props {
    /** Exposes the element so `/` can focus it. */
    element?: HTMLTextAreaElement | undefined;
  }
  let { element = $bindable() }: Props = $props();
  const app = appState();

  const lang = $derived(resolveTextLang(app.textLang, app.text, i18n.current));

  /** Safari's `autocorrect` is not in Svelte's attribute types; it is a plain attribute, so pass it through a spread. */
  const SAFARI_ATTRIBUTES: Record<string, string> = { autocorrect: 'off' };

  const MIN_ROWS = 3;
  const MAX_ROWS = 8;

  /** Fits the textarea to its content (3–8 rows); `_text` is the dependency the effect below tracks. */
  function autosize(_text: string): void {
    const el = element;
    if (el === undefined) return;
    const style = getComputedStyle(el);
    const line = Number.parseFloat(style.lineHeight) || 24;
    const chrome =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom) +
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth);
    el.style.height = 'auto';
    const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.ceil((el.scrollHeight - chrome) / line)));
    el.style.height = `${String(rows * line + chrome)}px`;
  }

  $effect(() => {
    autosize(app.text);
  });

  function onInput(event: Event): void {
    const target = event.currentTarget as HTMLTextAreaElement;
    const input = event as InputEvent;
    app.composing = input.isComposing;
    app.setText(target.value, input.inputType === 'insertFromPaste');
    app.setCaret(target.selectionStart);
  }

  function onCompositionStart(): void {
    app.composing = true;
  }

  function onCompositionEnd(event: CompositionEvent): void {
    const target = event.currentTarget as HTMLTextAreaElement;
    requestAnimationFrame(() => {
      app.composing = false;
      app.setText(target.value);
    });
  }

  /** A key that belongs to an IME composition marks the text provisional until the next non-composing `input`. */
  function onKeydown(event: KeyboardEvent): void {
    if (isComposing(event)) app.composing = true;
  }

  function onCaret(event: Event): void {
    app.setCaret((event.currentTarget as HTMLTextAreaElement).selectionStart);
  }
</script>

<label class="label" for="text-input">{i18n.t('input.label')}</label>
<textarea
  id="text-input"
  bind:this={element}
  class="input"
  rows={MIN_ROWS}
  {lang}
  value={app.text}
  placeholder={i18n.t('input.placeholder')}
  spellcheck="false"
  autocapitalize="off"
  autocomplete="off"
  {...SAFARI_ATTRIBUTES}
  data-composing={app.composing}
  oninput={onInput}
  oncompositionstart={onCompositionStart}
  oncompositionend={onCompositionEnd}
  onkeydown={onKeydown}
  onkeyup={onCaret}
  onclick={onCaret}
  onselect={onCaret}></textarea>

<style>
  .label {
    display: block;
    margin-bottom: 0.25rem;
    font-weight: 600;
  }

  .input {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 1.25rem;
    line-height: 1.5;
    resize: vertical;
    overflow-wrap: anywhere;
  }

  .input[data-composing='true'] {
    background: var(--surface);
  }
</style>
