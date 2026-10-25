// FROZEN v1 — see docs/design/03-data-model-and-assets.md §B.8 and §C.2 (verbatim), plus §C.1 (META) and §C.2 (readTsbv1)
// transcribed as types at the end of this file. A change needs an ADR in docs/adr/ and one PR that updates every dependent
// (docs/design/07-implementation-plan.md §1). Excluded from Prettier on purpose.
import type { Family, TokenizerId } from '../model/result.ts';

export interface VocabManifest {
  readonly schema: 1;
  readonly builtOn: string;                                   // ISO date
  readonly generator: string;                                 // "@tsbs/vocab-tools@x.y.z"
  readonly assets: Readonly<Record<string /* TokenizerId */, VocabAssetEntry>>;
}
export interface VocabAssetEntry {
  readonly path: string;            // ROOT-RELATIVE: "/tok/openai-o200k_base/3f9a1c0b7e2d.bin" (sha256(compressed)[0:12]). Inside the Worker a relative
                                    // path would resolve against /assets/worker-<hash>.js, so the loader always does new URL(entry.path, self.location.origin)
  readonly format: 'tsbv1'; readonly family: Family;
  readonly encoding: 'gzip';        // v1.1 may add 'br' siblings: { br?: { path, bytesCompressed, sha256 } }
  readonly bytesCompressed: number; // progress denominator and Cache quota
  readonly bytesRaw: number;        // decompressed container size
  readonly sha256: string;          // of the compressed file (checked when the gzip layer arrives, C.6)
  readonly sha256Raw: string;       // of the decompressed TSBV1 container (checked when a transparently-decoded body arrives, C.6)
  readonly upstream: { readonly assetId: string; readonly file: string; readonly sha256: string; readonly url: string; readonly revision: string; readonly retrievedOn: string };
  readonly counts: { readonly pieces: number; readonly specials: number; readonly merges?: number };
}

export interface ByteVocab {                 // AD-8: both families; zero allocation on lookup
  readonly count: number;
  readonly offsets: Uint32Array;             // count+1, into `bytes`; recomputed at load by scanning PCES varints (5–12 ms)
  readonly bytes: Uint8Array;                // OWN COPY of the PCES payload (readTsbv1 copies it so the whole decompressed container — incl. the 1 MB MRGS payload — is released after the CSR is built)
  /** index (= rank / piece id) of buf[start,end) or -1. FNV-1a 32-bit over the slice, linear probing in a table of 2^ceil(log2(2·count)) Int32 slots, byte compare on probe. */
  indexOf(buf: Uint8Array, start: number, end: number): number;
  bytesOf(index: number): Uint8Array;        // subarray view
  pieceOf(index: number): string | null;     // TextDecoder({ fatal: true, ignoreBOM: true }); null if not valid UTF-8; memoised per index
}
export interface Tsbv1 {
  readonly meta: TsbvMeta; readonly family: Family;
  readonly vocab: ByteVocab;                 // over PCES
  readonly types: Uint8Array | null;         // TYPS
  readonly scores: Int32Array | Float32Array | null;   // PRIO (decoded) or SCRF
  readonly merges: { readonly start: Uint32Array /* count+1, CSR by result piece */; readonly splitByteOffset: Uint8Array; readonly rank: Uint32Array } | null;
  readonly specials: ReadonlyArray<{ id: number; bytes: Uint8Array; text: string }>;   // SPCL, source order
}

// ---- Transcribed from prose (not code blocks) in 03 §C.1 / §C.2 ----

/** Section `META` of a TSBV1 container (03 §C.1): UTF-8 JSON ≤ 4 KiB that makes a `.bin` self-describing. */
export interface TsbvMeta {
  readonly tokenizerId: TokenizerId;
  readonly family: Family;
  readonly upstream: VocabAssetEntry['upstream'];
  readonly counts: VocabAssetEntry['counts'];
  /** Measured longest PCES entry in bytes (o200k 128, Grok-2 256, Glimmer 113, Gemma 4 93); the engines' merge-window bound. */
  readonly maxPieceBytes: number;
  /** Count of UNUSED pieces; must be 0 (04 §3.2). */
  readonly unusedCount: number;
  readonly idOffset?: number;
  readonly byteFirstId?: number;
  readonly bosId?: number;
  readonly eosId?: number;
  readonly unkId?: number;
  readonly padId?: number;
  readonly addDummyPrefix?: boolean;
  readonly escapeWhitespace?: boolean;
  readonly priority?: 'score' | 'merge-rank';
  readonly fallbackOrder?: 'after-merge' | 'before-merge';
  readonly normalScoresMonotone?: boolean;
  readonly hfMergesRegenerable?: boolean;
  readonly modificationNotice: string;
  readonly unicodeVersion: '16.0.0';
  readonly generator: string;
}

/** Signature of the TSBV1 reader (03 §C.2; implemented by WP02). Throws `FormatError { section, offset, reason }` (04 §5). */
export type ReadTsbv1 = (buf: ArrayBuffer) => Tsbv1;
