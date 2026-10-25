/**
 * `TokenizerClient` — the main thread's side of the FROZEN Worker protocol (04 §6, AD-19, AD-21); framework-free, so
 * `apps/web` wraps `onResident` in a rune. It is constructed with a Worker factory, which it calls for the first Worker
 * and for the single respawn:
 *
 *   import TokWorker from '@tsbs/worker/entry?worker';
 *   import { TokenizerClient, WORKER_NAME } from '@tsbs/worker/client';
 *   const client = new TokenizerClient(() => new TokWorker({ name: WORKER_NAME }));
 *
 * Rules it implements: reqIds strictly increase; every `encode` gets a `seq`, the latest text wins and every older
 * encode is cancelled at once (a pending one is dropped by the Worker, an in-flight one stops at its next slice) and
 * rejects with the single name `cancelled` (`CancelledError`, shared with WP01's `MockTokenizerClient`); results whose
 * `seq` is older than the latest are dropped; an `AbortSignal` posts `cancel` with `target` = that request's reqId;
 * switching tokenizers posts `unload` before `load` (strict one-resident, AD-19); `features` / `assets` resolve from
 * the Worker's `ready`. **Watchdog:** any Worker message is liveness; while a request is outstanding the client pings
 * every 10 s unless an encode slice posted `progress` since the last tick, and two silent ticks terminate the Worker,
 * respawn it, replay the last requested `load` and reject outstanding encodes with `cancelled`. A crash (`error`
 * event) respawns the same way, once per tokenizer; a second crash on the same tokenizer surfaces `oom` (AD-19).
 */
import type { EncodeOptions, TokenizationResult, TokenizerId } from '@tsbs/core/model/result';
import { CancelledError } from '@tsbs/core/fixture/mock-client';
import type {
  AssetSummary,
  Features,
  FromWorker,
  LoadedInfo,
  LookupEntry,
  Progress,
  ToWorker,
  TokenizerClientLike,
} from '@tsbs/core/protocol';
import { cachedTokenizerIds, type CacheStorageLike } from './cache-store.ts';
import { TokenizerError } from './errors.ts';

export { CancelledError, isCancelled } from '@tsbs/core/fixture/mock-client';
export { TokenizerError } from './errors.ts';

/** Name given to the tokenizer Worker (`new TokWorker({ name })`) so it is identifiable in devtools and crash reports. */
export const WORKER_NAME = 'tsbs-tokenizer';

/** Watchdog period (04 §6 rule 6). */
export const WATCHDOG_MS = 10_000;

/** What the client needs of a `Worker` (a real `Worker` satisfies it; tests pass fakes). */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
  terminate(): void;
}

export interface TokenizerClientOptions {
  /** Watchdog period in ms (default 10 s). */
  readonly watchdogMs?: number;
}

/** The `AbortSignal` shape of the frozen interface (a real `AbortSignal` fits). */
type Signal = NonNullable<Parameters<TokenizerClientLike['load']>[2]>;

/** One outstanding request, by kind. */
type Request =
  | { readonly kind: 'hello' }
  | {
      readonly kind: 'load';
      readonly id: TokenizerId;
      readonly resolve: (loaded: LoadedInfo) => void;
      readonly reject: (error: Error) => void;
      readonly onProgress: ((p: Progress) => void) | undefined;
      readonly detach: () => void;
    }
  | {
      readonly kind: 'encode';
      readonly seq: number;
      readonly resolve: (result: TokenizationResult) => void;
      readonly reject: (error: Error) => void;
      readonly onProgress: ((p: Progress) => void) | undefined;
      readonly detach: () => void;
    }
  | { readonly kind: 'prefetch'; readonly resolve: () => void; readonly reject: (error: Error) => void }
  | {
      readonly kind: 'lookup';
      readonly resolve: (entries: LookupEntry[]) => void;
      readonly reject: (error: Error) => void;
    }
  | { readonly kind: 'unload'; readonly resolve: () => void };

/** The Network Information API fields the prefetch rule reads. */
export interface ConnectionLike {
  readonly effectiveType?: string;
  readonly saveData?: boolean;
}

