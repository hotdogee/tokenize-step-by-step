/**
 * One `TokenizationView` per (result, text language), shared by the board, the inspector and WP09's rail so the view's
 * replay cursor is reused (`partsAt(k ± 1)` is O(1) amortised, 03 §B.2). Results are immutable and transferred, so a
 * WeakMap keyed by the result object releases the view with it.
 *
 * WP13: the page registers the view resolvers (`setViewResolvers`, app/vocab-lookup.svelte.ts — the Worker's `lookup`
 * behind `idOf` / `pieceOf`). Their `version` is read here, so a derived that calls `viewOf` re-runs when lookup answers
 * arrive and gets a view built with them; without a registration (tests, About) views have no resolvers.
 */
import type { ResolvedTextLang, TokenizationResult } from '@tsbs/core';
import { TokenizationView, type ViewOptions } from '@tsbs/core/model/view';

/** What the page registers: a reactive version and the resolvers of a result. */
export interface ViewResolverSource {
  readonly version: number;
  resolversFor(result: TokenizationResult): Pick<ViewOptions, 'idOf' | 'pieceOf'>;
}

let source: ViewResolverSource | null = null;

/** Registers (or, with null, removes) the resolvers every later view is built with. */
export function setViewResolvers(next: ViewResolverSource | null): void {
  source = next;
}

const views = new WeakMap<TokenizationResult, { version: number; byLang: Map<ResolvedTextLang, TokenizationView> }>();

/** The view of `result` whose `CharInfo.lang` is `lang`. */
export function viewOf(result: TokenizationResult, lang: ResolvedTextLang): TokenizationView {
  const version = source?.version ?? 0;
  let entry = views.get(result);
  if (entry?.version !== version) {
    entry = { version, byLang: new Map() };
    views.set(result, entry);
  }
  let view = entry.byLang.get(lang);
  if (view === undefined) {
    view = new TokenizationView(result, { lang, ...(source?.resolversFor(result) ?? {}) });
    entry.byLang.set(lang, view);
  }
  return view;
}
