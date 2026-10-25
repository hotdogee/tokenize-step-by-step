/**
 * Engine A building blocks in isolation: the byte-bounded chunk cache (04 §2.5; never above 2 MiB), the `PretokenizeError`
 * path (04 §5), the source-order specials matcher (AD-12), `RankPriority`'s `maxPieceBytes` bound, and the engine-level
 * cache bound on a long Latin text with many distinct chunks.
 */
import { describe, expect, it } from 'vitest';
import {
  CHUNK_CACHE_MAX_BYTES,
  CHUNK_CACHE_MAX_CHUNK,
  ChunkCache,
} from '../../../src/engines/bytelevel/chunk-cache.ts';
import { emptyPlan, PretokenizeError, pretokenizeSegment } from '../../../src/engines/bytelevel/pretokenize.ts';
import { RankPriority } from '../../../src/engines/bytelevel/priority.ts';
import { SpecialsMatcher } from '../../../src/engines/bytelevel/specials.ts';
import { NO_MERGE, type ByteVocab } from '../../../src/index.ts';
import { analyzeText } from '../../../src/text/analyze.ts';
import { compilePattern, NO_RULE, type CompiledPattern } from '../../../src/unicode/expand.ts';
import { SKIP_REASON, tokenizerFor } from './assets.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('ChunkCache', () => {
  it('round-trips short (latin1-keyed) and long (hashed) chunks and refreshes on hit', () => {
    const cache = new ChunkCache();
    const short = bytes('xx hello');
    const long = bytes(`  ${'abcdefgh'.repeat(20)}`);
    cache.put(short, 2, 8, Uint32Array.of(1, 2), Int32Array.of(0, 1, 7));
    cache.put(long, 2, long.length, Uint32Array.of(3), Int32Array.of());
    expect(cache.get(bytes('.. hello'), 2, 8)?.ids).toEqual(Uint32Array.of(1, 2));
    expect(cache.get(long, 2, long.length)?.ids).toEqual(Uint32Array.of(3));
    expect(cache.size).toBe(2);
  });

  it('verifies hashed hits byte for byte and never caches chunks above 256 bytes', () => {
    const cache = new ChunkCache();
    const a = bytes('a'.repeat(100));
    cache.put(a, 0, 100, Uint32Array.of(9), Int32Array.of());
    const b = bytes(`${'a'.repeat(99)}b`);
    expect(cache.get(b, 0, 100)).toBeNull();
    const huge = new Uint8Array(CHUNK_CACHE_MAX_CHUNK + 1);
    cache.put(huge, 0, huge.length, Uint32Array.of(1), Int32Array.of());
    expect(cache.get(huge, 0, huge.length)).toBeNull();
    expect(cache.size).toBe(1);
  });

  it('evicts least recently used entries to stay within its byte bound', () => {
    const cache = new ChunkCache(4096);
    const keys: Uint8Array[] = [];
    for (let i = 0; i < 200; i++) {
      const key = bytes(`chunk-${String(i).padStart(4, '0')}`);
      keys.push(key);
      cache.put(key, 0, key.length, new Uint32Array(8), new Int32Array(24));
      if (i === 5) expect(cache.get(keys[0]!, 0, keys[0]!.length)).not.toBeNull(); // refresh the first entry
      expect(cache.bytes).toBeLessThanOrEqual(4096);
    }
    expect(cache.size).toBeLessThan(200);
    expect(cache.get(keys[199]!, 0, keys[199]!.length)).not.toBeNull();
    expect(cache.get(keys[1]!, 0, keys[1]!.length)).toBeNull();
    cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });

  it('defaults to 2 MiB', () => {
    expect(new ChunkCache().maxBytes).toBe(CHUNK_CACHE_MAX_BYTES);
    expect(CHUNK_CACHE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('PretokenizeError (04 §5)', () => {
  /** A deliberately broken pattern: letters only, so a space leaves a gap. */
  const lettersOnly: CompiledPattern = {
    ...compilePattern('o200k'),
    regex: /[a-z]+/gu,
    alternatives: [/[a-z]+/uy],
  };

  it('reports the byte offset where the matches stop tiling', () => {
    const analysis = analyzeText('台ab cd');
    const plan = emptyPlan();
    let error: unknown;
    try {
      pretokenizeSegment(lettersOnly, analysis.text, 0, analysis.text.length, analysis.utf16ToByte, true, plan);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PretokenizeError);
    expect((error as PretokenizeError).offset).toBe(0);
    expect((error as PretokenizeError).name).toBe('PretokenizeError');
    expect((error as PretokenizeError).code).toBe('pretokenize');
    const tail = emptyPlan();
    expect(() => {
      pretokenizeSegment(lettersOnly, analysis.text, 1, analysis.text.length, analysis.utf16ToByte, true, tail);
    }).toThrow(expect.objectContaining({ offset: 5 }) as Error);
    expect(tail.start).toEqual([3]);
    expect(tail.rule).toEqual([0]);
  });

  it('a regex that matches nothing at the end of a segment throws too', () => {
    const analysis = analyzeText('ab!');
    expect(() => {
      pretokenizeSegment(lettersOnly, analysis.text, 0, 3, analysis.utf16ToByte, false, emptyPlan());
    }).toThrow(expect.objectContaining({ offset: 2 }) as Error);
  });

  it.skipIf(SKIP_REASON !== null)('surfaces from encode() and encodeIncremental()', () => {
    const tokenizer = tokenizerFor('openai-o200k_base', { pattern: lettersOnly });
    expect(() => tokenizer.encode('ab cd')).toThrow(PretokenizeError);
    expect(() => [...tokenizer.encodeIncremental('ab cd')]).toThrow(PretokenizeError);
    expect(tokenizer.encode('abcd').chunks.rule[0]).toBe(0);
  });

  it('the shipped patterns never leave NO_RULE on a traced chunk', () => {
    const analysis = analyzeText("I'm 台灣 2024!\r\n  \t x");
    const plan = emptyPlan();
    pretokenizeSegment(
      compilePattern('o200k'),
      analysis.text,
      0,
      analysis.text.length,
      analysis.utf16ToByte,
      true,
      plan,
    );
    expect(plan.rule.every((rule) => rule !== NO_RULE)).toBe(true);
  });
});

describe('SpecialsMatcher (AD-12 source order)', () => {
  it('is leftmost-first: the special listed first wins where two start at the same offset', () => {
    const longFirst = new SpecialsMatcher([
      { id: 1, text: '<|eot|>' },
      { id: 2, text: '<|eot' },
    ]);
    expect(longFirst.find('a<|eot|>b')).toEqual([{ start: 1, end: 8, id: 1 }]);
    const shortFirst = new SpecialsMatcher([
      { id: 2, text: '<|eot' },
      { id: 1, text: '<|eot|>' },
    ]);
    expect(shortFirst.find('a<|eot|>b')).toEqual([{ start: 1, end: 6, id: 2 }]);
  });

  it('escapes regex syntax and finds non-overlapping matches left to right', () => {
    const m = new SpecialsMatcher([
      { id: 7, text: '[BOS]' },
      { id: 8, text: '<|a.b|>' },
      { id: 9, text: '' },
    ]);
    expect(m.find('[BOS]x<|a.b|>[BOS]<|aXb|>')).toEqual([
      { start: 0, end: 5, id: 7 },
      { start: 6, end: 13, id: 8 },
      { start: 13, end: 18, id: 7 },
    ]);
    expect(new SpecialsMatcher([]).find('anything')).toEqual([]);
  });
});

describe('RankPriority', () => {
  /** A counting vocabulary: every slice is "piece 7". */
  function countingVocab(): ByteVocab & { readonly calls: number } {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      count: 8,
      offsets: new Uint32Array(9),
      bytes: new Uint8Array(0),
      indexOf: () => {
        calls++;
        return 7;
      },
      bytesOf: () => new Uint8Array(0),
      pieceOf: () => null,
    };
  }

  it('returns NO_MERGE for slices above maxPieceBytes without hashing; mergedId = rank + idOffset, one lookup per merge', () => {
    const vocab = countingVocab();
    const prio = new RankPriority(vocab, new Uint8Array(64), 4, 128);
    expect(prio.priority(0, 3, 5)).toBe(NO_MERGE);
    expect(vocab.calls).toBe(0);
    expect(prio.priority(0, 2, 4)).toBe(7);
    expect(prio.mergedId(0, 2, 4)).toBe(135);
    expect(vocab.calls).toBe(1);
    expect(prio.mergedId(1, 2, 4)).toBe(135);
    expect(vocab.calls).toBe(2);
  });
});

describe.skipIf(SKIP_REASON !== null)('the engine cache stays within 2 MiB', () => {
  it('on 40,000 distinct words (each its own chunk), and cached results equal fresh ones', () => {
    const o200k = tokenizerFor('openai-o200k_base');
    const fresh = tokenizerFor('openai-o200k_base', { cacheBytes: 0 });
    // deterministic pseudo-words that are mostly not single tokens (so the merge path, and the cache, run)
    let seed = 12345;
    const word = (): string => {
      let w = ' ';
      const len = 6 + (seed % 9);
      for (let i = 0; i < len; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        w += String.fromCharCode(97 + (seed % 26));
      }
      return w;
    };
    const words = Array.from({ length: 40_000 }, word);
    for (let i = 0; i < words.length; i += 2000) {
      const text = words.slice(i, i + 2000).join('');
      const r = o200k.encode(text);
      expect(o200k.cacheBytes).toBeLessThanOrEqual(CHUNK_CACHE_MAX_BYTES);
      if (i % 10_000 === 0) expect(Array.from(r.tokens.id)).toEqual(Array.from(fresh.encode(text).tokens.id));
    }
    expect(o200k.cacheBytes).toBeGreaterThan(CHUNK_CACHE_MAX_BYTES * 0.9);
    expect(fresh.cacheBytes).toBe(0);
  });
});
