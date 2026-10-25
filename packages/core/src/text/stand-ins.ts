/**
 * Visible stand-ins for whitespace and control characters (05 §4) and the combining-mark test the char tier uses to draw a
 * mark on a dotted-circle base. `CharInfo.standIn` carries the stand-in **key**; the rendered glyph comes from
 * `standInGlyph` and the screen-reader text from the `a11y.standin.<key>` catalog entry (05 §10).
 */

/** Which stand-in a code point gets. */
export type StandInKey = 'space' | 'tab' | 'lf' | 'cr' | 'nbsp' | 'whitespace' | 'control' | 'bom' | 'zwj' | 'zwnj';

/**
 * Unicode `White_Space` (stable since Unicode 6.3; equal to `classes.White_Space` of tools/oracle/unicode_tables.json, which
 * a unit test asserts). Kept literal here because the char tier needs it without the pre-tokenizer tables.
 */
const WHITE_SPACE: ReadonlyArray<readonly [number, number]> = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

/** Unicode `White_Space`. */
export function isWhiteSpace(cp: number): boolean {
  return WHITE_SPACE.some(([first, last]) => cp >= first && cp <= last);
}

/** General category Cc (C0, DEL, C1). */
export function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * The stand-in key for `cp`, or null when the glyph itself is shown. Specific keys win over `control`, which wins over the
 * generic whitespace keys (so U+0085 NEL, which is both Cc and White_Space, shows as `⟨U+0085⟩`, as 05 §4 lists it).
 */
export function standInFor(cp: number): StandInKey | null {
  switch (cp) {
    case 0x20:
      return 'space';
    case 0x09:
      return 'tab';
    case 0x0a:
      return 'lf';
    case 0x0d:
      return 'cr';
    case 0xfeff:
      return 'bom';
    case 0x200d:
      return 'zwj';
    case 0x200c:
      return 'zwnj';
    case 0xa0:
      return 'nbsp';
    default:
      if (isControl(cp)) return 'control';
      return isWhiteSpace(cp) ? 'whitespace' : null;
  }
}

/** The rendered stand-in (05 §4 table); `control` spells the code point: `⟨U+0085⟩`. */
export function standInGlyph(key: StandInKey, cp: number): string {
  switch (key) {
    case 'space':
      return '␠';
    case 'tab':
      return '⇥';
    case 'lf':
      return '⏎';
    case 'cr':
      return '␍';
    case 'nbsp':
    case 'whitespace':
      return '⍽';
    case 'control':
      return `⟨U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟩`;
    case 'bom':
      return 'BOM';
    case 'zwj':
      return 'ZWJ';
    case 'zwnj':
      return 'ZWNJ';
  }
}

const MARK = /^\p{M}$/u;

/**
 * True for combining marks and variation selectors (general category M: U+3099, U+FE0F, U+E0100, …), which the char tier
 * draws on an `aria-hidden` U+25CC base (05 §4). This is a rendering decision, so it deliberately asks the runtime's own
 * Unicode data (the font engine attaches marks by the same data); the pre-tokenizer never uses native classes (AD-4).
 */
export function isCombiningMark(cp: number): boolean {
  return MARK.test(String.fromCodePoint(cp));
}
