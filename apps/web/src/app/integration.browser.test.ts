/**
 * WP13 components in chromium (06 §1 "Component"): the counts line (live code points / graphemes / bytes, the
 * precomputed → live badge, the "stale" badge of an on-demand tier), the long-input banners (on-demand, running, cap) and
 * the error toast (`role="alert"`, 05 §12 copy and action), driven through a real AppState over a hand-settled client.
 */
import '../theme/base.css';
import axe from 'axe-core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { i18n } from '../i18n/locale.svelte.ts';
import AppHarness from './AppHarness.test-helper.svelte';
import { AppState, type UiError } from './app-state.svelte.ts';
import { defaultResult } from './bootstrap.ts';
import { FakeClient, flush } from './fake-client.test-helper.ts';

const mounted: Array<() => void> = [];
afterEach(() => {
  for (const destroy of mounted.splice(0)) destroy();
});

/** Mounts the harness over an AppState whose o200k engine is resident (its first live encode answered). */
function setup(): { app: AppState; client: FakeClient; root: HTMLElement } {
  i18n.set('en');
  const client = new FakeClient();
  const app = new AppState(client, defaultResult());
  const root = document.createElement('div');
  document.body.append(root);
  const component = mount(AppHarness, { target: root, props: { app } });
  mounted.push(() => {
    void unmount(component);
    root.remove();
  });
  flushSync();
  return { app, client, root };
}

async function loaded(app: AppState, client: FakeClient): Promise<void> {
  const start = app.start();
  // The load trigger waits for a paint and two frames (06 §3) before it asks for the tokenizer.
  for (let i = 0; i < 400 && client.loads.length === 0; i++) await flush();
  client.loads.at(-1)?.finish();
  await start;
  await flush();
  client.encodes.at(-1)?.answer();
  await flush();
  flushSync();
}

const text = (root: HTMLElement, selector: string): string => root.querySelector(selector)?.textContent.trim() ?? '';

describe('counts line', () => {
  it('counts the text live and flips the badge from precomputed to live', async () => {
    const { app, client, root } = setup();
    const counts = [...root.querySelectorAll('[data-testid="counts"] li')].map((li) => li.textContent);
    expect(counts).toEqual([
      '4 code points',
      '4 grapheme clusters',
      '12 bytes',
      '4 tokens',
      '0 partial-character tokens',
    ]);
    expect(root.querySelector('[data-source]')?.getAttribute('data-source')).toBe('precomputed');
    await loaded(app, client);
    expect(root.querySelector('[data-source]')?.getAttribute('data-source')).toBe('live');
    const tokens = root.querySelector('[data-testid="counts"] li:nth-child(4)');
    app.setText('台灣台南!');
    flushSync();
    // Code points are live at once; the last result's tokens stay (muted after 300 ms, no badge) for the debounced
    // encode, so a keystroke swaps neither the tokens nor the live badge (PA-11).
    expect(text(root, '[data-testid="counts"]')).toContain('5 code points');
    expect(root.querySelector('[data-testid="counts"] li:nth-child(4)')).toBe(tokens);
    expect(tokens?.textContent).toBe('4 tokens');
    expect(tokens?.classList.contains('superseded')).toBe(true);
    expect(tokens && getComputedStyle(tokens).transitionDelay).toBe('0.3s');
    expect(root.querySelector('[data-testid="tokens-pending"]')).toBeNull();
    expect(root.querySelector('[data-testid="stale-badge"]')).toBeNull();
    expect(root.querySelector('[data-source]')?.getAttribute('data-source')).toBe('live');
    for (let i = 0; i < 200 && client.encodes.at(-1)?.text !== '台灣台南!'; i++) await flush();
    client.encodes.at(-1)?.answer();
    await flush();
    flushSync();
    expect(tokens?.textContent).toBe('5 tokens');
    expect(tokens?.classList.contains('superseded')).toBe(false);
  });

  it('keeps the last on-demand run’s tokens with a "stale" badge once the text changes (AD-27)', async () => {
    const { app, client, root } = setup();
    await loaded(app, client);
    const long = 'a'.repeat(20_001);
    app.setText(long);
    flushSync();
    expect(text(root, '[data-testid="counts"]')).toContain('20,001 code points');
    expect(text(root, '[data-testid="counts"]')).toContain('tokens: press “Tokenize now”');
    expect(root.querySelector('[data-testid="stale-badge"]')).toBeNull();
    const button = root.querySelector<HTMLButtonElement>('[data-testid="long-input-run"]');
    button?.focus();
    const run = app.runOnDemand();
    flushSync();
    // Busy, yet still focusable (05 §8): aria-disabled with a guard, never `disabled`.
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button?.textContent).toBe('tokenizing');
    expect(text(root, '[data-testid="counts"]')).toContain('tokens: waiting for the tokenizer');
    const sent = client.encodes.length;
    button?.click();
    expect(client.encodes).toHaveLength(sent); // no second run while one is in flight
    client.encodes.at(-1)?.answer();
    await run;
    flushSync();
    expect(button?.getAttribute('aria-disabled')).toBe('false');
    expect(document.activeElement).toBe(button);
    expect(text(root, '[data-testid="counts"]')).toContain('20,001 tokens');
    expect(root.querySelector('[data-testid="stale-badge"]')).toBeNull();
    app.setText(`${long}b`);
    flushSync();
    expect(text(root, '[data-testid="counts"]')).toContain('20,002 code points');
    expect(text(root, '[data-testid="counts"]')).toContain('20,001 tokens');
    expect(root.querySelector('[data-testid="stale-badge"]')?.textContent).toBe('stale');
    expect(await axe.run(root).then((r) => r.violations.map((v) => v.id))).toEqual([]);
  });
});

