/**
 * Precomputed example results (AD-16, 03 §C.7): every example chip × every shipped tokenizer, as the compact
 * `ExamplesWire` fixture subset that `fromFixtureCase` (WP01) expands on the main thread. Paragraph chips omit
 * `merges` (their timeline arrives with the live engine). Outputs: one `<tokenizerId>.<sha8>.json` per tokenizer
 * (≤ 16 KB gzip each), `examples-default.json` (an array of one wire per default row — the default chip on each lab's
 * primary tokenizer, PA-19 — inlined, ≤ 4 KB gzip together) and `examples-index.json` (file paths, the default pairs
 * and which chips split a character, for the chips' hatch mark).
 */
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  TokenFlag,
  TokenKind,
  type Fixture,
  type SpmFixtureCase,
  type TiktokenFixtureCase,
  type TokenizerId,
} from '@tsbs/core';
import { gzipSize, sha256Hex } from './compress.ts';
import { ASSET_SOURCES } from './sources/index.ts';

// ---- wire format (03 §C.7, verbatim) ----

export interface ExampleCaseWire {
  text: string;
  ids: number[];
  /** Delta-coded byte ends (cumulative); zero-width tokens contribute 0. */
  tokenEnd: number[];
  /** Sparse [index, TokenFlag bits] for tokens that are Partial/ZeroWidth/Byte/UserDefined/Special. */
  flags?: Array<[number, number]>;
  /** spm only, 0 = "same as decoded bytes". */
  piece?: Array<string | 0>;
  /** spm only, TokenKind per token (gemma4: USER_DEFINED already mapped to Normal, B.5). */
  type?: number[];
  /** bytelevel: delta-coded chunk ends. */
  chunks?: number[];
  /** bytelevel: per chunk, [position, rank] flattened; OMITTED for paragraph chips. */
  merges?: Array<{ c: number; d: 0 | 1; s: number[] }>;
}
export interface ExamplesWire {
  schema: 1;
  tokenizer: TokenizerId;
  cases: Record<string, ExampleCaseWire>;
}

/** `examples-index.json`: where each tokenizer's lazy file lives and which chips yield a partial-character token. */
export interface ExamplesIndex {
  schema: 1;
  /** The board's first paint: the default chip on the default tokenizer. */
  default: { tokenizer: TokenizerId; case: string };
  /** The table's first paint (PA-19): the default chip on each lab's primary tokenizer, inlined in examples-default.json. */
  defaults: Array<{ tokenizer: TokenizerId; case: string }>;
  chips: string[];
  files: Partial<Record<TokenizerId, string>>;
  partial: Partial<Record<TokenizerId, string[]>>;
}

/** A chip as far as this generator cares (registry `ExampleChip`, 03 §B.7). */
export interface ChipRef {
  readonly fixtureCase: string;
  /** When present it must equal the fixture case text byte-for-byte. */
  readonly text?: string;
  /** Paragraph chips carry a label (AD-38); they ship without merges. */
  readonly paragraph: boolean;
}

/** The 19 chips of 05 §6, used until `packages/registry/data/examples.json` (WP04) exists. */
export const DEFAULT_CHIP_CASES = [
  'zh-tw-tainan',
  'zh-tw-taiwan-formal',
  'zh-tw-renao',
  'cjk-saba',
  'cjk-turtle',
  'cjk-ext-g-biang',
  'emoji-family-zwj',
  'emoji-flag-tw',
  'emoji-heart-vs16',
  'ja-text',
  'ja-shibuya-ramen',
  'mixed-hello-taiwan-tokyo',
  'zh-date',
  'en-contraction-code',
  'bopomofo',
  'fullwidth-latin',
  'zh-tw-paragraph',
  'ja-paragraph',
  'en-paragraph',
] as const;

/** Default chip × default tokenizer (OD-1 台灣台南 on o200k_base): the board's first paint. */
export const DEFAULT_EXAMPLE = {
  tokenizer: 'openai-o200k_base',
  case: 'zh-tw-tainan',
} as const satisfies ExamplesIndex['default'];

/**
 * The default rows (PA-19): the default chip on each lab's `tier: 'primary'` tokenizer, in the registry's lab order
 * (the web app's registry test checks the list against tokenizers.json). The first is {@link DEFAULT_EXAMPLE}.
 */
export const DEFAULT_EXAMPLES = [
  DEFAULT_EXAMPLE,
  { tokenizer: 'anthropic-claude-legacy', case: DEFAULT_EXAMPLE.case },
  { tokenizer: 'google-gemma4', case: DEFAULT_EXAMPLE.case },
  { tokenizer: 'meta-llama4-muse', case: DEFAULT_EXAMPLE.case },
  { tokenizer: 'xai-grok2', case: DEFAULT_EXAMPLE.case },
] as const satisfies ReadonlyArray<ExamplesIndex['default']>;

