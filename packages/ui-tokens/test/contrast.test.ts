import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkContrast, contrastRatio, mixOklab, parseOklch, relativeLuminance, type Oklch } from '../src/contrast.ts';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const oklch = (l: number, c: number, h: number): Oklch => ({ l, c, h });

describe('colour maths', () => {
  it('parses plain oklch() values only', () => {
    expect(parseOklch('oklch(0.5 0.12 200)')).toEqual({ l: 0.5, c: 0.12, h: 200 });
    expect(parseOklch('var(--fg)')).toBeNull();
  });

  it('maps OKLCH white, black and sRGB red to their WCAG luminance', () => {
    expect(relativeLuminance(oklch(1, 0, 0))).toBeCloseTo(1, 4);
    expect(relativeLuminance(oklch(0, 0, 0))).toBeCloseTo(0, 6);
    // sRGB #ff0000 = oklch(0.62796 0.25768 29.2339); WCAG luminance 0.2126.
    expect(relativeLuminance(oklch(0.62796, 0.25768, 29.2339))).toBeCloseTo(0.2126, 3);
  });

  it('computes the WCAG ratio symmetrically (black on white = 21:1)', () => {
    expect(contrastRatio(oklch(0, 0, 0), oklch(1, 0, 0))).toBeCloseTo(21, 3);
    expect(contrastRatio(oklch(1, 0, 0), oklch(0, 0, 0))).toBeCloseTo(21, 3);
  });

  it('mixes in OKLab like color-mix(in oklab)', () => {
    const mid = mixOklab(oklch(1, 0, 0), oklch(0, 0, 0), 0.4);
    expect(mid.l).toBeCloseTo(0.4, 6);
  });
});

describe('the 05 §11 contract on tokens.css', () => {
  const { checks, warnings } = checkContrast(css);

  it('asserts exactly the contract pairs in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const mine = checks.filter((check) => check.theme === theme);
      expect(mine.filter((check) => check.rule === 'chip-text')).toHaveLength(8);
      expect(mine.filter((check) => check.rule === 'hatch')).toHaveLength(8);
      expect(mine.filter((check) => check.rule === 'border')).toHaveLength(16 + 4);
      expect(mine.filter((check) => check.rule === 'accent')).toHaveLength(16 + 4);
      expect(mine.some((check) => check.rule === 'accent' && check.bg === '--bg')).toBe(true);
    }
    expect(checks.filter((check) => check.rule === 'chip-text').every((check) => check.min === 4.5)).toBe(true);
    expect(checks.filter((check) => check.rule !== 'chip-text').every((check) => check.min === 3)).toBe(true);
  });

  it('passes every pair', () => {
    const failures = checks.filter((check) => !check.pass);
    expect(failures).toEqual([]);
  });

  it('keeps adjacent tints apart (informational)', () => {
    expect(warnings).toEqual([]);
  });

  it('fails a border that is too light (negative test)', () => {
    const broken = css.replace('--border: oklch(0.5 0 0);', '--border: oklch(0.75 0 0);');
    expect(checkContrast(broken).checks.some((check) => check.rule === 'border' && !check.pass)).toBe(true);
  });
});

describe('check-contrast.mjs (CLI)', () => {
  it('exits 0 and prints OK on the committed tokens', () => {
    const script = fileURLToPath(new URL('../scripts/check-contrast.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    expect(output).toContain('check-contrast: OK');
  });
});

describe('stand-in font (AD-36)', () => {
  const font = readFileSync(new URL('../src/fonts/tsbs-standins.woff2', import.meta.url));
  const fontsCss = readFileSync(new URL('../src/fonts.css', import.meta.url), 'utf8');
  const generator = readFileSync(new URL('../fonts/build_standins.py', import.meta.url), 'utf8');

  it('is a WOFF2 within the 4 KB budget (06 §3)', () => {
    expect(font.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(font.length).toBeLessThanOrEqual(4096);
  });

  it('declares exactly the code points the generator draws', () => {
    const drawn = [...generator.matchAll(/\(0x([0-9A-F]{4}), glyph_/g)].map((m) => Number.parseInt(m[1] ?? '', 16));
    const range = /unicode-range: ([^;]+);/.exec(fontsCss)?.[1] ?? '';
    const declared = range.split(',').flatMap((part) => {
      const [from, to] = part.trim().replace('U+', '').split('-');
      const start = Number.parseInt(from ?? '', 16);
      const end = to === undefined ? start : Number.parseInt(to, 16);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    });
    expect(declared.sort((a, b) => a - b)).toEqual(drawn.sort((a, b) => a - b));
  });
});
