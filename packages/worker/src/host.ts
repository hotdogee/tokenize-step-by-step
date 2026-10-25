/**
 * The Worker host (04 §6, FROZEN protocol; AD-19, AD-21): turns `ToWorker` messages into loads and encodes and posts
 * `FromWorker` replies. Its rules:
 *
 * - **One running + one pending encode.** A newer `encode` replaces the pending one, which settles as `cancelled`;
 *   `cancel.target` drops the pending encode at once or stops the running one at its next `mergeStep` yield (one
 *   budget, 04 §1.3); either way exactly one `cancelled` is posted for that reqId, and unknown targets are ignored.
 * - **Encodes across a load.** An `encode` that arrives while a load is in flight becomes the pending encode and runs
 *   after `loaded`; `not-loaded` is answered only when no engine is resident AND no load is in flight.
 * - **Load supersession.** A `load` while another is in flight aborts the older one (its `loaded` never arrives); the
 *   same tokenizer simply hands the in-flight load to the newer reqId.
 * - **Strict one-resident (AD-19).** The resident tables are released (engine disposed, references nulled) before a
 *   new load starts, whether or not the client sent `unload` first; `hooks.onLoadStart` lets tests assert it.
 * - **Lazy engines.** `importEngine(family)` (entry.ts: `import('./engines/<family>.ts')`) runs on a family's first
 *   load, in parallel with the download.
 * - **Progress.** Loads post `cache | download | verify | decompress | build`; every encode slice posts `encode`
 *   progress, which the client's watchdog counts as liveness. `prefetch` posts `download` progress and finishes with
 *   one `progress` of phase `cache` (also the immediate no-op ack when that tokenizer is loading or resident).
 *
 * `createHost` takes the bundled manifest, the engine config, the engine importer and `post` as parameters (PA-8), so
 * tests drive it with fakes; `startHost` wires it to a Worker global scope.
 */
import type { VocabManifest } from '@tsbs/core/format/types';
import type { Tsbv1 } from '@tsbs/core/format/types';
import { readTsbv1 } from '@tsbs/core/format/tsbv1';
import type { Tokenizer } from '@tsbs/core/model/engine';
import type { Family, TokenizerId } from '@tsbs/core/model/result';
import type {
  AssetSummary,
  Features,
  FromWorker,
  LoadedInfo,
  LookupEntry,
  Progress,
  ToWorker,
} from '@tsbs/core/protocol';
import type { EngineConfig, EngineFactory } from './engine-config.ts';
import { TokenizerError, toWireError, type ErrorPhase } from './errors.ts';
import { probeWorkerFeatures } from './features.ts';
import { createLoader, defaultLoaderEnv, type Loader } from './loader.ts';
import { createMacrotaskYield } from './macrotask.ts';
import { transferablesOf } from './transfer.ts';

/** Default time slice of an encode (04 §1.3). */
export const DEFAULT_BUDGET_MS = 4;

type EncodeMessage = Extract<ToWorker, { type: 'encode' }>;
type LookupMessage = Extract<ToWorker, { type: 'lookup' }>;

/** Test hooks (no effect on the protocol). */
export interface HostHooks {
  /** A load starts, after the strict one-resident release; `tablesReleased` is true iff no resident tables remain. */
  onLoadStart?(event: { readonly tokenizer: TokenizerId; readonly tablesReleased: boolean }): void;
  /** The resident tokenizer was released (engine disposed, tables unreferenced). */
  onRelease?(tokenizer: TokenizerId): void;
}

export interface HostDeps {
  /** The bundled vocab manifest (AD-11). */
  readonly manifest: VocabManifest;
  /** Per-tokenizer engine configuration (PA-8). */
  readonly engineConfig: EngineConfig;
  /** Imports a family's engine factory on first use. */
  readonly importEngine: (family: Family) => Promise<EngineFactory>;
  /** Posts a reply; `transfer` lists the buffers to move (results). */
  readonly post: (message: FromWorker, transfer: Transferable[]) => void;
  /** Default: `createLoader(manifest, defaultLoaderEnv())`. */
  readonly loader?: Loader;
  /** Default: `probeWorkerFeatures`. */
  readonly features?: () => Promise<Features>;
  /** One event-loop turn between encode slices. Default: a `MessageChannel` macrotask. */
  readonly yieldNow?: () => Promise<void>;
  /** Monotonic clock for `LoadedInfo.ms`. Default: `performance.now`. */
  readonly now?: () => number;
  /** `pong.heapHint`: null in browsers (04 §6 rule 7); the Node bench passes `process.memoryUsage().arrayBuffers`. */
  readonly heapHint?: () => number | null;
  readonly hooks?: HostHooks;
}

