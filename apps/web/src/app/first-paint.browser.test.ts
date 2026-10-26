/**
 * Hydration parity of the static first paint (PA-15): for every UI locale and board variant, the markup the build
 * prerenders (src/app/prerender.ts, server-rendered by the test server through the `renderFirstPaint` command) is the
 * client's own first render of the same state, and `hydrate()` adopts it without re-creating a node or warning. The
 * client renders with the variant's view (app/first-paint.ts), as main.ts does, so every variant is checked here at the
 * test viewport. E2E (e2e/specs/first-paint.spec.ts) repeats the adoption on the built page in each browser.
 */
import '../theme/base.css';
import { hydrate, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { i18n } from '../i18n/locale.svelte.ts';
import { LOCALES } from '../i18n/types.ts';
import App from './App.svelte';
import { AppState } from './app-state.svelte.ts';
import { defaultResult } from './bootstrap.ts';
import { FakeClient } from './fake-client.test-helper.ts';
import { setFirstPaintView, type FirstPaintView } from './first-paint.ts';

interface BoardVariant {
  readonly media: string;
  readonly view: FirstPaintView;
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    renderFirstPaint: (locale: string, view: FirstPaintView) => Promise<string>;
    firstPaintVariants: () => Promise<readonly BoardVariant[]>;
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

/** The page state the prerender renders: the precomputed default example, no URL state (FakeClient: no Worker). */
function firstState(): AppState {
  return new AppState(new FakeClient(), defaultResult(), null, {});
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
  setFirstPaintView(null);
  i18n.current = 'en';
});

describe('the static first paint (PA-15)', async () => {
  const variants = await commands.firstPaintVariants();

  it('has a variant per width range, packed for the smallest K of its range', () => {
    expect(variants.map((variant) => variant.view.k)).toEqual([12, 12, 12, 9, 8]);
  });

  for (const locale of LOCALES)
    for (const { media, view } of variants) {
      it(`${locale} ${media}: the server's markup is the client's first render, and hydration adopts it`, async () => {
        const markup = await commands.renderFirstPaint(locale, view);
        const parsed = document.createElement('template');
        parsed.innerHTML = markup;
        i18n.current = locale;

        // The client's own first render of the same state (template effects only: user effects have not run yet).
        const fresh = container();
        setFirstPaintView(view);
        const first = mount(App, { target: fresh, props: { app: firstState() } });
        setFirstPaintView(null);
        expect(shape(parsed.content)).toEqual(shape(fresh));
        void unmount(first);

        // Hydration of the markup as the clone script inserts it: every node adopted, no mismatch warning.
        const target = container();
        target.append(parsed.content.cloneNode(true));
        const before = [...target.querySelectorAll('*')];
        const warn = vi.spyOn(console, 'warn');
        setFirstPaintView(view);
        components.push(hydrate(App, { target, props: { app: firstState() } }));
        setFirstPaintView(null);
        const warnings = warn.mock.calls.map((call) => call.map(String).join(' '));
        warn.mockRestore();
        expect(warnings.filter((warning) => /hydrat/i.test(warning))).toEqual([]);
        expect(before.filter((node) => !target.contains(node)).map((node) => node.outerHTML.slice(0, 100))).toEqual([]);
        expect(target.querySelectorAll('*')).toHaveLength(before.length);
        expect(shape(target)).toEqual(shape(parsed.content));
      });
    }
});
