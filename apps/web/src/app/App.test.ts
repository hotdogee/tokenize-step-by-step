import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import App from './App.svelte';
import { APP_TITLE, DEFAULT_EXAMPLE } from './constants.ts';

describe('App (WP00 shell)', () => {
  const { body } = render(App);

  it('renders the app title', () => {
    expect(body).toContain(APP_TITLE);
  });

  it('renders the default example 台灣台南 as plain text in Traditional Chinese', () => {
    expect(DEFAULT_EXAMPLE).toBe('台灣台南');
    expect(body).toMatch(/<p class="example[^"]*" lang="zh-Hant-TW">台灣台南<\/p>/);
  });

  it('emits no inline style attribute (strict CSP, PA-2a)', () => {
    expect(body).not.toMatch(/\sstyle=/);
  });
});