/** Budgets (03 §C.7 / 06 §3), gzip bytes; the default budget covers the five default rows together. */
export const EXAMPLES_BUDGET_GZ = 16 * 1024;
export const DEFAULT_EXAMPLE_BUDGET_GZ = 4 * 1024;

const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function decoded(hex: string): string | null {
  try {
    return utf8Strict.decode(hexToBytes(hex));
  } catch {
    return null;
  }
}

/** TokenKind of a fixture spm token (gemma4 USER_DEFINED → Normal, AD-31; a zero-width `▁` is the dummy prefix, B.3). */
export function spmKind(tokenizer: string, token: SpmFixtureCase['tokens'][number]): number {
  if (token.zeroWidth && token.piece === '▁') return TokenKind.DummyPrefix;
  switch (token.type) {
    case 'BYTE':
      return TokenKind.Byte;
    case 'USER_DEFINED':
      return tokenizer === 'google-gemma4' ? TokenKind.Normal : TokenKind.UserDefined;
    case 'CONTROL':
      return TokenKind.Control;
    case 'UNK':
      return TokenKind.Unk;
    default:
      return TokenKind.Normal;
  }
}

function flagBits(partial: boolean, zeroWidth: boolean, kind: number | null): number {
  let bits = 0;
  if (partial) bits |= TokenFlag.Partial;
  if (zeroWidth) bits |= TokenFlag.ZeroWidth;
  if (kind === TokenKind.Byte) bits |= TokenFlag.ByteFallback;
  if (kind === TokenKind.UserDefined) bits |= TokenFlag.UserDefined;
  if (kind === TokenKind.Control || kind === TokenKind.Special) bits |= TokenFlag.Special;
  return bits;
}

/** Converts one fixture case into its wire form. */
export function caseToWire(fixture: Fixture, name: string, withMerges: boolean): ExampleCaseWire {
  const found = (fixture.cases as ReadonlyArray<TiktokenFixtureCase | SpmFixtureCase>).find((c) => c.name === name);
  if (found === undefined) throw new Error(`${fixture.tokenizer}: no fixture case ${name}`);
  const tokens = found.tokens;
  const wire: ExampleCaseWire = { text: found.text, ids: [...found.ids], tokenEnd: [] };
  const flags: Array<[number, number]> = [];
  let end = 0;
  tokens.forEach((token, i) => {
    if (token.start !== end) throw new Error(`${fixture.tokenizer}/${name}: token ${String(i)} is not contiguous`);
    wire.tokenEnd.push(token.end - token.start);
    end = token.end;
  });
  if (end !== found.utf8Len)
    throw new Error(`${fixture.tokenizer}/${name}: tokens cover ${String(end)} of ${String(found.utf8Len)} bytes`);
  if (fixture.family === 'sentencepiece-bpe') {
    const spm = found as SpmFixtureCase;
    wire.piece = [];
    wire.type = [];
    spm.tokens.forEach((token, i) => {
      const kind = spmKind(fixture.tokenizer, token);
      const bits = flagBits(token.partial, token.zeroWidth, kind);
      if (bits !== 0) flags.push([i, bits]);
      wire.piece?.push(decoded(token.bytes) === token.piece ? 0 : token.piece);
      wire.type?.push(kind);
    });
  } else {
    const tk = found as TiktokenFixtureCase;
    tk.tokens.forEach((token, i) => {
      const bits = flagBits(token.partial, token.zeroWidth, null);
      if (bits !== 0) flags.push([i, bits]);
    });
    let chunkEnd = 0;
    wire.chunks = tk.chunks.map(([start, stop]) => {
      if (start !== chunkEnd) throw new Error(`${fixture.tokenizer}/${name}: chunks do not tile the text`);
      chunkEnd = stop;
      return stop - start;
    });
    if (withMerges) wire.merges = tk.merges.map((m) => ({ c: m.chunk, d: m.directHit ? 1 : 0, s: m.steps.flat() }));
  }
  if (flags.length > 0) wire.flags = flags;
  return wire;
}

/** One generated file. */
export interface GeneratedJson {
  readonly name: string;
  readonly json: string;
  readonly bytes: number;
  readonly gzipBytes: number;
}

function generated(name: string, value: unknown): GeneratedJson {
  const json = JSON.stringify(value);
  return { name, json, bytes: Buffer.byteLength(json), gzipBytes: gzipSize(json) };
}

/** Output of {@link buildExamples}. */
export interface ExamplesOutput {
  readonly perTokenizer: ReadonlyArray<GeneratedJson & { readonly tokenizer: TokenizerId }>;
  /** `examples-default.json`: an `ExamplesWire[]`, one wire per default row, each with the default chip only. */
  readonly defaultExamples: GeneratedJson;
  readonly index: GeneratedJson;
}

