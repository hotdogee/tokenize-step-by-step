/**
 * `MockTokenizerClient` (07 §1, 04 §6): a `TokenizerClientLike` that answers from golden fixtures or precomputed examples
 * through `fromFixtureCase`, so the shell, board and pipeline (WP06/WP08/WP09) can be built before the Worker (WP07) and
 * the engines (WP05A/B) exist. It keeps the client's observable rules: one resident tokenizer, `load` before `encode`
 * (`not-loaded` otherwise), latest encode wins and every superseded or aborted one rejects with the single name
 * `cancelled` (AD-21), results carry the caller's `seq`, and everything settles asynchronously.
 *
 * Text that no case contains is synthesised (one Normal token per code point, id = the code point, no timeline) or rejected,
 * per `unknownText`. `specialTokens: 'match'` is answered with the default-mode result (fixtures carry ids, not spans, for
 * that mode).
 */
import { buildResult } from '../model/build-result.ts';
import {
  ChunkKind,
  TokenKind,
  type EncodeOptions,
  type TokenizationResult,
  type TokenizerId,
} from '../model/result.ts';
import type { TokenizerInfo } from '../model/engine.ts';
import type {
  AssetSummary,
  ErrorCode,
  Features,
  LoadedInfo,
  LookupEntry,
  Progress,
  TokenizerClientLike,
} from '../protocol.ts';
import { analyzeText, defaultGraphemeSegmenter } from '../text/analyze.ts';
import { decodeUtf8, hexByte } from '../text/utf8.ts';
import type { ExamplesWire } from './examples-wire.ts';
import type { Fixture } from './fixture-types.ts';
import { fromFixtureCase, type FixtureTokenizerRef, type FromFixtureOptions } from './from-fixture-case.ts';

/** The single rejection name for a superseded or cancelled request (AD-21). */
export class CancelledError extends Error {
  override readonly name = 'cancelled';
  constructor() {
    super('cancelled');
  }
}

/** True for `CancelledError` and anything else named `cancelled` (the real client's rejection). */
export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'cancelled';
}

/** A mock failure carrying a protocol `ErrorCode`. */
export class MockClientError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'MockClientError';
    this.code = code;
  }
}

/** One tokenizer the mock can "load". */
export interface MockTokenizerSource {
  readonly ref: FixtureTokenizerRef;
  readonly data: Fixture | ExamplesWire;
}

export interface MockTokenizerClientOptions {
  readonly sources: readonly MockTokenizerSource[];
  readonly features?: Features;
  readonly assets?: AssetSummary;
  /** Encode of text no case contains: `'synthesize'` (default) or `'reject'` with `internal`. */
  readonly unknownText?: 'synthesize' | 'reject';
  /** Passed to `fromFixtureCase` (e.g. the NFKC segment rule). */
  readonly fixtureOptions?: Pick<FromFixtureOptions, 'nfkcSegmentStart' | 'segmenter'>;
}

const TOKENIZER_IDS: readonly TokenizerId[] = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'anthropic-claude-legacy',
  'google-gemma4',
  'google-gemma2',
  'meta-llama4-muse',
  'meta-llama3',
  'xai-grok2',
  'xai-grok1',
];

interface Pending {
  readonly reject: (reason: Error) => void;
}

/** id → bytes/piece, and hex bytes → id, from every case of a source. */
interface LookupIndex {
  readonly byId: Map<number, { readonly bytes: Uint8Array; readonly piece: string | null }>;
  readonly byHex: Map<string, number>;
}

function hexKey(bytes: Uint8Array): string {
  return Array.from(bytes, hexByte).join('');
}

