/**
 * A `TokenizerClientLike` whose implementation is imported on first use. The page needs a client the moment it builds
 * its AppState, but not the client's code: today that is the precomputed-examples client over WP01's
 * `MockTokenizerClient` (`examples-client.ts`), and the page first loads a tokenizer only after first paint
 * (`AppState.start`, 06 §3), so the code arrives then, in a chunk of its own, outside the initial Main JS.
 *
 * Calls made before the import settles wait on it in call order, so supersession and cancellation behave exactly as on
 * the underlying client (AD-21); `features` and `assets` settle once it exists. A failed import (a chunk missing after a
 * deploy) rejects every call with `code: 'fetch'`, which the shell shows as "a new version is available — reload" (AD-11).
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

type Signal = Parameters<TokenizerClientLike['load']>[2];

/** Every call's rejection when the client's chunk cannot be imported. */
export class ClientImportError extends Error {
  override readonly name = 'ClientImportError';
  readonly code = 'fetch';
}

export class DeferredClient implements TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary>;
  readonly #ready: Promise<TokenizerClientLike>;
  readonly #start: () => void;
  #client: TokenizerClientLike | null = null;

  /** `create` runs once, on the first call that needs the client — never at construction. */
  constructor(create: () => Promise<TokenizerClientLike>) {
    let start: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    this.#start = start;
    this.#ready = started.then(create).then(
      (client) => {
        this.#client = client;
        return client;
      },
      (error: unknown) => {
        throw new ClientImportError(error instanceof Error ? error.message : String(error), { cause: error });
      },
    );
    this.features = this.#ready.then((client) => client.features);
    this.assets = this.#ready.then((client) => client.assets);
    // Callers observe these when they await them; until then a rejection is not an unhandled one.
    this.features.catch(() => undefined);
    this.assets.catch(() => undefined);
  }

  get resident(): TokenizerId | null {
    return this.#client?.resident ?? null;
  }

  onResident(cb: (id: TokenizerId | null) => void): () => void {
    let subscribed = true;
    let unsubscribe: (() => void) | null = null;
    this.#ready.then(
      (client) => {
        if (subscribed) unsubscribe = client.onResident(cb);
      },
      () => undefined,
    );
    return () => {
      subscribed = false;
      unsubscribe?.();
    };
  }

  load(id: TokenizerId, onProgress?: (p: Progress) => void, signal?: Signal): Promise<LoadedInfo> {
    return this.#use().then((client) => client.load(id, onProgress, signal));
  }

  prefetch(id: TokenizerId): Promise<void> {
    return this.#use().then((client) => client.prefetch(id));
  }

  encode(
    text: string,
    options: EncodeOptions,
    onProgress?: (p: Progress) => void,
    signal?: Signal,
  ): Promise<TokenizationResult> {
    return this.#use().then((client) => client.encode(text, options, onProgress, signal));
  }

  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]> {
    return this.#use().then((client) => client.lookup(q));
  }

  unload(): Promise<void> {
    return this.#use().then((client) => client.unload());
  }

  /** Terminates the client once it exists; a client never imported has nothing to terminate. */
  terminate(): void {
    this.#ready.then(
      (client) => {
        client.terminate();
      },
      () => undefined,
    );
  }

  #use(): Promise<TokenizerClientLike> {
    this.#start();
    return this.#ready;
  }
}
