/**
 * Fakes for the Worker tests: an in-memory Cache API, a scripted `fetch`, a controllable loader, a slow test engine
 * that yields like `encodeIncremental`, a scripted Worker and a Worker that runs the real host in-process.
 */
import { analyzeText, buildResult, ChunkKind, TokenKind, type TokenizerId } from '@tsbs/core';
import type { Tokenizer, TokenizerInfo } from '@tsbs/core/model/engine';
import type { Tsbv1, VocabAssetEntry, VocabManifest } from '@tsbs/core/format/types';
import type { FromWorker, ToWorker } from '@tsbs/core/protocol';
import type { CacheLike, CacheStorageLike } from '../../src/cache-store.ts';
import type { EngineConfig, EngineConfigEntry, EngineFactory } from '../../src/engine-config.ts';
import { createHost, type Host, type HostDeps } from '../../src/host.ts';
import type { FetchedAsset, Loader, LoaderEnv } from '../../src/loader.ts';
import type { WorkerLike } from '../../src/client.ts';
import { buildContainer } from './tsbv.ts';

export const ORIGIN = 'https://tsbs.test';

// ---- bytes ----

/** gzip through the platform `CompressionStream` (the format `DecompressionStream('gzip')` reads). */
export async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A test asset: the raw container, its gzip file and the manifest entry describing both. */
export interface TestAsset {
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly gz: Uint8Array<ArrayBuffer>;
  readonly entry: VocabAssetEntry;
  readonly url: string;
}

export async function makeAsset(id: TokenizerId = 'openai-o200k_base'): Promise<TestAsset> {
  const raw = buildContainer(id);
  const gz = await gzip(raw);
  const sha256 = await sha256Hex(gz);
  const entry: VocabAssetEntry = {
    path: `/tok/${id}/${sha256.slice(0, 12)}.bin`,
    format: 'tsbv1',
    family: 'bytelevel-bpe',
    encoding: 'gzip',
    bytesCompressed: gz.length,
    bytesRaw: raw.length,
    sha256,
    sha256Raw: await sha256Hex(raw),
    upstream: {
      assetId: id,
      file: 'test',
      sha256: '0'.repeat(64),
      url: 'test:',
      revision: 'r',
      retrievedOn: '2026-10-25',
    },
    counts: { pieces: 259, specials: 1 },
  };
  return { raw, gz, entry, url: `${ORIGIN}${entry.path}` };
}

export function manifestOf(...assets: Array<{ readonly entry: VocabAssetEntry }>): VocabManifest {
  return {
    schema: 1,
    builtOn: '2026-10-25',
    generator: 'test',
    assets: Object.fromEntries(assets.map((a) => [a.entry.upstream.assetId, a.entry])),
  };
}

// ---- Cache API ----

interface StoredResponse {
  readonly body: Uint8Array<ArrayBuffer>;
  readonly headers: Record<string, string>;
}

export class FakeCache implements CacheLike {
  readonly store = new Map<string, StoredResponse>();
  /** When set, `put` of an asset (not the index) rejects like a full quota. */
  failPuts = false;

  match(url: string): Promise<Response | undefined> {
    const hit = this.store.get(url);
    return Promise.resolve(hit === undefined ? undefined : new Response(hit.body.slice(), { headers: hit.headers }));
  }

  async put(url: string, response: Response): Promise<void> {
    if (this.failPuts && !url.endsWith('/__tsbs-index')) throw new DOMException('quota', 'QuotaExceededError');
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    this.store.set(url, { body: new Uint8Array(await response.arrayBuffer()), headers });
  }

  delete(url: string): Promise<boolean> {
    return Promise.resolve(this.store.delete(url));
  }

  keys(): Promise<ReadonlyArray<{ readonly url: string }>> {
    return Promise.resolve([...this.store.keys()].map((url) => ({ url })));
  }

  /** Writes raw bytes as if a previous session had stored them. */
  seed(url: string, body: Uint8Array<ArrayBuffer>): void {
    this.store.set(url, { body, headers: {} });
  }

