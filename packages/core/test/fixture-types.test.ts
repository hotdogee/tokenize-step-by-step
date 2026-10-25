/**
 * Guards the FROZEN fixture schema (src/fixture/fixture-types.ts) against the committed fixtures: every object in every
 * fixtures/*.json file must carry exactly the keys its type declares (all required keys, no undeclared keys) with values
 * of the declared primitive types. The key lists are checked against the types at compile time, so the types, this test
 * and the data cannot drift apart.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  CtokAbsorbed,
  CtokFixture,
  CtokFixtureCase,
  CtokFixtureToken,
  FixtureCrossCheck,
  FixtureDisagreement,
  FixtureMerge,
  FixtureOracle,
  FixturePolicy,
  FixtureToken,
  SpmFixture,
  SpmFixtureCase,
  SpmFixtureToken,
  SpmPieceType,
  TiktokenFixture,
  TiktokenFixtureCase,
} from '../src/index.ts';

type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;
interface KeySpec {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

/** A key spec whose two lists must be exactly `T`'s required and optional keys (enforced by the compiler). */
function keys<T>() {
  return <const R extends ReadonlyArray<RequiredKeys<T>>, const O extends ReadonlyArray<OptionalKeys<T>>>(
    required: R & ([Exclude<RequiredKeys<T>, R[number]>] extends [never] ? unknown : never),
    optional: O & ([Exclude<OptionalKeys<T>, O[number]>] extends [never] ? unknown : never),
  ): KeySpec => ({ required: required as readonly string[], optional: optional as readonly string[] });
}

const HEADER = [
  'tokenizer',
  'lab',
  'family',
  'vocabAsset',
  'vocabSha256',
  'oracle',
  'crossCheck',
  'policy',
  'generatedOn',
  'cases',
] as const;
const SPEC = {
  tiktoken: keys<TiktokenFixture>()(HEADER, ['normalizedNFKC']),
  spm: keys<SpmFixture>()(HEADER, []),
  ctok: keys<CtokFixture>()(
    [
      ...HEADER,
      'version',
      'ctokFamily',
      'aliases',
      'models',
      'sourceModel',
      'frame',
      'dataFile',
      'vocabSha256Of',
      'wheelSha256',
      'vocabSize',
      'vocabGroups',
      'byteFallbackPieces',
      'normalization',
      'knownGaps',
      'versionRouting',
      'caveat',
      'description',
    ],
    [],
  ),
  oracle: keys<FixtureOracle>()(['library', 'version'], []),
  crossCheck: keys<FixtureCrossCheck>()(
    ['library', 'version', 'agreedCases', 'disagreedCases'],
    ['vocabAsset', 'vocabSha256', 'disagreements', 'scope'],
  ),
  disagreement: keys<FixtureDisagreement>()(['name', 'ids', 'crossCheckIds', 'explanation'], []),
  policy: keys<FixturePolicy>()(['specialTokens', 'addBos', 'notes'], []),
  tiktokenCase: keys<TiktokenFixtureCase>()(
    ['name', 'text', 'utf8Len', 'ids', 'tokens', 'chunks', 'merges'],
    ['idsWithSpecials'],
  ),
  spmCase: keys<SpmFixtureCase>()(['name', 'text', 'utf8Len', 'ids', 'tokens'], ['idsWithSpecials']),
  ctokCase: keys<CtokFixtureCase>()(
    ['name', 'text', 'utf8Len', 'ids', 'tokens', 'pieces', 'frameCount', 'contentCount', 'totalCount'],
    ['spansNullReason', 'nfcText', 'absorbed'],
  ),
  token: keys<FixtureToken>()(['id', 'bytes', 'start', 'end', 'partial', 'zeroWidth'], []),
  spmToken: keys<SpmFixtureToken>()(['id', 'bytes', 'start', 'end', 'partial', 'zeroWidth', 'piece', 'type'], []),
  ctokToken: keys<CtokFixtureToken>()(['id', 'bytes', 'start', 'end', 'partial', 'zeroWidth', 'piece'], []),
  merge: keys<FixtureMerge>()(['chunk', 'directHit', 'steps'], []),
  absorbed: keys<CtokAbsorbed>()(['start', 'end', 'reason', 'token'], []),
} as const;

const PIECE_TYPES: readonly SpmPieceType[] = ['NORMAL', 'USER_DEFINED', 'BYTE', 'CONTROL', 'UNK', 'UNUSED'];
const FIXTURES_DIR = new URL('../../../fixtures/', import.meta.url);

type Json = Readonly<Record<string, unknown>>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIntArray = (value: unknown): boolean => Array.isArray(value) && value.every((v) => Number.isInteger(v));
const isPairArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2 && isIntArray(pair));

/** Collects human-readable schema violations. */
class Checker {
  readonly problems: string[] = [];

  object(value: unknown, spec: KeySpec, path: string): value is Json {
    if (!isObject(value)) {
      this.problems.push(`${path}: not an object`);
      return false;
    }
    for (const key of spec.required) if (!(key in value)) this.problems.push(`${path}: missing "${key}"`);
    for (const key of Object.keys(value)) {
      if (!spec.required.includes(key) && !spec.optional.includes(key))
        this.problems.push(`${path}: undeclared "${key}"`);
    }
    return true;
  }

  expect(ok: boolean, path: string, what: string): void {
    if (!ok) this.problems.push(`${path}: expected ${what}`);
  }

