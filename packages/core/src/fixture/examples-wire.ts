/**
 * The precomputed-examples wire format (03 §C.7, AD-16): a compact fixture subset that `fromFixtureCase` expands into a
 * `TokenizationResult` on the main thread. `toExampleCaseWire` is the encoder the `examples` output (WP03) and the tests
 * use; decoding lives in `from-fixture-case.ts`. Encoding rules:
 *
 * - `tokenEnd`: delta-coded token end offsets (cumulative sum = end; zero-width tokens contribute 0);
 * - `flags`: sparse `[index, TokenFlag bits]` for tokens that are Partial / ZeroWidth / Byte / UserDefined / Special;
 * - `piece` (spm): the piece string, or 0 when it equals the token's bytes decoded as UTF-8;
 * - `type` (spm): `TokenKind` per token, with gemma4's USER_DEFINED already mapped to Normal (AD-31) and a zero-width
 *   leading `▁` as DummyPrefix;
 * - `chunks` (byte-level): delta-coded chunk end offsets;
 * - `merges` (byte-level, omitted for paragraph chips): `{ c, d, s }` per chunk with `s` the flattened `[position, rank]`
 *   steps; an entry is left out when it carries nothing beyond the default (no steps, and `d` = 1 exactly for a 1-byte
 *   chunk — every 1-byte chunk is a direct hit, 03 §B.2).
 */
import type { TokenizerId } from '../model/result.ts';
import { TokenFlag, TokenKind } from '../model/result.ts';
import { decodeUtf8 } from '../text/utf8.ts';
import type { Fixture, SpmFixtureCase, SpmPieceType, TiktokenFixtureCase } from './fixture-types.ts';

/** `generated/examples-default.json` and `dist/examples/<tokenizerId>.<sha8>.json`. */
export interface ExamplesWire {
  readonly schema: 1;
  readonly tokenizer: TokenizerId;
  readonly cases: Readonly<Record<string, ExampleCaseWire>>;
}

/** One case in wire form (plain JSON; typed arrays are rebuilt by `fromFixtureCase`). */
export interface ExampleCaseWire {
  readonly text: string;
  readonly ids: readonly number[];
  readonly tokenEnd: readonly number[];
  readonly flags?: ReadonlyArray<readonly [number, number]>;
  readonly piece?: ReadonlyArray<string | 0>;
  readonly type?: readonly number[];
  readonly chunks?: readonly number[];
  readonly merges?: ReadonlyArray<{ readonly c: number; readonly d: 0 | 1; readonly s: readonly number[] }>;
}

/** `TokenKind` of a fixture piece type (03 §B.5), with the gemma4 rule: USER_DEFINED → Normal (AD-31). */
export function kindOfPieceType(type: SpmPieceType, tokenizer: string): number {
  switch (type) {
    case 'BYTE':
      return TokenKind.Byte;
    case 'USER_DEFINED':
      return tokenizer === 'google-gemma4' ? TokenKind.Normal : TokenKind.UserDefined;
    case 'CONTROL':
      return TokenKind.Control;
    case 'UNK':
      return TokenKind.Unk;
    case 'NORMAL':
    case 'UNUSED':
      return TokenKind.Normal;
  }
}

/** Token kinds of an spm fixture case (a zero-width token at offset 0 is the dummy prefix). */
export function spmCaseKinds(c: SpmFixtureCase, tokenizer: string): number[] {
  return c.tokens.map((t) =>
    t.zeroWidth && t.start === 0 ? TokenKind.DummyPrefix : kindOfPieceType(t.type, tokenizer),
  );
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function isTiktokenCase(c: TiktokenFixtureCase | SpmFixtureCase): c is TiktokenFixtureCase {
  return 'chunks' in c;
}

/** Encodes one fixture case (from `fixture.cases` or `fixture.normalizedNFKC`); `merges: false` drops the steps. */
export function toExampleCaseWire(
  fixture: Fixture,
  c: TiktokenFixtureCase | SpmFixtureCase,
  options: { readonly merges?: boolean } = {},
): ExampleCaseWire {
  const tokenEnd: number[] = [];
  const flags: Array<readonly [number, number]> = [];
  let prev = 0;
  const kinds = isTiktokenCase(c) ? null : spmCaseKinds(c, fixture.tokenizer);
  c.tokens.forEach((t, i) => {
    tokenEnd.push(t.end - prev);
    prev = t.end;
    let f = 0;
    if (t.partial) f |= TokenFlag.Partial;
    if (t.zeroWidth) f |= TokenFlag.ZeroWidth;
    const kind = kinds?.[i];
    if (kind === TokenKind.Byte) f |= TokenFlag.ByteFallback;
    if (kind === TokenKind.UserDefined) f |= TokenFlag.UserDefined;
    if (kind === TokenKind.Special || kind === TokenKind.Bos) f |= TokenFlag.Special;
    if (f !== 0) flags.push([i, f]);
  });
  const base = { text: c.text, ids: [...c.ids], tokenEnd, ...(flags.length > 0 ? { flags } : {}) };
  if (!isTiktokenCase(c)) {
    const piece = c.tokens.map((t) => (decodeUtf8(hexToBytes(t.bytes)) === t.piece ? 0 : t.piece));
    return { ...base, piece, type: kinds ?? [] };
  }
  let chunkPrev = 0;
  const chunks = c.chunks.map(([, end]) => {
    const delta = end - chunkPrev;
    chunkPrev = end;
    return delta;
  });
  if (options.merges === false) return { ...base, chunks };
  const merges = c.merges
    .filter((m) => {
      const span = c.chunks[m.chunk];
      const oneByte = span !== undefined && span[1] - span[0] === 1;
      return m.steps.length > 0 || m.directHit !== oneByte;
    })
    .map((m) => ({ c: m.chunk, d: m.directHit ? (1 as const) : (0 as const), s: m.steps.flat() }));
  return { ...base, chunks, merges };
}

/** Encodes the named cases of a fixture; `withoutMerges` lists the cases (paragraph chips) whose steps are omitted. */
export function toExamplesWire(
  fixture: Fixture,
  tokenizer: TokenizerId,
  caseNames: readonly string[],
  withoutMerges: ReadonlySet<string> = new Set(),
): ExamplesWire {
  const cases: Record<string, ExampleCaseWire> = {};
  for (const name of caseNames) {
    const c = (fixture.cases as ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase>).find((x) => x.name === name);
    if (c === undefined) throw new Error(`${fixture.tokenizer} has no case ${name}`);
    cases[name] = toExampleCaseWire(fixture, c, { merges: !withoutMerges.has(name) });
  }
  return { schema: 1, tokenizer, cases };
}
