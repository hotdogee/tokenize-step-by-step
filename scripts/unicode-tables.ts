/**
 * Converts `tools/oracle/unicode_tables.json` (written and cross-checked by `tools/oracle/export_unicode_tables.py`,
 * AD-4) into `packages/core/src/unicode/tables.generated.ts` (committed; 02 §7, 04 §2.3).
 *
 *   node scripts/unicode-tables.ts           write the TypeScript tables (`pnpm unicode:export` runs the Python export first)
 *   node scripts/unicode-tables.ts --check   exit 1 if the committed TypeScript differs from what the JSON gives
 *                                            (`pnpm unicode:check`, which then runs the Python export's own `--check`)
 *
 * Each table is written as a flat list of `(gap, span)` pairs over its sorted, inclusive `[first, last]` ranges: with
 * `next = 0` initially, a pair decodes to `first = next + gap`, `last = first + span`, then `next = last + 1`. The
 * decoder is `decodeRanges` in `packages/core/src/unicode/ranges.ts`; `packages/core/test/unicode/tables.test.ts`
 * decodes the committed file and compares it with the JSON range by range, so encoder and decoder cannot drift apart.
 * The output goes through Prettier with the repository configuration, so `format:check` and `--check` agree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const JSON_PATH = fileURLToPath(new URL('../tools/oracle/unicode_tables.json', import.meta.url));
const TS_PATH = fileURLToPath(new URL('../packages/core/src/unicode/tables.generated.ts', import.meta.url));
const MAX_CODE_POINT = 0x10ffff;

/** Tables in output order, with the doc line each exported constant gets. */
const TABLES = [
  { group: 'classes', name: 'L', doc: String.raw`\p{L} (letters)` },
  { group: 'classes', name: 'Lu', doc: String.raw`\p{Lu} (uppercase letters)` },
  { group: 'classes', name: 'Ll', doc: String.raw`\p{Ll} (lowercase letters)` },
  { group: 'classes', name: 'Lt', doc: String.raw`\p{Lt} (titlecase letters)` },
  { group: 'classes', name: 'Lm', doc: String.raw`\p{Lm} (modifier letters)` },
  { group: 'classes', name: 'Lo', doc: String.raw`\p{Lo} (other letters)` },
  { group: 'classes', name: 'M', doc: String.raw`\p{M} (marks)` },
  { group: 'classes', name: 'N', doc: String.raw`\p{N} (numbers)` },
  { group: 'classes', name: 'White_Space', doc: String.raw`White_Space (= \s of the id oracles)` },
  { group: 'normalization', name: 'cccNonZero', doc: 'Canonical_Combining_Class != 0' },
  { group: 'normalization', name: 'nfkcQcNotYes', doc: 'NFKC_Quick_Check = No or Maybe' },
] as const;
const VERSION_KEYS = ['python', 'regex', 'tiktoken', 'tokenizers', 'unicodedata'] as const;

type Range = readonly [number, number];

