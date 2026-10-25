/**
 * One `TokenizationView` per (result, text language), shared by the board, the inspector and WP09's rail so the view's
 * replay cursor is reused (`partsAt(k ± 1)` is O(1) amortised, 03 §B.2). Results are immutable and transferred, so a
 * WeakMap keyed by the result object releases the view with it.
 */
import type { ResolvedTextLang, TokenizationResult } from '@tsbs/core';
import { TokenizationView } from '@tsbs/core/model/view';

const views = new WeakMap<TokenizationResult, Map<ResolvedTextLang, TokenizationView>>();

/** The view of `result` whose `CharInfo.lang` is `lang`. */
export function viewOf(result: TokenizationResult, lang: ResolvedTextLang): TokenizationView {
  let byLang = views.get(result);
  if (byLang === undefined) {
    byLang = new Map();
    views.set(result, byLang);
  }
  let view = byLang.get(lang);
  if (view === undefined) {
    view = new TokenizationView(result, { lang });
    byLang.set(lang, view);
  }
  return view;
}
