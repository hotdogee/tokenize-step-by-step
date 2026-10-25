<script lang="ts">
  /**
   * Page header (05 §1 region 1, §3.5): skip link, wordmark, the tokenizer picker chip (on `/`), the UI-language menu
   * (文/A), the theme menu and the `?` help button. Icon-only buttons carry `aria-label`s from the catalog.
   */
  import type { Snippet } from 'svelte';
  import { i18n, toLocale } from '../i18n/locale.svelte.ts';
  import { LOCALES } from '../i18n/types.ts';
  import { theme, THEME_CHOICES, toThemeChoice } from '../theme/theme.svelte.ts';
  import ChoiceMenu from './ChoiceMenu.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** `/` renders the wordmark as the page's h1; other pages link it home. */
    home: boolean;
    skipTarget: string;
    skipLabel: string;
    picker?: Snippet;
    onhelp?: () => void;
  }
  let { home, skipTarget, skipLabel, picker, onhelp }: Props = $props();

  const LOCALE_LABEL = { en: 'locale.en', 'zh-TW': 'locale.zh-TW', ja: 'locale.ja' } as const;
  const THEME_LABEL = { auto: 'theme.auto', light: 'theme.light', dark: 'theme.dark' } as const;

  const localeChoices = $derived(
    LOCALES.map((locale) => ({ value: locale, label: i18n.t(LOCALE_LABEL[locale]), lang: locale })),
  );
  const themeChoices = $derived(THEME_CHOICES.map((choice) => ({ value: choice, label: i18n.t(THEME_LABEL[choice]) })));
</script>

<header class="header">
  <a class="skip-link" href={skipTarget}>{skipLabel}</a>
  <div class="bar frame">
    {#if home}
      <h1 class="wordmark" lang="en">{i18n.t('app.name')}</h1>
    {:else}
      <a class="wordmark" href="/" lang="en">{i18n.t('app.name')}</a>
    {/if}
    {#if picker}
      <div class="picker-slot">{@render picker()}</div>
    {/if}
    <div class="actions">
      <ChoiceMenu
        id="locale-menu"
        label={i18n.t('a11y.localeMenu')}
        icon="locale"
        choices={localeChoices}
        value={i18n.current}
        onchange={(value: string) => {
          i18n.set(toLocale(value) ?? 'en');
        }}
      />
      <ChoiceMenu
        id="theme-menu"
        label={i18n.t('a11y.themeToggle')}
        icon="theme"
        choices={themeChoices}
        value={theme.choice}
        onchange={(value: string) => {
          theme.set(toThemeChoice(value));
        }}
      />
      {#if onhelp}
        <button
          type="button"
          class="btn btn-icon btn-quiet"
          aria-label={i18n.t('a11y.help')}
          aria-haspopup="dialog"
          onclick={onhelp}
        >
          <Icon name="help" size={20} />
        </button>
      {/if}
    </div>
  </div>
</header>

<style>
  .header {
    position: relative;
    border-block-end: var(--border-width) solid var(--border);
    background: var(--surface);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    padding-block: 0.25rem;
    min-height: var(--header-h);
  }

  .wordmark {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--fg);
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    text-decoration: none;
  }

  a.wordmark:hover {
    text-decoration: underline;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    margin-inline-start: auto;
  }

  /* Below 768 px the picker chip takes its own full-width line under the bar (05 §3.4 sketch). */
  .picker-slot {
    order: 3;
    flex: 1 0 100%;
    min-width: 0;
    padding-block-end: 0.25rem;
  }

  @media (min-width: 768px) {
    .picker-slot {
      order: 0;
      flex: 0 1 auto;
      padding-block-end: 0;
    }

    .wordmark {
      flex: 0 1 auto;
    }
  }

  .skip-link {
    position: absolute;
    z-index: 30;
    top: 0.25rem;
    inset-inline-start: var(--gutter);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--accent);
    transform: translateY(-200%);
  }

  .skip-link:focus {
    transform: none;
  }
</style>