/** A host as `startHost` and tests use it. */
export interface Host {
  handle(message: ToWorker): void;
}

/** The resident tokenizer and its tables. */
interface Resident {
  readonly id: TokenizerId;
  readonly tsbv: Tsbv1;
  readonly tokenizer: Tokenizer;
  readonly layer: 'gzip' | 'raw';
}

/** The load in flight; `reqId` moves to a newer `load` of the same tokenizer. */
interface Loading {
  reqId: number;
  readonly id: TokenizerId;
  readonly abort: AbortController;
  readonly started: number;
}

/** The encode in flight. */
interface Running {
  readonly reqId: number;
  readonly seq: number;
  cancelled: boolean;
}

/** `ready.assets` from the bundled manifest; ids without an asset in this build are absent. */
export function assetSummary(manifest: VocabManifest): AssetSummary {
  const summary: Record<string, { path: string; bytesCompressed: number; bytesRaw: number }> = {};
  for (const [id, entry] of Object.entries(manifest.assets)) {
    summary[id] = { path: entry.path, bytesCompressed: entry.bytesCompressed, bytesRaw: entry.bytesRaw };
  }
  return summary as AssetSummary;
}

class WorkerHost implements Host {
  readonly #deps: HostDeps;
  readonly #loader: Loader;
  readonly #yield: () => Promise<void>;
  readonly #now: () => number;
  #resident: Resident | null = null;
  #loading: Loading | null = null;
  #running: Running | null = null;
  #pending: EncodeMessage | null = null;
  #cleanedUp = false;

  constructor(deps: HostDeps) {
    // The manifest is generated JSON (typed by assertion in entry.ts), so its schema is checked at run time.
    if ((deps.manifest.schema as number) !== 1) throw new TypeError('unsupported vocab manifest schema');
    this.#deps = deps;
    this.#loader = deps.loader ?? createLoader(deps.manifest, defaultLoaderEnv());
    this.#yield = deps.yieldNow ?? createMacrotaskYield();
    this.#now = deps.now ?? (() => performance.now());
  }

