/**
 * The result hub (PA-19): one result per tokenizer and token options, shared by every view that shows it — the table's
 * rows (fixed `ROW_OPTIONS`, no timeline) and the step-by-step board (`AppState`: its options, traced) — over one Worker
 * per tokenizer (the pool in `result-hub-engine.ts`; AD-19 holds per Worker).
 *
 * - **Entries.** `entry(id, options)` is the reactive state of one tokenizer under one set of token options: `result`,
 *   `source` (`precomputed` | `live`), `pending` (an answer is on its way), `progress` (the tokenizer's load), `error` and
 *   `traced` (the latest request asked for a merge timeline). The board and a row share the entry when their token
 *   options agree (every tokenizer's registry defaults equal `ROW_OPTIONS`), so **one** traced request serves both; a
 *   board toggle (NFKC, BOS, special tokens) gives the board an entry of its own on the same Worker.
 * - **Requests.** `request(id, text, options, { trace })` answers from the precomputed examples while the tokenizer is
 *   not loaded (AD-16: every chip × all nine tokenizers, the lazy `examples/<id>.<sha8>.json` files, the default rows
 *   inlined); free text waits for the engine and asks for its load (once the hub is started). A loaded tokenizer encodes
 *   live with the client's latest-wins rule (AD-21): a newer request for the entry supersedes the older one, and a
 *   superseded or cancelled request is never an error. Requests for the same text are shared, and a live result answers
 *   a request it covers (a traced result answers an untraced one). One Worker runs one encode at a time and cancels
 *   older ones, so the requests of two entries on the same Worker take turns. Every request settles with a `HubAnswer`.
 * - **Loads.** Nothing loads before `start()` (06 §3: after first paint) except an explicit `load(id)` (the board's
 *   tokenizer, AppState). Then a tokenizer loads when a request for it has no precomputed answer (the first free-text
 *   edit), when `ensureRows` asks for it (a row switched to it), or when `load` does; when it is loaded, entries that wait
 *   for it, or show its precomputed result for the text they asked for, are encoded live. A failed load answers the
 *   requests that waited for it (`error`; `none` when it was cancelled) and the next load runs them. `prefetchIdle`
 *   downloads more vocabularies into the Cache API only (no engine) a while after the load trigger, unless Save-Data is
 *   on.
 * - **Memory (AD-27).** A view `retain`s the entries it shows and `release`s them; an entry nobody holds drops its result,
 *   and a Worker nobody holds may be evicted. A request whose result may exceed 8 MB releases the entry's previous result
 *   first, and `forget` drops an entry's result (and any answer still on its way) at once.
 * - **First paint.** This module holds only the results. The Worker side (`HubEngine`: the pool, loads, encodes,
 *   prefetches) is imported with the first load, after first paint, with the client code it spawns; a failed import is a
 *   `fetch` error ("a new version is available — reload", AD-11).
 */
import type {
  AssetSummary,
  EncodeOptions,
  Features,
  LoadedInfo,
  LookupEntry,
  Progress,
  TokenizationResult,
  TokenizerId,
} from '@tsbs/core';
import { isCancelledError, toUiError, type UiError } from './errors.ts';
import { estimatedResultBytes, RELEASE_ABOVE_BYTES, utf8ByteLength } from './long-input.ts';
import type { PrecomputedSource } from './precomputed.ts';
import { tokenizerEntry } from './registry.ts';
import type { PoolEntry } from './tokenizer-pool.ts';

/** The options that change tokens (`trace` only changes the timeline). */
export type TokenOptions = Pick<EncodeOptions, 'specialTokens' | 'addBos' | 'normalize'>;
type Trace = EncodeOptions['trace'];
export type ResultSource = 'precomputed' | 'live';

/** The table rows' fixed options (PA-19): no specials matched, no BOS, no NFKC, so every row indexes the input's bytes. */
export const ROW_OPTIONS: TokenOptions = { specialTokens: 'as-text', addBos: false, normalize: 'none' };

