import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declarationsOf } from '../src/contrast.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const fontsCss = read('../src/fonts.css');

/** The declarations of the `@font-face` rule whose family is `family`. */
function fontFace(family: string): Map<string, string> {
  for (const [, body = ''] of fontsCss.matchAll(/@font-face \{([^}]*)\}/g)) {
    const declarations = new Map(
      [...body.matchAll(/([a-z-]+):\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value.trim()]),
    );
    if (declarations.get('font-family') === `'${family}'`) return declarations;
  }
  return new Map();
}

describe('token-id digits font (PA-17)', () => {
  const font = readFileSync(new URL('../src/fonts/tsbs-digits.woff2', import.meta.url));

  it('is a WOFF2 within its 3 KB share of the font budget (06 §3)', () => {
    expect(font.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(font.length).toBeLessThanOrEqual(3072);
  });

  it('declares the digits only, the width range the board narrows within, and no fallback flash', () => {
    const face = fontFace('TSBS Digits');
    expect(face.get('src')).toBe("url('./fonts/tsbs-digits.woff2') format('woff2')");
    expect(face.get('font-weight')).toBe('400');
    expect(face.get('font-stretch')).toBe('62.5% 100%');
    expect(face.get('font-display')).toBe('block');
    expect(face.get('unicode-range')).toBe('U+30-39');
  });

  it('comes first in --font-digits (tokens.css)', () => {
    const tokens = declarationsOf(read('../src/tokens.css'), ':root');
    expect(tokens.get('--font-digits')).toBe("'TSBS Digits', var(--font-mono)");
  });

  it('ships with the Noto Sans OFL its generator pins (no Reserved Font Name)', () => {
    const licence = read('../fonts/NotoSans-OFL.txt');
    expect(licence).toMatch(/^Copyright 2022 The Noto Project Authors/);
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    // The copyright header above the licence text would name one ("with Reserved Font Name …").
    expect(licence.split('-----')[0]).not.toContain('Reserved Font Name');
    const generator = read('../fonts/build_digits.py');
    expect(generator).toContain('FAMILY = "TSBS Digits"');
    expect(generator).toContain('SOURCE_SHA256 = "bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d"');
  });
});
