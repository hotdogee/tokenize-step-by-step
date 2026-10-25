/**
 * The UI locale store (AD-29, 05 §10). boot.js has already written `<html lang>` from `?lang` → localStorage →
 * `navigator.languages` before first paint; this store starts from that attribute, switches at runtime (no routes, no
 * reload), persists the choice and keeps `<html lang>`, `<title>` and `<meta name=description>` in step.
 */
import { readStored, STORAGE_KEYS, writeStored } from '../app/storage.ts';
import type { MessageKey } from './en.ts';
import { translate } from './t.ts';
import type { Locale, Params } from './types.ts';

/** Which page's `<title>` / description to localise. */
export type PageKind = 'main' | 'about' | 'notFound';

const META: Readonly<Record<PageKind, readonly [title: MessageKey, description: MessageKey | null]>> = {
  main: ['meta.main.title', 'meta.main.description'],
  about: ['meta.about.title', 'meta.about.description'],
  notFound: ['meta.notFound.title', null],
};

/** Maps a BCP 47 tag to a UI locale (zh-TW / zh-Hant* / zh → zh-TW; ja* → ja; en* → en), else null. Mirrors boot.ts. */
export function toLocale(tag: string | null | undefined): Locale | null {
  const t = (tag ?? '').toLowerCase();
  if (t === 'zh' || t === 'zh-tw' || t.startsWith('zh-hant')) return 'zh-TW';
  if (t === 'ja' || t.startsWith('ja-')) return 'ja';
  if (t === 'en' || t.startsWith('en-')) return 'en';
  return null;
}

function initialLocale(): Locale {
  if (typeof document !== 'undefined') {
    const fromBoot = toLocale(document.documentElement.lang);
    if (fromBoot !== null) return fromBoot;
  }
  return toLocale(readStored(STORAGE_KEYS.locale)) ?? 'en';
}

export class LocaleStore {
  /** The active UI locale. Reading it inside a template or `$derived` makes that code locale-reactive. */
  current: Locale = $state('en');
  #page: PageKind = 'main';

  constructor(initial: Locale = initialLocale()) {
    this.current = initial;
  }

  /** Translates in the current locale (reactive). */
  readonly t = (key: MessageKey, params?: Params): string => translate(this.current, key, params);

  /** Declares which page this is (sets the localised title/description immediately). */
  setPage(page: PageKind): void {
    this.#page = page;
    this.#apply();
  }

  /** Switches the locale, persists it and updates the document. */
  set(locale: Locale): void {
    this.current = locale;
    writeStored(STORAGE_KEYS.locale, locale);
    this.#apply();
  }

  #apply(): void {
    if (typeof document === 'undefined') return;
    const [title, description] = META[this.#page];
    document.documentElement.lang = this.current;
    document.title = this.t(title);
    if (description !== null)
      document.querySelector('meta[name="description"]')?.setAttribute('content', this.t(description));
  }
}

/** The app-wide locale store. */
export const i18n = new LocaleStore();