/** Checks every chip against every fixture (case present; text identical when the chip states one). */
export function validateChips(fixtures: ReadonlyMap<TokenizerId, Fixture>, chips: readonly ChipRef[]): void {
  for (const [tokenizer, fixture] of fixtures) {
    const byName = new Map(fixture.cases.map((c) => [c.name, c.text]));
    for (const chip of chips) {
      const text = byName.get(chip.fixtureCase);
      if (text === undefined) throw new Error(`chip ${chip.fixtureCase} is missing from fixtures/${tokenizer}.json`);
      if (chip.text !== undefined && chip.text !== text)
        throw new Error(
          `chip ${chip.fixtureCase}: text differs from fixtures/${tokenizer}.json (chip.text must equal case.text)`,
        );
    }
  }
}

/** Builds every examples output from loaded fixtures and the chip list. `pathPrefix` is the site directory of the lazy files. */
export function buildExamples(
  fixtures: ReadonlyMap<TokenizerId, Fixture>,
  chips: readonly ChipRef[],
  pathPrefix = '/examples/',
): ExamplesOutput {
  validateChips(fixtures, chips);
  const perTokenizer: Array<GeneratedJson & { tokenizer: TokenizerId }> = [];
  const index: ExamplesIndex = {
    schema: 1,
    default: DEFAULT_EXAMPLE,
    defaults: DEFAULT_EXAMPLES.map(({ tokenizer, case: name }) => ({ tokenizer, case: name })),
    chips: chips.map((c) => c.fixtureCase),
    files: {},
    partial: {},
  };
  for (const [tokenizer, fixture] of fixtures) {
    const wire: ExamplesWire = { schema: 1, tokenizer, cases: {} };
    const partial: string[] = [];
    for (const chip of chips) {
      const c = caseToWire(fixture, chip.fixtureCase, !chip.paragraph);
      wire.cases[chip.fixtureCase] = c;
      if (c.flags?.some(([, bits]) => (bits & TokenFlag.Partial) !== 0) === true) partial.push(chip.fixtureCase);
    }
    const body = JSON.stringify(wire);
    const name = `${tokenizer}.${sha256Hex(body).slice(0, 8)}.json`;
    perTokenizer.push({ tokenizer, ...generated(name, wire) });
    index.files[tokenizer] = `${pathPrefix}${name}`;
    index.partial[tokenizer] = partial;
  }
  const defaultWires = DEFAULT_EXAMPLES.map(({ tokenizer, case: name }): ExamplesWire => {
    const fixture = fixtures.get(tokenizer);
    if (fixture === undefined) throw new Error(`no fixture for the default row ${tokenizer}`);
    return { schema: 1, tokenizer, cases: { [name]: caseToWire(fixture, name, true) } };
  });
  return {
    perTokenizer,
    defaultExamples: generated('examples-default.json', defaultWires),
    index: generated('examples-index.json', index),
  };
}

/** Loads `fixtures/<tokenizerId>.json` for every shipped tokenizer, in source order. */
export async function loadFixtures(fixturesDir: string): Promise<Map<TokenizerId, Fixture>> {
  const out = new Map<TokenizerId, Fixture>();
  for (const { tokenizerId } of ASSET_SOURCES) {
    const fixture = JSON.parse(await readFile(join(fixturesDir, `${tokenizerId}.json`), 'utf8')) as Fixture;
    if (fixture.tokenizer !== tokenizerId) throw new Error(`fixtures/${tokenizerId}.json names ${fixture.tokenizer}`);
    out.set(tokenizerId, fixture);
  }
  return out;
}

/**
 * Loads the chip list from `examples.json` (WP04: an array of `ExampleChip`, or `{ chips: [...] }`). When the file does
 * not exist yet, falls back to {@link DEFAULT_CHIP_CASES} and says so in `warning`.
 */
export async function loadChips(path: string): Promise<{ chips: ChipRef[]; warning: string | null }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return {
      chips: DEFAULT_CHIP_CASES.map((fixtureCase) => ({ fixtureCase, paragraph: fixtureCase.endsWith('-paragraph') })),
      warning: `${path} not found: using the 19 chips of 05 §6 until the registry's examples.json exists`,
    };
  }
  const data: unknown = JSON.parse(text);
  const list: unknown = Array.isArray(data) ? data : isRecord(data) ? data['chips'] : undefined;
  if (!Array.isArray(list)) throw new Error(`${path}: expected an array of chips or { chips: [...] }`);
  const chips = list.map((chip: unknown, i): ChipRef => {
    if (!isRecord(chip) || typeof chip['fixtureCase'] !== 'string')
      throw new Error(`${path}: chip ${String(i)} has no fixtureCase`);
    const name = chip['fixtureCase'];
    return {
      fixtureCase: name,
      ...(typeof chip['text'] === 'string' ? { text: chip['text'] } : {}),
      paragraph: chip['label'] !== undefined || name.endsWith('-paragraph'),
    };
  });
  return { chips, warning: null };
}
