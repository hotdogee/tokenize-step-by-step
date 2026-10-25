/**
 * The page's `TokenizerClientLike` until WP07's Worker client lands: WP01's `MockTokenizerClient` answering from WP03's
 * precomputed examples (AD-16, 03 §C.7). On the first `load` of a tokenizer it fetches that tokenizer's lazy
 * `examples/<id>.<sha8>.json` (`ExamplesWire`, reporting `download` progress) and hands it to the mock, so every example
 * chip × tokenizer pair has its real, oracle-derived result. Text outside the chips has no result yet and rejects with
 * `NoPrecomputedResultError`, which the shell shows as "waiting for the tokenizer" — never a made-up tokenization.
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
import type { ExamplesWire } from '@tsbs/core/fixture/examples-wire';
import type { FixtureTokenizerRef } from '@tsbs/core/fixture/from-fixture-case';
import { MockClientError, MockTokenizerClient } from '@tsbs/core/fixture/mock-client';
import { CancelledError, isCancelled } from '@tsbs/core/model/cancelled';
import { NoPrecomputedResultError } from './no-precomputed.ts';

type Fetch = (url: string) => Promise<Response>;

export interface ExamplesClientOptions {
  /** Registry entries (structurally `FixtureTokenizerRef`s: id, family, engine.bosId). */
  readonly refs: readonly FixtureTokenizerRef[];
  /** Root-relative URL of each tokenizer's examples file (`examples-index.json` › `files`). */
  readonly files: Readonly<Partial<Record<TokenizerId, string>>>;
  readonly features: Features;
  readonly fetch?: Fetch;
}

/** Reads a response body, reporting `download` progress against `Content-Length` when the server sends one. */
async function readJson(response: Response, report: (loaded: number, total: number | null) => void): Promise<unknown> {
  const length = Number(response.headers.get('Content-Length'));
  const total = Number.isFinite(length) && length > 0 ? length : null;
  const reader = response.body?.getReader();
  if (reader === undefined) return response.json();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    report(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class ExamplesClient implements TokenizerClientLike {
  readonly features: Promise<Features>;
  /** Wire sizes of the vocabularies arrive with the Worker's `ready.assets` (AD-11, WP07); until then none are known. */
  readonly assets: Promise<AssetSummary>;
  readonly #mock: MockTokenizerClient;
  readonly #refs: ReadonlyMap<TokenizerId, FixtureTokenizerRef>;
  readonly #files: Readonly<Partial<Record<TokenizerId, string>>>;
  readonly #fetch: Fetch;
  /** Texts each fetched examples file answers. */
  readonly #texts = new Map<TokenizerId, ReadonlySet<string>>();
  /** Latest `load`/`unload`: like the Worker (04 §6), a newer request supersedes a load still fetching. */
  #loadSeq = 0;

  constructor(options: ExamplesClientOptions) {
    this.#refs = new Map(options.refs.map((ref) => [ref.id, ref]));
    this.#files = options.files;
    this.#fetch = options.fetch ?? ((url) => fetch(url, { credentials: 'omit' }));
    this.#mock = new MockTokenizerClient({ sources: [], unknownText: 'reject', features: options.features });
    this.features = this.#mock.features;
    this.assets = Promise.reject(new Error('vocabulary wire sizes are reported by the Worker client (WP07)'));
    this.assets.catch(() => undefined);
  }

  get resident(): TokenizerId | null {
    return this.#mock.resident;
  }

  onResident(cb: (id: TokenizerId | null) => void): () => void {
    return this.#mock.onResident(cb);
  }

  async load(
    id: TokenizerId,
    onProgress?: (p: Progress) => void,
    signal?: { readonly aborted: boolean },
  ): Promise<LoadedInfo> {
    const seq = ++this.#loadSeq;
    if (!this.#texts.has(id)) await this.#fetchExamples(id, onProgress);
    if (seq !== this.#loadSeq || signal?.aborted === true) throw new CancelledError();
    return this.#mock.load(id, onProgress, signal);
  }

  async #fetchExamples(id: TokenizerId, onProgress?: (p: Progress) => void): Promise<void> {
    const ref = this.#refs.get(id);
    const url = this.#files[id];
    if (ref === undefined || url === undefined) throw new MockClientError('fetch', `no precomputed examples for ${id}`);
    let wire: ExamplesWire;
    try {
      const response = await this.#fetch(url);
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      onProgress?.({ tokenizer: id, phase: 'download', loaded: 0, total: null });
      wire = (await readJson(response, (loaded, total) => {
        onProgress?.({ tokenizer: id, phase: 'download', loaded, total });
      })) as ExamplesWire;
    } catch (error) {
      throw new MockClientError('fetch', `${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (wire.tokenizer !== id) throw new MockClientError('format', `${url} holds ${wire.tokenizer}, not ${id}`);
    this.#mock.addSource({ ref, data: wire });
    this.#texts.set(id, new Set(Object.values(wire.cases).map((wireCase) => wireCase.text)));
  }

  prefetch(): Promise<void> {
    return Promise.resolve();
  }

  encode(
    text: string,
    options: EncodeOptions,
    onProgress?: (p: Progress) => void,
    signal?: AbortSignal,
  ): Promise<TokenizationResult> {
    const id = this.#mock.resident;
    const known = id !== null && this.#texts.get(id)?.has(text) === true;
    // Always through the mock, so a newer encode cancels an older one exactly as the real client does (AD-21).
    const pending = this.#mock.encode(text, options, onProgress, signal);
    if (known || id === null) return pending;
    return pending.catch((error: unknown) => {
      throw isCancelled(error) ? error : new NoPrecomputedResultError(`no precomputed result for this text on ${id}`);
    });
  }

  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]> {
    return this.#mock.lookup(q);
  }

  unload(): Promise<void> {
    this.#loadSeq++;
    return this.#mock.unload();
  }

  terminate(): void {
    this.#mock.terminate();
  }
}
