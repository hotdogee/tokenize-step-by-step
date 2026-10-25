/**
 * Catalog types (05 §10). A message is a template with named placeholders (`{name}`), or a set of plural forms selected by
 * `Intl.PluralRules` on the `n` parameter. Every locale may reorder placeholders; positional ones (`{0}`) are not allowed.
 */
import type { Locale } from '@tsbs/registry';

export type { Locale };

/** CLDR plural forms; `other` is always required (zh-TW and ja use it alone). */
export type PluralForms = { readonly other: string } & Readonly<
  Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many', string>>
>;

export type Message = string | PluralForms;

/** Values for a template's placeholders. Numbers are formatted per the 05 §10 number rules (see `t.ts`). */
export type Params = Readonly<Record<string, string | number>>;

/** The UI locales in menu order (05 §10). */
export const LOCALES: readonly Locale[] = ['zh-TW', 'ja', 'en'];
