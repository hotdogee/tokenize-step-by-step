/**
 * The static first paint's clone script (PA-15, first-paint-script.ts), compiled as the build emits it and run against a
 * test document: which template and board variant it clones into `#app`, and when it leaves `#app` alone (the query
 * cases run in e2e/specs/first-paint.spec.ts, on the built page).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    compileFirstPaintScript: () => Promise<string>;
  }
}

/** The page markup of `locale`, its board in two variants (wide, narrow). */
function pageTemplate(locale: string): string {
  return (
    `<template id="fp-${locale}"><header>${locale}</header><main>` +
    `<template data-mq="(min-width: 9999px)" data-fp='{"k":12}'><section class="board">wide</section></template>` +
    `<template data-mq="(max-width: 9999px)" data-fp='{"k":9}'><section class="board">narrow</section></template>` +
    `</main></template>`
  );
}

let code = '';
const added: Element[] = [];
const lang = document.documentElement.lang;

beforeAll(async () => {
  code = await commands.compileFirstPaintScript();
});

/** Sets up the templates and `#app` (with `keep`, and optional existing content), runs the script, returns `#app`. */
function run(options: { keep?: string; content?: string; lang?: string } = {}): HTMLElement {
  for (const element of added.splice(0)) element.remove(); // one #app at a time
  document.documentElement.lang = options.lang ?? 'en';
  const host = document.createElement('div');
  host.innerHTML = `${pageTemplate('en')}${pageTemplate('ja')}<div id="app"></div>`;
  added.push(host);
  document.body.append(host);
  const app = host.querySelector<HTMLElement>('#app');
  if (app === null) throw new Error('no #app');
  if (options.keep !== undefined) app.dataset['keep'] = options.keep;
  if (options.content !== undefined) app.innerHTML = options.content;
  // An inline classic script runs on insertion, like the build's external one where the parser meets it.
  const script = document.createElement('script');
  script.textContent = code;
  document.body.append(script);
  script.remove();
  return app;
}

afterEach(() => {
  for (const element of added.splice(0)) element.remove();
  document.documentElement.lang = lang;
  localStorage.removeItem('tsbs:byteView');
  vi.unstubAllGlobals();
});

describe('the clone script', () => {
  it('compiles to a self-contained IIFE within its 0.5 KB budget', () => {
    expect(code).toMatch(/^\(\(\)=>\{/);
    expect(code).not.toMatch(/\b(?:import|export)\b/);
    // size-limit (brotli) is the budget; the raw size bounds it from above.
    expect(code.length).toBeLessThan(1024);
  });

  it('clones the template of <html lang> with the first board variant whose media query matches, and names its view', () => {
    const app = run({ lang: 'ja' });
    expect(app.querySelector('header')?.textContent).toBe('ja');
    expect(app.querySelector('.board')?.textContent).toBe('narrow');
    expect(app.querySelectorAll('template')).toHaveLength(0);
    expect(app.querySelectorAll('.board')).toHaveLength(1);
    expect(app.dataset['fp']).toBe('{"k":9}');
  });

  it('takes the first matching variant when several match', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const app = run();
    expect(app.querySelector('.board')?.textContent).toBe('wide');
    expect(app.dataset['fp']).toBe('{"k":12}');
  });

  it('leaves #app empty when no variant matches', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const app = run();
    expect(app.childNodes).toHaveLength(0);
    expect(app.dataset['fp']).toBeUndefined();
  });

  it('leaves #app empty when a stored value differs from the state the templates show, and clones when it equals it', () => {
    localStorage.setItem('tsbs:byteView', 'dec');
    expect(run({ keep: 'tsbs%3AbyteView=hex&b=hex' }).childNodes).toHaveLength(0);
    localStorage.setItem('tsbs:byteView', 'hex');
    expect(run({ keep: 'tsbs%3AbyteView=hex&b=hex' }).dataset['fp']).toBe('{"k":9}');
  });

  it('leaves #app alone when it is not empty or the locale has no template', () => {
    expect(run({ content: '<p>mounted</p>' }).innerHTML).toBe('<p>mounted</p>');
    expect(run({ lang: 'zh-TW' }).childNodes).toHaveLength(0);
  });
});
