/**
 * The fuzz alphabet of 04 §7: the golden-fixture corpus alphabet (`tools/oracle/alphabet.json`, written by
 * `make_corpus.py --export-alphabet`: the weighted pools of the corpus fuzz cases plus every code point the corpus uses)
 * and the extra classes the pre-tokenizer ports are most likely to get wrong (04 §2.2): the information separators
 * U+001C–1F, NEL U+0085, BOM U+FEFF, U+2028/2029, the ideographic space U+3000, ZWJ, VS16, the SentencePiece mark
 * U+2581, supplementary-plane characters (surrogate pairs in UTF-16), and the case-folding contraction alphabet with `ſ`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo.ts';

/** Inclusive code point ranges. */
export type Ranges = ReadonlyArray<readonly [number, number]>;

/** A weighted source of characters: code point ranges, literal strings (which may be longer than one code point), or both. */
export interface Pool {
  readonly label: string;
  readonly weight: number;
  readonly ranges?: Ranges;
  readonly literals?: readonly string[];
}

/** The parts of `tools/oracle/alphabet.json` the generators read. */
export interface AlphabetFile {
  readonly version: number;
  readonly codePoints: { readonly all: Ranges };
  readonly fuzz: { readonly pools: readonly Pool[] };
}

/** Parses `tools/oracle/alphabet.json`. */
export function readAlphabetFile(path = join(REPO_ROOT, 'tools', 'oracle', 'alphabet.json')): AlphabetFile {
  return JSON.parse(readFileSync(path, 'utf8')) as AlphabetFile;
}

/** The extra code points of 04 §7 beyond the corpus alphabet (each is also a member of `EXTRA_POOL`). */
export const EXTRA_CODE_POINTS = {
  informationSeparators: [0x1c, 0x1d, 0x1e, 0x1f],
  nel: 0x85,
  bom: 0xfeff,
  lineSeparator: 0x2028,
  paragraphSeparator: 0x2029,
  ideographicSpace: 0x3000,
  zwj: 0x200d,
  vs16: 0xfe0f,
  spmMark: 0x2581,
  longS: 0x17f,
} as const;

/** The format/control/whitespace extras as one pool (04 §7). */
export const EXTRA_POOL: Pool = {
  label: 'extras (U+001C–1F, U+0085, U+FEFF, U+2028/9, U+3000, ZWJ, VS16, U+2581)',
  weight: 1,
  ranges: [
    [0x1c, 0x1f],
    [0x85, 0x85],
    [0xfeff, 0xfeff],
    [0x2028, 0x2029],
    [0x3000, 0x3000],
    [0x200d, 0x200d],
    [0xfe0f, 0xfe0f],
    [0x2581, 0x2581],
  ],
};

/**
 * Supplementary-plane characters (two UTF-16 units, four UTF-8 bytes): CJK Extension B, Extensions G–H (𰻝 U+30EDD is
 * in G), mathematical alphanumerics (letters to `\p{L}`), emoji incl. skin tones and regional indicators, and a few
 * multi-code-point emoji sequences (ZWJ families, VS16 hearts, a flag).
 */
export const ASTRAL_POOL: Pool = {
  label: 'supplementary planes (surrogate pairs)',
  weight: 1,
  ranges: [
    [0x20000, 0x2a6df],
    [0x30000, 0x323af],
    [0x1d400, 0x1d7ff],
    [0x1f300, 0x1faff],
    [0x1f1e6, 0x1f1ff],
  ],
  literals: [
    '\u{1f469}\u200d\u{1f469}\u200d\u{1f467}', // family (ZWJ sequence)
    '\u{1f468}\u200d\u{1f4bb}', // technologist (ZWJ)
    '\u2764\ufe0f', // red heart + VS16
    '\u2764\ufe0f\u200d\u{1f525}', // heart on fire (VS16 + ZWJ)
    '\u{1f1f9}\u{1f1fc}', // flag: regional indicators T W
    '\u{1f44d}\u{1f3fd}', // thumbs up + skin tone
    '\u{30edd}', // CJK Extension G, four UTF-8 bytes
    '\u{20bb7}野家', // CJK Extension B + BMP
  ],
};

/**
 * Code points that Unicode 17.0 assigned (CJK Extension J; Tai Yo, the 17.0 probe of 04 §8). The engines and the id
 * oracles classify them with Unicode 16.0 tables (unassigned: not `\p{L}`), while Node's native `\p{…}` and the Python
 * `regex` module (18.0) call them letters, so second opinions built on those disagree — the `unicode-version` class.
 */
export const UNICODE17_POOL: Pool = {
  label: 'Unicode 17.0 additions',
  weight: 0.25,
  ranges: [
    [0x323b0, 0x3347f],
    [0x1e6c0, 0x1e6de],
  ],
};

/**
 * Contraction alphabet (04 §2.2: `(?i:'s|'t|'re|'ve|'m|'ll|'d)` must fold case, including `ſ` → s, and must not apply
 * to a lone `'`): suffixes in every case with `ſ` substituted for s, preceded by short words.
 */
export const CONTRACTION_SUFFIXES = ['s', 't', 're', 've', 'm', 'll', 'd'] as const;
export const CONTRACTION_WORDS = [
  'don',
  'DON',
  'it',
  'IT',
  'we',
  'We',
  'they',
  'I',
  'you',
  'ſhe',
  'O',
  'x',
  '',
] as const;

/** Units of the repeated-unit generator (04 §7), the HF-vs-SentencePiece tie-break class of risk 2 (07 §5). */
export const REPEAT_UNITS = ['\n', ' ', '\t', '-', '=', '.', '!', '─'] as const;

/** Every pool the mixed generator draws from: the corpus pools, the corpus code points, and the extras. */
export function allPools(file: AlphabetFile): Pool[] {
  return [
    ...file.fuzz.pools,
    { label: 'corpus code points', weight: 2, ranges: file.codePoints.all },
    EXTRA_POOL,
    ASTRAL_POOL,
    UNICODE17_POOL,
  ];
}

/** Number of code points in `ranges`. */
export function rangeSize(ranges: Ranges): number {
  return ranges.reduce((sum, [first, last]) => sum + (last - first + 1), 0);
}

/** The `index`-th code point of `ranges` (0-based, in range order). */
export function nthCodePoint(ranges: Ranges, index: number): number {
  let rest = index;
  for (const [first, last] of ranges) {
    const size = last - first + 1;
    if (rest < size) return first + rest;
    rest -= size;
  }
  throw new RangeError(`index ${String(index)} is outside the ranges`);
}