function buildIndex(data: Fixture | ExamplesWire): LookupIndex {
  const byId = new Map<number, { readonly bytes: Uint8Array; readonly piece: string | null }>();
  const byHex = new Map<string, number>();
  const add = (id: number, bytes: Uint8Array, piece: string | null): void => {
    if (byId.has(id)) return;
    byId.set(id, { bytes, piece });
    if (bytes.length > 0 && !byHex.has(hexKey(bytes))) byHex.set(hexKey(bytes), id);
  };
  if ('schema' in data) {
    for (const wire of Object.values(data.cases)) {
      const utf8 = analyzeText(wire.text, { segmenter: null }).utf8;
      let start = 0;
      wire.ids.forEach((id, i) => {
        const end = start + (wire.tokenEnd[i] ?? 0);
        const p = wire.piece?.[i];
        add(id, utf8.slice(start, end), p === undefined ? null : p === 0 ? decodeUtf8(utf8, start, end) : p);
        start = end;
      });
    }
  } else {
    for (const c of data.cases) {
      for (const t of c.tokens) {
        const bytes = new Uint8Array(t.bytes.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(t.bytes.slice(2 * i, 2 * i + 2), 16);
        add(t.id, bytes, 'piece' in t ? t.piece : null);
      }
    }
  }
  return { byId, byHex };
}

/** Case name by text (first case wins). */
function caseNames(data: Fixture | ExamplesWire): Map<string, string> {
  const names = new Map<string, string>();
  const entries: Array<readonly [string, string]> =
    'schema' in data
      ? Object.entries(data.cases).map(([name, c]) => [name, c.text])
      : data.cases.map((c) => [c.name, c.text]);
  for (const [name, text] of entries) if (!names.has(text)) names.set(text, name);
  return names;
}

function later<T>(work: () => T): Promise<T> {
  return Promise.resolve().then(work);
}

export class MockTokenizerClient implements TokenizerClientLike {
  readonly features: Promise<Features>;
  readonly assets: Promise<AssetSummary>;
  private readonly sources: Map<TokenizerId, MockTokenizerSource>;
  private readonly options: MockTokenizerClientOptions;
  private readonly listeners = new Set<(id: TokenizerId | null) => void>();
  private readonly indexes = new Map<TokenizerId, LookupIndex>();
  private readonly names = new Map<TokenizerId, Map<string, string>>();
  private current: TokenizerId | null = null;
  private pending: Pending | null = null;
  private seq = 0;
  private terminated = false;

  constructor(options: MockTokenizerClientOptions) {
    this.options = options;
    this.sources = new Map(options.sources.map((s) => [s.ref.id, s]));
    this.features = Promise.resolve(
      options.features ?? {
        cacheApi: false,
        segmenter: defaultGraphemeSegmenter() !== null,
        brotli: false,
        subtleCrypto: false,
      },
    );
    const assets = Object.fromEntries(
      TOKENIZER_IDS.map((id) => [id, { path: `/tok/${id}/mock.bin`, bytesCompressed: 0, bytesRaw: 0 }]),
    ) as Record<TokenizerId, { path: string; bytesCompressed: number; bytesRaw: number }>;
    this.assets = Promise.resolve(options.assets ?? assets);
  }

  /**
   * Adds or replaces the data of one tokenizer (e.g. a precomputed-examples file fetched when it is first loaded). It
   * takes effect from the next `load`/`encode`/`lookup`; a resident tokenizer stays resident.
   */
  addSource(source: MockTokenizerSource): void {
    this.sources.set(source.ref.id, source);
    this.indexes.delete(source.ref.id);
    this.names.delete(source.ref.id);
  }

  /** The resident tokenizer (plain getter). */
  get resident(): TokenizerId | null {
    return this.current;
  }

  onResident(cb: (id: TokenizerId | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setResident(id: TokenizerId | null): void {
    this.current = id;
    for (const cb of this.listeners) cb(id);
  }

  private info(source: MockTokenizerSource): TokenizerInfo {
    const bosId = source.ref.engine?.bosId ?? null;
    return {
      id: source.ref.id,
      family: source.ref.family,
      vocabSize: 0,
      rankCount: 0,
      specials: [],
      bosId,
      unicodeVersion: '16.0.0',
      sourceSha256: 'schema' in source.data ? '' : source.data.vocabSha256,
      supports: { nfkc: source.ref.id === 'anthropic-claude-legacy', bos: bosId !== null, specialsToggle: true },
    };
  }

  load(
    id: TokenizerId,
    onProgress?: (p: Progress) => void,
    signal?: { readonly aborted: boolean },
  ): Promise<LoadedInfo> {
    return later(() => {
      if (signal?.aborted === true) throw new CancelledError();
      const source = this.sources.get(id);
      if (source === undefined) throw new MockClientError('fetch', `no mock data for ${id}`);
      onProgress?.({ tokenizer: id, phase: 'build', loaded: 1, total: 1 });
      this.setResident(id);
      return {
        info: this.info(source),
        fromCache: true,
        ms: 0,
        bytesTransferred: 0,
        contentEncoding: null,
        layer: 'raw',
      };
    });
  }

  prefetch(id: TokenizerId): Promise<void> {
    return later(() => {
      if (!this.sources.has(id)) throw new MockClientError('fetch', `no mock data for ${id}`);
    });
  }

  encode(
    text: string,
    options: EncodeOptions,
    onProgress?: (p: Progress) => void,
    signal?: {
      readonly aborted: boolean;
      addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
    },
  ): Promise<TokenizationResult> {
    const seq = ++this.seq;
    this.pending?.reject(new CancelledError());
    return new Promise<TokenizationResult>((resolve, reject) => {
      let settled = false;
      const entry: Pending = {
        reject: (reason) => {
          if (settled) return;
          settled = true;
          reject(reason);
        },
      };
      this.pending = entry;
      if (signal?.aborted === true) entry.reject(new CancelledError());
      signal?.addEventListener(
        'abort',
        () => {
          entry.reject(new CancelledError());
        },
        { once: true },
      );
      void later(() => {
        if (settled) return;
        if (this.pending === entry) this.pending = null;
        try {
          const result = this.encodeNow(text, options, seq);
          onProgress?.({
            tokenizer: result.tokenizer,
            phase: 'encode',
            loaded: result.utf8.length,
            total: result.utf8.length,
          });
          settled = true;
          resolve(result);
        } catch (error) {
          entry.reject(error instanceof Error ? error : new MockClientError('internal', String(error)));
        }
      });
    });
  }

  private encodeNow(text: string, options: EncodeOptions, seq: number): TokenizationResult {
    if (this.terminated || this.current === null) throw new MockClientError('not-loaded', 'no tokenizer is loaded');
    const id = this.current;
    const source = this.sources.get(id);
    if (source === undefined) throw new MockClientError('not-loaded', `no mock data for ${id}`);
    let names = this.names.get(id);
    if (names === undefined) {
      names = caseNames(source.data);
      this.names.set(id, names);
    }
    const name = names.get(text);
    if (name !== undefined) {
      return fromFixtureCase(source.data, name, source.ref, {
        ...this.options.fixtureOptions,
        addBos: options.addBos,
        normalize: options.normalize,
        merges: options.trace !== false,
        seq,
      });
    }
    if (this.options.unknownText === 'reject') throw new MockClientError('internal', 'text is not in the mock data');
    return synthesize(source.ref, text, options, seq);
  }

  lookup(q: { ids?: number[]; bytes?: Uint8Array }): Promise<LookupEntry[]> {
    return later(() => {
      const id = this.current;
      const source = id === null ? undefined : this.sources.get(id);
      if (id === null || source === undefined) throw new MockClientError('not-loaded', 'no tokenizer is loaded');
      let index = this.indexes.get(id);
      if (index === undefined) {
        index = buildIndex(source.data);
        this.indexes.set(id, index);
      }
      const found = index;
      const entries: LookupEntry[] = (q.ids ?? []).map((tokenId) => {
        const hit = found.byId.get(tokenId);
        return { id: tokenId, bytes: hit?.bytes ?? null, piece: hit?.piece ?? null };
      });
      if (q.bytes) {
        const tokenId = found.byHex.get(hexKey(q.bytes)) ?? null;
        entries.push({
          id: tokenId,
          bytes: q.bytes,
          piece: tokenId === null ? null : (found.byId.get(tokenId)?.piece ?? null),
        });
      }
      return entries;
    });
  }

  unload(): Promise<void> {
    return later(() => {
      this.setResident(null);
    });
  }

  terminate(): void {
    this.terminated = true;
    this.pending?.reject(new CancelledError());
    this.pending = null;
    this.setResident(null);
  }
}

/** A placeholder result for text the mock data does not contain: one Normal token per code point (id = code point). */
function synthesize(ref: FixtureTokenizerRef, text: string, options: EncodeOptions, seq: number): TokenizationResult {
  const analysis = analyzeText(text);
  const n = analysis.utf8.length;
  const { count, cp, byteStart } = analysis.chars;
  return buildResult({
    tokenizer: ref.id,
    family: ref.family,
    options: { ...options, trace: false, specialTokens: 'as-text', normalize: 'none', addBos: false },
    analysis,
    chunks: {
      byteStart: n > 0 ? [0, n] : [0],
      kind: n > 0 ? [ref.family === 'spm-bpe' ? ChunkKind.SpmText : ChunkKind.Regex] : [],
    },
    tokens: { id: cp, byteStart, kind: new Uint8Array(count).fill(TokenKind.Normal) },
    timeline: null,
    seq,
  });
}
