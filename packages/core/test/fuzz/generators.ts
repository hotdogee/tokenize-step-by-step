/**
 * Seeded fuzz strings (04 §7, PA-9). String `i` of tokenizer `t` depends only on (`seed`, `t`, `i`), so a failure is
 * reproduced with `pnpm test:fuzz --seed <seed> --tokenizer <t>` and every tokenizer explores its own strings. Six kinds:
 *
 * - `pool-mix`: 1–48 code points from the weighted corpus pools, the corpus code points and the extras;
 * - `extras`: letters, digits and spaces interleaved with the 04 §2.2 discriminators (U+001C–1F, U+0085, U+FEFF,
 *   U+2028/9, U+3000, ZWJ, VS16, U+2581), so a port with the JavaScript `\s` set or a missing in-context rule fails;
 * - `contractions`: mixed-case `'s 't 're 've 'm 'll 'd` with `ſ` for s, lone apostrophes and words around them;
 * - `repeated-unit`: runs of 1–64 × `\n`, space, `\t`, `-`, `=`, `.`, `!`, `─` mixed with letters — the
 *   HF-vs-SentencePiece tie-break class (07 §5 risk 2);
 * - `astral`: supplementary-plane characters and emoji sequences (surrogate pairs);
 * - `composite`: 2–6 strings of the other kinds joined, up to a few hundred code points (chunk interplay).
 *
 * Lone surrogates are never generated: the oracles encode strict UTF-8 (the engines' U+FFFD rule is covered by the
 * property tests in `text.test.ts`).
 */
import {
  allPools,
  ASTRAL_POOL,
  CONTRACTION_SUFFIXES,
  CONTRACTION_WORDS,
  EXTRA_POOL,
  nthCodePoint,
  type AlphabetFile,
  type Pool,
  rangeSize,
  REPEAT_UNITS,
} from './alphabet.ts';
import { createRng, type Rng } from './prng.ts';

export const GENERATOR_KINDS = ['pool-mix', 'extras', 'contractions', 'repeated-unit', 'astral', 'composite'] as const;
export type GeneratorKind = (typeof GENERATOR_KINDS)[number];

/** One generated string. */
export interface FuzzString {
  /** Position in the tokenizer's sequence (0-based); the candidate case name is `fuzz-<seed>-<index>`. */
  readonly index: number;
  readonly kind: GeneratorKind;
  readonly text: string;
}

/** Relative frequency of each kind. */
const KIND_WEIGHTS: Readonly<Record<GeneratorKind, number>> = {
  'pool-mix': 30,
  extras: 15,
  contractions: 10,
  'repeated-unit': 25,
  astral: 8,
  composite: 12,
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const WORDS = [
  'the',
  'Hello',
  'world',
  'x',
  'ab',
  'Tokyo',
  '台灣',
  '台南',
  'こんにちは',
  'ラーメン',
  '한국어',
  '日本語',
  'é',
  '123',
];

/** Picks an element with probability proportional to `weight(element)`. */
function weighted<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let target = rng.next() * total;
  for (const item of items) {
    target -= weight(item);
    if (target < 0) return item;
  }
  const last = items.at(-1);
  if (last === undefined) throw new RangeError('weighted() over an empty list');
  return last;
}

/** One draw from `pool`: a literal or a code point, chosen in proportion to how many of each the pool has. */
function drawFromPool(rng: Rng, pool: Pool): string {
  const literals = pool.literals ?? [];
  const size = pool.ranges === undefined ? 0 : rangeSize(pool.ranges);
  const pick = rng.int(literals.length + Math.min(size, 64)); // ranges count as at most 64 slots so literals stay visible
  if (pick < literals.length || pool.ranges === undefined) return rng.pick(literals);
  return String.fromCodePoint(nthCodePoint(pool.ranges, rng.int(size)));
}

function word(rng: Rng): string {
  if (rng.chance(0.5)) return rng.pick(WORDS);
  let out = '';
  for (let n = rng.between(1, 6); n > 0; n--) out += LETTERS.charAt(rng.int(LETTERS.length));
  return out;
}