  async index(): Promise<Array<{ url: string; bytes: number; lastUsed: number }>> {
    const response = await this.match(`${ORIGIN}/__tsbs-index`);
    if (response === undefined) return [];
    return ((await response.json()) as { entries: Array<{ url: string; bytes: number; lastUsed: number }> }).entries;
  }
}

export class FakeCacheStorage implements CacheStorageLike {
  readonly caches = new Map<string, FakeCache>();
  failOpen = false;

  open(name: string): Promise<CacheLike> {
    if (this.failOpen) return Promise.reject(new DOMException('private mode', 'SecurityError'));
    return Promise.resolve(this.cache(name));
  }

  /** The named cache (created on first use). */
  cache(name = 'tsbs-tok-v1'): FakeCache {
    let cache = this.caches.get(name);
    if (cache === undefined) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.caches.has(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.caches.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.caches.delete(name));
  }
}

// ---- fetch ----

/** A response the fake server returns for one URL (a fresh `Response` per call). */
export type Route = () => Response;

/** Serves `body` in `chunkSize` pieces with the given headers (Content-Length = the body size unless overridden). */
export function respond(
  body: Uint8Array<ArrayBuffer>,
  init: { headers?: Record<string, string>; status?: number; chunkSize?: number } = {},
): Route {
  return () => {
    const chunk = init.chunkSize ?? 16 * 1024;
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= body.length) {
          controller.close();
          return;
        }
        controller.enqueue(body.slice(offset, offset + chunk));
        offset += chunk;
      },
    });
    return new Response(init.status === 404 ? null : stream, {
      status: init.status ?? 200,
      headers: { 'content-length': String(body.length), ...init.headers },
    });
  };
}

export interface FakeFetch {
  readonly fetch: LoaderEnv['fetch'];
  readonly calls: string[];
  readonly routes: Map<string, Route>;
}

export function fakeFetch(routes: Record<string, Route> = {}): FakeFetch {
  const map = new Map(Object.entries(routes));
  const calls: string[] = [];
  return {
    calls,
    routes: map,
    fetch: (url) => {
      calls.push(url);
      const route = map.get(url);
      return Promise.resolve(route === undefined ? new Response(null, { status: 404 }) : route());
    },
  };
}

export function loaderEnv(overrides: Partial<LoaderEnv> = {}): LoaderEnv {
  let clock = 1_000;
  return {
    origin: ORIGIN,
    fetch: fakeFetch().fetch,
    caches: new FakeCacheStorage(),
    subtle: crypto.subtle,
    estimate: null,
    now: () => ++clock,
    ...overrides,
  };
}

// ---- host fakes ----

/** A loader whose loads the test resolves by hand. */
export class FakeLoader implements Loader {
  readonly loads: Array<{
    readonly id: TokenizerId;
    readonly signal: AbortSignal | undefined;
    readonly resolve: (asset: FetchedAsset) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  readonly prefetches: TokenizerId[] = [];

  load(id: TokenizerId, _onProgress: unknown, options?: { signal?: AbortSignal }): Promise<FetchedAsset> {
    return new Promise((resolve, reject) => {
      this.loads.push({ id, signal: options?.signal, resolve, reject });
    });
  }

  prefetch(id: TokenizerId): Promise<number> {
    this.prefetches.push(id);
    return Promise.resolve(123);
  }

  cleanup(): Promise<void> {
    return Promise.resolve();
  }

  cachedIds(): Promise<TokenizerId[]> {
    return Promise.resolve([]);
  }

  /** Resolves the most recent load of `id` with a valid container. */
  finish(id: TokenizerId): void {
    const load = [...this.loads].reverse().find((l) => l.id === id);
    if (load === undefined) throw new Error(`no load of ${id}`);
    load.resolve(fakeAsset(id));
  }
}

/** A fetched asset over the test container. */
export function fakeAsset(id: TokenizerId, fromCache = false): FetchedAsset {
  return {
    container: buildContainer(id).buffer,
    layer: 'gzip',
    fromCache,
    bytesTransferred: fromCache ? 0 : 1000,
    contentEncoding: null,
    commit: () => Promise.resolve(),
    evict: () => Promise.resolve(),
  };
}

export function engineEntry(id: TokenizerId): EngineConfigEntry {
  return {
    id,
    family: 'bytelevel-bpe',
    vocabSize: 260,
    rankCount: 259,
    engine: { kind: 'bytelevel-bpe', pattern: 'o200k', idOffset: 0, maxTokenBytes: 3, bosId: null },
    defaults: {},
    toggles: [],
  };
}

export const ENGINE_CONFIG: EngineConfig = {
  'openai-o200k_base': engineEntry('openai-o200k_base'),
  'openai-cl100k_base': engineEntry('openai-cl100k_base'),
};

/** Busy-waits `ms` (an engine slice that keeps the thread). */
export function spin(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // busy
  }
}

