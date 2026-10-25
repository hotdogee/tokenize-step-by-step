/**
 * `translate()` — named-placeholder templates with `Intl.PluralRules` plurals and the 05 §10 number rules.
 *
 * Number rules: counts, sizes and durations are grouped with `Intl.NumberFormat(locale)` ("1,025", "12 位元組"); token ids,
 * ranks, hex/dec byte values, byte offsets and step indices are raw ASCII digits ("133072", never "133,072"). A numeric
 * parameter is therefore formatted by its NAME: the names in `RAW_PLACEHOLDERS` print `String(value)`, every other number
 * is grouped. Plural messages select their form with `Intl.PluralRules(locale)` on the `n` parameter.
 */
import { en, type Catalog, type MessageKey } from './en.ts';
import { ja } from './ja.ts';
import type { Locale, Message, Params } from './types.ts';
import { zhTW } from './zh-TW.ts';

/** All three catalogs are bundled (AD-29; the `i18n` chunk). */
export const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, 'zh-TW': zhTW, ja };

/** Placeholder names whose numeric values are printed as raw ASCII digits (ids, ranks, offsets, steps, byte values). */
export const RAW_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'id',
  'rank',
  'offset',
  'start',
  'end',
  'step',
  'stepCount',
  'hex',
  'dec',
  'cp',
  'byte',
  'sha',
]);

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

const numberFormats = new Map<Locale, Intl.NumberFormat>();
const pluralRules = new Map<Locale, Intl.PluralRules>();

/** Grouped number formatting for counts (`Intl.NumberFormat(locale)`, cached). */
export function formatCount(value: number, locale: Locale): string {
  let format = numberFormats.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

function pluralCategory(value: number, locale: Locale): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(value);
}

/** The template of `message` for these params (plural forms resolved on `n`). */
export function templateOf(message: Message, params: Params | undefined, locale: Locale): string {
  if (typeof message === 'string') return message;
  const n = params?.['n'];
  const count = typeof n === 'number' ? n : Number(n ?? Number.NaN);
  if (Number.isNaN(count)) return message.other;
  return message[pluralCategory(count, locale)] ?? message.other;
}

/** Fills `{name}` placeholders; an unknown placeholder is left visible so tests catch it. */
export function fill(template: string, params: Params | undefined, locale: Locale): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    if (typeof value === 'string') return value;
    return RAW_PLACEHOLDERS.has(name) ? String(value) : formatCount(value, locale);
  });
}

/** Translates `key` in `locale`. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const message = CATALOGS[locale][key];
  return fill(templateOf(message, params, locale), params, locale);
}

/** Placeholder names used by a message (all plural forms). */
export function placeholdersOf(message: Message): Set<string> {
  const templates = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const template of templates) for (const match of template.matchAll(PLACEHOLDER)) names.add(match[1] ?? '');
  return names;
}

/** Formats a byte size for the picker and About: "908 B", "443 KB", "1.0 MB" (KB = 1024 B, as in 03 §C.3). */
export function formatSize(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${formatCount(bytes, locale)} B`;
  if (bytes < 1024 * 1024) return `${formatCount(Math.round(bytes / 1024), locale)} KB`;
  const mb = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${mb.format(bytes / (1024 * 1024))} MB`;
}

/** Formats a ratio 0…1 as a percentage in the locale ("64%"). */
export function formatPercent(ratio: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/** Formats milliseconds for diagnostics ("12 ms", grouped). */
export function formatMs(ms: number, locale: Locale): string {
  return `${formatCount(Math.round(ms), locale)} ms`;
}
