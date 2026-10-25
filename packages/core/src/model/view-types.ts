// FROZEN v1 — see docs/design/03-data-model-and-assets.md §B.2 (verbatim). A change needs an ADR in docs/adr/
// and one PR that updates every dependent (docs/design/07-implementation-plan.md §1). Excluded from Prettier on purpose.
export interface CharInfo { index: number; cp: number; hex: string /* "U+7063" */; byteStart: number; byteEnd: number; utf16Start: number; utf16End: number;
  grapheme: number; chunk: number; tokenFirst: number; tokenLast: number; split: boolean; standIn: string | null /* ␠ ⇥ ⏎ … key, 05 §4 */;
  combining: boolean; lang: ResolvedTextLang; sourceRun: readonly [number, number] | null; }
export interface TokenInfo { index: number; id: number; byteStart: number; byteEnd: number; bytes: Uint8Array; hex: string[]; dec: number[];
  text: string | null /* decoded only if complete UTF-8: TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) */; piece: string | null;
  kind: number; flags: number; flagsAsWords: string[]; completes: 'full' | 'starts' | 'ends' | 'inside' | 'crosses'; missingBytes: number;
  charFirst: number; charLast: number; chunk: number; stepFormed: number; zeroWidth: boolean; partial: boolean; }
export interface PartsAt { step: number; partStart: Uint32Array /* count+1 */; partChunk: Int32Array; partId: Int32Array /* -1 if not a vocab entry */;
  justMerged: number /* part index formed at this step or -1 */; }
export interface StepSentence { step: number; stepCount: number; kind: 'merge' | 'split'; leftHex: string[]; rightHex: string[]; resultId: number;
  rank: number; chunk: number; charsText: string /* "灣" */; partOf: 'whole' | 'part' | 'crosses'; }
export interface Fragment { spanId: number; row: number; colStart: number /* 0-based column in the row */; colSpan: number; first: boolean; last: boolean;
  byteStart: number; byteEnd: number; }
export interface RowModel { index: number; byteStart: number; byteEnd: number; columns: number /* ≤ K, incl. marker columns */;
  chars: Fragment[]; markers: Array<{ col: number; token: number }>; bytes: Array<{ col: number; byte: number }>;
  graphemes: Fragment[]; chunks: Fragment[]; tokens: Fragment[]; parts: Fragment[] /* at the current step */; }
/** What the text-language chip offers (05 §10) … */
export type TextLangChoice = 'auto' | 'zh-Hant' | 'ja' | 'en';
/** … and what is written to `lang` attributes (auto-detection may yield 'ko' / 'und'). zh-Hant resolves to zh-Hant-TW so the UI root (zh-TW) and glyph cells share one font stack. */
export type ResolvedTextLang = 'zh-Hant-TW' | 'ja' | 'en' | 'ko' | 'und';
