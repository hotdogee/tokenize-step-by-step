<script lang="ts">
  /**
   * The input textarea (05 §1 region 2, §6 IME): auto-grows from 3 to 8 rows (height set through the CSSOM, which the
   * strict CSP allows), `lang` = the resolved text language, spellcheck/autocorrect off. IME: while composing the text is
   * provisional and no encode is sent; on `compositionend` the encode is scheduled from `textarea.value` after a frame, and
   * a later `input` with `isComposing === false` is authoritative — the 40 ms debounce collapses the pair. Paste encodes
   * immediately.
   */
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { resolveTextLang } from '../i18n/text-lang.ts';

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
    app.composing = (event as InputEvent).isComposing;
    app.setText(target.value);
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

  function onPaste(): void {
    queueMicrotask(() => {
      if (element !== undefined) {
        app.composing = false;
        app.text = element.value;
        app.encodeNow();
      }
    });
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
  onpaste={onPaste}></textarea>

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