export interface TestEngineOptions {
  /** Work per slice in ms (busy). Default 0. */
  readonly sliceMs?: number;
  /** Code points per slice. Default: the whole text in one slice. */
  readonly charsPerSlice?: number;
  /** Thrown from the first slice. */
  readonly error?: Error;
}

/** Observations of the test engines a factory created. */
export interface EngineLog {
  readonly created: Array<{ readonly id: TokenizerId; readonly tsbv: Tsbv1 }>;
  readonly disposed: TokenizerId[];
  readonly slices: number[];
}

/**
 * A test engine factory: one token per UTF-8 byte (id = byte value), produced in slices of `charsPerSlice` code points,
 * each spinning `sliceMs`, with `{ bytesDone, bytesTotal }` yielded between slices like the real engines.
 */
export function testEngine(options: TestEngineOptions = {}): { factory: EngineFactory; log: EngineLog } {
  const log: EngineLog = { created: [], disposed: [], slices: [] };
  const factory: EngineFactory = (tsbv, entry) => {
    log.created.push({ id: entry.id, tsbv });
    const info: TokenizerInfo = {
      id: entry.id,
      family: entry.family,
      vocabSize: entry.vocabSize,
      rankCount: entry.rankCount,
      specials: [],
      bosId: null,
      unicodeVersion: '16.0.0',
      sourceSha256: tsbv.meta.upstream.sha256,
      supports: { nfkc: false, bos: false, specialsToggle: true },
    };
    const tokenizer: Tokenizer = {
      info,
      encode() {
        throw new Error('the host must use encodeIncremental');
      },
      *encodeIncremental(text, encodeOptions = {}) {
        const analysis = analyzeText(text, { segmenter: null });
        const total = analysis.utf8.length;
        const per = options.charsPerSlice ?? Math.max(analysis.chars.count, 1);
        let slices = 0;
        for (let c = 0; c < analysis.chars.count; c += per) {
          if (options.error !== undefined) throw options.error;
          spin(options.sliceMs ?? 0);
          slices++;
          const done = analysis.chars.byteStart[Math.min(c + per, analysis.chars.count)] ?? total;
          if (done < total) yield { bytesDone: done, bytesTotal: total };
        }
        log.slices.push(slices);
        const n = total;
        return buildResult({
          tokenizer: entry.id,
          family: entry.family,
          options: { ...encodeOptions, trace: false },
          analysis,
          chunks: { byteStart: n > 0 ? [0, n] : [0], kind: n > 0 ? [ChunkKind.Regex] : [] },
          tokens: {
            id: Array.from(analysis.utf8),
            byteStart: Array.from({ length: n + 1 }, (_, i) => i),
            kind: new Uint8Array(n).fill(TokenKind.Normal),
          },
          timeline: null,
        });
      },
      tokenBytes: (id) => (id >= 0 && id < 256 ? Uint8Array.of(id) : null),
      pieceString: () => null,
      idOf: (bytes) => (bytes.length === 1 ? (bytes[0] ?? null) : null),
      pretokenize: () => [],
      dispose() {
        log.disposed.push(entry.id);
      },
    };
    return tokenizer;
  };
  return { factory, log };
}

