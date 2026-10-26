import { describe, expect, it } from 'vitest';
import {
  APP_ELEMENT,
  assertCspSafe,
  attr,
  BOARD_VARIANTS,
  cutBoard,
  injectFirstPaint,
  pageTemplate,
  unstyledScopes,
  type BoardVariant,
} from './first-paint.ts';

const board = (k: number): string =>
  `<section class="board-region svelte-a" id="board"><div data-k="${String(k)}"><section class="x"></section></div></section>`;
const page = (k: number): string =>
  `<!--[--><header>h</header> <main>${board(k)}<!----></main> <footer>f</footer><!--]-->`;
const variant = (media: string, k: number): BoardVariant => ({
  media,
  view: { k, wide: false, medium: false, small: false },
});

describe('cutBoard', () => {
  it('cuts the markup around its board section, nested sections included', () => {
    const cut = cutBoard(page(9));
    expect(cut.board).toBe(board(9));
    expect(cut.prefix).toBe('<!--[--><header>h</header> <main>');
    expect(cut.suffix).toBe('<!----></main> <footer>f</footer><!--]-->');
    expect(cut.prefix + cut.board + cut.suffix).toBe(page(9));
  });

  it('refuses markup without exactly one closed board section', () => {
    expect(() => cutBoard('<main></main>')).toThrow(/exactly one board section/);
    expect(() => cutBoard(page(9) + page(9))).toThrow(/exactly one board section/);
    expect(() => cutBoard('<section class="board-region"><section>')).toThrow(/not closed/);
  });
});

describe('assertCspSafe (AD-15)', () => {
  it('passes markup without inline code and rejects style attributes, <style> and <script>', () => {
    expect(() => {
      assertCspSafe(page(9), 'page');
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
  it('keeps the markup outside the board once and each board in a nested template with its query and view', () => {
    const html = pageTemplate('zh-TW', [
      { variant: variant('(min-width: 1024px)', 12), markup: page(12) },
      { variant: variant('(max-width: 355.98px)', 8), markup: page(8) },
    ]);
    expect(html.startsWith('<template id="fp-zh-TW"><!--[--><header>h</header> <main><template data-mq=')).toBe(true);
    expect(html.match(/<header>/g)).toHaveLength(1);
    expect(html).toContain(
      `<template data-mq="(min-width: 1024px)" data-fp="{&quot;k&quot;:12,&quot;wide&quot;:false,&quot;medium&quot;:false,&quot;small&quot;:false}">${board(12)}</template>`,
    );
    expect(html).toContain(`<template data-mq="(max-width: 355.98px)" data-fp="`);
    expect(html.endsWith('</template><!----></main> <footer>f</footer><!--]--></template>')).toBe(true);
  });

  it('refuses variants that differ outside the board (they would hydrate different pages)', () => {
    expect(() =>
      pageTemplate('en', [
        { variant: variant('a', 12), markup: page(12) },
        { variant: variant('b', 8), markup: page(8).replace('<footer>f', '<footer>g') },
      ]),
    ).toThrow(/differ outside the board \(b\)/);
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

  it('refuses a page without #app or without exactly one entry module', () => {
    expect(() => injectFirstPaint('<body></body>', [], '', '/c.js')).toThrow(/#app|app/);
    expect(() => injectFirstPaint(`<body>${APP_ELEMENT}</body>`, [], '', '/c.js')).toThrow(/one entry module/);
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

/**
 * The board geometry each variant stands for (tokens.css, base.css `.frame`, 05 §3.3): K = clamp(8, ⌊(content) / cell⌋,
 * 64) with content = viewport − 2 × 16 px frame gutter − the 320 px side rail from 1024 px, and the cell at size M —
 * 36 px below 768 px (also the coarse-pointer floor), 32 px to 1023, 30 px from 1024 (32 from 1440).
 */
function measuredK(width: number): number {
  const cell = width < 768 ? 36 : width < 1024 ? 32 : width < 1440 ? 30 : 32;
  const content = width - 32 - (width >= 1024 ? 320 : 0);
  return Math.min(64, Math.max(8, Math.floor(content / cell)));
}

/** The default example's rows at K: four 3-byte characters, a code point never split across rows (pack-rows.ts). */
function rowsAt(k: number): number[] {
  const perRow = Math.floor(k / 3);
  const rows: number[] = [];
  for (let left = 4; left > 0; left -= perRow) rows.push(Math.min(perRow, left));
  return rows;
}

/** The variant a width falls in (the clone script takes the first media query that matches). */
function variantAt(width: number): BoardVariant | undefined {
  return BOARD_VARIANTS.find(({ media }) => {
    const min = /min-width: ([\d.]+)px/.exec(media)?.[1];
    const max = /max-width: ([\d.]+)px/.exec(media)?.[1];
    return (min === undefined || width >= Number(min)) && (max === undefined || width <= Number(max));
  });
}

describe('BOARD_VARIANTS', () => {
  it("pack the default example as the board does at every width of their range, so hydration's measurement moves nothing", () => {
    for (let width = 320; width <= 2560; width++) {
      const found = variantAt(width);
      if (found === undefined) {
        expect([width, rowsAt(measuredK(width))]).toEqual([width, [4]]); // 464–479: no variant, mounts as before
        continue;
      }
      expect([width, rowsAt(found.view.k)]).toEqual([width, rowsAt(measuredK(width))]);
      expect(found.view.k).toBeLessThanOrEqual(measuredK(width)); // the board only widens after hydration
    }
  });

  it('render the viewport facts of their range (≥ 1024 rail, ≥ 768 no sheet, ≥ 480 labels on the board)', () => {
    for (const width of [320, 355, 356, 400, 463, 480, 600, 767, 768, 900, 1023, 1024, 1440, 2560]) {
      const found = variantAt(width);
      expect(found, String(width)).toBeDefined();
      expect([width, found?.view.wide, found?.view.medium, found?.view.small]).toEqual([
        width,
        width >= 1024,
        width >= 768,
        width >= 480,
      ]);
    }
    expect(variantAt(470)).toBeUndefined();
  });
});
