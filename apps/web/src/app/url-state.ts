/**
 * URL state (05 §1.1), pure: `?t=<tokenizer>&q=<text>&s=<stage>.<step>&b=hex|dec|both&lang=<ui>&tl=<TextLangChoice>`.
 *
 * - Read once at load (`parseUrlState`); an invalid value is ignored and its default kept. `lang` is applied by boot.js
 *   before first paint (AD-29), so it is parsed here only for completeness.
 * - Written with `history.replaceState`, debounced 500 ms, for everything except the text (`urlFor` without `text`); the
 *   text goes into `q` only on an explicit "Copy link" (`urlFor` with `text`, ≤ 2,000 code points), and a `q` that
 *   came with the page (or from "Copy link") stays while the text equals it and is removed by the next write once the
 *   text changes (App.svelte). Parameters this module does not own (`mock=1`) are kept.
 */
import type { TextLangChoice, TokenizerId } from '@tsbs/core';
import type { Locale } from '../i18n/types.ts';
import type { ByteView, Stage } from './app-state.svelte.ts';
import { countCodePoints } from './long-input.ts';

/** Longest text "Copy link" puts into `q` (code points). */
export const MAX_LINK_TEXT = 2000;
/** The replaceState debounce (05 §1.1). */
export const URL_WRITE_DELAY_MS = 500;

/** What a URL can set; absent fields keep their defaults. */
export interface UrlState {
  readonly tokenizer?: TokenizerId;
  readonly text?: string;
  readonly stage?: Stage;
  /** Only with `stage` 5: the merge step. */
  readonly step?: number;
  readonly byteView?: ByteView;
  readonly locale?: Locale;
  readonly textLang?: TextLangChoice;
}

/** The state the URL writer serializes. */
export interface UrlSnapshot {
  readonly tokenizer: TokenizerId;
  readonly stage: Stage;
  readonly step: number;
  readonly byteView: ByteView;
  readonly locale: Locale;
  readonly textLang: TextLangChoice;
}

const BYTE_VIEWS: readonly ByteView[] = ['hex', 'dec', 'both'];
const LOCALES: readonly Locale[] = ['zh-TW', 'ja', 'en'];
const TEXT_LANGS: readonly TextLangChoice[] = ['auto', 'zh-Hant', 'ja', 'en'];
/** Keys this module owns, in the order it writes them. */
const KEYS = ['t', 'q', 's', 'b', 'lang', 'tl'] as const;

const pick = <T extends string>(allowed: readonly T[], value: string | null): T | undefined =>
  allowed.find((candidate) => candidate === value);

/** `s=<stage>[.<step>]`: stage 1–6; a step only at stage 5 (stop 6 implies the last step, stops 1–4 step 0). */
function parseStage(value: string | null): Pick<UrlState, 'stage' | 'step'> {
  const match = /^([1-6])(?:\.(\d{1,7}))?$/.exec(value ?? '');
  if (match === null) return {};
  const stage = Number(match[1]) as Stage;
  return stage === 5 && match[2] !== undefined ? { stage, step: Number(match[2]) } : { stage };
}

/** The state `search` (a `location.search`) asks for, among the tokenizers the page offers. */
export function parseUrlState(search: string, tokenizers: readonly TokenizerId[]): UrlState {
  const params = new URLSearchParams(search);
  const tokenizer = pick(tokenizers, params.get('t'));
  const text = params.get('q');
  const byteView = pick(BYTE_VIEWS, params.get('b'));
  const locale = pick(LOCALES, params.get('lang'));
  const textLang = pick(TEXT_LANGS, params.get('tl'));
  return {
    ...(tokenizer === undefined ? {} : { tokenizer }),
    ...(text === null || text === '' ? {} : { text }),
    ...parseStage(params.get('s')),
    ...(byteView === undefined ? {} : { byteView }),
    ...(locale === undefined ? {} : { locale }),
    ...(textLang === undefined ? {} : { textLang }),
  };
}

/** `s` for a timeline position: `5.<step>` at stop 5, the stop alone elsewhere. */
export function stageParam(stage: Stage, step: number): string {
  return stage === 5 ? `5.${String(Math.max(0, Math.floor(step)))}` : String(stage);
}

/**
 * The page URL for `snapshot`: `href` with the owned keys rewritten in order and every other parameter kept. With
 * `text`, `q` carries it (callers check `MAX_LINK_TEXT`); without, `q` is removed.
 */
export function urlFor(href: string, snapshot: UrlSnapshot, text?: string): string {
  const url = new URL(href);
  const kept = [...url.searchParams].filter(([key]) => !(KEYS as readonly string[]).includes(key));
  const owned: Record<(typeof KEYS)[number], string | null> = {
    t: snapshot.tokenizer,
    q: text ?? null,
    s: stageParam(snapshot.stage, snapshot.step),
    b: snapshot.byteView,
    lang: snapshot.locale,
    tl: snapshot.textLang,
  };
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = owned[key];
    if (value !== null) params.set(key, value);
  }
  for (const [key, value] of kept) params.append(key, value);
  url.search = params.toString();
  return url.toString();
}

/** "Copy link": the URL with the text when it fits (`MAX_LINK_TEXT` code points), else without it. */
export function shareLink(
  href: string,
  snapshot: UrlSnapshot,
  text: string,
): { readonly url: string; readonly withText: boolean } {
  const withText = text !== '' && countCodePoints(text) <= MAX_LINK_TEXT;
  return { url: urlFor(href, snapshot, withText ? text : undefined), withText };
}