function poolMix(rng: Rng, pools: readonly Pool[]): string {
  let out = '';
  for (let n = rng.between(1, 48); n > 0; n--)
    out += drawFromPool(
      rng,
      weighted(rng, pools, (p) => p.weight),
    );
  return out;
}

function extras(rng: Rng): string {
  const fillers = [' ', '  ', '\n', '\t', '1', '42', 'a', 'Zz', '台', '!', "'s"];
  let out = '';
  for (let n = rng.between(1, 10); n > 0; n--) {
    out += rng.chance(0.6) ? drawFromPool(rng, EXTRA_POOL) : rng.pick(fillers);
    if (rng.chance(0.5)) out += word(rng);
  }
  return out;
}

/** `'` + a suffix in random case, `s` sometimes written `ſ`. */
function contraction(rng: Rng): string {
  let suffix = '';
  for (const ch of rng.pick(CONTRACTION_SUFFIXES)) {
    const folded = ch === 's' && rng.chance(0.35) ? 'ſ' : ch;
    suffix += rng.chance(0.5) ? folded.toUpperCase() : folded; // 'ſ'.toUpperCase() === 'S'
  }
  return `'${suffix}`;
}

function contractions(rng: Rng): string {
  let out = '';
  for (let n = rng.between(1, 5); n > 0; n--) {
    out += rng.pick(CONTRACTION_WORDS);
    out += rng.chance(0.85) ? contraction(rng) : "'";
    if (rng.chance(0.4)) out += rng.pick(['', 'ſ', 'S', 'x', 'LL', 'ſt']);
    out += rng.pick([' ', '', '  ', '\n', ', ', '.']);
  }
  return out;
}

function repeatedUnit(rng: Rng): string {
  let out = '';
  for (let n = rng.between(1, 4); n > 0; n--) {
    if (rng.chance(0.65)) {
      const count = rng.chance(0.5) ? rng.between(1, 8) : rng.between(1, 64);
      out += rng.pick(REPEAT_UNITS).repeat(count);
    }
    if (rng.chance(0.7)) out += word(rng);
  }
  return out === '' ? rng.pick(REPEAT_UNITS).repeat(rng.between(1, 64)) : out;
}

function astral(rng: Rng): string {
  let out = '';
  for (let n = rng.between(1, 12); n > 0; n--) {
    out += drawFromPool(rng, ASTRAL_POOL);
    if (rng.chance(0.25)) out += rng.pick([' ', '\u200d', '\ufe0f', 'a', '台']);
  }
  return out;
}

function one(rng: Rng, kind: Exclude<GeneratorKind, 'composite'>, pools: readonly Pool[]): string {
  switch (kind) {
    case 'pool-mix':
      return poolMix(rng, pools);
    case 'extras':
      return extras(rng);
    case 'contractions':
      return contractions(rng);
    case 'repeated-unit':
      return repeatedUnit(rng);
    case 'astral':
      return astral(rng);
  }
}

const SIMPLE_KINDS = GENERATOR_KINDS.filter((k): k is Exclude<GeneratorKind, 'composite'> => k !== 'composite');

/** The string of `kind` drawn from `rng`. */
export function generate(rng: Rng, kind: GeneratorKind, pools: readonly Pool[]): string {
  if (kind !== 'composite') return one(rng, kind, pools);
  const parts: string[] = [];
  for (let n = rng.between(2, 6); n > 0; n--) parts.push(one(rng, rng.pick(SIMPLE_KINDS), pools));
  return parts.join(rng.pick(['', ' ', '\n']));
}

/** The first `n` fuzz strings of `tokenizer` for `seed`. */
export function generateStrings(alphabet: AlphabetFile, seed: number, tokenizer: string, n: number): FuzzString[] {
  const pools = allPools(alphabet);
  const out: FuzzString[] = [];
  for (let index = 0; index < n; index++) {
    // One independent stream per string: string i never depends on how many draws string i − 1 took.
    const rng = createRng(seed, `${tokenizer}#${String(index)}`);
    const kind = weighted(rng, GENERATOR_KINDS, (k) => KIND_WEIGHTS[k]);
    out.push({ index, kind, text: generate(rng, kind, pools) });
  }
  return out;
}