function fail(message: string): never {
  console.error(`unicode-tables: ${message}`);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates one table: integer ranges inside the code space, sorted, non-overlapping and non-adjacent. */
function readRanges(value: unknown, label: string): Range[] {
  if (!Array.isArray(value)) fail(`${label} is not an array`);
  let next = 0;
  return value.map((item: unknown, i) => {
    if (!Array.isArray(item) || item.length !== 2) fail(`${label}[${String(i)}] is not a [first, last] pair`);
    const [first, last] = item as unknown[];
    if (!Number.isInteger(first) || !Number.isInteger(last)) fail(`${label}[${String(i)}] holds a non-integer`);
    const a = first as number;
    const b = last as number;
    if (a < next || b < a || b > MAX_CODE_POINT)
      fail(`${label}[${String(i)}] = [${String(a)}, ${String(b)}] is out of order`);
    if (i > 0 && a === next) fail(`${label}[${String(i)}] touches the previous range (ranges must be maximal)`);
    next = b + 1;
    return [a, b] as const;
  });
}

/** `(gap, span)` pairs, see the file comment. */
function encode(ranges: readonly Range[]): number[] {
  const out: number[] = [];
  let next = 0;
  for (const [first, last] of ranges) {
    out.push(first - next, last - first);
    next = last + 1;
  }
  return out;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Builds the TypeScript source (before Prettier) from the parsed JSON document. */
function render(doc: Record<string, unknown>): string {
  const versions = doc['versions'];
  if (!isRecord(versions)) fail('versions is missing');
  if (doc['unicodeVersion'] !== '16.0.0') fail(`unicodeVersion is ${String(doc['unicodeVersion'])}, expected 16.0.0`);
  const versionEntries = VERSION_KEYS.map((key) => {
    const value = versions[key];
    if (typeof value !== 'string') fail(`versions.${key} is missing`);
    return [key, value] as const;
  });
  const lines = [
    '// GENERATED FILE — do not edit. Source: tools/oracle/unicode_tables.json (tools/oracle/export_unicode_tables.py, AD-4),',
    '// converted by scripts/unicode-tables.ts. `pnpm unicode:export` regenerates both; `pnpm unicode:check` fails on drift.',
    '/**',
    ' * Unicode 16.0 tables for the pre-tokenizer patterns (docs/design/04-engines.md §2.2–2.3) and the NFKC segment source',
    ' * map (03 §B.4). Classes come from the tiktoken class probe, cross-checked against HF tokenizers and the regex module;',
    ' * the normalization tables from Python unicodedata united with the regex module (tools/oracle/README.md § "Unicode tables").',
    ' *',
    ` * Oracle versions: ${versionEntries.map(([key, value]) => `${key} ${value}`).join(', ')}.`,
    ' *',
    ' * Encoding: each table is a flat list of (gap, span) pairs over sorted inclusive code-point ranges; with next = 0, a pair',
    ' * decodes to first = next + gap, last = first + span, then next = last + 1 (`decodeRanges` in ./ranges.ts).',
    ' */',
    '',
    '/** The Unicode version every pre-tokenizer class is pinned to (`TokenizerInfo.unicodeVersion`, AD-4). */',
    "export const UNICODE_VERSION = '16.0.0';",
    '',
    '/** Library versions of the export that produced these tables. */',
    `export const TABLE_VERSIONS = { ${versionEntries.map(([key, value]) => `${key}: '${value}'`).join(', ')} } as const;`,
  ];
  for (const { group, name, doc: label } of TABLES) {
    const section = doc[group];
    if (!isRecord(section)) fail(`${group} is missing`);
    const ranges = readRanges(section[name], `${group}.${name}`);
    const codePoints = ranges.reduce((sum, [a, b]) => sum + b - a + 1, 0);
    lines.push(
      '',
      `/** ${label}: ${plural(ranges.length, 'range')}, ${plural(codePoints, 'code point')}. */`,
      `export const ${name}: readonly number[] = [${encode(ranges).join(', ')}];`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const doc: unknown = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  if (!isRecord(doc)) fail(`${JSON_PATH} is not a JSON object`);
  const options = (await resolveConfig(TS_PATH)) ?? {};
  const generated = await format(render(doc), { ...options, filepath: TS_PATH });
  let current = '';
  try {
    current = readFileSync(TS_PATH, 'utf8');
  } catch {
    // A missing file is stale in --check mode and simply written otherwise.
  }
  if (check) {
    if (current !== generated) {
      fail('packages/core/src/unicode/tables.generated.ts is stale; run `pnpm unicode:export`');
    }
    console.log('packages/core/src/unicode/tables.generated.ts matches tools/oracle/unicode_tables.json');
    return;
  }
  if (current === generated) {
    console.log('packages/core/src/unicode/tables.generated.ts unchanged');
    return;
  }
  writeFileSync(TS_PATH, generated);
  console.log(`packages/core/src/unicode/tables.generated.ts written (${String(generated.length)} chars)`);
}

await main();
