<script lang="ts">
  /**
   * The input panel's controls (05 §1 region 2, §6): text-language chip (a native select), the option toggles the selected
   * tokenizer declares (special tokens · BOS · NFKC), the byte-view control (hex / dec, plus both at ≥ 1024 px) and the
   * grapheme-brackets switch. Byte view and graphemes are global and persisted.
   */
  import type { TextLangChoice } from '@tsbs/core';
  import { appState } from '../app/context.ts';
  import type { ByteView } from '../app/app-state.svelte.ts';
  import { i18n } from '../i18n/locale.svelte.ts';

  const app = appState();

  const TEXT_LANGS: ReadonlyArray<{ value: TextLangChoice; key: `textLang.${TextLangChoice}` }> = [
    { value: 'auto', key: 'textLang.auto' },
    { value: 'zh-Hant', key: 'textLang.zh-Hant' },
    { value: 'ja', key: 'textLang.ja' },
    { value: 'en', key: 'textLang.en' },
  ];
  const BYTE_VIEWS: ReadonlyArray<{ value: ByteView; key: 'byteView.hex' | 'byteView.dec' | 'byteView.both' }> = [
    { value: 'hex', key: 'byteView.hex' },
    { value: 'dec', key: 'byteView.dec' },
    { value: 'both', key: 'byteView.both' },
  ];
  const toggles = $derived(app.entry.toggles);
</script>

<div class="row">
  <label class="field">
    <span class="field-label control-label">{i18n.t('textLang.label')}</span>
    <select
      value={app.textLang}
      onchange={(event) => {
        app.textLang = event.currentTarget.value as TextLangChoice;
      }}
    >
      {#each TEXT_LANGS as option (option.value)}
        <option value={option.value}>{i18n.t(option.key)}</option>
      {/each}
    </select>
  </label>

  {#if toggles.length > 0}
    <fieldset class="group">
      <legend class="visually-hidden">{i18n.t('options.label')}</legend>
      {#if toggles.includes('specialTokens')}
        <label class="check">
          <input
            type="checkbox"
            checked={app.options.specialTokens === 'match'}
            onchange={(event) => {
              app.setOption('specialTokens', event.currentTarget.checked ? 'match' : 'as-text');
            }}
          />
          <span class="control-label">{i18n.t('option.specialTokens')}</span>
        </label>
      {/if}
      {#if toggles.includes('addBos')}
        <label class="check">
          <input
            type="checkbox"
            checked={app.options.addBos}
            onchange={(event) => {
              app.setOption('addBos', event.currentTarget.checked);
            }}
          />
          <span class="control-label">{i18n.t('option.addBos')}</span>
        </label>
      {/if}
      {#if toggles.includes('normalize')}
        <label class="check">
          <input
            type="checkbox"
            checked={app.options.normalize === 'NFKC'}
            onchange={(event) => {
              app.setOption('normalize', event.currentTarget.checked ? 'NFKC' : 'none');
            }}
          />
          <span class="control-label">{i18n.t('option.normalize')}</span>
        </label>
      {/if}
    </fieldset>
  {/if}

  <fieldset class="group segmented">
    <legend class="field-label control-label">{i18n.t('byteView.label')}</legend>
    {#each BYTE_VIEWS as option (option.value)}
      <label class="segment" class:wide-only={option.value === 'both'}>
        <input
          type="radio"
          name="byte-view"
          value={option.value}
          checked={app.byteView === option.value}
          onchange={() => {
            app.setByteView(option.value);
          }}
        />
        <span class="control-label">{i18n.t(option.key)}</span>
      </label>
    {/each}
  </fieldset>

  <label class="check">
    <input
      type="checkbox"
      checked={app.graphemes}
      onchange={(event) => {
        app.setGraphemes(event.currentTarget.checked);
      }}
    />
    <span class="control-label">{i18n.t('graphemes.toggle')}</span>
  </label>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  /* Wraps the select under its label when both do not fit one line (320 px with wide fonts, WCAG 1.4.10). */
  .field {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .field-label {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  select {
    min-height: 2.5rem;
    padding: 0.25rem 0.5rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .group {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .segmented legend {
    float: left;
    margin-inline-end: 0.375rem;
    padding: 0;
  }

  .check,
  .segment {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    cursor: pointer;
  }

  input[type='checkbox'],
  input[type='radio'] {
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--accent);
  }

  /* "Both" (hex and dec rows) only where the board has room for two byte rows (05 §4: ≥ 1024 px). */
  .wide-only {
    display: none;
  }

  @media (min-width: 1024px) {
    .wide-only {
      display: inline-flex;
    }
  }
</style>
