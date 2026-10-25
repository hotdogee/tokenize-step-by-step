/**
 * Browser-parity harness page (06 §1 "Browser parity", 04 §7) — BROWSER code. `parity/serve.ts` bundles it with esbuild
 * and serves it at `/__parity/` through Playwright routing under the production CSP, so it never ships in `dist`.
 *
 * Skeleton (WP11 first pass): platform features the engines rely on, UTF-8 encoding and the gzip stream path. The
 * `compilePattern` chunk test (WP02) and `DecompressionStream` + `readTsbv1` of the o200k `.bin` (WP02/WP03) are added in
 * WP11's wave-3 pass; `coreExports()` lets the specs see which `@tsbs/core` functions exist.
 */
import * as core from '@tsbs/core';

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

/** What `window.tsbsParity` offers the specs. */
export interface ParityApi {
  features(): ParityFeatures;
  /** Names of the function exports of `@tsbs/core`, sorted. */
  coreExports(): string[];
  /** Lower-case hex of `TextEncoder` output for each text. */
  utf8Hex(texts: readonly string[]): string[];
  /** gzip with `CompressionStream`, gunzip with `DecompressionStream`; returns the hex that came back. */
  gzipRoundTrip(hex: string): Promise<string>;
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
): Promise<Uint8Array> {
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
    const restored = await pipe(new Uint8Array(gzipped), new DecompressionStream('gzip'));
    return toHex(restored);
  },
};

window.tsbsParity = api;
document.documentElement.dataset['ready'] = 'true';