describe('long-input banners', () => {
  it('shows the on-demand banner above 20,000 code points and the cap line above 200,000, said in the status region', async () => {
    const { app, client, root } = setup();
    await loaded(app, client);
    app.setText('a'.repeat(20_000));
    flushSync();
    expect(root.querySelector('[data-testid="long-input-banner"]')).toBeNull();
    app.setText('a'.repeat(20_001));
    flushSync();
    const banner = root.querySelector('[data-testid="long-input-banner"]');
    expect(banner?.textContent).toContain('Long input — tokenize on demand');
    // The lazy-mounted banner is no live region of its own: the always-mounted status region says the tier once.
    expect(banner?.querySelector('[role="status"]')).toBeNull();
    expect(text(root, '[data-testid="status"]')).toBe('Long input — tokenize on demand');
    expect(root.querySelector('[data-testid="cap-banner"]')).toBeNull();
    app.setText('a'.repeat(200_001));
    flushSync();
    expect(text(root, '[data-testid="cap-banner"]')).toBe('Only the first 200,000 code points are analysed');
    expect(text(root, '[data-testid="status"]')).toBe('Only the first 200,000 code points are analysed');
    expect(text(root, '[data-testid="counts"]')).toContain('200,000 code points');
    expect(app.text).toHaveLength(200_001);
  });
});

describe('error toast', () => {
  it('is a role=alert with the 05 §12 message and its action', () => {
    const { app, root } = setup();
    app.error = {
      code: 'oom',
      message: 'RangeError',
      retryable: false,
      tokenizer: 'google-gemma4',
      previous: 'openai-o200k_base',
    };
    flushSync();
    const toast = root.querySelector('[data-testid="error-toast"]');
    expect(toast?.querySelector('[role="alert"]')?.textContent).toBe(
      'Not enough memory to load Gemma 4 (Gemini 2.0 → 3.5) on this device — try o200k_base (GPT-4o → GPT-5.x)',
    );
    expect(toast?.querySelector('[data-testid="error-action"]')?.textContent).toBe('Go back');
    if (toast === null) throw new Error('no toast');
    expect(getComputedStyle(toast).position).toBe('fixed');
    app.error = { code: 'quota', message: '', retryable: false, tokenizer: 'openai-o200k_base', previous: null };
    flushSync();
    expect(root.querySelector('[data-testid="error-action"]')).toBeNull();
    expect(root.querySelector('[data-testid="error-toast"]')?.getAttribute('data-informational')).toBe('true');
  });

  it('moves keyboard focus to a control that stays before its action or dismiss removes it (05 §8)', async () => {
    const { app, root } = setup();
    const textarea = document.createElement('textarea');
    textarea.id = 'text-input';
    const picker = document.createElement('button');
    picker.id = 'picker-button';
    root.prepend(textarea, picker);
    /** Shows `error`'s toast, reaches `target` with Tab (keyboard focus) and presses Enter on it. */
    const activate = async (error: UiError, target: string): Promise<void> => {
      app.error = error;
      flushSync();
      textarea.focus();
      for (let i = 0; i < 6 && document.activeElement?.getAttribute('data-testid') !== target; i++)
        await userEvent.tab();
      expect(document.activeElement?.getAttribute('data-testid')).toBe(target);
      await userEvent.keyboard('{Enter}');
      flushSync();
      expect(root.querySelector('[data-testid="error-toast"]')).toBeNull();
    };
    const fetchError: UiError = {
      code: 'fetch',
      message: '',
      retryable: true,
      tokenizer: 'openai-o200k_base',
      previous: null,
    };
    await activate(fetchError, 'error-action'); // Retry
    expect(document.activeElement).toBe(textarea);
    await activate(fetchError, 'error-dismiss');
    expect(document.activeElement).toBe(textarea);
    await activate(
      { code: 'oom', message: '', retryable: false, tokenizer: 'google-gemma4', previous: 'openai-o200k_base' },
      'error-action', // Go back
    );
    expect(document.activeElement).toBe(picker);
  });
});