  handle(message: ToWorker): void {
    try {
      switch (message.type) {
        case 'hello':
          void this.#hello(message.reqId);
          break;
        case 'load':
          this.#load(message.reqId, message.tokenizer);
          break;
        case 'prefetch':
          void this.#prefetch(message.reqId, message.tokenizer);
          break;
        case 'unload':
          this.#unload(message.reqId);
          break;
        case 'encode':
          this.#encode(message);
          break;
        case 'cancel':
          this.#cancel(message.target);
          break;
        case 'lookup':
          this.#lookup(message);
          break;
        case 'ping':
          this.#post({
            type: 'pong',
            reqId: message.reqId,
            resident: this.#resident?.id ?? null,
            loading: this.#loading?.id ?? null,
            encodeInFlight: this.#running !== null,
            heapHint: this.#deps.heapHint?.() ?? null,
          });
          break;
        default:
          break; // not a protocol message: ignored
      }
    } catch (error) {
      this.#postError(message.reqId, error, 'other');
    }
  }

  #post(message: FromWorker, transfer: Transferable[] = []): void {
    this.#deps.post(message, transfer);
  }

  #postError(reqId: number, error: unknown, phase: ErrorPhase): void {
    this.#post({ type: 'error', reqId, ...toWireError(error, phase) });
  }

  async #hello(reqId: number): Promise<void> {
    const features = await (this.#deps.features ?? probeWorkerFeatures)();
    this.#post({ type: 'ready', reqId, features, assets: assetSummary(this.#deps.manifest) });
    if (!this.#cleanedUp) {
      this.#cleanedUp = true;
      void this.#loader.cleanup();
    }
  }

  // ---- loading (03 §C.6, AD-19) ----

  #load(reqId: number, id: TokenizerId): void {
    const current = this.#loading;
    if (current?.id === id) {
      current.reqId = reqId; // the same tokenizer: the newer request takes over the in-flight load
      return;
    }
    if (current !== null) {
      current.abort.abort(); // superseded: its `loaded` never arrives (rule 4)
      this.#loading = null;
    }
    const resident = this.#resident;
    if (resident?.id === id) {
      this.#post({
        type: 'loaded',
        reqId,
        loaded: {
          info: resident.tokenizer.info,
          fromCache: true,
          ms: 0,
          bytesTransferred: 0,
          contentEncoding: null,
          layer: resident.layer,
        },
      });
      this.#startPending();
      return;
    }
    this.#release();
    this.#deps.hooks?.onLoadStart?.({ tokenizer: id, tablesReleased: this.#resident === null });
    const loading: Loading = { reqId, id, abort: new AbortController(), started: this.#now() };
    this.#loading = loading;
    void this.#runLoad(loading);
  }

  /** Drops the resident engine: a running encode on it is cancelled, the engine disposed, the tables unreferenced. */
  #release(): void {
    const resident = this.#resident;
    if (resident === null) return;
    if (this.#running !== null) this.#running.cancelled = true;
    this.#resident = null;
    try {
      resident.tokenizer.dispose();
    } catch {
      // a failing dispose must not keep the tables resident
    }
    this.#deps.hooks?.onRelease?.(resident.id);
  }

  async #runLoad(loading: Loading): Promise<void> {
    const { id } = loading;
    const live = (): boolean => this.#loading === loading;
    const progress = (phase: Progress['phase'], loaded: number, total: number | null): void => {
      if (live())
        this.#post({ type: 'progress', reqId: loading.reqId, progress: { tokenizer: id, phase, loaded, total } });
    };
    try {
      const config = this.#deps.engineConfig[id];
      if (config === undefined) throw new TokenizerError('internal', `no engine configuration for ${id}`, false);
      const factory = this.#deps.importEngine(config.family).catch((error: unknown) => {
        throw new TokenizerError('fetch', `could not load the ${config.family} engine`, false, { cause: error });
      });
      factory.catch(() => undefined); // observed below; a download failure must not leave it unhandled
      const signal = loading.abort.signal;
      let asset = await this.#loader.load(id, progress, { signal });
      if (!live()) return;
      progress('build', 0, 2);
      let tsbv: Tsbv1;
      try {
        tsbv = readTsbv1(asset.container);
      } catch (error) {
        if (!asset.fromCache) throw error;
        await asset.evict(); // a stored body that no longer decodes: refetch once
        if (!live()) return;
        asset = await this.#loader.load(id, progress, { signal, network: true });
        if (!live()) return;
        tsbv = readTsbv1(asset.container);
      }
      if (tsbv.meta.tokenizerId !== id) {
        throw new TokenizerError('format', `the asset of ${id} holds ${tsbv.meta.tokenizerId}`, false);
      }
      progress('build', 1, 2);
      const create = await factory;
      if (!live()) return;
      const tokenizer = await create(tsbv, config);
      if (!live()) {
        tokenizer.dispose();
        return;
      }
      progress('build', 2, 2);
      this.#loading = null;
      this.#resident = { id, tsbv, tokenizer, layer: asset.layer };
      void asset.commit(); // queued now, so a later load of this tokenizer reads it back from the cache
      const loaded: LoadedInfo = {
        info: tokenizer.info,
        fromCache: asset.fromCache,
        ms: this.#now() - loading.started,
        bytesTransferred: asset.bytesTransferred,
        contentEncoding: asset.contentEncoding,
        layer: asset.layer,
      };
      this.#post({ type: 'loaded', reqId: loading.reqId, loaded });
      this.#startPending();
    } catch (error) {
      if (!live()) return; // superseded or unloaded: silent
      this.#loading = null;
      this.#postError(loading.reqId, error, 'load');
      this.#startPending(); // a queued encode now has nothing to run on → not-loaded
    }
  }

  #unload(reqId: number): void {
    if (this.#loading !== null) {
      this.#loading.abort.abort();
      this.#loading = null;
    }
    this.#release();
    const pending = this.#pending;
    if (pending !== null) {
      this.#pending = null;
      this.#post({ type: 'cancelled', reqId: pending.reqId });
    }
    this.#post({ type: 'unloaded', reqId });
  }

  async #prefetch(reqId: number, id: TokenizerId): Promise<void> {
    const ack = (loaded: number): void => {
      this.#post({ type: 'progress', reqId, progress: { tokenizer: id, phase: 'cache', loaded, total: loaded } });
    };
    if (this.#resident?.id === id || this.#loading?.id === id) {
      ack(0); // no-op (rule 4)
      return;
    }
    try {
      const stored = await this.#loader.prefetch(id, (phase, loaded, total) => {
        if (phase === 'download')
          this.#post({ type: 'progress', reqId, progress: { tokenizer: id, phase, loaded, total } });
      });
      ack(stored);
    } catch (error) {
      this.#postError(reqId, error, 'other');
    }
  }

  // ---- encoding (AD-21) ----

  #encode(message: EncodeMessage): void {
    if (this.#resident === null && this.#loading === null) {
      this.#post({
        type: 'error',
        reqId: message.reqId,
        code: 'not-loaded',
        message: 'no tokenizer is loaded',
        retryable: false,
      });
      return;
    }
    const replaced = this.#pending;
    this.#pending = message;
    if (replaced !== null) this.#post({ type: 'cancelled', reqId: replaced.reqId });
    this.#startPending();
  }

  #cancel(target: number): void {
    if (this.#pending?.reqId === target) {
      this.#pending = null;
      this.#post({ type: 'cancelled', reqId: target });
      return;
    }
    if (this.#running?.reqId === target) this.#running.cancelled = true; // posted at its next yield
  }

  /** Starts the pending encode when nothing runs and the engine is ready; answers `not-loaded` when it never will be. */
  #startPending(): void {
    const message = this.#pending;
    if (message === null || this.#running !== null || this.#loading !== null) return;
    this.#pending = null;
    const resident = this.#resident;
    if (resident === null) {
      this.#post({
        type: 'error',
        reqId: message.reqId,
        code: 'not-loaded',
        message: 'no tokenizer is loaded',
        retryable: false,
      });
      return;
    }
    const run: Running = { reqId: message.reqId, seq: message.seq, cancelled: false };
    this.#running = run;
    void this.#drive(run, message, resident);
  }

  /** Runs one encode slice by slice; between slices the event loop delivers `cancel`/`encode` messages. */
  async #drive(run: Running, message: EncodeMessage, resident: Resident): Promise<void> {
    try {
      const steps = resident.tokenizer.encodeIncremental(
        message.text,
        message.options,
        message.budgetMs ?? DEFAULT_BUDGET_MS,
      );
      for (;;) {
        if (run.cancelled) {
          this.#post({ type: 'cancelled', reqId: run.reqId });
          return;
        }
        const step = steps.next();
        if (step.done === true) {
          const result = { ...step.value, seq: run.seq };
          this.#post({ type: 'result', reqId: run.reqId, seq: run.seq, result }, transferablesOf(result));
          return;
        }
        const { bytesDone, bytesTotal } = step.value;
        this.#post({
          type: 'progress',
          reqId: run.reqId,
          progress: { tokenizer: resident.id, phase: 'encode', loaded: bytesDone, total: bytesTotal },
        });
        await this.#yield();
      }
    } catch (error) {
      if (run.cancelled) this.#post({ type: 'cancelled', reqId: run.reqId });
      else this.#postError(run.reqId, error, 'encode');
    } finally {
      if (this.#running === run) this.#running = null;
      this.#startPending();
    }
  }

  #lookup(message: LookupMessage): void {
    const resident = this.#resident;
    if (resident === null) {
      this.#post({
        type: 'error',
        reqId: message.reqId,
        code: 'not-loaded',
        message: 'no tokenizer is loaded',
        retryable: false,
      });
      return;
    }
    const { tokenizer } = resident;
    // Copies: `tokenBytes` returns a view into the vocabulary, and posting a view would clone its whole buffer.
    const entries: LookupEntry[] = (message.ids ?? []).map((id) => ({
      id,
      bytes: tokenizer.tokenBytes(id)?.slice() ?? null,
      piece: tokenizer.pieceString(id),
    }));
    if (message.bytes !== undefined) {
      const id = tokenizer.idOf(message.bytes);
      entries.push({ id, bytes: message.bytes.slice(), piece: id === null ? null : tokenizer.pieceString(id) });
    }
    this.#post({ type: 'lookupResult', reqId: message.reqId, entries });
  }
}

/** Creates a host over injected dependencies (PA-8). */
export function createHost(deps: HostDeps): Host {
  return new WorkerHost(deps);
}

/** The parts of a dedicated Worker's global scope the host talks through. */
export interface WorkerScopeLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Wires a host to a Worker scope: incoming messages are handled, replies posted with their transfer lists. */
export function startHost(scope: WorkerScopeLike, deps: Omit<HostDeps, 'post'>): Host {
  const host = createHost({
    ...deps,
    post: (message, transfer) => {
      scope.postMessage(message, transfer);
    },
  });
  scope.addEventListener('message', (event) => {
    host.handle(event.data as ToWorker);
  });
  return host;
}
