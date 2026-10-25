// FROZEN v1 — see docs/design/03-data-model-and-assets.md §B.6 (verbatim; only the import line is added). A change needs an
// ADR in docs/adr/ and one PR that updates every dependent (docs/design/07-implementation-plan.md §1). Excluded from Prettier.
import type { EncodeOptions, Family, TokenizationResult, TokenizerId } from './result.ts';

export interface TokenizerInfo {
  readonly id: TokenizerId; readonly family: Family; readonly vocabSize: number; readonly rankCount: number;
  readonly specials: ReadonlyArray<{ readonly id: number; readonly text: string }>;
  readonly bosId: number | null; readonly unicodeVersion: '16.0.0'; readonly sourceSha256: string;
  readonly supports: { readonly nfkc: boolean; readonly bos: boolean; readonly specialsToggle: boolean };
}
export interface Tokenizer {
  readonly info: TokenizerInfo;
  encode(text: string, options?: Partial<EncodeOptions>): TokenizationResult;
  /** Yields between chunks AND inside the agenda loop (every ~4 ms of merge work, 04 §1.3) so the Worker can observe `cancel` even when the
   *  whole text is one chunk (CJK). `budgetMs` defaults to 4. */
  encodeIncremental(text: string, options?: Partial<EncodeOptions>, budgetMs?: number): Generator<{ bytesDone: number; bytesTotal: number }, TokenizationResult>;
  tokenBytes(id: number): Uint8Array | null;
  pieceString(id: number): string | null;      // spm piece with ▁; bytelevel: null
  idOf(bytes: Uint8Array): number | null;      // inspector: "is this byte string a token?"
  pretokenize(text: string): ReadonlyArray<readonly [number, number]>;  // byte spans (engine A: chunks; engine B: symbols)
  dispose(): void;
}
