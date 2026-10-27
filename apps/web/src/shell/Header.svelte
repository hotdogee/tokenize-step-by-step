<script lang="ts">
  /**
   * Page header (05 §1 region 1, §3.5): skip link, wordmark, the UI-language menu (文/A), the theme menu and the `?` help
   * button, on one line at every width. Icon-only buttons carry `aria-label`s from the catalog. It is sticky (PA-19): it
   * stays at the top while the page scrolls, and the comparison table's header box pins right under it
   * (`top: var(--header-h)`), so the bar keeps exactly `--header-h`. The tokenizer picker moved into Advanced.
   */
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
    onhelp?: () => void;
  }
  let { home, skipTarget, skipLabel, onhelp }: Props = $props();

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
    position: sticky;
    top: 0;
    z-index: 20;
    border-block-end: var(--border-width) solid var(--border);
    background: var(--surface);
  }

  /* One line of exactly --header-h (the table's header box pins at that offset): the wordmark gives way, never the bar. */
  .bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    height: calc(var(--header-h) - var(--border-width));
  }

  .wordmark {
    flex: 0 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--fg);
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
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
