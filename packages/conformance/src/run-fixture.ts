/**
 * `runFixture(fixture, tokenizer)` (04 §7, AD-13): checks a tokenizer against a golden fixture, case by case, and reports
 * every mismatch. Shared by the engine tests and `tsbs-vocab build` (which refuses to write an asset that fails).
 *
 * Per case (and per `normalizedNFKC` case, encoded from the original text with `normalize: 'NFKC'`, when the tokenizer
 * supports NFKC):
 * - `ids` equal with default options; `utf8Len`; per token `start/end`, `bytes` (the span; "" for zero-width tokens, as in
 *   the fixtures), `partial`, `zeroWidth`; for SentencePiece also `piece` (`tokenizer.pieceString`) and `type` → `TokenKind`
 *   (exact for the `.model` fixtures; for google-gemma4 only on the BYTE / CONTROL / UNK / other axis, and USER_DEFINED
 *   must be Normal, AD-31);
 * - byte-level `chunks` spans and `merges` (directHit, and the steps replayed to offsets, rank = stepResultId = stepRank);
 * - `stats.splitChars` = chars with more than one non-zero-width token, from the fixture tokens;
 * - the 03 §B.3 invariants, and `encode()` ≡ `encodeIncremental()` (timings excluded);
 * - `specialTokens: 'match'` ids equal `idsWithSpecials`, or `ids` where the fixture omits it. Since the oracle lane emits the
 *   emulated `idsWithSpecials` for the user-defined-atomic SentencePiece fixtures (gemma2, grok1) wherever a CONTROL/UNK
 *   string makes them differ (03 §B.5), this one rule covers both specials-mode oracles and the emulation;
 * - `addBos: true` (tokenizers with a BOS id, 03 §B.5 `policy.addBos === false` row): `[bosId, ...ids]`, the BOS a
 *   zero-width `ZeroWidth | Special` token of kind Bos at `[0, 0)`, every other token's span unchanged.
 */
import {
  checkInvariants,
  TokenFlag,
  TokenKind,
  type EncodeOptions,
  type Fixture,
  type FixtureToken,
  type SpmFixtureCase,
  type SpmFixtureToken,
  type SpmPieceType,
  type TiktokenFixtureCase,
  type TokenizationResult,
  type Tokenizer,
} from '@tsbs/core';
import { compareMergeSteps } from './position-steps.ts';

export interface ConformanceFailure {
  readonly case: string;
  readonly variant: 'default' | 'match' | 'nfkc' | 'bos';
  readonly field: string;
  readonly message: string;
}

export interface ConformanceReport {
  readonly tokenizer: string;
  /** Cases encoded (cases + normalizedNFKC). */
  readonly cases: number;
  readonly assertions: number;
  readonly failures: readonly ConformanceFailure[];
  readonly ok: boolean;
  /** True when `maxFailures` was reached and later failures were not collected. */
  readonly truncated: boolean;
}

export interface RunFixtureOptions {
  /** Stop collecting after this many failures (default 200). */
  readonly maxFailures?: number;
  /** Check `encode() ≡ encodeIncremental()` (default true). */
  readonly incremental?: boolean;
  /** Restrict to these case names (default: all). */
  readonly cases?: readonly string[];
  /** `budgetMs` for `encodeIncremental` (default 4). */
  readonly budgetMs?: number;
}

type AnyCase = TiktokenFixtureCase | SpmFixtureCase;

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** The expected `TokenKind`s of a fixture piece type on the `.model` fixtures (CONTROL may surface as Special). */
function kindsFor(type: SpmPieceType, zeroWidth: boolean): readonly number[] {
  switch (type) {
    case 'BYTE':
      return [TokenKind.Byte];
    case 'USER_DEFINED':
      return [TokenKind.UserDefined];
    case 'CONTROL':
      return [TokenKind.Control, TokenKind.Special];
    case 'UNK':
      return [TokenKind.Unk];
    case 'NORMAL':
    case 'UNUSED':
      return zeroWidth ? [TokenKind.DummyPrefix, TokenKind.Normal] : [TokenKind.Normal];
  }
}

/** gemma4's comparison axis (AD-31). */
function axisOfKind(kind: number): string {
  if (kind === TokenKind.Byte) return 'BYTE';
  if (kind === TokenKind.Control || kind === TokenKind.Special) return 'CONTROL';
  if (kind === TokenKind.Unk) return 'UNK';
  return 'other';
}

function axisOfType(type: SpmPieceType): string {
  return type === 'BYTE' || type === 'CONTROL' || type === 'UNK' ? type : 'other';
}

/** Field-by-field equality of two results, timings excluded; returns the first differing path or null. */
export function firstDifference(a: unknown, b: unknown, path = 'result'): string | null {
  if (Object.is(a, b)) return null;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (a.constructor !== b.constructor || x.length !== y.length) return path;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `${path}[${String(i)}]`;
    return null;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (path === 'result' && key === 'timings') continue;
    const diff = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
    if (diff !== null) return diff;
  }
  return null;
}

