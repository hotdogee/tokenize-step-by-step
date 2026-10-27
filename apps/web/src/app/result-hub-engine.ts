/**
 * The Worker side of the result hub (PA-19): the pool of clients (`tokenizer-pool.ts`, one Worker per tokenizer), the
 * loads and their progress, the encodes and their turns, encode failures, the prefetches and the lookups.
 * `result-hub.svelte.ts` imports it with the first load — after first paint (06 §3), like the client code it brings along
 * (`clients.ts`) — so the first paint carries only the hub's results.
 *
 * Pool users: an operation (a load, an encode) holds one while it runs, and a lane that views hold keeps one once it has
 * a client — a client is spawned for a load or an encode only, never because a view shows a precomputed result.
 */
import type { Features, LoadedInfo, LookupEntry, Progress, TokenizerId } from '@tsbs/core';
import { createClient } from './clients.ts';
import { isCancelledError, toUiError } from './errors.ts';
import { isNoPrecomputedResult } from './no-precomputed.ts';
import {
  ticketFor,
  type EngineHost,
  type HubEngine,
  type HubEntryState,
  type HubLane,
  type Ticket,
} from './result-hub.svelte.ts';
import { TokenizerPool, type PoolEntry } from './tokenizer-pool.ts';

/** The hub's engine over `pool` (the page's: one client per tokenizer, spawned by `createClient`). */
export function createEngine(host: EngineHost, pool: TokenizerPool = new TokenizerPool(createClient)): HubEngine {
  return new Engine(host, pool);
}

class Engine implements HubEngine {
  readonly #host: EngineHost;
  readonly #pool: TokenizerPool;
  /** Lanes whose views hold a pool user. */
  readonly #held = new Set<TokenizerId>();
  readonly #prefetched = new Set<TokenizerId>();

  constructor(host: EngineHost, pool: TokenizerPool) {
    this.#host = host;
    this.#pool = pool;
  }

  hold(lane: HubLane): void {
    const want = lane.holders > 0 && this.#pool.get(lane.id) !== undefined;
    if (want === this.#held.has(lane.id)) return;
    if (want) {
      this.#held.add(lane.id);
      this.#pool.acquire(lane.id);
    } else {
      this.#held.delete(lane.id);
      this.#pool.release(lane.id);
    }
  }

  load(lane: HubLane, onProgress?: (progress: Progress) => void): Promise<LoadedInfo> {
    if (onProgress !== undefined) lane.listeners.push(onProgress);
    if (lane.loading !== null) return lane.loading;
    lane.error = null;
    lane.progress = { tokenizer: lane.id, phase: 'cache', loaded: 0, total: null };
    const pool = this.#acquire(lane);
    const done = (): void => {
      lane.loading = null;
      lane.progress = null;
      lane.listeners.length = 0;
      this.#pool.release(lane.id);
    };
    const loading = pool
      .start((progress) => {
        lane.progress = progress;
        for (const listener of lane.listeners) listener(progress);
      })
      .then(
        (loaded) => {
          done();
          if (lane.pool === pool) lane.resident = pool.loaded;
          this.#loaded(lane);
          return loaded;
        },
        (error: unknown) => {
          done();
          if (!isCancelledError(error)) lane.error = toUiError(error, lane.id, null, 'load');
          throw error;
        },
      );
    lane.loading = loading;
    return loading;
  }

  post(entry: HubEntryState): void {
    const ticket = entry.ticket;
    if (ticket === null || ticket.settled || ticket.posted) return;
    const lane = entry.lane;
    const inflight = lane.inflight;
    if (inflight !== null && inflight.entry !== entry && !inflight.ticket.settled) {
      // The Worker runs another entry's encode, which its client would cancel (04 §6 rule 1): take turns.
      if (!lane.queue.includes(entry)) lane.queue.push(entry);
      return;
    }
    const pool = this.#acquire(lane);
    if (!pool.loaded) {
      // The Worker lost the tokenizer (evicted, respawned): load it again, then run.
      this.#pool.release(lane.id);
      lane.resident = false;
      ticket.waiting = true;
      this.#host.reload(lane.id);
      return;
    }
    ticket.posted = true;
    ticket.waiting = false;
    lane.inflight = { entry, ticket };
    const turn = (): void => {
      this.#pool.release(lane.id);
      if (lane.inflight?.ticket !== ticket) return;
      lane.inflight = null;
      const next = lane.queue.shift();
      if (next !== undefined) this.post(next);
    };
    pool.client.encode(ticket.text, { ...entry.options, trace: ticket.trace }).then(
      (result) => {
        turn();
        this.#host.accept(entry, ticket, result, 'live');
      },
      (error: unknown) => {
        turn();
        this.#failed(entry, ticket, error);
      },
    );
  }

  async prefetch(ids: readonly TokenizerId[]): Promise<void> {
    for (const id of ids) {
      const lane = this.#host.lane(id);
      if (this.#prefetched.has(id) || (lane !== undefined && (lane.resident || lane.loading !== null))) continue;
      const entries = this.#pool.entries();
      const client = (entries.find((entry) => entry.loaded) ?? entries.at(-1))?.client;
      if (client === undefined) return;
      this.#prefetched.add(id);
      await client.prefetch(id).catch(() => {
        this.#prefetched.delete(id);
      });
    }
  }

  features(id: TokenizerId): Promise<Features> | null {
    return this.#pool.get(id)?.client.features ?? null;
  }

  lookup(id: TokenizerId, q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]> {
    const pool = this.#pool.get(id);
    if (pool?.loaded !== true) return Promise.reject(new Error(`${id} is not loaded`));
    return pool.client.lookup(q);
  }

  /** One pool user for an operation; a new pool entry (a new Worker) is watched for residency and its asset sizes. */
  #acquire(lane: HubLane): PoolEntry {
    const pool = this.#pool.acquire(lane.id);
    if (pool !== lane.pool) {
      lane.pool = pool;
      lane.resident = pool.loaded;
      pool.client.onResident((resident) => {
        if (lane.pool === pool) lane.resident = resident === lane.id;
      });
      pool.client.assets.then(
        (assets) => {
          this.#host.assets(assets);
        },
        () => undefined,
      );
    }
    this.hold(lane);
    return pool;
  }

  /** The tokenizer is resident: requests waiting for it, and precomputed answers of what was asked, go live. */
  #loaded(lane: HubLane): void {
    if (!lane.resident) return;
    for (const entry of lane.entries) {
      const ticket = entry.ticket;
      if (ticket !== null) {
        if (ticket.waiting) this.post(entry);
        continue;
      }
      const wanted = entry.wanted;
      if (wanted === null || entry.source !== 'precomputed' || entry.result?.input.text !== wanted.text) continue;
      entry.ticket = ticketFor(wanted.text, wanted.trace, entry.generation);
      entry.pending = true;
      this.post(entry);
    }
  }

  /** An encode failed: `cancelled` is never an error (AD-21); anything else goes on the entry and to the caller. */
  #failed(entry: HubEntryState, ticket: Ticket, error: unknown): void {
    if (ticket.settled) return;
    ticket.settled = true;
    if (entry.ticket === ticket) {
      entry.ticket = null;
      entry.pending = false;
    }
    if (isCancelledError(error)) {
      ticket.settle({ kind: 'none' });
      return;
    }
    // ?mock=1 has no result for free text: the view shows the text alone instead of the last result.
    if (isNoPrecomputedResult(error)) this.#host.forget(entry);
    else entry.ownError = toUiError(error, entry.id, null, 'encode');
    ticket.settle({ kind: 'error', error });
  }
}
