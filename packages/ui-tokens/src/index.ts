/**
 * @tsbs/ui-tokens — the custom-property names defined by `tokens.css` (docs/design/05-ui-ux.md §3.3, §10, §11). Import the
 * stylesheet as `@tsbs/ui-tokens/tokens.css` (and `@tsbs/ui-tokens/fonts.css` for the stand-in and digits subset fonts); use these
 * names from TypeScript (e.g. `element.style.setProperty`) to stay typo-free.
 */

/** Tokens whose value differs between the light and the dark theme. */
export const THEMED_TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--surface-3',
  '--fg',
  '--fg-muted',
  '--border',
  '--accent',
  '--tok-h0',
  '--tok-h1',
  '--tok-h2',
  '--tok-h3',
  '--tok-h4',
  '--tok-h5',
  '--tok-h6',
  '--tok-h7',
] as const;

/** The eight token tints in hue order (20° + 45°·i); chips cycle through them. */
export const TINT_TOKENS = THEMED_TOKENS.slice(8) as ReadonlyArray<(typeof THEMED_TOKENS)[number]>;

/** Font-stack tokens (05 §10). */
export const FONT_TOKENS = [
  '--font-latin',
  '--font-zh',
  '--font-ja',
  '--font-ko',
  '--font-mono',
  '--font-emoji',
  '--font-standin',
  '--font-digits',
] as const;

/** Layout tokens (05 §3.3); `--cell-*-base` are the breakpoint sizes before the coarse-pointer floor. */
export const LAYOUT_TOKENS = [
  '--gutter',
  '--cell-s-base',
  '--cell-m-base',
  '--cell-l-base',
  '--cell-s',
  '--cell-m',
  '--cell-l',
  '--cell',
  '--gap',
  '--row-h',
  '--radius',
  '--header-h',
  '--rail-w',
  '--board-max',
  '--sheet-height',
  '--target-min',
] as const;

/** Every token (themed ones first). */
export const TOKEN_NAMES = [
  ...THEMED_TOKENS,
  '--border-width',
  '--focus',
  '--hatch',
  '--hatch-tint',
  ...FONT_TOKENS,
  ...LAYOUT_TOKENS,
  '--dur-fast',
  '--dur',
  '--dur-slow',
  '--ease',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** The cell-size setting (05 §1.1 `cellSize`), written to `<html data-cell-size>`. */
export type CellSize = 'S' | 'M' | 'L';
