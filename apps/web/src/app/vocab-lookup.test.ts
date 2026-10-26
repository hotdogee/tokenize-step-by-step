import type { LookupEntry, TokenizerId } from '@tsbs/core';
import { describe, expect, it } from 'vitest';
import { TokenizationView } from '@tsbs/core/model/view';
import { caseResult } from '../board/fixture-results.test-helper.ts';
import { flush } from './fake-client.test-helper.ts';
import { VocabLookup, type LookupClient } from './vocab-lookup.ts';

/** A lookup client over a tiny vocabulary: single bytes are ids 1000 + byte, anything longer is unknown. */
function client(resident: TokenizerId | null): LookupClient & { readonly requests: number[] } {
  const requests: number[] = [];
  return {
    resident,
    requests,
    lookup(q) {
      requests.push(1);
      const entries: LookupEntry[] = (q.ids ?? []).map((id) => ({ id, bytes: null, piece: `▁${String(id)}` }));
      if (q.bytes !== undefined)
        entries.push({ id: q.bytes.length === 1 ? 1000 + (q.bytes[0] ?? 0) : null, bytes: q.bytes, piece: null });
      return Promise.resolve(entries);
    },
  };
}

describe('VocabLookup (the view resolvers over the Worker lookup)', () => {
  it('resolves nothing for a tokenizer that is not resident', () => {
    const lookup = new VocabLookup(client(null), () => undefined);
    expect(lookup.resolversFor(caseResult('openai-o200k_base', 'zh-tw-tainan'))).toEqual({});
  });

  it('answers misses with null, batches them, bumps the version once and serves the cache afterwards', async () => {
    const fake = client('openai-cl100k_base');
    let version = 0;
    const lookup = new VocabLookup(fake, () => {
      version++;
    });
    const result = caseResult('openai-cl100k_base', 'zh-tw-tainan');
    const { idOf, pieceOf } = lookup.resolversFor(result);
    expect(idOf?.(Uint8Array.of(0xe5))).toBeNull();
    expect(idOf?.(Uint8Array.of(0xe5, 0x8f))).toBeNull();
    expect(pieceOf?.(7)).toBeNull();
    expect(version).toBe(0);
    await flush();
    expect(version).toBe(1);
    expect(fake.requests).toHaveLength(3); // one ids batch + one per byte string
    expect(idOf?.(Uint8Array.of(0xe5))).toBe(1000 + 0xe5);
    expect(idOf?.(Uint8Array.of(0xe5, 0x8f))).toBeNull(); // known absent: never asked again
    expect(pieceOf?.(7)).toBe('▁7');
    await flush();
    expect(fake.requests).toHaveLength(3);
  });

  it('gives a view the ids of parts before their first merge (stop 4 of a byte-level result)', async () => {
    const lookup = new VocabLookup(client('openai-cl100k_base'), () => undefined);
    const result = caseResult('openai-cl100k_base', 'zh-tw-tainan');
    const before = new TokenizationView(result, lookup.resolversFor(result)).partsAt(0);
    expect(before.partId.includes(-1)).toBe(true);
    await flush();
    const after = new TokenizationView(result, lookup.resolversFor(result)).partsAt(0);
    expect([...after.partId].every((id) => id >= 0)).toBe(true);
  });
});