/** One macrotask. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Polls `predicate` every macrotask until it holds (or fails after `ms`). */
export async function waitFor(predicate: () => boolean, ms = 2_000): Promise<void> {
  const end = performance.now() + ms;
  while (!predicate()) {
    if (performance.now() > end) throw new Error('waitFor: condition not met');
    await tick();
  }
}

/** A host driven directly, with every posted message recorded. */
export function hostWith(deps: Partial<Omit<HostDeps, 'post'>> = {}): {
  host: Host;
  posted: FromWorker[];
  loader: FakeLoader;
  log: EngineLog;
} {
  const posted: FromWorker[] = [];
  const loader = new FakeLoader();
  const { factory, log } = testEngine();
  const host = createHost({
    manifest: { schema: 1, builtOn: '2026-10-25', generator: 'test', assets: {} },
    engineConfig: ENGINE_CONFIG,
    importEngine: () => Promise.resolve(factory),
    loader,
    features: () => Promise.resolve({ cacheApi: true, segmenter: true, brotli: false, subtleCrypto: true }),
    ...deps,
    post: (message) => {
      posted.push(message);
    },
  });
  return { host, posted, loader, log };
}

// ---- Workers ----

type Listener = (event: { readonly data: unknown; readonly message?: string }) => void;

/** A Worker the test scripts: it records what the client posts and emits what the test says. */
export class ScriptedWorker implements WorkerLike {
  readonly posted: ToWorker[] = [];
  terminated = false;
  readonly #message: Listener[] = [];
  readonly #error: Listener[] = [];

  postMessage(message: ToWorker): void {
    this.posted.push(message);
  }

  addEventListener(type: 'message' | 'error', listener: Listener): void {
    (type === 'message' ? this.#message : this.#error).push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: FromWorker): void {
    for (const listener of this.#message) listener({ data: message });
  }

  crash(message = 'crashed'): void {
    for (const listener of this.#error) listener({ data: undefined, message });
  }

  /** The last posted message of `type`. */
  last<T extends ToWorker['type']>(type: T): Extract<ToWorker, { type: T }> {
    const found = [...this.posted].reverse().find((m) => m.type === type);
    if (found === undefined) throw new Error(`nothing of type ${type} was posted`);
    return found as Extract<ToWorker, { type: T }>;
  }

  /** Answers the client's `hello`. */
  ready(): void {
    this.emit({
      type: 'ready',
      reqId: this.last('hello').reqId,
      features: { cacheApi: true, segmenter: true, brotli: false, subtleCrypto: true },
      assets: {} as never,
    });
  }
}

/** A Worker that runs the real host in-process; both directions are delivered as macrotasks, like `postMessage`. */
export class HostWorker implements WorkerLike {
  readonly host: Host;
  readonly posted: ToWorker[] = [];
  readonly received: Array<{ readonly message: FromWorker; readonly at: number }> = [];
  terminated = false;
  readonly #message: Listener[] = [];

  constructor(deps: Omit<HostDeps, 'post'>) {
    this.host = createHost({
      // Node drains up to 1000 MessagePort messages in one go, so the default MessageChannel yield would not let a
      // timer (the test's "user") run between slices here; setImmediate gives the event loop a full turn, as a
      // browser's task queue does for the Worker's incoming messages.
      yieldNow: () =>
        new Promise((resolve) => {
          setImmediate(resolve);
        }),
      ...deps,
      post: (message) => {
        if (this.terminated) return;
        this.received.push({ message, at: performance.now() });
        setImmediate(() => {
          if (!this.terminated) for (const listener of this.#message) listener({ data: message });
        });
      },
    });
  }

  postMessage(message: ToWorker): void {
    this.posted.push(message);
    setImmediate(() => {
      if (!this.terminated) this.host.handle(message);
    });
  }

  addEventListener(type: 'message' | 'error', listener: Listener): void {
    if (type === 'message') this.#message.push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }
}
