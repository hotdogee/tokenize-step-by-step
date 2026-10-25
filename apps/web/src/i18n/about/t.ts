/**
 * Translator for the About-page catalogs (same template rules as ../t.ts). Reads the shared locale store, so templates
 * that call it re-render when the UI language changes. Only `/about/` imports this module.
 */
import { i18n } from '../locale.svelte.ts';
import { fill, templateOf } from '../t.ts';
import type { Locale, Params } from '../types.ts';
import { aboutEn, type AboutCatalog, type AboutMessageKey } from './en.ts';
import { aboutJa } from './ja.ts';
import { aboutZhTW } from './zh-TW.ts';

export const ABOUT_CATALOGS: Readonly<Record<Locale, AboutCatalog>> = { en: aboutEn, 'zh-TW': aboutZhTW, ja: aboutJa };

/** Translates an About-page key in `locale`. */
export function translateAbout(locale: Locale, key: AboutMessageKey, params?: Params): string {
  return fill(templateOf(ABOUT_CATALOGS[locale][key], params, locale), params, locale);
}

/** Translates an About-page key in the current UI locale (reactive). */
export function at(key: AboutMessageKey, params?: Params): string {
  return translateAbout(i18n.current, key, params);
}
