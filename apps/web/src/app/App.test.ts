/**
 * Server-rendered smoke tests of the shell in all three locales (the E2E suites in e2e/specs/shell-*.spec.ts cover the
 * real browser: axe, CSP, boot, overflow, notices).
 */
import { render } from 'svelte/server';
import { afterAll, describe, expect, it } from 'vitest';
import { i18n } from '../i18n/locale.svelte.ts';
import { LOCALES } from '../i18n/types.ts';
import App from './App.svelte';
import type { AppState } from './app-state.svelte.ts';
import { createAppState } from './bootstrap.ts';
import NotFound from './NotFound.svelte';

const renderApp = (configure?: (app: AppState) => void): string => {
  const app = createAppState();
  configure?.(app);
  return render(App, { props: { app } }).body;
};

afterAll(() => {
  i18n.current = 'en';
});

describe('App shell (server-rendered)', () => {
  for (const locale of LOCALES) {
    it(`renders every region in ${locale} with no leftover placeholders`, () => {
      i18n.current = locale;
      const body = renderApp();
      expect(body).toContain('<h1 class="wordmark');
      expect(body).toContain('What is a token?');
      expect(body).toMatch(/<textarea[^>]*id="text-input"/);
      expect(body).toContain('role="listbox"');
      expect(body).toContain('role="grid"');
      expect(body).toContain('role="status"');
      expect(body).toMatch(/<footer/);
      expect(body).toContain(i18n.t('input.label'));
      expect(body).toContain(i18n.t('counts.bytes', { n: 12 }));
      expect(body).toContain(i18n.t('counts.tokens', { n: 4 }));
      expect(body).not.toMatch(/\{[A-Za-z]+\}/);
    });
  }

  it('renders the default example 台灣台南 in the textarea with lang zh-Hant-TW', () => {
    i18n.current = 'en';
    const body = renderApp();
    expect(body).toMatch(/<textarea[^>]*lang="zh-Hant-TW"[^>]*>台灣台南<\/textarea>/s);
  });

  it('labels icon-only header buttons (05 §3.5)', () => {
    i18n.current = 'en';
    const body = renderApp();
    expect(body).toContain('aria-label="Interface language"');
    expect(body).toContain('aria-label="Colour theme"');
    expect(body).toContain('aria-label="Keyboard shortcuts and help"');
  });

  it('shows the selected tokenizer’s required notices only (05 §15)', () => {
    i18n.current = 'ja';
    const grok2 = renderApp((app) => {
      app.tokenizer = 'xai-grok2';
    });
    expect(grok2).toContain('Powered by xAI');
    expect(grok2).toContain('lang="en"');
    const o200k = renderApp();
    expect(o200k).not.toContain('Powered by xAI');
    const llama3 = renderApp((app) => {
      app.tokenizer = 'meta-llama3';
    });
    expect(llama3).toContain('Built with Meta Llama 3');
  });

  it('marks chips that split a character on the selected tokenizer', () => {
    i18n.current = 'en';
    const cl100k = renderApp((app) => {
      app.tokenizer = 'openai-cl100k_base';
    });
    expect(cl100k).toMatch(/data-key="zh-tw-tainan"[\s\S]*?splits a character on this tokenizer/);
  });
});

describe('404 page', () => {
  it('renders in every locale', () => {
    for (const locale of LOCALES) {
      i18n.current = locale;
      expect(render(NotFound).body).toContain(i18n.t('notFound.heading'));
    }
  });
});
