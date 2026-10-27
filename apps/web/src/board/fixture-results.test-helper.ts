/**
 * Test-only: fixture cases as `TokenizationResult`s for the Node unit tests of the board and inspector models (the
 * browser-mode helpers in board.test-helper.ts mount Svelte; this module stays DOM-free). Never imported by app code.
 */
import type { Fixture, TokenizationResult, TokenizerId } from '@tsbs/core';
import { fromFixtureCase, type FromFixtureOptions } from '@tsbs/core/fixture/from-fixture-case';
import { packRows, withParts } from '@tsbs/core/layout/pack-rows';
import { TokenizationView } from '@tsbs/core/model/view';
import { SHIPPING_FIXTURES } from '../app/fixtures.test-helper.ts';
import { tokenizerEntry } from '../app/registry.ts';
import { translate } from '../i18n/t.ts';
import type { Locale } from '../i18n/types.ts';
import type { Stage } from '../app/app-state.svelte.ts';
import { nfkcSource, type BoardContext } from './cells.ts';
import { tiersFor, tokenMode } from './geometry.ts';
import type { Translate } from './labels.ts';
import { BoardUnits } from './units.ts';

/** A fixture case as a result (byte-level cases carry their merge timeline). */
export function caseResult(
  tokenizer: TokenizerId,
  caseName: string,
  options: FromFixtureOptions = {},
): TokenizationResult {
  const fixture: Fixture | undefined = SHIPPING_FIXTURES.get(tokenizer);
  if (fixture === undefined) throw new Error(`no fixture for ${tokenizer}`);
  return fromFixtureCase(fixture, caseName, tokenizerEntry(tokenizer), options);
}

/** The translator of `locale`. */
export function translator(locale: Locale = 'en'): Translate {
  return (key, params) => translate(locale, key, params);
}

export interface ContextOptions {
  readonly K: number;
  readonly stage?: Stage;
  readonly step?: number;
  readonly byteView?: 'hex' | 'dec' | 'both';
  readonly wide?: boolean;
  readonly locale?: Locale;
  readonly fusedDummy?: boolean;
}

/** The board context the Board component would build for `result` (desktop viewport unless told otherwise). */
export function boardContext(result: TokenizationResult, options: ContextOptions): BoardContext {
  const stage = options.stage ?? 6;
  const view = new TokenizationView(result);
  const step = Math.min(options.step ?? view.stepCount, view.stepCount);
  const base = packRows(result, options.K);
  const parts = tokenMode(stage) === 'parts' ? view.partsAt(stage === 4 ? 0 : step) : null;
  const rows = parts === null ? base : withParts(base, result, parts);
  const wide = options.wide ?? true;
  return {
    result,
    units: new BoardUnits(result, rows, parts),
    tiers: tiersFor({ stage, byteView: options.byteView ?? 'hex', wide, chunkTier: true, tokens: true }),
    stage,
    pending: false,
    uLabels: stage >= 2,
    brackets: true,
    fusedDummy: options.fusedDummy ?? false,
    lang: 'und',
    t: translator(options.locale),
    nfkc: nfkcSource(result),
  };
}
