import { describe, expect, it } from 'vitest';
import {
  APP_ELEMENT,
  assertCspSafe,
  attr,
  DIGITS_FONT,
  injectFirstPaint,
  pageTemplate,
  unstyledScopes,
} from './first-paint.ts';

const page =
  '<!--[--><header>h</header> <main><section id="compare"><div class="x"></div></section></main> <footer>f</footer><!--]-->';

describe('assertCspSafe (AD-15)', () => {
  it('passes markup without inline code and rejects style attributes, <style> and <script>', () => {
    expect(() => {
      assertCspSafe(page, 'page');
    }).not.toThrow();
    expect(() => {
      assertCspSafe('<div style="--k: 8;"></div>', 'page');
    }).toThrow(/style=/);
    expect(() => {
      assertCspSafe('<style>a{}</style>', 'page');
    }).toThrow(/<style/);
    expect(() => {
      assertCspSafe('<script>x()</script>', 'page');
    }).toThrow(/<script/);
  });
});

describe('pageTemplate', () => {
  it('wraps the whole page of one locale in its inert template (PA-19: no viewport variants)', () => {
    const html = pageTemplate('zh-TW', page);
    expect(html).toBe(`<template id="fp-zh-TW">${page}</template>`);
    expect(html).not.toContain('data-mq');
    expect(pageTemplate('a"b', '')).toBe('<template id="fp-a&quot;b"></template>');
  });
});

describe('injectFirstPaint', () => {
  const html = `<!doctype html><html><head>
    <script src="/assets/boot-0123abcd.js"></script>
    <script type="module" crossorigin src="/assets/main-AbC.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/i18n-x.js">
    <link rel="stylesheet" crossorigin href="/assets/main-y.css">
  </head><body>
    ${APP_ELEMENT}
  </body></html>`;
  const out = injectFirstPaint(
    html,
    ['<template id="fp-en">E</template>', '<template id="fp-ja">J</template>'],
    'a=1&b=2',
    '/assets/first-paint-0123abcd.js',
    '/assets/tsbs-digits-Ab1.woff2',
  );

  it('writes the templates, then #app with the page state, the clone script and the entry module, in that order', () => {
    const order = [
      '<template id="fp-en">E</template>',
      '<template id="fp-ja">J</template>',
      '<div id="app" data-keep="a=1&amp;b=2"></div>',
      '<script src="/assets/first-paint-0123abcd.js"></script>',
      '<script type="module" async fetchpriority="low" crossorigin src="/assets/main-AbC.js"></script>',
    ].map((part) => out.indexOf(part));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('moves the entry module out of <head>, keeps boot.js first, and lowers the modulepreloads', () => {
    expect(out.match(/<script type="module"/g)).toHaveLength(1);
    expect(out.indexOf('boot-0123abcd.js')).toBeLessThan(out.indexOf('<body>'));
    expect(out).toContain('<link rel="modulepreload" fetchpriority="low" crossorigin href="/assets/i18n-x.js">');
    expect(out).toContain('<link rel="stylesheet" crossorigin href="/assets/main-y.css">');
  });

  it('preloads the digits font once, right after the stylesheet in <head> (PA-17)', () => {
    const preload = '<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/tsbs-digits-Ab1.woff2">';
    expect(out.split(preload)).toHaveLength(2);
    expect(out).toContain(`<link rel="stylesheet" crossorigin href="/assets/main-y.css">\n    ${preload}`);
    expect(out.indexOf(preload)).toBeLessThan(out.indexOf('</head>'));
    expect(DIGITS_FONT.test('assets/tsbs-digits-Ab1.woff2')).toBe(true);
    expect(DIGITS_FONT.test('assets/tsbs-standins-Ab1.woff2')).toBe(false);
  });

  it('refuses a page without #app, without exactly one entry module or without a stylesheet in <head>', () => {
    expect(() => injectFirstPaint('<body></body>', [], '', '/c.js', '/f.woff2')).toThrow(/#app|app/);
    expect(() => injectFirstPaint(`<body>${APP_ELEMENT}</body>`, [], '', '/c.js', '/f.woff2')).toThrow(
      /one entry module/,
    );
    const noCss = html.replace(/\s*<link rel="stylesheet"[^>]*>/, '');
    expect(() => injectFirstPaint(noCss, [], '', '/c.js', '/f.woff2')).toThrow(/stylesheet link in <head>/);
  });
});

describe('unstyledScopes', () => {
  it('names the scoped classes no stylesheet has a rule for', () => {
    expect(unstyledScopes('<a class="x svelte-abc"></a><b class="svelte-def"></b>', '.svelte-abc{color:red}')).toEqual([
      'svelte-def',
    ]);
  });

  it('escapes attribute values', () => {
    expect(attr('a&b"c<d>')).toBe('a&amp;b&quot;c&lt;d&gt;');
  });
});