/** The idle prefetch starts this long after the load trigger (PA-19). */
export const IDLE_PREFETCH_MS = 10_000;

/**
 * How a request ended: its result (`source` says where it came from), the error its encode failed with (also on the
 * entry), or `none` — superseded by a newer request, cancelled, or dropped with its entry.
 */
export type HubAnswer =
  | { readonly kind: 'result'; readonly result: TokenizationResult; readonly source: ResultSource }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'none' };

/** The reactive state of one tokenizer under one set of token options (read it in templates and `$derived`s). */
export interface HubEntry {
  readonly id: TokenizerId;
  readonly options: TokenOptions;
  /** The latest result accepted for the latest request (kept until the next one; null after a release). */
  readonly result: TokenizationResult | null;
  readonly source: ResultSource | null;
  /** The latest request has no answer yet (an encode, a lookup or the tokenizer's load is on its way). */
  readonly pending: boolean;
  /** The tokenizer's load progress (null while nothing loads). */
  readonly progress: Progress | null;
  /** The latest request's encode error, else the tokenizer's load error (05 §12 copy through `errorView`). */
  readonly error: UiError | null;
  /** The latest request asked for a merge timeline (the board reads this entry). */
  readonly traced: boolean;
}

/** One request of an entry, as the engine sees it. */
export interface Ticket {
  readonly text: string;
  readonly trace: Trace;
  /** The entry's generation when it was issued: a `forget` or release since then drops its answer. */
  readonly generation: number;
  readonly promise: Promise<HubAnswer>;
  readonly settle: (answer: HubAnswer) => void;
  settled: boolean;
  /** No precomputed answer: it runs when the tokenizer is loaded. */
  waiting: boolean;
  /** Its encode was posted. */
  posted: boolean;
}

/** One tokenizer as the engine sees it: its Worker, load, residency and the turn order of its entries' encodes. */
export interface HubLane {
  readonly id: TokenizerId;
  pool: PoolEntry | null;
  resident: boolean;
  progress: Progress | null;
  error: UiError | null;
  loading: Promise<LoadedInfo> | null;
  readonly listeners: Array<(progress: Progress) => void>;
  readonly holders: number;
  inflight: { readonly entry: HubEntryState; readonly ticket: Ticket } | null;
  readonly queue: HubEntryState[];
  readonly entries: readonly HubEntryState[];
}

/** One entry as the engine sees it. */
export interface HubEntryState {
  readonly id: TokenizerId;
  readonly options: TokenOptions;
  readonly lane: HubLane;
  readonly result: TokenizationResult | null;
  readonly source: ResultSource | null;
  readonly generation: number;
  readonly wanted: { readonly text: string; readonly trace: Trace } | null;
  ticket: Ticket | null;
  pending: boolean;
  ownError: UiError | null;
  /** A failed load answered the request for `wanted`: the next load runs it (unless a `forget` or release drops it). */
  retry: boolean;
}

/** What the engine calls back. */
export interface EngineHost {
  accept(entry: HubEntryState, ticket: Ticket, result: TokenizationResult, source: ResultSource): void;
  /** Drops the entry's result, and answers still on their way (`forget`). */
  forget(entry: HubEntryState): void;
  /** The Worker lost the tokenizer: load it again (the waiting request runs then). */
  reload(id: TokenizerId): void;
  assets(summary: AssetSummary): void;
  /** The lane of `id`, if there is one. */
  lane(id: TokenizerId): HubLane | undefined;
}

