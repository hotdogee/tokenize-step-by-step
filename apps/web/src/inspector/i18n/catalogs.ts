/**
 * The inspector's catalogs and translator (lazy: the Board imports this module after first paint, so the inspector's
 * strings never weigh on the initial `i18n` chunk, 06 §3 / PA-7). Same template rules as the shell (`fill`/`templateOf`
 * of ../../i18n/t.ts: named placeholders, plural forms on `n`, raw digits for ids/hex/steps).
 */
import { fill, templateOf } from '../../i18n/t.ts';
import type { Locale, Params } from '../../i18n/types.ts';
import { inspectorEn, type InspectorCatalog, type InspectorMessageKey } from './en.ts';
import { inspectorJa } from './ja.ts';
import { inspectorZhTW } from './zh-TW.ts';

export type { InspectorMessageKey };

export const INSPECTOR_CATALOGS: Readonly<Record<Locale, InspectorCatalog>> = {
  en: inspectorEn,
  'zh-TW': inspectorZhTW,
  ja: inspectorJa,
};

/** Translates an inspector key in `locale`. */
export function translateInspector(locale: Locale, key: InspectorMessageKey, params?: Params): string {
  const message = INSPECTOR_CATALOGS[locale][key];
  return fill(templateOf(message, params, locale), params, locale);
}

/** The inspector translator the model takes (bound to the current locale by the caller). */
export type InspectorTranslate = (key: InspectorMessageKey, params?: Params) => string;
