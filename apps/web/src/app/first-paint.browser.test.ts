/**
 * Hydration parity of the static first paint (PA-15): for every UI locale, the markup the build prerenders
 * (src/app/prerender.ts, server-rendered by the test server through the `renderFirstPaint` command) is the client's own
 * first render of the same state — the comparison table with its five precomputed default rows, Advanced closed (PA-19:
 * one template per locale, no viewport variants) — and `hydrate()` adopts it without re-creating a node or warning. E2E
 * (e2e/specs/first-paint.spec.ts) repeats the adoption on the built page in each browser.
 */
import '../theme/base.css';
import { flushSync, hydrate, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { i18n } from '../i18n/locale.svelte.ts';
import { LOCALES } from '../i18n/types.ts';
import App from './App.svelte';
import { AppState } from './app-state.svelte.ts';
import { defaultResults } from './bootstrap.ts';
import { FakeClient, hubOf } from './fake-client.test-helper.ts';
import { readStaticInput } from './static-input.ts';
import { STORAGE_KEYS } from './storage.ts';

declare module 'vitest/browser' {
  interface BrowserCommands {
    renderFirstPaint: (locale: string) => Promise<string>;
  }
}

/** Attributes the client sets as properties (the server writes them as attributes); compared as properties instead. */
const PROPERTY_ATTRIBUTES = new Set(['checked', 'selected', 'value']);

/**
 * The tree under `root` as comparable lines: each element with its sorted attributes (form state as properties), each
 * run of text merged; comments (hydration markers, block anchors) and empty text skipped.
 */
function shape(root: Node): string[] {
  const lines: string[] = [];
  const walk = (node: Node, depth: number): void => {
    let text = '';
    const flush = (): void => {
      if (text !== '') lines.push(`${'  '.repeat(depth)}"${text}"`);
      text = '';
    };
    for (const child of node.childNodes) {
      if (child.nodeType === Node.COMMENT_NODE) continue;
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
        continue;
      }
      if (!(child instanceof Element)) continue;
      flush();
      const attributes = [...child.attributes]
        .filter((attribute) => !PROPERTY_ATTRIBUTES.has(attribute.name))
        .map((attribute) => `${attribute.name}="${attribute.value}"`)
        .sort();
      if (child instanceof HTMLInputElement) attributes.push(`.checked=${String(child.checked)}`);
      if (child instanceof HTMLSelectElement || child instanceof HTMLTextAreaElement)
        attributes.push(`.value=${child.value}`);
      lines.push(`${'  '.repeat(depth)}<${child.localName} ${attributes.join(' ')}>`);
      if (!(child instanceof HTMLTextAreaElement)) walk(child, depth + 1);
    }
    flush();
  };
  walk(root, 0);
  return lines;
}

/** The page state the prerender renders: the precomputed default rows, no URL state (FakeClient: no Worker). */
function firstState(): AppState {
  return new AppState(hubOf(new FakeClient(), { seeds: Object.values(defaultResults()) }), {});
}

/** A container for one render, removed after the test. */
const containers: HTMLElement[] = [];
const components: Array<ReturnType<typeof mount>> = [];
function container(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  containers.push(element);
  return element;
}

afterEach(() => {
  for (const component of components.splice(0)) void unmount(component);
  for (const element of containers.splice(0)) element.remove();
  i18n.current = 'en';
});

// The static paint is the first render of a visitor without stored preferences (prerender.ts `keep`), and the browser
// project shares one origin across test files: another file's keyboard use or option change (tsbs:boardKeysUsed,
// tsbs:byteView, …) would otherwise leak into the client render compared here. CI runs the files in a different order.
beforeEach(() => {
  try {
    for (const key of Object.values(STORAGE_KEYS)) localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
});

describe('the static first paint (PA-15)', () => {
  for (const locale of LOCALES) {
    it(`${locale}: the server's markup is the client's first render, and hydration adopts it`, async () => {
      const markup = await commands.renderFirstPaint(locale);
      expect(markup).toContain('data-testid="compare"');
      expect(markup).not.toContain('board-region');
      const parsed = document.createElement('template');
      parsed.innerHTML = markup;
      i18n.current = locale;

      // The client's own first render of the same state (template effects only: user effects have not run yet).
      const fresh = container();
      const first = mount(App, { target: fresh, props: { app: firstState() } });
      expect(shape(parsed.content)).toEqual(shape(fresh));
      void unmount(first);

      // Hydration of the markup as the clone script inserts it: every node adopted, no mismatch warning.
      const target = container();
      target.append(parsed.content.cloneNode(true));
      const before = [...target.querySelectorAll('*')];
      const warn = vi.spyOn(console, 'warn');
      components.push(hydrate(App, { target, props: { app: firstState() } }));
      const warnings = warn.mock.calls.map((call) => call.map(String).join(' '));
      warn.mockRestore();
      expect(warnings.filter((warning) => /hydrat/i.test(warning))).toEqual([]);
      expect(before.filter((node) => !target.contains(node)).map((node) => node.outerHTML.slice(0, 100))).toEqual([]);
      expect(target.querySelectorAll('*')).toHaveLength(before.length);
      expect(shape(target)).toEqual(shape(parsed.content));
    });
  }

  it('what the visitor did before hydration survives it: no mismatch warning, no node recreated (main.ts)', async () => {
    const parsed = document.createElement('template');
    parsed.innerHTML = await commands.renderFirstPaint('en');
    const target = container();
    target.append(parsed.content.cloneNode(true));
    const textarea = target.querySelector('textarea');
    const details = target.querySelector<HTMLDetailsElement>('details#advanced');
    const select = target.querySelector<HTMLSelectElement>('[data-testid="row-select-openai"]');
    if (textarea === null || details === null || select === null) throw new Error('the static paint lost a control');
    textarea.value = `ab${textarea.value}`;
    textarea.setSelectionRange(2, 2);
    details.open = true;
    select.value = 'openai-cl100k_base';
    const before = [...target.querySelectorAll('*')];

    const app = firstState();
    const warn = vi.spyOn(console, 'warn');
    const replay = readStaticInput(target);
    components.push(hydrate(App, { target, props: { app } }));
    flushSync();
    // Hydration adopted everything; the replay below then changes the page as an edit would (the rows re-render).
    expect(before.filter((node) => !target.contains(node)).map((node) => node.outerHTML.slice(0, 100))).toEqual([]);
    replay(app);
    flushSync();
    const warnings = warn.mock.calls.map((call) => call.map(String).join(' '));
    warn.mockRestore();

    expect(warnings.filter((warning) => /hydrat/i.test(warning))).toEqual([]);
    expect(app.text).toBe('ab台灣台南');
    expect(textarea.value).toBe('ab台灣台南');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 2]);
    expect(app.advancedOpen).toBe(true);
    expect(details.open).toBe(true);
    expect(app.rows.choice('openai')).toBe('openai-cl100k_base');
    expect(select.value).toBe('openai-cl100k_base');
  });

  it('an untouched static page replays nothing', async () => {
    const parsed = document.createElement('template');
    parsed.innerHTML = await commands.renderFirstPaint('en');
    const target = container();
    target.append(parsed.content.cloneNode(true));
    const app = firstState();
    const replay = readStaticInput(target);
    components.push(hydrate(App, { target, props: { app } }));
    flushSync();
    replay(app);
    flushSync();
    expect(app.advancedOpen).toBe(false);
    expect(app.rows.nonDefault()).toEqual([]);
    expect(target.querySelector('#advanced .body')).toBeNull(); // the body stays out of the first paint's DOM
  });
});