/**
 * AD-19 prefetch rule: prefetch when `navigator.connection` is undefined (Firefox, Safari — otherwise prefetch would
 * never run there) or `effectiveType === '4g'`, and never when `saveData` is set.
 */
export function shouldPrefetch(connection: ConnectionLike | undefined): boolean {
  if (connection === undefined) return true;
  if (connection.saveData === true) return false;
  return connection.effectiveType === '4g';
}

/** Main-thread globals the client reads (each may be missing). */
interface PageGlobals {
  readonly location?: { readonly origin: string };
  readonly caches?: CacheStorageLike;
  readonly navigator?: { readonly connection?: ConnectionLike };
  readonly requestIdleCallback?: (callback: () => void, options?: { readonly timeout: number }) => number;
}

const page = (): PageGlobals => globalThis as unknown as PageGlobals;

/**
 * Tokenizers whose vocabulary is in the Cache API now — the picker's "downloaded ✓" and About › Diagnostics, read on
 * the main thread with no Worker round trip (`cache.keys()` each time, 03 §C.6).
 */
export function probeCachedTokenizers(assets: AssetSummary, origin?: string): Promise<TokenizerId[]> {
  const scope = page();
  const base = origin ?? scope.location?.origin;
  if (base === undefined) return Promise.resolve([]);
  return cachedTokenizerIds(scope.caches ?? null, assets, base);
}

