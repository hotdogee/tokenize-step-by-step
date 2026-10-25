import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as core from '@tsbs/core';
import { loadReadTsbv1, READER_SUBPATH, type ReaderLoader } from '../src/core-reader.ts';
import { REPO } from './support/repo.ts';

const notFound = (): never => {
  throw Object.assign(new Error(`Cannot find module '${READER_SUBPATH}'`), { code: 'MODULE_NOT_FOUND' });
};
const reader = (): never => {
  throw new Error('fake reader');
};

function loader(resolve: () => string, load: () => Promise<unknown> = () => Promise.resolve({})): ReaderLoader {
  return { resolve, load };
}

describe('loadReadTsbv1', () => {
  it('prefers the design subpath @tsbs/core/format/tsbv1 over a root export', async () => {
    const lookup = await loadReadTsbv1(
      { readTsbv1: () => null },
      loader(
        () => 'format/tsbv1.ts',
        () => Promise.resolve({ readTsbv1: reader }),
      ),
    );
    expect(lookup).toEqual({ kind: 'found', read: reader, from: READER_SUBPATH });
  });

  it('falls back to a root re-export, and is absent only when neither exists', async () => {
    expect(await loadReadTsbv1({ readTsbv1: reader }, loader(notFound))).toEqual({
      kind: 'found',
      read: reader,
      from: '@tsbs/core',
    });
    const absent = await loadReadTsbv1({}, loader(notFound));
    expect(absent.kind).toBe('absent');
  });

  it('throws when the reader module exists but is broken (never reported as absent)', async () => {
    await expect(
      loadReadTsbv1(
        {},
        loader(() => 'format/tsbv1.ts'),
      ),
    ).rejects.toThrow(/does not export a readTsbv1/);
    await expect(
      loadReadTsbv1(
        {},
        loader(
          () => 'format/tsbv1.ts',
          () => Promise.reject(new Error('syntax error')),
        ),
      ),
    ).rejects.toThrow(/syntax error/);
    await expect(
      loadReadTsbv1(
        {},
        loader(() => {
          throw new Error('EACCES');
        }),
      ),
    ).rejects.toThrow(/EACCES/);
  });

  it('finds the real reader exactly when packages/core/src/format/tsbv1.ts exists', async () => {
    const lookup = await loadReadTsbv1(core);
    const present = existsSync(join(REPO, 'packages', 'core', 'src', 'format', 'tsbv1.ts'));
    expect(lookup.kind).toBe(present ? 'found' : 'absent');
  });
});
