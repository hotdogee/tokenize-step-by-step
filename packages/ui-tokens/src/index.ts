/**
 * @tsbs/ui-tokens — the custom-property names defined by `tokens.css` (docs/design/05-ui-ux.md §11). Import the stylesheet
 * as `@tsbs/ui-tokens/tokens.css`; use these names from TypeScript (e.g. `element.style.setProperty`) to stay typo-free.
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

/** Every token of §11 (themed ones first). */
export const TOKEN_NAMES = [
  ...THEMED_TOKENS,
  '--focus',
  '--hatch',
  '--hatch-tint',
  '--cell',
  '--gap',
  '--row-h',
  '--radius',
  '--sheet-height',
  '--dur-fast',
  '--dur',
  '--dur-slow',
  '--ease',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
