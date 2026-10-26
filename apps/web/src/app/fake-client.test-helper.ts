/**
 * Test-only: a `TokenizerClientLike` whose every `load` and `encode` is a promise the test settles by hand, and a
 * synthetic result builder (one chunk, one token per code point, ids = code points) for texts no fixture has. Never
 * imported by app code.
 */
import type {
  AssetSummary,
  EncodeOptions,
  Features,
  LoadedInfo,
  LookupEntry,
  Progress,
  TokenizationResult,
  TokenizerClientLike,
  TokenizerId,
} from '@tsbs/core';
import { buildResult } from '@tsbs/core/model/build-result';
import { CancelledError } from '@tsbs/core/model/cancelled';
import { ChunkKind, TokenKind } from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';
import { tokenizerEntry } from './registry.ts';

/** One chunk, one token per code point (id = the code point), no timeline unless `steps` asks for one. */
export function syntheticResult(
  text: string,
  tokenizer: TokenizerId,
  options: Partial<EncodeOptions> = {},
  seq = 0,
): TokenizationResult {
  const analysis = analyzeText(text);
  const n = analysis.utf8.length;
  const count = analysis.chars.count;
  const byteStart = Array.from({ length: count + 1 }, (_, i) => analysis.chars.byteStart[i] ?? n);
  return buildResult({
    tokenizer,
    family: tokenizerEntry(tokenizer).family,
    options,
    analysis,
    chunks: n === 0 ? { byteStart: [0], kind: [] } : { byteStart: [0, n], kind: [ChunkKind.Regex] },
    tokens: {
      id: Array.from({ length: count }, (_, i) => analysis.chars.cp[i] ?? 0),
      byteStart,
      kind: Array.from({ length: count }, () => TokenKind.Normal),
    },
    timeline: null,
    seq,
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export interface EncodeCall extends Deferred<TokenizationResult> {
  readonly text: string;
  readonly options: EncodeOptions;
  /** Answers with a synthetic result of the call's text. */
  answer(): void;
}

export interface LoadCall extends Deferred<LoadedInfo> {
  readonly id: TokenizerId;
  readonly onProgress: ((p: Progress) => void) | undefined;
  /** Finishes the load: the tokenizer becomes resident. */
  finish(): void;
}

export class FakeClient implements TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary> = Promise.reject(new Error('no assets in tests'));
  readonly loads: LoadCall[] = [];
  readonly encodes: EncodeCall[] = [];
  unloads = 0;
  #resident: TokenizerId | null = null;
  readonly #listeners = new Set<(id: TokenizerId | null) => void>();

  /** `features` overrides the Worker's `ready.features` (default: everything but brotli). */
  constructor(features: Partial<Features> = {}) {
    this.features = Promise.resolve({
      cacheApi: true,
      segmenter: true,
      brotli: false,
      subtleCrypto: true,
      ...features,
    });
    this.assets.catch(() => undefined);
  }

  get resident(): TokenizerId | null {
    return this.#resident;
  }

  setResident(id: TokenizerId | null): void {
    this.#resident = id;
    for (const listener of this.#listeners) listener(id);
  }

  onResident(cb: (id: TokenizerId | null) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  load(id: TokenizerId, onProgress?: (p: Progress) => void): Promise<LoadedInfo> {
    const call = deferred<LoadedInfo>();
    const entry = tokenizerEntry(id);
    const loadCall: LoadCall = {
      ...call,
      id,
      onProgress,
      finish: () => {
        this.setResident(id);
        call.resolve({
          info: {
            id,
            family: entry.family,
            vocabSize: entry.vocabSize,
            rankCount: entry.rankCount,
            specials: [],
            bosId: null,
            unicodeVersion: '16.0.0',
            sourceSha256: '',
            supports: { nfkc: false, bos: false, specialsToggle: false },
          },
          fromCache: false,
          ms: 12,
          bytesTransferred: 1000,
          contentEncoding: null,
          layer: 'gzip',
        });
      },
    };
    this.loads.push(loadCall);
    return call.promise;
  }

  prefetch(): Promise<void> {
    return Promise.resolve();
  }

  encode(text: string, options: EncodeOptions): Promise<TokenizationResult> {
    // Latest text wins (AD-21): every older encode settles as `cancelled`.
    for (const older of this.encodes) older.reject(new CancelledError());
    const call = deferred<TokenizationResult>();
    const tokenizer = this.#resident ?? 'openai-o200k_base';
    this.encodes.push({
      ...call,
      text,
      options,
      answer: () => {
        call.resolve(syntheticResult(text, tokenizer, options, this.encodes.length));
      },
    });
    return call.promise;
  }

  lookup(): Promise<LookupEntry[]> {
    return Promise.resolve([]);
  }

  unload(): Promise<void> {
    this.unloads++;
    this.setResident(null);
    return Promise.resolve();
  }

  terminate(): void {
    this.setResident(null);
  }
}

/** Lets pending promise callbacks run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