/** The Worker side of the hub (`result-hub-engine.ts`). */
export interface HubEngine {
  /** Keeps one pool user for the lane while views hold it and it has a client. */
  hold(lane: HubLane): void;
  /**
   * Loads the lane's tokenizer in its Worker (shared with a load in flight; progress and errors on the lane); requests
   * that wait for it, and precomputed answers of what was asked, run once it is resident.
   */
  load(lane: HubLane, onProgress?: (progress: Progress) => void): Promise<LoadedInfo>;
  /** Posts the entry's request to its Worker, or queues it behind another entry's encode on the same Worker. */
  post(entry: HubEntryState): void;
  /** Prefetches the vocabularies of `ids` one after another through a Worker that is up (skips loaded ones). */
  prefetch(ids: readonly TokenizerId[]): Promise<void>;
  features(id: TokenizerId): Promise<Features> | null;
  lookup(id: TokenizerId, q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]>;
}

/** Creates the engine; the page's is imported lazily (tests pass one over their own pool). */
export type EngineSource = () => ((host: EngineHost) => HubEngine) | Promise<(host: EngineHost) => HubEngine>;

const lazyEngine: EngineSource = () =>
  import('./result-hub-engine.ts').then((module) => (host: EngineHost) => module.createEngine(host));

/** What a request may reuse: true covers everything; a step cap covers smaller caps; false covers only false. */
function covers(has: Trace, wants: Trace): boolean {
  if (wants === false || has === true) return true;
  if (wants === true || has === false) return false;
  return has.maxSteps >= wants.maxSteps;
}

const keyOf = (id: TokenizerId, options: TokenOptions): string =>
  `${id}|${options.specialTokens}|${String(options.addBos)}|${options.normalize}`;

const NONE: HubAnswer = { kind: 'none' };

/** A new request of `text` with `trace` (`generation`: its entry's). */
export function ticketFor(text: string, trace: Trace, generation: number): Ticket {
  let settle: (answer: HubAnswer) => void = () => undefined;
  const promise = new Promise<HubAnswer>((resolve) => {
    settle = resolve;
  });
  return { text, trace, generation, promise, settle, settled: false, waiting: false, posted: false };
}

class Lane implements HubLane {
  readonly id: TokenizerId;
  pool: PoolEntry | null = null;
  /** The pool entry's client has the tokenizer resident (its `onResident`). */
  resident = $state(false);
  progress: Progress | null = $state.raw(null);
  error: UiError | null = $state.raw(null);
  loading: Promise<LoadedInfo> | null = null;
  readonly listeners: Array<(progress: Progress) => void> = [];
  /** Entry holds (views). */
  holders = 0;
  inflight: { readonly entry: HubEntryState; readonly ticket: Ticket } | null = null;
  readonly queue: HubEntryState[] = [];
  readonly entries: Entry[] = [];

  constructor(id: TokenizerId) {
    this.id = id;
  }
}

class Entry implements HubEntry, HubEntryState {
  readonly id: TokenizerId;
  readonly options: TokenOptions;
  readonly lane: Lane;
  result: TokenizationResult | null = $state.raw(null);
  source: ResultSource | null = $state(null);
  pending = $state(false);
  traced = $state(false);
  ownError: UiError | null = $state.raw(null);
  holders = 0;
  generation = 0;
  /** The latest request still waiting for its answer. */
  ticket: Ticket | null = null;
  /** The text and trace last asked for (a precomputed answer of it is encoded live once the tokenizer loads). */
  wanted: { readonly text: string; readonly trace: Trace } | null = null;
  retry = false;

  constructor(lane: Lane, options: TokenOptions) {
    this.id = lane.id;
    this.lane = lane;
    this.options = options;
  }

  get progress(): Progress | null {
    return this.lane.progress;
  }

  get error(): UiError | null {
    return this.ownError ?? this.lane.error;
  }
}

export interface ResultHubOptions {
  /** Precomputed example results (AD-16); null: free text and chips alike wait for the engine. */
  readonly precomputed?: PrecomputedSource | null;
  /** Results on screen before any request (the inlined default rows, PA-19), each under its own options. */
  readonly seeds?: Iterable<TokenizationResult>;
  /** The Worker side (default: `result-hub-engine.ts`, imported with the first load). */
  readonly engine?: EngineSource;
}

