/**
 * Fuzz findings as fixture candidates (04 §7, PA-9): `fixtures/candidates/<tokenizer>-<seed>.json`, one case per finding
 * in the golden-fixture case shape (`name`, `text`, `utf8Len`, `ids`, `tokens[]` from the Python oracle, tools/oracle/
 * README.md § Golden fixtures) plus a `classification` field and what triage needs: the engine's or the second opinion's
 * answer, the generator kind and the minimal repro. The oracle lane turns a confirmed candidate into a corpus case.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FixtureToken, TokenizerId } from '../../src/index.ts';
import type { DivergenceClass } from './classify.ts';
import type { Encoded } from './engines.ts';
import type { GeneratorKind } from './generators.ts';

/** What a finding is (the `classification` field). */
export type FindingClass =
  | 'engine-mismatch' // ids differ from the Python oracle
  | 'span-mismatch' // ids equal, byte spans differ
  | 'engine-error' // the engine threw
  | 'oracle-error' // the Python oracle could not encode the text
  | 'oracle-divergence'; // the Python oracle and a second opinion disagree (our engine agrees with the oracle)

/** One candidate case. */
export interface CandidateCase {
  readonly name: string;
  readonly text: string;
  readonly utf8Len: number;
  /** The Python oracle's ids and tokens (null when the oracle failed). */
  readonly ids: readonly number[] | null;
  readonly tokens: readonly FixtureToken[] | null;
  readonly classification: FindingClass;
  /** `oracle-divergence` only. */
  readonly divergenceClass?: DivergenceClass;
  readonly explanation: string;
  readonly generator: GeneratorKind;
  readonly engine?: Encoded | { readonly error: string };
  readonly secondOpinion?: { readonly library: string; readonly ids: readonly number[] | null };
  readonly minimal?: { readonly text: string; readonly utf8Hex: string };
}

/** One candidates file. */
export interface CandidateFile {
  readonly tokenizer: TokenizerId;
  readonly seed: number;
  readonly n: number;
  readonly generatedOn: string;
  readonly oracle: { readonly library: string; readonly crossLibrary: string | null };
  readonly note: string;
  readonly cases: readonly CandidateCase[];
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Lowercase hex of `bytes` (the fixtures' `bytes` encoding). */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when `bytes` is non-empty and not complete, valid UTF-8 on its own (the fixtures' `partial`). */
export function isPartial(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  try {
    strictUtf8.decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/** Fixture tokens for `ids` with `[start, end)` `spans` over the UTF-8 of `text`. */
export function fixtureTokens(
  text: string,
  ids: readonly number[],
  spans: ReadonlyArray<readonly [number, number]>,
): FixtureToken[] {
  const utf8 = new TextEncoder().encode(text);
  return ids.map((id, i) => {
    const [start, end] = spans[i] ?? [0, 0];
    const bytes = utf8.subarray(start, end);
    return { id, bytes: toHex(bytes), start, end, partial: isPartial(bytes), zeroWidth: start === end };
  });
}

/** `fixtures/candidates/<tokenizer>-<seed>.json` under `dir`; returns the path written. */
export function writeCandidates(dir: string, file: CandidateFile): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${file.tokenizer}-${String(file.seed)}.json`);
  writeFileSync(path, `${JSON.stringify(file, null, 1)}\n`, 'utf8');
  return path;
}
