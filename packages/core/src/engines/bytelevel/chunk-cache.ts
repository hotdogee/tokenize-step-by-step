/**
 * Chunk-result cache (04 §2.5, AD-21): an LRU of merged chunks bounded by BYTES, not entries — total payload ≤ 2 MiB and
 * only chunks ≤ 256 bytes are cached, because a CJK paragraph is one chunk that never repeats (an entry-count bound would
 * hold gigabytes there). Re-tokenizing Latin text on a keystroke then costs only the edited chunks.
 *
 * An entry holds the token ids and the merge steps as `(left, mid, resultId)` triples relative to the chunk start, so a
 * hit can replay the timeline exactly (the merged part's end is recovered by replaying the steps). Keys: the latin1
 * string of the chunk bytes when it is ≤ 64 bytes, else two 32-bit FNV-1a lanes behind a `U+0100` prefix (a code unit no
 * latin1 key contains); hashed entries keep their bytes and a hit is verified byte for byte, so a hash collision costs a
 * recompute, never a wrong result. Only results of the merge path are cached (direct hits are one lookup anyway).
 */
import { fnv1a32 } from '../../format/byte-vocab.ts';

/** Default payload bound (2 MiB). */
export const CHUNK_CACHE_MAX_BYTES = 2 * 1024 * 1024;
/** Longest chunk (in bytes) that is cached. */
export const CHUNK_CACHE_MAX_CHUNK = 256;
/** Chunks up to this length are keyed by their latin1 string. */
const LATIN1_KEY_MAX = 64;
/** Accounted per entry on top of its arrays and key (Map slot, object header, typed-array headers). */
const ENTRY_OVERHEAD = 96;

/** A cached merge result. */
export interface CachedChunk {
  /** Token ids of the chunk, in order. */
  readonly ids: Uint32Array;
  /** Merge steps as `(left, mid, resultId)` triples, offsets relative to the chunk start, in execution order. */
  readonly steps: Int32Array;
}

interface Entry extends CachedChunk {
  /** The chunk bytes (hashed keys only). */
  readonly bytes: Uint8Array | null;
  /** Accounted size in bytes. */
  readonly size: number;
}

/** Second FNV-1a lane: a different offset basis over the same bytes. */
function fnv1a32Alt(buf: Uint8Array, start: number, end: number): number {
  let h = 0x9747b28c | 0;
  for (let i = start; i < end; i++) h = Math.imul(h ^ (buf[i] ?? 0), 0x01000193);
  return h;
}

function keyOf(buf: Uint8Array, start: number, end: number): string {
  if (end - start <= LATIN1_KEY_MAX) return String.fromCharCode(...buf.subarray(start, end));
  return `Ā${String(fnv1a32(buf, start, end))}:${String(fnv1a32Alt(buf, start, end))}`;
}

function sameBytes(a: Uint8Array, buf: Uint8Array, start: number, end: number): boolean {
  if (a.length !== end - start) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== buf[start + i]) return false;
  return true;
}

export class ChunkCache {
  /** Payload bound in bytes. */
  readonly maxBytes: number;
  private readonly map = new Map<string, Entry>();
  private total = 0;

  constructor(maxBytes: number = CHUNK_CACHE_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  /** Accounted payload currently held (always ≤ `maxBytes`). */
  get bytes(): number {
    return this.total;
  }

  /** Number of cached chunks. */
  get size(): number {
    return this.map.size;
  }

  /** The cached result for `buf[start, end)`, refreshed as most recently used; null on a miss or an uncacheable length. */
  get(buf: Uint8Array, start: number, end: number): CachedChunk | null {
    if (end - start > CHUNK_CACHE_MAX_CHUNK) return null;
    const key = keyOf(buf, start, end);
    const entry = this.map.get(key);
    if (entry === undefined) return null;
    if (entry.bytes !== null && !sameBytes(entry.bytes, buf, start, end)) return null;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  /** Stores the result for `buf[start, end)` (ignored above `CHUNK_CACHE_MAX_CHUNK`), evicting least recently used entries. */
  put(buf: Uint8Array, start: number, end: number, ids: Uint32Array, steps: Int32Array): void {
    if (end - start > CHUNK_CACHE_MAX_CHUNK) return;
    const key = keyOf(buf, start, end);
    const bytes = end - start > LATIN1_KEY_MAX ? buf.slice(start, end) : null;
    const size = ids.byteLength + steps.byteLength + (bytes?.byteLength ?? 0) + 2 * key.length + ENTRY_OVERHEAD;
    if (size > this.maxBytes) return;
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      this.total -= old.size;
    }
    this.map.set(key, { ids, steps, bytes, size });
    this.total += size;
    for (const [oldest, entry] of this.map) {
      if (this.total <= this.maxBytes) break;
      this.map.delete(oldest);
      this.total -= entry.size;
    }
  }

  /** Drops every entry (`Tokenizer.dispose`). */
  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}
