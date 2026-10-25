/**
 * One fuzz run (PA-9, 04 §7) for one tokenizer: generate the seeded strings, ask the Python oracle (ids + spans + its
 * cross-check), encode with our engine over the built asset, compare ids AND spans, compare the oracle with every second
 * opinion (the pure-JS one and the Python cross-check; ids only), shrink each finding to a minimal repro and classify
 * the divergences. Dependencies are injected (oracle, engine, second opinion), so the loop is unit-tested with fakes.
 */
import type { Tokenizer, TokenizerId } from '../../src/index.ts';
import type { AlphabetFile } from './alphabet.ts';
import { type CandidateCase, type CandidateFile, fixtureTokens, type FindingClass, toHex } from './candidates.ts';
import { classifyDivergence, type DivergenceClass, type OpinionEngine } from './classify.ts';
import { compareWithOracle, isAnswer, type Mismatch, sameIds } from './compare.ts';
import { encodeWith, type Encoded } from './engines.ts';
import { type FuzzString, generateStrings } from './generators.ts';
import type { OracleInfo, OracleLike, OracleResult } from './oracle-client.ts';
import type { SecondOpinion } from './second-opinions.ts';
import { shrink } from './shrink.ts';

type Answer = Extract<OracleResult, { ids: readonly number[] }>;

/** The regex/Unicode engine behind each tokenizer's Python cross-check (fuzz_oracle.py's table). */
export const CROSS_ENGINE: Readonly<Record<TokenizerId, OpinionEngine | null>> = {
  'openai-o200k_base': null,
  'openai-cl100k_base': null,
  'meta-llama4-muse': null,
  'meta-llama3': 'unicode-16', // HF tokenizers (Oniguruma) on Xenova/llama3-tokenizer
  'xai-grok2': 'python-regex', // oracles.bpe_reference over Python `regex` chunks
  'anthropic-claude-legacy': 'python-regex',
  'google-gemma4': 'gemma3-spm', // sentencepiece on the Gemma 3 model
  'google-gemma2': 'unicode-16', // oracles.spm_bpe_ref (no regex)
  'xai-grok1': 'unicode-16',
};

/** Inputs of one tokenizer's run. */
export interface RunInput {
  readonly tokenizer: TokenizerId;
  readonly seed: number;
  readonly n: number;
  readonly alphabet: AlphabetFile;
  readonly oracle: OracleLike;
  readonly engine: Tokenizer;
  readonly secondOpinion: SecondOpinion | null;
  /** Shrink at most this many findings (the rest are classified on the full text). Default 50. */
  readonly maxShrinks?: number;
}

/** Comparison counts against one second opinion. */
export interface OpinionReport {
  readonly library: string;
  readonly engine: OpinionEngine;
  readonly compared: number;
  readonly divergences: Readonly<Partial<Record<DivergenceClass, number>>>;
}

/** The result of one tokenizer's run. */
export interface TokenizerReport {
  readonly tokenizer: TokenizerId;
  readonly strings: number;
  readonly oracle: OracleInfo;
  readonly idMismatches: number;
  readonly spanMismatches: number;
  readonly engineErrors: number;
  readonly oracleErrors: number;
  readonly opinions: readonly OpinionReport[];
  readonly cases: readonly CandidateCase[];
  /** Engine mismatches/errors, oracle errors and unclassified divergences: what fails the run. */
  readonly failures: number;
}

/** A second opinion as the run sees it: ids per (text, oracle answer). */
interface Opinion {
  readonly library: string;
  readonly engine: OpinionEngine;
  /** Ids, or an error message; null = no opinion on this text (the cross-check could not run). */
  idsFor(text: string, answer: Answer): readonly number[] | { readonly error: string } | null;
}

