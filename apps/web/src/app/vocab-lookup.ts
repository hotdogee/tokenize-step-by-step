/**
 * The `TokenizationView` resolvers (03 §B.2) wired to the Worker's `lookup` (04 §6; WP13): `idOf(bytes)` names an
 * intermediate part at stops 4–5 that is neither a final token nor formed by a recorded merge (single bytes before
 * their first merge on byte-level, parts of a precomputed or truncated run), and `pieceOf(id)` gives an spm piece. The
 * view asks synchronously, so answers are cached per tokenizer: a miss answers null and queues the key; the queue is
 * sent in one batch on the next microtask, and when it is answered `notify` runs (AppState bumps its reactive
 * `lookupVersion`, so `viewOf` builds a fresh view) — one board re-render per batch, and a known-absent answer is cached too, so it never asks twice. Only results
 * of the resident tokenizer are resolved (the Worker can answer for nothing else); the caches reset when it changes.
 */
import type { LookupEntry, TokenizationResult, TokenizerId } from '@tsbs/core';

/** What the lookup needs of the client (a `TokenizerClientLike` satisfies it). */
export interface LookupClient {
  readonly resident: TokenizerId | null;
  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]>;
}

/** The resolvers of one view (absent: unknown parts keep id −1, no pieces). */
export interface ViewResolvers {
  readonly idOf?: (bytes: Uint8Array) => number | null;
  readonly pieceOf?: (id: number) => string | null;
}

/** Distinct byte strings looked up per tokenizer at most (single bytes are ≤ 256; this bounds pathological runs). */
export const MAX_BYTE_LOOKUPS = 1024;

const keyOf = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export class VocabLookup {
  readonly #client: LookupClient;
  readonly #notify: () => void;
  #tokenizer: TokenizerId | null = null;
  #ids = new Map<string, number | null>();
  #pieces = new Map<number, string | null>();
  #queuedBytes = new Map<string, Uint8Array>();
  #queuedIds = new Set<number>();
  #scheduled = false;

  /** `notify` runs after every answered batch (the caches changed; views should be rebuilt). */
  constructor(client: LookupClient, notify: () => void) {
    this.#client = client;
    this.#notify = notify;
  }

  /** Resolvers for `result`, or an empty set when its tokenizer is not the resident one. */
  resolversFor(result: TokenizationResult): ViewResolvers {
    const tokenizer = result.tokenizer;
    if (this.#client.resident !== tokenizer) return {};
    if (this.#tokenizer !== tokenizer) this.#reset(tokenizer);
    return {
      idOf: (bytes) => {
        const key = keyOf(bytes);
        const known = this.#ids.get(key);
        if (known !== undefined) return known;
        if (this.#ids.size + this.#queuedBytes.size < MAX_BYTE_LOOKUPS) this.#queuedBytes.set(key, bytes.slice());
        this.#schedule();
        return null;
      },
      pieceOf: (id) => {
        const known = this.#pieces.get(id);
        if (known !== undefined) return known;
        this.#queuedIds.add(id);
        this.#schedule();
        return null;
      },
    };
  }

  #reset(tokenizer: TokenizerId): void {
    this.#tokenizer = tokenizer;
    this.#ids = new Map();
    this.#pieces = new Map();
    this.#queuedBytes = new Map();
    this.#queuedIds = new Set();
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#flush();
    });
  }

  async #flush(): Promise<void> {
    const tokenizer = this.#tokenizer;
    const bytes = [...this.#queuedBytes];
    const ids = [...this.#queuedIds];
    this.#queuedBytes = new Map();
    this.#queuedIds = new Set();
    if (tokenizer === null || (bytes.length === 0 && ids.length === 0)) return;
    const ownIds = this.#ids;
    const ownPieces = this.#pieces;
    try {
      const answers = await Promise.all([
        ids.length === 0 ? Promise.resolve<LookupEntry[]>([]) : this.#client.lookup({ ids }),
        ...bytes.map(([, value]) => this.#client.lookup({ bytes: value })),
      ]);
      if (this.#tokenizer !== tokenizer || ownIds !== this.#ids) return; // switched meanwhile
      const [pieces, ...byteAnswers] = answers;
      for (const entry of pieces) if (entry.id !== null) ownPieces.set(entry.id, entry.piece);
      for (const id of ids) if (!ownPieces.has(id)) ownPieces.set(id, null);
      bytes.forEach(([key], i) => {
        ownIds.set(key, byteAnswers[i]?.[0]?.id ?? null);
      });
      this.#notify();
    } catch {
      // not-loaded (a switch raced the batch): the next view asks again.
    }
  }
}