function drain(
  tokenizer: Tokenizer,
  text: string,
  options: Partial<EncodeOptions>,
  budgetMs: number,
): TokenizationResult {
  const gen = tokenizer.encodeIncremental(text, options, budgetMs);
  for (;;) {
    const next = gen.next();
    if (next.done === true) return next.value;
  }
}

class Collector {
  readonly failures: ConformanceFailure[] = [];
  assertions = 0;
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  get full(): boolean {
    return this.failures.length >= this.max;
  }
  check(ok: boolean, failure: () => ConformanceFailure): void {
    this.assertions++;
    if (!ok && !this.full) this.failures.push(failure());
  }
}

function checkCase(
  fixture: Fixture,
  tokenizer: Tokenizer,
  c: AnyCase,
  variant: 'default' | 'nfkc',
  input: string,
  out: Collector,
  options: Required<Pick<RunFixtureOptions, 'incremental' | 'budgetMs'>>,
): void {
  const fail = (field: string, message: string) => (): ConformanceFailure => ({
    case: c.name,
    variant,
    field,
    message,
  });
  const encodeOptions: Partial<EncodeOptions> = variant === 'nfkc' ? { normalize: 'NFKC' } : {};
  let r: TokenizationResult;
  try {
    r = tokenizer.encode(input, encodeOptions);
  } catch (error) {
    out.check(false, fail('encode', error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
    return;
  }
  if (variant === 'nfkc') out.check(r.text === c.text, fail('text', `normalized text ${JSON.stringify(r.text)}`));
  const ids = Array.from(r.tokens.id);
  out.check(
    ids.length === c.ids.length && ids.every((id, i) => id === c.ids[i]),
    fail('ids', `got [${ids.join(', ')}], fixture [${c.ids.join(', ')}]`),
  );
  out.check(r.utf8.length === c.utf8Len, fail('utf8Len', `got ${String(r.utf8.length)}`));
  const tokens: ReadonlyArray<FixtureToken | SpmFixtureToken> = c.tokens;
  if (r.tokens.count === tokens.length) {
    tokens.forEach((t, i) => {
      const s = r.tokens.byteStart[i] ?? 0;
      const e = r.tokens.byteStart[i + 1] ?? 0;
      const flags = r.tokens.flags[i] ?? 0;
      const where = `token ${String(i)}`;
      out.check(s === t.start && e === t.end, fail('tokens.span', `${where}: [${String(s)}, ${String(e)})`));
      out.check(
        hex(r.utf8.subarray(s, e)) === t.bytes,
        fail('tokens.bytes', `${where}: ${hex(r.utf8.subarray(s, e))}`),
      );
      out.check(((flags & 1) !== 0) === t.partial, fail('tokens.partial', `${where}: flags ${String(flags)}`));
      out.check(((flags & 2) !== 0) === t.zeroWidth, fail('tokens.zeroWidth', `${where}: flags ${String(flags)}`));
      if ('piece' in t) {
        const piece = tokenizer.pieceString(t.id);
        out.check(piece === t.piece, fail('tokens.piece', `${where}: ${JSON.stringify(piece)}`));
        const kind = r.tokens.kind[i] ?? -1;
        if (fixture.tokenizer === 'google-gemma4') {
          out.check(
            axisOfKind(kind) === axisOfType(t.type),
            fail('tokens.type', `${where}: kind ${String(kind)} vs ${t.type}`),
          );
          if (t.type === 'USER_DEFINED') {
            out.check(
              kind === TokenKind.Normal,
              fail('tokens.type', `${where}: gemma4 USER_DEFINED must be Normal (AD-31)`),
            );
          }
        } else {
          out.check(
            kindsFor(t.type, t.zeroWidth).includes(kind),
            fail('tokens.type', `${where}: kind ${String(kind)} vs ${t.type}`),
          );
        }
      }
    });
  } else {
    out.check(false, fail('tokens', `${String(r.tokens.count)} tokens, fixture has ${String(c.tokens.length)}`));
  }
  if ('chunks' in c) {
    const spans = Array.from(
      { length: r.chunks.count },
      (_, k) => `${String(r.chunks.byteStart[k])}-${String(r.chunks.byteStart[k + 1])}`,
    );
    const want = c.chunks.map(([s, e]) => `${String(s)}-${String(e)}`);
    out.check(spans.join(' ') === want.join(' '), fail('chunks', `got ${spans.join(' ')}, fixture ${want.join(' ')}`));
    for (const message of compareMergeSteps(r, c.merges)) out.check(false, fail('merges', message));
    out.assertions += c.merges.length;
  }
  let split = 0;
  for (let i = 0; i < r.chars.count; i++) {
    const s = r.chars.byteStart[i] ?? 0;
    const e = r.chars.byteStart[i + 1] ?? 0;
    if (c.tokens.filter((t) => !t.zeroWidth && t.start < e && t.end > s).length > 1) split++;
  }
  out.check(
    r.stats.splitChars === split,
    fail('stats.splitChars', `got ${String(r.stats.splitChars)}, expected ${String(split)}`),
  );
  for (const v of checkInvariants(r)) out.check(false, fail('invariants', v));
  out.assertions++;
  if (options.incremental) {
    try {
      const diff = firstDifference(r, drain(tokenizer, input, encodeOptions, options.budgetMs));
      out.check(diff === null, fail('encodeIncremental', `differs from encode() at ${diff ?? ''}`));
    } catch (error) {
      out.check(false, fail('encodeIncremental', error instanceof Error ? error.message : String(error)));
    }
  }
}

function checkMatch(tokenizer: Tokenizer, c: AnyCase, out: Collector): void {
  const expected = c.idsWithSpecials ?? c.ids;
  const fail = (field: string, message: string) => (): ConformanceFailure => ({
    case: c.name,
    variant: 'match',
    field,
    message,
  });
  let r: TokenizationResult;
  try {
    r = tokenizer.encode(c.text, { specialTokens: 'match' });
  } catch (error) {
    out.check(false, fail('encode', error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
    return;
  }
  const ids = Array.from(r.tokens.id);
  out.check(
    ids.length === expected.length && ids.every((id, i) => id === expected[i]),
    fail('idsWithSpecials', `got [${ids.join(', ')}], expected [${expected.join(', ')}]`),
  );
  for (const v of checkInvariants(r)) out.check(false, fail('invariants', v));
  out.assertions++;
}

function checkBos(tokenizer: Tokenizer, c: AnyCase, bosId: number, out: Collector): void {
  const fail = (field: string, message: string) => (): ConformanceFailure => ({
    case: c.name,
    variant: 'bos',
    field,
    message,
  });
  let r: TokenizationResult;
  try {
    r = tokenizer.encode(c.text, { addBos: true });
  } catch (error) {
    out.check(false, fail('encode', error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
    return;
  }
  const ids = Array.from(r.tokens.id);
  const expected = [bosId, ...c.ids];
  out.check(
    ids.length === expected.length && ids.every((id, i) => id === expected[i]),
    fail('ids', `got [${ids.join(', ')}], expected [${expected.join(', ')}]`),
  );
  out.check(
    r.tokens.byteStart[0] === 0 &&
      r.tokens.byteStart[1] === 0 &&
      r.tokens.flags[0] === (TokenFlag.ZeroWidth | TokenFlag.Special) &&
      r.tokens.kind[0] === TokenKind.Bos,
    fail('bos', 'BOS must be a zero-width ZeroWidth|Special Bos token at [0, 0)'),
  );
  const spansKept = c.tokens.every(
    (t, i) => r.tokens.byteStart[i + 1] === t.start && r.tokens.byteStart[i + 2] === t.end,
  );
  out.check(spansKept, fail('tokens.span', 'token spans changed under addBos'));
  for (const v of checkInvariants(r)) out.check(false, fail('invariants', v));
  out.assertions++;
}

/** Runs every assertion of 04 §7 for `fixture` against `tokenizer`. */
export function runFixture(fixture: Fixture, tokenizer: Tokenizer, options: RunFixtureOptions = {}): ConformanceReport {
  const out = new Collector(options.maxFailures ?? 200);
  const settings = { incremental: options.incremental ?? true, budgetMs: options.budgetMs ?? 4 };
  const only = options.cases ? new Set(options.cases) : null;
  const cases = (fixture.cases as readonly AnyCase[]).filter((c) => only === null || only.has(c.name));
  let encoded = 0;
  for (const c of cases) {
    if (out.full) break;
    checkCase(fixture, tokenizer, c, 'default', c.text, out, settings);
    if (tokenizer.info.supports.specialsToggle) checkMatch(tokenizer, c, out);
    const bosId = tokenizer.info.bosId;
    if (tokenizer.info.supports.bos && bosId !== null) checkBos(tokenizer, c, bosId, out);
    encoded++;
  }
  if (fixture.family === 'tiktoken-bpe' && fixture.normalizedNFKC && tokenizer.info.supports.nfkc) {
    const originals = new Map(fixture.cases.map((c) => [c.name, c.text]));
    for (const c of fixture.normalizedNFKC) {
      if (out.full) break;
      if (only !== null && !only.has(c.name)) continue;
      const original = originals.get(c.name);
      if (original === undefined) {
        out.check(false, () => ({ case: c.name, variant: 'nfkc', field: 'case', message: 'no original case' }));
        continue;
      }
      checkCase(fixture, tokenizer, c, 'nfkc', original, out, settings);
      encoded++;
    }
  }
  return {
    tokenizer: fixture.tokenizer,
    cases: encoded,
    assertions: out.assertions,
    failures: out.failures,
    ok: out.failures.length === 0,
    truncated: out.full,
  };
}

/** One line per failure, for CLI output and assertion messages. */
export function formatReport(report: ConformanceReport): string {
  const head = `${report.tokenizer}: ${String(report.cases)} cases, ${String(report.assertions)} assertions, ${String(report.failures.length)} failure(s)${report.truncated ? ' (truncated)' : ''}`;
  return [head, ...report.failures.map((f) => `  [${f.variant}] ${f.case} · ${f.field}: ${f.message}`)].join('\n');
}
