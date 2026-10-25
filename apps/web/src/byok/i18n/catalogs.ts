/**
 * The live-check drawer's catalogs and translator (lazy: they load with the open drawer, never at startup, so its strings
 * weigh on neither the initial `i18n` chunk nor the Main JS, PA-10). Same template rules as the shell (`fill`/`templateOf`
 * of ../../i18n/t.ts: named placeholders, plural forms on `n`, counts grouped, ids raw).
 */
import { fill, templateOf } from '../../i18n/t.ts';
import type { Locale, Params } from '../../i18n/types.ts';
import { byokEn, type ByokCatalog, type ByokMessageKey } from './en.ts';
import { byokJa } from './ja.ts';
import { byokZhTW } from './zh-TW.ts';

export type { ByokMessageKey };

export const BYOK_CATALOGS: Readonly<Record<Locale, ByokCatalog>> = { en: byokEn, 'zh-TW': byokZhTW, ja: byokJa };

/** Translates a drawer key in `locale`. */
export function translateByok(locale: Locale, key: ByokMessageKey, params?: Params): string {
  return fill(templateOf(BYOK_CATALOGS[locale][key], params, locale), params, locale);
}
