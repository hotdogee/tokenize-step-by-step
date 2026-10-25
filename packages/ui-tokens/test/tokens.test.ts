import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMED_TOKENS, TOKEN_NAMES } from '../src/index.ts';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');

/** Custom-property names declared (`--name:`) in `text`. */
const declarations = (text: string): string[] =>
  [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? '');

/** Custom properties declared inside the first rule whose selector text is exactly `selector`. */
function declaredIn(selector: string): Set<string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  return new Set(declarations(css.slice(start, css.indexOf('}', start))));
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

  it('declares nothing that TOKEN_NAMES does not list', () => {
    expect(new Set(declarations(css))).toEqual(new Set(TOKEN_NAMES));
  });
});
