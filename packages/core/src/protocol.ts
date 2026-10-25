// FROZEN v1 — see docs/design/04-engines.md §6 (verbatim), incl. `TokenizerClientLike` (07 §1 puts it in this file; the
// `TokenizerClient` / `MockTokenizerClient` classes belong to WP07 / WP01). Only the imports and the local `AbortSignal`
// subset at the end are added. A change needs an ADR in docs/adr/ and one PR that updates every dependent
// (docs/design/07-implementation-plan.md §1). Excluded from Prettier on purpose.
import type { EncodeOptions, TokenizationResult, TokenizerId } from './model/result.ts';
import type { TokenizerInfo } from './model/engine.ts';

export interface Features { cacheApi: boolean; segmenter: boolean; brotli: boolean; subtleCrypto: boolean; }
export interface Progress { tokenizer: TokenizerId; phase: 'cache' | 'download' | 'verify' | 'decompress' | 'build' | 'encode'; loaded: number; total: number | null; }
export interface LoadedInfo { info: TokenizerInfo; fromCache: boolean; ms: number; bytesTransferred: number; contentEncoding: string | null; layer: 'gzip' | 'raw'; }
export interface LookupEntry { id: number | null; bytes: Uint8Array | null; piece: string | null; }
export type AssetSummary = Readonly<Record<TokenizerId, { path: string; bytesCompressed: number; bytesRaw: number }>>;   // for the picker's wire-size column
export type ErrorCode = 'fetch' | 'integrity' | 'format' | 'decompress' | 'quota' | 'not-loaded' | 'pretokenize' | 'alignment' | 'oom' | 'internal';

export type ToWorker =
  | { type: 'hello'; reqId: number }
  | { type: 'load'; reqId: number; tokenizer: TokenizerId }
  | { type: 'prefetch'; reqId: number; tokenizer: TokenizerId }                       // download + cache only; no-op if that id is loading/resident
  | { type: 'unload'; reqId: number }                                                 // drops the resident engine (strict one-resident)
  | { type: 'encode'; reqId: number; seq: number; text: string; options: EncodeOptions; budgetMs?: number }
  | { type: 'cancel'; reqId: number; target: number }                                 // target = reqId of the encode to cancel (in flight OR pending)
  | { type: 'lookup'; reqId: number; ids?: number[]; bytes?: Uint8Array }             // inspector + BYOK live tier
  | { type: 'ping'; reqId: number };

export type FromWorker =
  | { type: 'ready'; reqId: number; features: Features; assets: AssetSummary }        // assets from the bundled manifest, so the main bundle needs no copy
  | { type: 'progress'; reqId: number; progress: Progress }                           // during load AND during encode (every mergeStep slice, §1.3)
  | { type: 'loaded'; reqId: number; loaded: LoadedInfo }
  | { type: 'result'; reqId: number; seq: number; result: TokenizationResult }         // all typed arrays in the transfer list
  | { type: 'cancelled'; reqId: number }                                               // the ONE name for a superseded/cancelled encode, on the wire and in the client
  | { type: 'lookupResult'; reqId: number; entries: LookupEntry[] }
  | { type: 'unloaded'; reqId: number }
  | { type: 'pong'; reqId: number; resident: TokenizerId | null; loading: TokenizerId | null; encodeInFlight: boolean; heapHint: number | null }
  | { type: 'error'; reqId: number; code: ErrorCode; message: string; retryable: boolean };

// @tsbs/worker/client.ts (main thread) — framework-free; apps/web wraps `onResident` in a rune
export interface TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary>;
  readonly resident: TokenizerId | null;                      // plain getter
  onResident(cb: (id: TokenizerId | null) => void): () => void;   // returns unsubscribe
  load(id: TokenizerId, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<LoadedInfo>;
  prefetch(id: TokenizerId): Promise<void>;
  encode(text: string, options: EncodeOptions, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<TokenizationResult>;   // latest text wins; rejects CancelledError ('cancelled')
  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]>;
  unload(): Promise<void>;
  terminate(): void;
}

// ---- Added (not in the design text) ----

/**
 * Structural subset of the DOM/WebWorker `AbortSignal` used by `TokenizerClientLike`. `@tsbs/core` compiles with
 * `lib: ["ES2023"]` only (02 §4), so the global type does not exist here; a real `AbortSignal` is assignable to this.
 */
interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
