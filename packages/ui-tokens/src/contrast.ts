/**
 * The 05 §11 / AD-35 contrast contract, as pure functions over the text of `tokens.css` (no DOM, no Node APIs; the CLI is
 * `check-contrast.mjs`). Colours are converted OKLCH → OKLab → linear sRGB (clamped to the gamut) → WCAG 2 relative
 * luminance, and compared with the WCAG contrast ratio (L1 + 0.05) / (L2 + 0.05).
 *
 * Asserted in both themes (failures):
 * - chip text `--fg` vs each of the 8 tints ≥ 4.5:1;
 * - `--border` vs each of the 16 tints and the 4 surfaces ≥ 3:1;
 * - the `--fg` hatch stripe vs its own tint ≥ 3:1;
 * - `--accent` vs each of the 16 tints and the 4 surfaces ≥ 3:1, which includes `--bg`, the focus ring's halo;
 * - the comparison table's scrollbar thumb `--fg-muted` vs its track `--surface-2` ≥ 3:1 (PA-19: an author-styled
 *   control, WCAG 1.4.11).
 * Informational (warnings): adjacent tints ≥ 45° hue and ≥ 0.07 L apart.
 *
 * "16 tints" = the 8 chip tints plus the 8 byte-cell tints, which 05 §4 defines as the owning token's tint at 40 % over the
 * cell surface (`color-mix(in oklab, tint 40%, var(--surface-2))`).
 */

/** An OKLCH colour: lightness 0…1, chroma, hue in degrees. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Parses `oklch(L C H)` with plain numbers (the only syntax tokens.css uses); null otherwise. */
export function parseOklch(value: string): Oklch | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (match === null) return null;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

type Vec3 = readonly [number, number, number];

function toOklab({ l, c, h }: Oklch): Vec3 {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

function fromOklab([l, a, b]: Vec3): Oklch {
  const c = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

/** OKLab → linear-light sRGB (Björn Ottosson's reference matrices). */
function oklabToLinearSrgb([l, a, b]: Vec3): Vec3 {
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** WCAG 2 relative luminance of an OKLCH colour (linear sRGB clamped to the gamut). */
export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklabToLinearSrgb(toOklab(color));
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** WCAG contrast ratio of two colours (≥ 1). */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color-mix(in oklab, a (weight·100)%, b)`. */
export function mixOklab(a: Oklch, b: Oklch, weight: number): Oklch {
  const pa = toOklab(a);
  const pb = toOklab(b);
  return fromOklab([
    pa[0] * weight + pb[0] * (1 - weight),
    pa[1] * weight + pb[1] * (1 - weight),
    pa[2] * weight + pb[2] * (1 - weight),
  ]);
}

/** Custom-property declarations of the first rule whose selector is exactly `selector` (nested in @media or not). */
export function declarationsOf(css: string, selector: string): ReadonlyMap<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`tokens.css has no rule for ${selector}`);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  const out = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] !== undefined && match[2] !== undefined) out.set(match[1], match[2].replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** The selectors whose first rule holds each theme's colour values. */
export const THEME_SELECTORS = { light: ':root', dark: ":root[data-theme='dark']" } as const;
export type Theme = keyof typeof THEME_SELECTORS;

export const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'] as const;
export const TINTS = [
  '--tok-h0',
  '--tok-h1',
  '--tok-h2',
  '--tok-h3',
  '--tok-h4',
  '--tok-h5',
  '--tok-h6',
  '--tok-h7',
] as const;
/** Byte cells carry the token tint at 40 % over this surface (05 §4). */
export const BYTE_TINT_WEIGHT = 0.4;
export const BYTE_CELL_SURFACE = '--surface-2';

/** One asserted pair. */
export interface ContrastCheck {
  readonly theme: Theme;
  readonly rule: 'chip-text' | 'border' | 'hatch' | 'accent' | 'scrollbar';
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
}

export interface ContrastReport {
  readonly checks: readonly ContrastCheck[];
  readonly warnings: readonly string[];
}

/** The theme's colours by token name, parsed; throws if a needed token is missing or not a plain oklch(). */
export function themeColors(css: string, theme: Theme): ReadonlyMap<string, Oklch> {
  const light = declarationsOf(css, THEME_SELECTORS.light);
  const own = theme === 'light' ? light : declarationsOf(css, THEME_SELECTORS[theme]);
  const out = new Map<string, Oklch>();
  for (const name of [...SURFACES, ...TINTS, '--fg', '--fg-muted', '--border', '--accent']) {
    const raw = own.get(name) ?? light.get(name);
    const color = raw === undefined ? null : parseOklch(raw);
    if (color === null) throw new Error(`${theme}: ${name} is not a plain oklch() value (${String(raw)})`);
    out.set(name, color);
  }
  return out;
}

const get = (colors: ReadonlyMap<string, Oklch>, name: string): Oklch => {
  const color = colors.get(name);
  if (color === undefined) throw new Error(`missing ${name}`);
  return color;
};

/** Runs the contract on the text of tokens.css. */
export function checkContrast(css: string): ContrastReport {
  const checks: ContrastCheck[] = [];
  const warnings: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const colors = themeColors(css, theme);
    const color = (name: string): Oklch => get(colors, name);
    const byteTint = (tint: string): Oklch => mixOklab(color(tint), color(BYTE_CELL_SURFACE), BYTE_TINT_WEIGHT);
    const backgrounds: Array<[string, Oklch]> = [
      ...TINTS.map((tint): [string, Oklch] => [tint, color(tint)]),
      ...TINTS.map((tint): [string, Oklch] => [`${tint}@40%/${BYTE_CELL_SURFACE}`, byteTint(tint)]),
      ...SURFACES.map((surface): [string, Oklch] => [surface, color(surface)]),
    ];
    const add = (rule: ContrastCheck['rule'], fg: string, bg: string, bgColor: Oklch, min: number): void => {
      const ratio = contrastRatio(color(fg), bgColor);
      checks.push({ theme, rule, fg, bg, ratio, min, pass: ratio >= min });
    };
    for (const tint of TINTS) add('chip-text', '--fg', tint, color(tint), 4.5);
    for (const [name, bg] of backgrounds) add('border', '--border', name, bg, 3);
    for (const tint of TINTS) add('hatch', '--fg', tint, color(tint), 3);
    for (const [name, bg] of backgrounds) add('accent', '--accent', name, bg, 3);
    add('scrollbar', '--fg-muted', '--surface-2', color('--surface-2'), 3);
    TINTS.forEach((tint, i) => {
      const next = TINTS[(i + 1) % TINTS.length] ?? tint;
      const a = color(tint);
      const b = color(next);
      const hue = Math.abs(((b.h - a.h + 540) % 360) - 180);
      const dl = Math.abs(a.l - b.l);
      if (hue < 45 || dl < 0.07)
        warnings.push(
          `${theme}: ${tint} / ${next} differ by ${hue.toFixed(0)}° hue and ${dl.toFixed(2)} L (informational)`,
        );
    });
  }
  return { checks, warnings };
}
