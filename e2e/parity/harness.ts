/**
 * Browser-parity harness page (06 §1 "Browser parity", 04 §7) — BROWSER code. `parity/serve.ts` bundles it with esbuild
 * and serves it at `/__parity/` through Playwright routing under the production CSP, so it never ships in `dist`.
 *
 * What each engine (chromium, firefox, webkit) runs here, through the production code paths:
 * - the platform features the loader and engines rely on, UTF-8 encoding and the gzip stream round trip;
 * - `compilePattern` (WP02, pinned Unicode 16.0 classes) chunking fixture texts into UTF-8 byte spans, which the spec
 *   compares with every fixture's `cases[].chunks` (the oracle's pre-tokenizer matches);
 * - a vocabulary asset read the way the Worker loader reads it (AD-10, AD-37): `fetch` from the page's origin,
 *   `crypto.subtle` sha256 of the wire bytes, `DecompressionStream('gzip')`, `readTsbv1`, then `ByteVocab` lookups.
 */
import * as core from '@tsbs/core';
import { readTsbv1 } from '@tsbs/core/format/tsbv1';
import { compilePattern } from '@tsbs/core/unicode/expand';
import type { PatternKey } from '@tsbs/core/unicode/patterns';
import { pieceDigest, utf8Offsets } from './digest.ts';

/** Platform features probed in each engine. */
export interface ParityFeatures {
  readonly textEncoder: boolean;
  /** `DecompressionStream('gzip')`: the vocabulary loader's path (AD-10; Safari 16.4 floor). */
  readonly decompressionGzip: boolean;
  readonly compressionGzip: boolean;
  /** `crypto.subtle` (asset sha256; absent in insecure contexts, AD-37). */
  readonly subtleCrypto: boolean;
  /** `Intl.Segmenter` (grapheme brackets; the fallback path covers its absence, PD-4). Informational. */
  readonly segmenter: boolean;
  readonly userAgent: string;
}

/** A UTF-8 byte span `[start, end)`, the fixture's `ByteSpan` form. */
export type Span = [start: number, end: number];

/** What `readVocab` saw: the wire layer, the container and the lookups. */
export interface VocabReport {
  /** sha256 (hex) of the bytes as fetched (`crypto.subtle`). */
  readonly sha256: string;
  readonly compressedBytes: number;
  /** Size after `DecompressionStream('gzip')`. */
  readonly rawBytes: number;
  /** First four bytes of the gunzipped container as ASCII (`TSBV`). */
  readonly magic: string;
  readonly tokenizerId: string;
  readonly family: string;
  /** `ByteVocab.count` (PCES entries). */
  readonly count: number;
  readonly maxPieceBytes: number;
  readonly specials: ReadonlyArray<{ readonly id: number; readonly text: string }>;
  /** FNV-1a 32 over every piece (length byte, then the bytes), hex: one value for the whole decoded table. */
  readonly pieceDigest: string;
  /** `ByteVocab.indexOf` of each requested hex byte string (−1 when absent). */
  readonly indices: readonly number[];
}

/** What `window.tsbsParity` offers the specs. */
export interface ParityApi {
  features(): ParityFeatures;
  /** Names of the function exports of `@tsbs/core`, sorted. */
  coreExports(): string[];
  /** Lower-case hex of `TextEncoder` output for each text. */
  utf8Hex(texts: readonly string[]): string[];
  /** gzip with `CompressionStream`, gunzip with `DecompressionStream`; returns the hex that came back. */
  gzipRoundTrip(hex: string): Promise<string>;
  /** UTF-8 byte spans of the `key` pre-tokenizer's matches in each text (`compilePattern`, pinned Unicode 16.0). */
  chunkSpans(key: PatternKey, texts: readonly string[]): Span[][];
  /** Fetches the asset at `path` (same origin) and reads it as the Worker loader does; looks up `lookups` (hex). */
  readVocab(path: string, lookups: readonly string[]): Promise<VocabReport>;
}

declare global {
  interface Window {
    tsbsParity?: ParityApi;
  }
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

function works(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch {
    return false;
  }
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const api: ParityApi = {
  features: () => ({
    textEncoder: typeof TextEncoder === 'function',
    decompressionGzip: works(() => new DecompressionStream('gzip')),
    compressionGzip: works(() => new CompressionStream('gzip')),
    subtleCrypto: typeof crypto !== 'undefined' && typeof crypto.subtle === 'object',
    segmenter: typeof Intl.Segmenter === 'function',
    userAgent: navigator.userAgent,
  }),
  coreExports: () =>
    Object.entries(core)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort(),
  utf8Hex: (texts) => {
    const encoder = new TextEncoder();
    return texts.map((text) => toHex(encoder.encode(text)));
  },
  gzipRoundTrip: async (hex) => {
    const gzipped = await pipe(fromHex(hex), new CompressionStream('gzip'));
    const restored = await pipe(gzipped, new DecompressionStream('gzip'));
    return toHex(restored);
  },
  chunkSpans: (key, texts) => {
    const { regex } = compilePattern(key);
    return texts.map((text) => {
      const offsets = utf8Offsets(text);
      regex.lastIndex = 0;
      return [...text.matchAll(regex)].map((match): Span => {
        const start = match.index;
        return [offsets[start] ?? -1, offsets[start + match[0].length] ?? -1];
      });
    });
  },
  readVocab: async (path, lookups) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${String(response.status)}`);
    const wire = new Uint8Array(await response.arrayBuffer());
    const sha256 = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', wire)));
    const raw = await pipe(wire, new DecompressionStream('gzip'));
    const tsbv = readTsbv1(raw.buffer);
    const { vocab } = tsbv;
    return {
      sha256,
      compressedBytes: wire.length,
      rawBytes: raw.length,
      magic: String.fromCharCode(...raw.subarray(0, 4)),
      tokenizerId: tsbv.meta.tokenizerId,
      family: tsbv.family,
      count: vocab.count,
      maxPieceBytes: tsbv.meta.maxPieceBytes,
      specials: tsbv.specials.map(({ id, text }) => ({ id, text })),
      pieceDigest: pieceDigest(vocab.count, (index) => vocab.bytesOf(index)),
      indices: lookups.map((hex) => {
        const bytes = fromHex(hex);
        return vocab.indexOf(bytes, 0, bytes.length);
      }),
    };
  },
};

window.tsbsParity = api;
document.documentElement.dataset['ready'] = 'true';