export class TokenizerClient implements TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary>;
  readonly #spawn: () => WorkerLike;
  readonly #watchdogMs: number;
  readonly #requests = new Map<number, Request>();
  readonly #listeners = new Set<(id: TokenizerId | null) => void>();
  readonly #respawned = new Set<TokenizerId>();
  readonly #ready: (value: { features: Features; assets: AssetSummary }) => void;
  readonly #failReady: (error: Error) => void;
  #worker: WorkerLike | null = null;
  #generation = 0;
  /**
   * Some Worker of this client has posted a message. Until then an `error` event means the script never ran (a chunk
   * missing after a deploy); afterwards it is a crash — even before a respawned Worker's `ready`, since the replayed
   * `load` may kill it before its asynchronous feature probe answers.
   */
  #started = false;
  #reqId = 0;
  #seq = 0;
  #latestSeq = 0;
  #resident: TokenizerId | null = null;
  /** The last tokenizer `load` asked for and not unloaded since: what a respawn replays. */
  #wanted: TokenizerId | null = null;
  #terminated = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  #heard = true;
  #encodeProgress = false;
  #missed = 0;

  /** `spawn` creates the Worker: once now, and again for the single respawn. */
  constructor(spawn: () => WorkerLike, options: TokenizerClientOptions = {}) {
    this.#spawn = spawn;
    this.#watchdogMs = options.watchdogMs ?? WATCHDOG_MS;
    let ready: (value: { features: Features; assets: AssetSummary }) => void = () => undefined;
    let failReady: (error: Error) => void = () => undefined;
    const readyPromise = new Promise<{ features: Features; assets: AssetSummary }>((resolve, reject) => {
      ready = resolve;
      failReady = reject;
    });
    this.#ready = ready;
    this.#failReady = failReady;
    this.features = readyPromise.then((r) => r.features);
    this.assets = readyPromise.then((r) => r.assets);
    // Callers observe these when they await them; until then a rejection is not an unhandled one.
    this.features.catch(() => undefined);
    this.assets.catch(() => undefined);
    this.#ensureWorker();
  }

  /** The resident tokenizer (plain getter; null while switching). */
  get resident(): TokenizerId | null {
    return this.#resident;
  }

  onResident(cb: (id: TokenizerId | null) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  load(id: TokenizerId, onProgress?: (p: Progress) => void, signal?: Signal): Promise<LoadedInfo> {
    if (this.#terminated) return Promise.reject(terminatedError());
    if (signal?.aborted === true) return Promise.reject(new CancelledError());
    for (const [reqId, request] of this.#requests) {
      if (request.kind !== 'load') continue;
      this.#requests.delete(reqId); // superseded: the Worker aborts it on the newer load (rule 4)
      request.detach();
      request.reject(new CancelledError());
    }
    if (this.#resident !== null && this.#resident !== id) {
      // Strict one-resident (AD-19): the old tables are dropped before `load` is posted.
      this.#post({ type: 'unload', reqId: this.#nextReqId() });
      this.#setResident(null);
    }
    this.#wanted = id;
    const reqId = this.#nextReqId();
    return new Promise<LoadedInfo>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.#requests.get(reqId) !== request) return;
        this.#forget(reqId);
        reject(new CancelledError());
        if (this.#wanted === id) {
          this.#wanted = null;
          this.#post({ type: 'unload', reqId: this.#nextReqId() });
          this.#setResident(null);
        }
      };
      const request: Request = {
        kind: 'load',
        id,
        resolve,
        reject,
        onProgress,
        detach: () => {
          signal?.removeEventListener('abort', onAbort);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#track(reqId, request);
      this.#post({ type: 'load', reqId, tokenizer: id });
    });
  }

  prefetch(id: TokenizerId): Promise<void> {
    if (this.#terminated) return Promise.reject(terminatedError());
    const reqId = this.#nextReqId();
    return new Promise<void>((resolve, reject) => {
      this.#track(reqId, { kind: 'prefetch', resolve, reject });
      this.#post({ type: 'prefetch', reqId, tokenizer: id });
    });
  }

  /**
   * Issues `prefetch(id)` when the browser is idle, if the AD-19 rule allows it (no `saveData`; 4G or no Network
   * Information API). For the lab's secondary tokenizer; failures are ignored.
   */
  prefetchWhenIdle(id: TokenizerId): void {
    const scope = page();
    if (!shouldPrefetch(scope.navigator?.connection)) return;
    const run = (): void => {
      if (!this.#terminated) this.prefetch(id).catch(() => undefined);
    };
    if (typeof scope.requestIdleCallback === 'function') scope.requestIdleCallback(run, { timeout: 10_000 });
    else setTimeout(run, 1000);
  }

  encode(
    text: string,
    options: EncodeOptions,
    onProgress?: (p: Progress) => void,
    signal?: Signal,
  ): Promise<TokenizationResult> {
    if (this.#terminated) return Promise.reject(terminatedError());
    const seq = ++this.#seq;
    this.#latestSeq = seq;
    // Latest text wins: every older encode is cancelled now (AD-21).
    for (const [reqId, request] of this.#requests) {
      if (request.kind !== 'encode') continue;
      this.#forget(reqId);
      this.#post({ type: 'cancel', reqId: this.#nextReqId(), target: reqId });
      request.reject(new CancelledError());
    }
    if (signal?.aborted === true) return Promise.reject(new CancelledError());
    const reqId = this.#nextReqId();
    return new Promise<TokenizationResult>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.#requests.get(reqId) !== request) return;
        this.#forget(reqId);
        this.#post({ type: 'cancel', reqId: this.#nextReqId(), target: reqId });
        reject(new CancelledError());
      };
      const request: Request = {
        kind: 'encode',
        seq,
        resolve,
        reject,
        onProgress,
        detach: () => {
          signal?.removeEventListener('abort', onAbort);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#track(reqId, request);
      this.#post({ type: 'encode', reqId, seq, text, options: plainOptions(options) });
    });
  }

  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]> {
    if (this.#terminated) return Promise.reject(terminatedError());
    const reqId = this.#nextReqId();
    return new Promise<LookupEntry[]>((resolve, reject) => {
      this.#track(reqId, { kind: 'lookup', resolve, reject });
      this.#post({
        type: 'lookup',
        reqId,
        ...(q.ids === undefined ? {} : { ids: [...q.ids] }),
        ...(q.bytes === undefined ? {} : { bytes: q.bytes }),
      });
    });
  }

  unload(): Promise<void> {
    if (this.#terminated) return Promise.resolve();
    // The Worker aborts the load in flight and cancels its encodes; their promises settle now.
    for (const [reqId, request] of this.#requests) {
      if (request.kind !== 'load' && request.kind !== 'encode') continue;
      this.#forget(reqId);
      request.reject(new CancelledError());
    }
    this.#wanted = null;
    this.#setResident(null);
    const reqId = this.#nextReqId();
    return new Promise<void>((resolve) => {
      this.#track(reqId, { kind: 'unload', resolve });
      this.#post({ type: 'unload', reqId });
    });
  }

  /** The picker's "downloaded ✓" probe (03 §C.6) against this build's assets. */
  cachedTokenizers(): Promise<TokenizerId[]> {
    return this.assets.then((assets) => probeCachedTokenizers(assets));
  }

  terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#discardWorker();
    this.#settleAll(new CancelledError());
    this.#failReady(terminatedError());
    this.#setResident(null);
  }

  // ---- internals ----

  #nextReqId(): number {
    return ++this.#reqId;
  }

  #setResident(id: TokenizerId | null): void {
    if (this.#resident === id) return;
    this.#resident = id;
    for (const cb of this.#listeners) cb(id);
  }

  #ensureWorker(): WorkerLike {
    if (this.#worker !== null) return this.#worker;
    const generation = ++this.#generation;
    const worker = this.#spawn();
    this.#worker = worker;
    worker.addEventListener('message', (event) => {
      if (generation === this.#generation) this.#onMessage(event.data as FromWorker);
    });
    worker.addEventListener('error', (event) => {
      if (generation === this.#generation) this.#onError(event.message);
    });
    const reqId = this.#nextReqId();
    this.#track(reqId, { kind: 'hello' });
    worker.postMessage({ type: 'hello', reqId }, []);
    return worker;
  }

  #post(message: ToWorker, transfer: Transferable[] = []): void {
    this.#ensureWorker().postMessage(message, transfer);
  }

  #track(reqId: number, request: Request): void {
    this.#requests.set(reqId, request);
    if (this.#timer === null) {
      this.#heard = true;
      this.#encodeProgress = false;
      this.#missed = 0;
      this.#timer = setInterval(() => {
        this.#tick();
      }, this.#watchdogMs);
    }
  }

  /** Removes a request (detaching its abort listener); the watchdog stops when nothing is outstanding. */
  #forget(reqId: number): void {
    const request = this.#requests.get(reqId);
    if (request === undefined) return;
    this.#requests.delete(reqId);
    if (request.kind === 'load' || request.kind === 'encode') request.detach();
    if (this.#requests.size === 0) this.#stopWatchdog();
  }

  #stopWatchdog(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One watchdog period: silence twice in a row (no message, no pong) → respawn. */
  #tick(): void {
    if (this.#requests.size === 0 || this.#worker === null) {
      this.#stopWatchdog();
      return;
    }
    if (this.#heard) this.#missed = 0;
    else if (++this.#missed >= 2) {
      this.#recover();
      return;
    }
    const ping = !this.#encodeProgress;
    this.#heard = false;
    this.#encodeProgress = false;
    if (ping) this.#post({ type: 'ping', reqId: this.#nextReqId() });
  }

  #onMessage(message: FromWorker): void {
    this.#started = true;
    this.#heard = true;
    const request = this.#requests.get(message.reqId);
    switch (message.type) {
      case 'ready':
        this.#ready({ features: message.features, assets: message.assets });
        this.#forget(message.reqId);
        return;
      case 'progress':
        if (message.progress.phase === 'encode') this.#encodeProgress = true;
        if (request?.kind === 'prefetch') {
          if (message.progress.phase === 'cache') {
            this.#forget(message.reqId);
            request.resolve();
          }
        } else if (request?.kind === 'load' || request?.kind === 'encode') {
          request.onProgress?.(message.progress);
        }
        return;
      case 'loaded':
        if (request?.kind !== 'load') return;
        this.#forget(message.reqId);
        this.#setResident(message.loaded.info.id);
        request.resolve(message.loaded);
        return;
      case 'result':
        if (request?.kind !== 'encode') return;
        this.#forget(message.reqId);
        if (message.seq < this.#latestSeq) request.reject(new CancelledError());
        else request.resolve(message.result);
        return;
      case 'cancelled':
        if (request?.kind !== 'encode') return;
        this.#forget(message.reqId);
        request.reject(new CancelledError());
        return;
      case 'lookupResult':
        if (request?.kind !== 'lookup') return;
        this.#forget(message.reqId);
        request.resolve(message.entries);
        return;
      case 'unloaded':
        if (request?.kind !== 'unload') return;
        this.#forget(message.reqId);
        request.resolve();
        return;
      case 'error':
        if (request === undefined || request.kind === 'hello' || request.kind === 'unload') return;
        this.#forget(message.reqId);
        if (request.kind === 'load' && this.#wanted === request.id) this.#wanted = null;
        request.reject(new TokenizerError(message.code, message.message, message.retryable));
        return;
      case 'pong':
        return;
      default:
        return;
    }
  }

  /** An `error` event: a Worker that never ran cannot be helped by a respawn; a running one crashed. */
  #onError(detail: string | undefined): void {
    if (this.#started) {
      this.#recover();
      return;
    }
    const error = new TokenizerError(
      'fetch',
      `the tokenizer worker could not start${detail === undefined || detail === '' ? '' : `: ${detail}`}`,
      false,
    );
    this.#discardWorker();
    this.#settleAll(error);
    this.#wanted = null;
    this.#failReady(error);
    this.#setResident(null);
  }

  #discardWorker(): void {
    this.#stopWatchdog();
    this.#generation++;
    this.#worker?.terminate();
    this.#worker = null;
  }

  /** Settles every outstanding request with `error` (unloads resolve: nothing is resident any more). */
  #settleAll(error: Error): void {
    const requests = [...this.#requests.values()];
    this.#requests.clear();
    for (const request of requests) {
      if (request.kind === 'hello') continue;
      if (request.kind === 'unload') request.resolve();
      else {
        if (request.kind === 'load' || request.kind === 'encode') request.detach();
        request.reject(error);
      }
    }
  }

  /**
   * After a crash or two silent watchdog periods: terminate, then respawn and replay the last requested `load`, at most
   * once per tokenizer (AD-19); a second failure on the same tokenizer surfaces `oom` instead of looping.
   */
  #recover(): void {
    const id = this.#wanted;
    const load = [...this.#requests].find(
      (entry): entry is [number, Extract<Request, { kind: 'load' }>] => entry[1].kind === 'load',
    );
    this.#discardWorker();
    this.#setResident(null);
    if (load !== undefined) this.#requests.delete(load[0]);
    if (id !== null && this.#respawned.has(id)) {
      this.#wanted = null;
      const oom = new TokenizerError(
        'oom',
        `${id} stopped the tokenizer worker twice; it may need more memory than this device has`,
        false,
      );
      this.#settleAll(oom);
      if (load !== undefined) {
        load[1].detach();
        load[1].reject(oom);
      }
      return; // the next request spawns a fresh Worker
    }
    // Outstanding encodes were for the dead Worker: `cancelled` (rule 6); other requests cannot be replayed.
    const requests = [...this.#requests.values()];
    this.#requests.clear();
    for (const request of requests) {
      if (request.kind === 'encode') {
        request.detach();
        request.reject(new CancelledError());
      } else if (request.kind === 'unload') request.resolve();
      else if (request.kind !== 'hello') {
        request.reject(new TokenizerError('internal', 'the tokenizer worker restarted', true));
      }
    }
    this.#ensureWorker();
    if (id === null) return;
    this.#respawned.add(id);
    const reqId = this.#nextReqId();
    this.#track(
      reqId,
      load?.[1] ?? {
        kind: 'load',
        id,
        resolve: () => undefined,
        reject: () => undefined,
        onProgress: undefined,
        detach: () => undefined,
      },
    );
    this.#post({ type: 'load', reqId, tokenizer: id });
  }
}

/**
 * A plain copy of the options: `postMessage` cannot clone a reactive proxy (a Svelte `$state` object), and the copy
 * keeps exactly the four frozen fields.
 */
function plainOptions(options: EncodeOptions): EncodeOptions {
  const { trace } = options;
  return {
    specialTokens: options.specialTokens,
    addBos: options.addBos,
    normalize: options.normalize,
    trace: typeof trace === 'boolean' ? trace : { maxSteps: trace.maxSteps },
  };
}

function terminatedError(): TokenizerError {
  return new TokenizerError('not-loaded', 'the tokenizer client was terminated', false);
}