function jsOpinion(opinion: SecondOpinion): Opinion {
  return {
    library: opinion.library,
    engine: 'node-regex',
    idsFor(text) {
      try {
        return opinion.encode(text);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function crossOpinion(library: string, engine: OpinionEngine): Opinion {
  return { library, engine, idsFor: (_text, answer) => answer.cross };
}

function describeMismatch(mismatch: Mismatch): string {
  switch (mismatch.kind) {
    case 'engine-error':
      return `the engine threw: ${mismatch.message}`;
    case 'ids':
      return `ids differ from the oracle at token ${String(mismatch.at)}`;
    case 'spans':
      return `ids equal, byte span of token ${String(mismatch.at)} differs from the oracle`;
  }
}

const FINDING_OF: Readonly<Record<Mismatch['kind'], FindingClass>> = {
  'engine-error': 'engine-error',
  ids: 'engine-mismatch',
  spans: 'span-mismatch',
};

/** Runs the fuzz for one tokenizer. */
export async function runTokenizer(input: RunInput): Promise<TokenizerReport> {
  const { tokenizer, seed, n, oracle, engine } = input;
  const maxShrinks = input.maxShrinks ?? 50;
  const strings = generateStrings(input.alphabet, seed, tokenizer, n);
  const response = await oracle.request({ [tokenizer]: strings.map((s) => s.text) });
  const results = response.results[tokenizer] ?? [];
  const info = response.oracles[tokenizer] ?? { library: 'fuzz_oracle.py', crossLibrary: null };
  const specials = engine.info.specials.map((s) => s.text);
  const opinions: Opinion[] = [];
  if (input.secondOpinion !== null) opinions.push(jsOpinion(input.secondOpinion));
  const crossEngine = CROSS_ENGINE[tokenizer];
  if (info.crossLibrary !== null && crossEngine !== null) opinions.push(crossOpinion(info.crossLibrary, crossEngine));

  const ask = async (texts: readonly string[]): Promise<readonly OracleResult[]> =>
    (await oracle.request({ [tokenizer]: texts })).results[tokenizer] ?? [];
  let shrinks = 0;
  const minimalOf = async (
    text: string,
    failing: (t: string, r: OracleResult | undefined) => boolean,
  ): Promise<string | null> => {
    if (shrinks >= maxShrinks) return null;
    shrinks++;
    const result = await shrink(text, async (texts) => {
      const answers = await ask(texts);
      return texts.map((t, i) => failing(t, answers[i]));
    });
    return result.text;
  };
  const minimalField = (text: string | null): Pick<CandidateCase, 'minimal'> =>
    text === null ? {} : { minimal: { text, utf8Hex: toHex(new TextEncoder().encode(text)) } };

  const cases: CandidateCase[] = [];
  let idMismatches = 0;
  let spanMismatches = 0;
  let engineErrors = 0;
  let oracleErrors = 0;
  let failures = 0;
  const counts = opinions.map((): { compared: number; divergences: Partial<Record<DivergenceClass, number>> } => ({
    compared: 0,
    divergences: {},
  }));
  const base = (s: FuzzString): Pick<CandidateCase, 'name' | 'text' | 'utf8Len' | 'generator'> => ({
    name: `fuzz-${String(seed)}-${String(s.index).padStart(5, '0')}`,
    text: s.text,
    utf8Len: new TextEncoder().encode(s.text).length,
    generator: s.kind,
  });

  for (const s of strings) {
    const result = results[s.index];
    if (!isAnswer(result)) {
      oracleErrors++;
      failures++;
      cases.push({
        ...base(s),
        ids: null,
        tokens: null,
        classification: 'oracle-error',
        explanation: result === undefined ? 'no oracle answer' : result.error,
        engine: encodeWith(engine, s.text),
      });
      continue;
    }
    const encoded: Encoded | { readonly error: string } = encodeWith(engine, s.text);
    const mismatch = compareWithOracle(encoded, result);
    const oracleCase = { ids: result.ids, tokens: fixtureTokens(s.text, result.ids, result.spans) };
    if (mismatch !== null) {
      failures++;
      if (mismatch.kind === 'ids') idMismatches++;
      else if (mismatch.kind === 'spans') spanMismatches++;
      else engineErrors++;
      const minimal = await minimalOf(
        s.text,
        (t, r) => isAnswer(r) && compareWithOracle(encodeWith(engine, t), r) !== null,
      );
      cases.push({
        ...base(s),
        ...oracleCase,
        classification: FINDING_OF[mismatch.kind],
        explanation: describeMismatch(mismatch),
        engine: encoded,
        ...minimalField(minimal),
      });
    }
    for (const [k, opinion] of opinions.entries()) {
      const ids = opinion.idsFor(s.text, result);
      const count = counts[k];
      if (ids === null || count === undefined) continue;
      count.compared++;
      if (!('error' in ids) && sameIds(ids, result.ids)) continue;
      let classification;
      let minimal: string | null = null;
      if ('error' in ids) {
        classification = { class: 'opinion-error' as const, explanation: `${opinion.library} threw: ${ids.error}` };
      } else {
        minimal = await minimalOf(s.text, (t, r) => {
          if (!isAnswer(r)) return false;
          const other = opinion.idsFor(t, r);
          return other !== null && !('error' in other) && !sameIds(other, r.ids);
        });
        const decidedOn = minimal ?? s.text;
        const reply = minimal === null ? result : (await ask([minimal]))[0];
        const note = isAnswer(reply) ? reply.crossNote : null;
        classification = classifyDivergence({ text: decidedOn, engine: opinion.engine, specials, crossNote: note });
      }
      count.divergences[classification.class] = (count.divergences[classification.class] ?? 0) + 1;
      if (classification.class === 'unclassified') failures++;
      cases.push({
        ...base(s),
        ...oracleCase,
        classification: 'oracle-divergence',
        divergenceClass: classification.class,
        explanation: classification.explanation,
        secondOpinion: { library: opinion.library, ids: 'error' in ids ? null : ids },
        ...minimalField(minimal),
      });
    }
  }
  return {
    tokenizer,
    strings: strings.length,
    oracle: info,
    idMismatches,
    spanMismatches,
    engineErrors,
    oracleErrors,
    opinions: opinions.map((o, k) => ({
      library: o.library,
      engine: o.engine,
      compared: counts[k]?.compared ?? 0,
      divergences: counts[k]?.divergences ?? {},
    })),
    cases,
    failures,
  };
}

/** The candidates file of a report (the CLI writes it only when the report has failures to triage). */
export function candidateFile(report: TokenizerReport, seed: number, n: number, generatedOn: string): CandidateFile {
  return {
    tokenizer: report.tokenizer,
    seed,
    n,
    generatedOn,
    oracle: report.oracle,
    note:
      'pnpm test:fuzz findings (packages/core/test/fuzz, PA-9). ids/tokens are the Python oracle (tools/oracle/fuzz_oracle.py, ' +
      'fixture policy). engine-mismatch / span-mismatch / engine-error: our engine disagrees with the oracle (a bug, or a ' +
      'fixture candidate for the oracle lane). oracle-divergence: the oracle and a second opinion disagree; divergenceClass ' +
      'says why. Reproduce: pnpm test:fuzz --seed <seed> --tokenizer <id>.',
    cases: report.cases,
  };
}
