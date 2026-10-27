/**
 * The page's tokenizer clients (PA-19): one `TokenizerClientLike` — one Worker holding one resident tokenizer, so AD-19's
 * strict one-resident rule holds per Worker and the FROZEN protocol is unchanged — per tokenizer the page shows, at most
 * `max` of them (six: the table's five rows plus the board's tokenizer).
 *
 * `acquire(id)` hands out the entry of `id`, spawning its client when there is none (`createWorkerClient()`, or one
 * `ExamplesClient` per tokenizer under `?mock=1`; clients.ts), and counts one more user; `release(id)` counts one
 * fewer. An entry without users stays (its tokenizer stays resident and answers at once when it is wanted again) until
 * the pool is over `max`: then the least recently acquired entry without users is evicted and its client terminated. An
 * entry with users is never evicted, so the pool may hold more than `max` while every entry is in use; the next release
 * trims it. Nothing loads on `acquire`: the tokenizer's `load` starts when `PoolEntry.start()` is called (the load policy
 * lives in the result hub: result-hub.svelte.ts and its Worker side, result-hub-engine.ts, which owns the pool).
 */
import type { LoadedInfo, Progress, TokenizerClientLike, TokenizerId } from '@tsbs/core';

/** Clients the pool keeps at most while some are unused: the table's five rows plus the board's tokenizer. */
export const MAX_CLIENTS = 6;

export interface PoolEntry {
  readonly id: TokenizerId;
  readonly client: TokenizerClientLike;
  /** Holders of the entry (`acquire` +1, `release` −1); only an entry with none may be evicted. */
  readonly users: number;
  /** True while the client has `id` resident: its load finished and no Worker respawn has dropped it since. */
  readonly loaded: boolean;
  /**
   * Starts loading `id` on the client: a load in flight, or one that finished and is still resident, is shared (its
   * `onProgress` is the first caller's); a failed load, or one the Worker has lost since, starts again.
   */
  start(onProgress?: (progress: Progress) => void): Promise<LoadedInfo>;
}

class Entry implements PoolEntry {
  readonly id: TokenizerId;
  readonly client: TokenizerClientLike;
  users = 0;
  #load: Promise<LoadedInfo> | null = null;
  #settled = false;

  constructor(id: TokenizerId, client: TokenizerClientLike) {
    this.id = id;
    this.client = client;
  }

  get loaded(): boolean {
    return this.client.resident === this.id;
  }

  start(onProgress?: (progress: Progress) => void): Promise<LoadedInfo> {
    if (this.#load !== null && (!this.#settled || this.loaded)) return this.#load;
    const load = this.client.load(this.id, onProgress);
    this.#load = load;
    this.#settled = false;
    load.then(
      () => {
        if (this.#load === load) this.#settled = true;
      },
      () => {
        if (this.#load === load) this.#load = null;
      },
    );
    return load;
  }
}

export class TokenizerPool {
  readonly #spawn: () => TokenizerClientLike;
  readonly #max: number;
  /** Least recently acquired first. */
  readonly #entries: Entry[] = [];

  /** `spawn` creates one client (one Worker) for one tokenizer; `max` bounds the clients kept while some are unused. */
  constructor(spawn: () => TokenizerClientLike, max = MAX_CLIENTS) {
    this.#spawn = spawn;
    this.#max = max;
  }

  /** The entry of `id` with one more user, created (and the pool trimmed) when there is none. */
  acquire(id: TokenizerId): PoolEntry {
    const index = this.#entries.findIndex((candidate) => candidate.id === id);
    const entry = index === -1 ? new Entry(id, this.#spawn()) : this.#entries.splice(index, 1)[0];
    if (entry === undefined) throw new Error(`pool entry ${id} vanished`);
    this.#entries.push(entry);
    entry.users++;
    this.#trim();
    return entry;
  }

  /** One user fewer for `id` (never below zero); the pool is trimmed to `max` when it has grown past it. */
  release(id: TokenizerId): void {
    const entry = this.#entries.find((candidate) => candidate.id === id);
    if (entry === undefined || entry.users === 0) return;
    entry.users--;
    this.#trim();
  }

  /** The entry of `id`, if the pool has one (no user is counted and its recency is unchanged). */
  get(id: TokenizerId): PoolEntry | undefined {
    return this.#entries.find((candidate) => candidate.id === id);
  }

  /** Every entry, least recently acquired first. */
  entries(): readonly PoolEntry[] {
    return [...this.#entries];
  }

  /** Evicts unused entries, least recently acquired first, while the pool holds more than `max`. */
  #trim(): void {
    while (this.#entries.length > this.#max) {
      const index = this.#entries.findIndex((candidate) => candidate.users === 0);
      if (index === -1) return;
      const [evicted] = this.#entries.splice(index, 1);
      evicted?.client.terminate();
    }
  }
}
