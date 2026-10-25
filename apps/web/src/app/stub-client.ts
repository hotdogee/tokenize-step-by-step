/**
 * TODO(WP-integration): a local `TokenizerClientLike` stand-in until WP01's `MockTokenizerClient` and WP07's
 * `TokenizerClient` land; main.ts constructs it and the integrator swaps in the real client. It implements the FROZEN
 * contract (04 §6) closely enough to drive the shell: strict one-resident `unload`/`load` with phased progress
 * (download 0–75 %, verify, decompress, build — 03 §C.6), `ready.assets`-style wire sizes, `onResident`, and `encode`
 * that serves exactly one precomputed result (fixtures/openai-o200k_base.json › zh-tw-tainan) and rejects every other
 * request with `StubUnavailableError`.
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
import { probeFeatures } from './features.ts';
import { tokenizerEntry, TOKENIZERS } from './registry-stub.ts';
import { DEFAULT_CASE, DEFAULT_CASE_TOKENIZER, defaultResult } from './stub-result.ts';

/** Thrown by the stub for any encode it has no precomputed result for. */
export class StubUnavailableError extends Error {
  override readonly name = 'StubUnavailableError';
}

/** Wire sizes from 03 §C.3 (gzip column, KB = 1024 B) so the picker's size column has realistic data. */
const WIRE_KB: Readonly<Record<TokenizerId, readonly [gzip: number, raw: number]>> = {
  'openai-o200k_base': [1025, 1560],
  'openai-cl100k_base': [443, 727],
  'anthropic-claude-legacy': [277, 464],
  'google-gemma4': [1620, 3782],
  'google-gemma2': [1410, 3030],
  'meta-llama4-muse': [1045, 1615],
  'meta-llama3': [572, 942],
  'xai-grok2': [601, 939],
  'xai-grok1': [615, 1407],
};

function stubAssets(): AssetSummary {
  const entries = TOKENIZERS.map((entry) => {
    const [gzip, raw] = WIRE_KB[entry.id];
    return [
      entry.id,
      { path: `/tok/${entry.id}/stub.bin`, bytesCompressed: gzip * 1024, bytesRaw: raw * 1024 },
    ] as const;
  });
  return Object.fromEntries(entries) as AssetSummary;
}

interface Abortable {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
}

const delay = (ms: number, signal?: Abortable): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

export interface StubClientOptions {
  /** Milliseconds per simulated progress tick (0 in tests). */
  readonly tickMs?: number;
}

export class StubTokenizerClient implements TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary>;
  #resident: TokenizerId | null = null;
  readonly #listeners = new Set<(id: TokenizerId | null) => void>();
  readonly #tickMs: number;
  #seq = 0;
  /** Latest load request: like the real Worker (04 §6 rule 4), a newer load supersedes an older one. */
  #loadSeq = 0;

  constructor(options: StubClientOptions = {}) {
    this.#tickMs = options.tickMs ?? 60;
    this.features = Promise.resolve(probeFeatures());
    this.assets = Promise.resolve(stubAssets());
  }

  get resident(): TokenizerId | null {
    return this.#resident;
  }

  onResident(cb: (id: TokenizerId | null) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  #setResident(id: TokenizerId | null): void {
    this.#resident = id;
    for (const listener of this.#listeners) listener(id);
  }

  async load(id: TokenizerId, onProgress?: (p: Progress) => void, signal?: Abortable): Promise<LoadedInfo> {
    const seq = ++this.#loadSeq;
    const started = performance.now();
    const total = WIRE_KB[id][0] * 1024;
    const raw = WIRE_KB[id][1] * 1024;
    const report = (phase: Progress['phase'], loaded: number, of: number | null): void =>
      onProgress?.({ tokenizer: id, phase, loaded, total: of });
    for (let i = 1; i <= 4; i++) {
      await delay(this.#tickMs, signal);
      report('download', (total * i) / 4, total);
    }
    await delay(this.#tickMs, signal);
    report('verify', total, total);
    await delay(this.#tickMs, signal);
    report('decompress', raw, raw);
    await delay(this.#tickMs, signal);
    report('build', 1, 1);
    if (seq !== this.#loadSeq) throw new DOMException('superseded by a newer load', 'AbortError');
    const entry = tokenizerEntry(id);
    this.#setResident(id);
    return {
      info: {
        id,
        family: entry.family,
        vocabSize: entry.vocabSize,
        rankCount: entry.rankCount,
        specials: [],
        bosId: entry.engine.bosId,
        unicodeVersion: '16.0.0',
        sourceSha256: entry.asset.sourceSha256,
        supports: {
          nfkc: entry.toggles.includes('normalize'),
          bos: entry.toggles.includes('addBos'),
          specialsToggle: entry.toggles.includes('specialTokens'),
        },
      },
      fromCache: false,
      ms: performance.now() - started,
      bytesTransferred: total,
      contentEncoding: null,
      layer: 'gzip',
    };
  }

  prefetch(): Promise<void> {
    return Promise.resolve();
  }

  encode(text: string, options: EncodeOptions): Promise<TokenizationResult> {
    this.#seq++;
    const plain = options.specialTokens === 'as-text' && !options.addBos && options.normalize === 'none';
    if (this.#resident === DEFAULT_CASE_TOKENIZER && text === DEFAULT_CASE.text && plain)
      return Promise.resolve(defaultResult(this.#seq));
    return Promise.reject(new StubUnavailableError(`no precomputed result for this text on ${String(this.#resident)}`));
  }

  lookup(): Promise<LookupEntry[]> {
    return Promise.resolve([]);
  }

  unload(): Promise<void> {
    this.#loadSeq++;
    this.#setResident(null);
    return Promise.resolve();
  }

  terminate(): void {
    this.#listeners.clear();
  }
}