export class ResultHub {
  /** Wire sizes of the vocabularies (the first client's `ready.assets`, AD-11); null until a client reports them. */
  assets: AssetSummary | null = $state.raw(null);
  readonly #precomputed: PrecomputedSource | null;
  readonly #engineSource: EngineSource;
  #engine: HubEngine | null = null;
  #engineImport: Promise<HubEngine> | null = null;
  /* eslint-disable svelte/prefer-svelte-reactivity -- bookkeeping no view reads: `entry()` and `loaded()` may run while a
     template renders, where adding to a reactive collection would be an unsafe mutation; what views read is $state. */
  readonly #lanes = new Map<TokenizerId, Lane>();
  readonly #entries = new Map<string, Entry>();
  /** Loads asked for before `start()` (free text, `ensureRows`). */
  readonly #deferred = new Set<TokenizerId>();
  /* eslint-enable svelte/prefer-svelte-reactivity */
  #started = false;
  readonly #host: EngineHost = {
    accept: (entry, ticket, result, source) => {
      this.#accept(entry as Entry, ticket, result, source);
    },
    forget: (entry) => {
      this.forget(entry.id, entry.options);
    },
    reload: (id) => {
      this.#loadQuietly(id);
    },
    assets: (summary) => {
      this.assets ??= summary;
    },
    lane: (id) => this.#lanes.get(id),
  };

  constructor(options: ResultHubOptions = {}) {
    this.#precomputed = options.precomputed ?? null;
    this.#engineSource = options.engine ?? lazyEngine;
    for (const result of options.seeds ?? []) this.seed(result);
  }

  /** The entry of `id` under `options` (created empty on first use). */
  entry(id: TokenizerId, options: TokenOptions = ROW_OPTIONS): HubEntry {
    return this.#entryOf(id, options);
  }

  /** Puts a precomputed result on its entry (no request; the next request replaces it). */
  seed(result: TokenizationResult): void {
    const entry = this.#entryOf(result.tokenizer, result.options);
    entry.result = result;
    entry.source = 'precomputed';
  }

  /** True while `id` is resident in its Worker. */
  loaded(id: TokenizerId): boolean {
    return this.#laneOf(id).resident;
  }

  /** A view shows the entry: its result is kept and its Worker is not evicted until every holder has released it. */
  retain(id: TokenizerId, options: TokenOptions = ROW_OPTIONS): void {
    const entry = this.#entryOf(id, options);
    entry.holders++;
    entry.lane.holders++;
    this.#engine?.hold(entry.lane);
  }

  /** The view no longer shows the entry; the last release drops its result and its pending request (AD-27). */
  release(id: TokenizerId, options: TokenOptions = ROW_OPTIONS): void {
    const entry = this.#entries.get(keyOf(id, options));
    if (entry === undefined || entry.holders === 0) return;
    entry.holders--;
    entry.lane.holders--;
    if (entry.holders === 0) {
      this.#supersede(entry);
      this.forget(id, options);
      entry.wanted = null;
      entry.pending = false;
      entry.traced = false;
      entry.ownError = null;
      entry.retry = false;
    }
    this.#engine?.hold(entry.lane);
  }

  /**
   * Drops the entry's result now, and the answer of any request issued before — a failed load's request included, which
   * the next load no longer runs (AD-27: never keep, or compute again, what is not shown).
   */
  forget(id: TokenizerId, options: TokenOptions = ROW_OPTIONS): void {
    const entry = this.#entries.get(keyOf(id, options));
    if (entry === undefined) return;
    entry.generation++;
    entry.result = null;
    entry.source = null;
    entry.retry = false;
  }

  /** The page has painted (06 §3): loads that requests or `ensureRows` asked for may start now. */
  start(): void {
    this.#started = true;
    for (const id of this.#deferred) this.#loadQuietly(id);
    this.#deferred.clear();
  }

  /**
   * Loads `id` in its own Worker (shared with a load in flight); rejects with the client's error (also `progress`/`error`),
   * after answering the requests that waited for it.
   */
  load(id: TokenizerId, onProgress?: (progress: Progress) => void): Promise<LoadedInfo> {
    const lane = this.#laneOf(id);
    const engine = this.#engineNow();
    const loading =
      engine instanceof Promise
        ? engine.then(
            (installed) => installed.load(lane, onProgress),
            (error: unknown) => {
              lane.error = toUiError(error, id, null, 'load');
              throw error;
            },
          )
        : engine.load(lane, onProgress);
    loading.catch((error: unknown) => {
      this.#loadFailed(lane, error);
    });
    return loading;
  }

  /** Loads the rows' tokenizers now (a row switched to them, PA-19), or once the hub is started. */
  ensureRows(ids: readonly TokenizerId[]): void {
    for (const id of ids) this.#want(id);
  }

  /**
   * `delayMs` after the call (the load trigger), downloads the vocabularies of `ids` into the Cache API one after another
   * — no engine is built — through a Worker that is already up, unless `navigator.connection.saveData` is set. Skips
   * tokenizers that are loaded, loading or already prefetched. Resolves when it is done (best effort: failures are quiet).
   */
  async prefetchIdle(ids: readonly TokenizerId[], delayMs = IDLE_PREFETCH_MS): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const scope = globalThis as { navigator?: { connection?: { saveData?: boolean } } };
    if (scope.navigator?.connection?.saveData !== true) await this.#engine?.prefetch(ids); // no Worker yet: nothing to do
  }

  /** The Worker features of `id`'s client (`ready.features`), or null when it has no client. */
  features(id: TokenizerId): Promise<Features> | null {
    return this.#engine?.features(id) ?? null;
  }

  /** Vocabulary lookups (04 §6) on `id`'s Worker; rejects when `id` is not resident there. */
  lookup(id: TokenizerId, q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]> {
    return this.#engine?.lookup(id, q) ?? Promise.reject(new Error(`${id} is not loaded`));
  }

  /**
   * Asks for `id`'s result of `text` under `options`, with `trace` (see the module comment). Settles once: with the
   * precomputed result while the tokenizer is not loaded, with the live result when it is (also when the request had to
   * wait for the load), or with `none`/`error`.
   */
  request(id: TokenizerId, text: string, options: TokenOptions, { trace }: { trace: Trace }): Promise<HubAnswer> {
    const entry = this.#entryOf(id, options);
    entry.wanted = { text, trace };
    const current = entry.ticket;
    if (current !== null && current.text === text && covers(current.trace, trace)) return current.promise;
    entry.retry = false;
    const shown = entry.result;
    if (
      shown?.input.text === text &&
      (entry.source === 'live' ? covers(shown.options.trace, trace) : !entry.lane.resident)
    ) {
      this.#supersede(entry);
      entry.pending = false;
      return Promise.resolve({ kind: 'result', result: shown, source: entry.source ?? 'precomputed' });
    }
    this.#supersede(entry);
    // AD-27: never hold two big results at once — the previous one goes before the new one exists.
    if (estimatedResultBytes(utf8ByteLength(text), trace) > RELEASE_ABOVE_BYTES) this.forget(id, options);
    const ticket = ticketFor(text, trace, entry.generation);
    entry.ticket = ticket;
    entry.pending = true;
    entry.traced = trace !== false;
    entry.ownError = null;
    if (entry.lane.resident) this.#post(entry);
    else void this.#lookup(entry, ticket);
    return ticket.promise;
  }

  /** The engine, or the promise of its import (the first call starts it). */
  #engineNow(): HubEngine | Promise<HubEngine> {
    if (this.#engine !== null) return this.#engine;
    if (this.#engineImport !== null) return this.#engineImport;
    const install = (create: (host: EngineHost) => HubEngine): HubEngine => {
      const engine = create(this.#host);
      this.#engine = engine;
      return engine;
    };
    const source = this.#engineSource();
    if (!(source instanceof Promise)) return install(source);
    this.#engineImport = source.then(install, (error: unknown) => {
      this.#engineImport = null;
      // A chunk missing after a deploy: the alert offers the reload (AD-11), as for any client chunk.
      throw Object.assign(new Error(String(error), { cause: error }), { code: 'fetch' });
    });
    return this.#engineImport;
  }

  #laneOf(id: TokenizerId): Lane {
    let lane = this.#lanes.get(id);
    if (lane === undefined) {
      lane = new Lane(id);
      this.#lanes.set(id, lane);
    }
    return lane;
  }

  #entryOf(id: TokenizerId, options: TokenOptions): Entry {
    const key = keyOf(id, options);
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      const lane = this.#laneOf(id);
      const { specialTokens, addBos, normalize } = options;
      entry = new Entry(lane, { specialTokens, addBos, normalize });
      lane.entries.push(entry);
      this.#entries.set(key, entry);
    }
    return entry;
  }

  #loadQuietly(id: TokenizerId): void {
    this.load(id).catch(() => undefined); // the lane's `error` says what failed
  }

  /** Loads `id` now, or once the hub is started (06 §3). */
  #want(id: TokenizerId): void {
    if (this.#started) this.#loadQuietly(id);
    else this.#deferred.add(id);
  }

  /** Settles the entry's waiting request with `none` (a newer one replaces it, or the entry is released). */
  #supersede(entry: Entry): void {
    const ticket = entry.ticket;
    entry.ticket = null;
    const queued = entry.lane.queue.indexOf(entry);
    if (queued !== -1) entry.lane.queue.splice(queued, 1);
    if (ticket === null || ticket.settled) return;
    ticket.settled = true;
    ticket.settle(NONE);
  }

  /**
   * A load of the lane failed: the requests that waited for it are answered — `error` (on the lane: the rows and the
   * board show it with its action), `none` when the load was cancelled — and run with the next load (`retry`, unless a
   * `forget` has dropped them since), so no caller waits for a load that will not come (a row of the on-demand run never
   * holds up the next one).
   */
  #loadFailed(lane: Lane, error: unknown): void {
    const answer: HubAnswer = isCancelledError(error) ? NONE : { kind: 'error', error };
    for (const entry of lane.entries) {
      const ticket = entry.ticket;
      if (ticket === null || ticket.settled || !ticket.waiting) continue;
      ticket.settled = true;
      entry.ticket = null;
      entry.pending = false;
      entry.retry = ticket.generation === entry.generation;
      ticket.settle(answer);
    }
  }

  #post(entry: Entry): void {
    const engine = this.#engine;
    if (engine !== null) engine.post(entry);
    else if (entry.ticket !== null) entry.ticket.waiting = true; // no Worker yet: it runs once one has loaded
  }

  /** While the tokenizer is not loaded: the precomputed answer, else wait for the engine (and ask for its load). */
  async #lookup(entry: Entry, ticket: Ticket): Promise<void> {
    let result: TokenizationResult | null = null;
    if (this.#precomputed !== null) {
      try {
        result = await this.#precomputed.find(tokenizerEntry(entry.id), ticket.text, {
          ...entry.options,
          trace: ticket.trace,
        });
      } catch {
        result = null;
      }
    }
    if (ticket.settled) return;
    if (entry.lane.resident) this.#post(entry);
    else if (result !== null) this.#accept(entry, ticket, result, 'precomputed');
    else {
      ticket.waiting = true;
      this.#want(entry.id);
    }
  }

  #accept(entry: Entry, ticket: Ticket, result: TokenizationResult, source: ResultSource): void {
    if (ticket.settled) return;
    ticket.settled = true;
    if (ticket.generation === entry.generation) {
      entry.result = result;
      entry.source = source;
      entry.ownError = null;
    }
    if (entry.ticket === ticket) {
      entry.ticket = null;
      entry.pending = false;
    }
    ticket.settle({ kind: 'result', result, source });
  }
}
