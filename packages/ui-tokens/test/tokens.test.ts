import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declarationsOf } from '../src/contrast.ts';
import { FONT_TOKENS, THEMED_TOKENS, TOKEN_NAMES } from '../src/index.ts';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');

/** Custom-property names declared (`--name:`) in `text`. */
const declarations = (text: string): string[] =>
  [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');

/** Custom properties declared inside the first rule whose selector text is exactly `selector`. */
function declaredIn(selector: string): Set<string> {
  return new Set(declarationsOf(css, selector).keys());
}

describe('tokens.css (05 §11)', () => {
  it('declares every token on :root (light theme)', () => {
    const light = declaredIn(':root');
    for (const name of TOKEN_NAMES) expect(light, name).toContain(name);
  });

  it('redefines every themed token for dark under the media query and under data-theme="dark"', () => {
    for (const selector of [":root:not([data-theme='light'])", ":root[data-theme='dark']"]) {
      const dark = declaredIn(selector);
      for (const name of THEMED_TOKENS) expect(dark, `${selector} ${name}`).toContain(name);
    }
  });

  it('keeps the two dark blocks identical (auto-dark and forced dark cannot drift)', () => {
    expect([...declarationsOf(css, ":root:not([data-theme='light'])")]).toEqual([
      ...declarationsOf(css, ":root[data-theme='dark']"),
    ]);
  });

  it('declares nothing that TOKEN_NAMES does not list', () => {
    expect(new Set(declarations(css))).toEqual(new Set(TOKEN_NAMES));
  });

  it('gives body-level code an explicit color-scheme and theme overrides', () => {
    expect(css).toMatch(/:root \{\s*color-scheme: light dark;/);
    expect(css).toMatch(/:root\[data-theme='light'\] \{\s*color-scheme: light;/);
    expect(css).toMatch(/:root\[data-theme='dark'\] \{\s*color-scheme: dark;/);
  });
});

describe('font stacks (05 §10)', () => {
  const light = declarationsOf(css, ':root');
  const stack = (name: string): string => light.get(name) ?? '';

  it('defines every stack', () => {
    for (const name of FONT_TOKENS) expect(stack(name), name).not.toBe('');
  });

  it('starts each CJK stack with the platform family of the right script', () => {
    expect(stack('--font-zh')).toMatch(/^'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei'/);
    expect(stack('--font-ja')).toMatch(/^'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP'/);
    expect(stack('--font-ko')).toMatch(/^'Apple SD Gothic Neo', 'Noto Sans KR'/);
    expect(stack('--font-mono')).toMatch(/^ui-monospace,/);
    expect(stack('--font-standin')).toBe("'TSBS Stand-ins', var(--font-mono)");
    expect(stack('--font-digits')).toBe("'TSBS Digits', var(--font-mono)");
  });
});

describe('layout tokens (05 §3.3, AD-18)', () => {
  it('floors every cell size at 36 px on coarse pointers', () => {
    const coarse = /@media \(pointer: coarse\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(coarse).toContain('--cell-s: max(36px, var(--cell-s-base));');
    expect(coarse).toContain('--cell-m: max(36px, var(--cell-m-base));');
    expect(coarse).toContain('--cell-l: max(36px, var(--cell-l-base));');
  });

  it('uses the 05 §3.3 breakpoints and row heights', () => {
    for (const [width, rowHeight] of [
      ['480px', '136px'],
      ['768px', '150px'],
      ['1024px', '172px'],
    ] as const) {
      const block = new RegExp(`@media \\(min-width: ${width}\\) \\{\\s*:root \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(block, width).toContain(`--row-h: ${rowHeight};`);
    }
    expect(declarationsOf(css, ':root').get('--row-h')).toBe('106px');
  });
});
