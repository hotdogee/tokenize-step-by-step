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
      expect(body).toContain('aria-haspopup="menu"');
      expect(body).toContain('role="menu"');
      expect(body).toContain('role="grid"');
      expect(body).toContain('id="compare"');
      expect(body).toContain('id="advanced"');
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

  it('shows the union of the notices the tokenizers on screen require (05 §15, PA-19)', () => {
    i18n.current = 'ja';
    const byDefault = renderApp();
    expect(byDefault).toContain('Powered by xAI'); // the xAI row shows Grok-2
    expect(byDefault).toContain('lang="en"');
    expect(byDefault).not.toContain('Built with Meta Llama 3');
    const grok1 = renderApp((app) => {
      app.rows.select('xai', 'xai-grok1');
    });
    expect(grok1).not.toContain('Powered by xAI');
    const board = renderApp((app) => {
      app.rows.select('xai', 'xai-grok1');
      app.tokenizer = 'xai-grok2';
      app.advancedOpen = true;
    });
    expect(board).toContain('Powered by xAI'); // the board's tokenizer while Advanced is open
    const llama3 = renderApp((app) => {
      app.rows.select('meta', 'meta-llama3');
    });
    expect(llama3).toContain('Built with Meta Llama 3');
    expect(llama3.indexOf('Built with Meta Llama 3')).toBeLessThan(llama3.indexOf('Powered by xAI')); // row order
  });

  it('lists every example in the Examples menu, grouped, as menu item radios (PA-19)', () => {
    i18n.current = 'en';
    const body = renderApp();
    expect(body.match(/role="menuitemradio"/g)).toHaveLength(19);
    expect(body.match(/role="group"/g)).toHaveLength(4);
    expect(body).toMatch(/aria-checked="true"[^>]*data-key="zh-tw-tainan"/);
  });

  it('renders the five default rows with their tokenizer selects, the Anthropic one with the API option', () => {
    i18n.current = 'en';
    const body = renderApp();
    for (const lab of ['openai', 'anthropic', 'google', 'meta', 'xai']) expect(body).toContain(`data-row="${lab}"`);
    expect(body).toContain('aria-label="Anthropic tokenizer"');
    expect(body).toContain('>Claude 5.5 · API key</option>');
    const api = renderApp((app) => {
      app.rows.select('anthropic', 'anthropic-api');
    });
    expect(api).toContain('Current Claude models count tokens through the API.');
    expect(api).toContain('Live check…');
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