  token(value: unknown, spec: KeySpec, path: string, idIsNull: boolean): void {
    if (!this.object(value, spec, path)) return;
    this.expect(
      idIsNull ? value['id'] === null : Number.isInteger(value['id']),
      `${path}.id`,
      idIsNull ? 'null' : 'an integer',
    );
    this.expect(
      typeof value['bytes'] === 'string' && /^(?:[0-9a-f]{2})*$/.test(value['bytes']),
      `${path}.bytes`,
      'lowercase hex',
    );
    this.expect(Number.isInteger(value['start']) && Number.isInteger(value['end']), `${path}.start/end`, 'integers');
    this.expect(
      typeof value['partial'] === 'boolean' && typeof value['zeroWidth'] === 'boolean',
      `${path}.partial/zeroWidth`,
      'booleans',
    );
    if (spec.required.includes('piece')) this.expect(typeof value['piece'] === 'string', `${path}.piece`, 'a string');
    if (spec === SPEC.spmToken)
      this.expect(PIECE_TYPES.includes(value['type'] as SpmPieceType), `${path}.type`, 'an SpmPieceType');
  }

  commonCase(value: Json, path: string): void {
    this.expect(typeof value['name'] === 'string' && typeof value['text'] === 'string', `${path}.name/text`, 'strings');
    this.expect(Number.isInteger(value['utf8Len']), `${path}.utf8Len`, 'an integer');
  }

  header(fixture: Json, path: string): void {
    this.object(fixture['oracle'], SPEC.oracle, `${path}.oracle`);
    if (this.object(fixture['crossCheck'], SPEC.crossCheck, `${path}.crossCheck`)) {
      const disagreements = fixture['crossCheck']['disagreements'];
      if (Array.isArray(disagreements)) {
        disagreements.forEach((d, i) => {
          this.object(d, SPEC.disagreement, `${path}.crossCheck.disagreements[${String(i)}]`);
        });
      }
    }
    if (this.object(fixture['policy'], SPEC.policy, `${path}.policy`)) {
      const special = fixture['policy']['specialTokens'];
      this.expect(
        special === 'as-text' || special === 'user-defined-atomic',
        `${path}.policy.specialTokens`,
        'a known policy',
      );
    }
  }

  tiktokenCase(value: unknown, path: string): void {
    if (!this.object(value, SPEC.tiktokenCase, path)) return;
    this.commonCase(value, path);
    this.expect(isIntArray(value['ids']), `${path}.ids`, 'integers');
    this.expect(isPairArray(value['chunks']), `${path}.chunks`, '[start, end] pairs');
    this.tokens(value['tokens'], SPEC.token, path, false);
    const merges = value['merges'];
    if (Array.isArray(merges)) {
      merges.forEach((m, i) => {
        const mergePath = `${path}.merges[${String(i)}]`;
        if (this.object(m, SPEC.merge, mergePath))
          this.expect(isPairArray(m['steps']), `${mergePath}.steps`, '[position, rank] pairs');
      });
    }
  }

  spmCase(value: unknown, path: string): void {
    if (!this.object(value, SPEC.spmCase, path)) return;
    this.commonCase(value, path);
    this.expect(isIntArray(value['ids']), `${path}.ids`, 'integers');
    this.tokens(value['tokens'], SPEC.spmToken, path, false);
  }

  ctokCase(value: unknown, path: string): void {
    if (!this.object(value, SPEC.ctokCase, path)) return;
    this.commonCase(value, path);
    const ids = value['ids'];
    this.expect(ids === null || (Array.isArray(ids) && ids.every((id) => id === null)), `${path}.ids`, 'null or nulls');
    const tokens = value['tokens'];
    if (tokens === null)
      this.expect(typeof value['spansNullReason'] === 'string', `${path}.spansNullReason`, 'a reason');
    else this.tokens(tokens, SPEC.ctokToken, path, true);
    const absorbed = value['absorbed'];
    if (Array.isArray(absorbed)) {
      absorbed.forEach((a, i) => {
        this.object(a, SPEC.absorbed, `${path}.absorbed[${String(i)}]`);
      });
    }
  }

  tokens(value: unknown, spec: KeySpec, path: string, idIsNull: boolean): void {
    if (!Array.isArray(value)) {
      this.problems.push(`${path}.tokens: not an array`);
      return;
    }
    value.forEach((token, i) => {
      this.token(token, spec, `${path}.tokens[${String(i)}]`, idIsNull);
    });
  }
}

const files = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort();

describe('golden fixtures match the FROZEN fixture types', () => {
  it('finds the committed fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files)('%s', (file) => {
    const fixture: unknown = JSON.parse(readFileSync(new URL(file, FIXTURES_DIR), 'utf8'));
    const check = new Checker();
    if (!isObject(fixture)) throw new Error(`${file}: not an object`);
    const family = fixture['family'];
    const spec = family === 'tiktoken-bpe' ? SPEC.tiktoken : family === 'sentencepiece-bpe' ? SPEC.spm : SPEC.ctok;
    if (check.object(fixture, spec, file)) {
      check.expect(
        family === 'tiktoken-bpe' || family === 'sentencepiece-bpe' || family === 'ctok-tiling',
        `${file}.family`,
        'a known family',
      );
      check.expect(fixture['tokenizer'] === file.replace(/\.json$/, ''), `${file}.tokenizer`, 'the file name');
      check.header(fixture, file);
      const lists: Array<[string, unknown]> = [
        ['cases', fixture['cases']],
        ['normalizedNFKC', fixture['normalizedNFKC'] ?? []],
      ];
      for (const [listName, list] of lists) {
        check.expect(Array.isArray(list), `${file}.${listName}`, 'an array');
        if (!Array.isArray(list)) continue;
        list.forEach((c, i) => {
          const path = `${file}.${listName}[${String(i)}]`;
          if (family === 'tiktoken-bpe') check.tiktokenCase(c, path);
          else if (family === 'sentencepiece-bpe') check.spmCase(c, path);
          else check.ctokCase(c, path);
        });
      }
    }
    expect(check.problems.slice(0, 20)).toEqual([]);
  });
});
