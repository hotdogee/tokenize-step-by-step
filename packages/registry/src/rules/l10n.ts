/**
 * Rules on every localized string in the registry (05 §10). The schemas already demand a non-empty string per locale;
 * these add: the same `{placeholders}` in all three locales (named placeholders, so locales may reorder them), the
 * placeholders each marker/BYOK template needs, the glossary ban on 標記 for "token" in zh-TW, and fullwidth punctuation
 * after CJK text in zh-TW and ja.
 */
import type { L10n } from '../schema.ts';
import { placeholders } from './licences.ts';
import type { Report } from './report.ts';

/** Placeholders specific `strings.json` templates must carry (05 §10 marker SR text; AD-24 frame note). */
export const REQUIRED_PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  'strings.marker.byteFallback': ['hex'],
  'strings.marker.combining': ['base', 'cp'],
  'strings.byok.frameNote': ['frame'],
};

const L10N_KEYS = ['en', 'ja', 'zh-TW'];

/** A CJK ideograph or kana immediately followed by ASCII punctuation (should be fullwidth: 「」，。 / 「」、。). */
const CJK_THEN_ASCII_PUNCT = /[぀-ヿ㐀-䶿一-鿿豈-﫿][,.;:!?]/u;

function isL10n(value: unknown): value is L10n {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.join() === L10N_KEYS.join() && Object.values(value).every((v) => typeof v === 'string');
}

/** Index label of an array item in a path: its `id`, `key` or `model` when it is a keyed record, else its position. */
function itemLabel(item: unknown, index: number): string {
  if (typeof item !== 'object' || item === null) return String(index);
  const record = new Map<string, unknown>(Object.entries(item));
  const label = record.get('id') ?? record.get('key') ?? record.get('model');
  return typeof label === 'string' ? label : String(index);
}

/** Every L10n object inside `value`, with its path. Arrays of keyed records use the record's id/key/model as the index. */
export function collectL10n(value: unknown, path: string, into: Array<[string, L10n]> = []): Array<[string, L10n]> {
  if (isL10n(value)) {
    into.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item: unknown, i) => {
      collectL10n(item, `${path}[${itemLabel(item, i)}]`, into);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) collectL10n(item, `${path}.${key}`, into);
  }
  return into;
}

/** All localization rules over the given named roots (e.g. `{ tokenizers, models, licences, examples, strings }`). */
export function checkL10n(roots: Readonly<Record<string, unknown>>, report: Report): void {
  for (const [name, root] of Object.entries(roots)) {
    for (const [path, l10n] of collectL10n(root, name)) {
      const en = placeholders(l10n.en).join(',');
      for (const locale of ['zh-TW', 'ja'] as const) {
        const other = placeholders(l10n[locale]).join(',');
        if (other !== en) report('l10n-placeholders', path, `${locale} placeholders {${other}} differ from en {${en}}`);
        if (CJK_THEN_ASCII_PUNCT.test(l10n[locale])) {
          report('l10n-punctuation', path, `${locale}: use fullwidth punctuation after CJK text`);
        }
      }
      if (l10n['zh-TW'].includes('標記')) report('l10n-glossary', path, 'zh-TW: token is 詞元, never 標記 (05 §10)');
      const required = REQUIRED_PLACEHOLDERS[path];
      if (required !== undefined && en !== [...required].sort().join(',')) {
        report('l10n-placeholders', path, `needs exactly the placeholders {${required.join('}, {')}}`);
      }
    }
  }
}
