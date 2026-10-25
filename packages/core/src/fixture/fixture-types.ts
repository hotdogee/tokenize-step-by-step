// FROZEN v1 — golden-fixture schema. Derived from tools/oracle/README.md § "Golden fixtures" › "Fixture schema" and the
// committed fixtures/*.json (12 files); field semantics and the model mapping are in docs/design/03-data-model-and-assets.md
// §B.5 and 04-engines.md §7. A change needs an ADR in docs/adr/ and one PR that updates every dependent
// (docs/design/07-implementation-plan.md §1).

/** Oracle family of a fixture (`family` field). Only the first two are shipping families in v1 (ctok is Phase 2, AD-30). */
export type FixtureFamily = 'tiktoken-bpe' | 'sentencepiece-bpe' | 'ctok-tiling';

/** SentencePiece proto piece type (`tokens[].type`, sentencepiece-bpe only). */
export type SpmPieceType = 'NORMAL' | 'USER_DEFINED' | 'BYTE' | 'CONTROL' | 'UNK' | 'UNUSED';

/** A half-open UTF-8 byte span `[start, end)`. */
export type ByteSpan = readonly [start: number, end: number];

/** One merge step in fixture form: merge part `position` with part `position + 1`; `rank` is the merged token's id. */
export type FixtureMergeStep = readonly [position: number, rank: number];

/** `oracle {library, version}`. */
export interface FixtureOracle {
  readonly library: string;
  readonly version: string;
}

/** One explained cross-check disagreement (`crossCheck.disagreements[]`, google-gemma4 only). */
export interface FixtureDisagreement {
  readonly name: string;
  readonly ids: readonly number[];
  readonly crossCheckIds: readonly number[];
  readonly explanation: string;
}

/** `crossCheck {library, version, agreedCases, disagreedCases}` plus the family-specific extras. */
export interface FixtureCrossCheck {
  readonly library: string;
  readonly version: string;
  readonly agreedCases: number;
  /** Names of the cases the cross-check disagreed on. */
  readonly disagreedCases: readonly string[];
  /** google-gemma4: the cross-check's own model asset (manifest id) and its SHA-256. */
  readonly vocabAsset?: string;
  readonly vocabSha256?: string;
  /** google-gemma4: every disagreement with its explanation. */
  readonly disagreements?: readonly FixtureDisagreement[];
  /** ctok: what the independent re-check covers. */
  readonly scope?: string;
}

/** `policy {specialTokens, addBos, notes}`. */
export interface FixturePolicy {
  /**
   * `as-text`: special-token strings are encoded as ordinary text; where matching them would change the ids, that result is
   * stored as `idsWithSpecials`. `user-defined-atomic` (google-gemma2): SentencePiece never matches CONTROL pieces but always
   * matches USER_DEFINED pieces, some of which are special-token strings.
   */
  readonly specialTokens: 'as-text' | 'user-defined-atomic';
  /** `false` in every committed fixture. */
  readonly addBos: boolean;
  /** The exact encode call, the special-token handling and the alignment rule for this fixture. */
  readonly notes: string;
}

/** Top-level fields shared by every fixture. */
interface FixtureHeader {
  /** Tokenizer id; equals the file name without `.json`. */
  readonly tokenizer: string;
  readonly lab: string;
  readonly family: FixtureFamily;
  /** Asset id in tools/oracle/manifest.json. */
  readonly vocabAsset: string;
  /** SHA-256 of the vocabulary file, verified against the manifest. */
  readonly vocabSha256: string;
  readonly oracle: FixtureOracle;
  readonly crossCheck: FixtureCrossCheck;
  readonly policy: FixturePolicy;
  /** Fixed (`2026-10-25`) so regeneration is byte-identical. */
  readonly generatedOn: string;
}

/** One token of a tiktoken-bpe or sentencepiece-bpe case. */
export interface FixtureToken {
  readonly id: number;
  /** Token bytes as lowercase hex. */
  readonly bytes: string;
  /** UTF-8 byte offsets `[start, end)`. */
  readonly start: number;
  readonly end: number;
  /** The bytes are not complete UTF-8 on their own. */
  readonly partial: boolean;
  /** `start === end` (Grok-1 dummy prefix). */
  readonly zeroWidth: boolean;
}

/** A sentencepiece-bpe token additionally carries its piece string (with `▁`) and proto piece type. */
export interface SpmFixtureToken extends FixtureToken {
  readonly piece: string;
  /** google-gemma4 takes `type` from the Gemma 3 proto; USER_DEFINED there is provenance only (AD-31). */
  readonly type: SpmPieceType;
}

/** Fields shared by every tiktoken-bpe / sentencepiece-bpe case. */
interface FixtureCaseBase<T extends FixtureToken> {
  readonly name: string;
  readonly text: string;
  readonly utf8Len: number;
  readonly ids: readonly number[];
  readonly tokens: readonly T[];
  /** Present only where matching special-token strings changes the ids. */
  readonly idsWithSpecials?: readonly number[];
}

/** Per-chunk merge record (tiktoken family). */
export interface FixtureMerge {
  /** Index into the case's `chunks`. */
  readonly chunk: number;
  /** The whole chunk is a vocabulary entry: tiktoken emits it without merging and `steps` is empty. */
  readonly directHit: boolean;
  /** Replayed from one part per byte. */
  readonly steps: readonly FixtureMergeStep[];
}

/** A tiktoken-bpe case: tokens plus pre-tokenizer chunks and merge steps. */
export interface TiktokenFixtureCase extends FixtureCaseBase<FixtureToken> {
  /** Pre-tokenizer regex matches as byte spans; they tile the text. */
  readonly chunks: readonly ByteSpan[];
  /** One record per chunk. */
  readonly merges: readonly FixtureMerge[];
}

/** A sentencepiece-bpe case. */
export type SpmFixtureCase = FixtureCaseBase<SpmFixtureToken>;

/** A tiktoken-bpe fixture (o200k, cl100k, Llama 3, Llama 4/Muse, Grok-2, Claude legacy). */
export interface TiktokenFixture extends FixtureHeader {
  readonly family: 'tiktoken-bpe';
  readonly cases: readonly TiktokenFixtureCase[];
  /** anthropic-claude-legacy only: the cases whose NFKC form differs, with `text` set to the NFKC form. */
  readonly normalizedNFKC?: readonly TiktokenFixtureCase[];
}

/** A sentencepiece-bpe fixture (Gemma 4, Gemma 1/2, Grok-1). */
export interface SpmFixture extends FixtureHeader {
  readonly family: 'sentencepiece-bpe';
  readonly cases: readonly SpmFixtureCase[];
}

/** A fixture of a shipping family: what `runFixture` and `fromFixtureCase` consume (04 §7, 03 §C.7). */
export type Fixture = TiktokenFixture | SpmFixture;

// ---- ctok-tiling (Phase 2, AD-30: committed but not consumed in v1) ----

/** A ctok token: ctok has no ids, so `id` is always `null`; `piece` is the verbatim ctok piece. */
export interface CtokFixtureToken {
  readonly id: null;
  readonly bytes: string;
  readonly start: number;
  readonly end: number;
  readonly partial: boolean;
  readonly zeroWidth: boolean;
  readonly piece: string;
}

/** Source bytes that no ctok piece spells. `token` is the index of the token they are attributed to. */
export interface CtokAbsorbed {
  readonly start: number;
  readonly end: number;
  readonly reason: 'bow-space' | 'stripped' | 'frame-newlines';
  readonly token: number;
}

/** A ctok case. Token spans cover UTF-8(NFC(`text`)). */
export interface CtokFixtureCase {
  readonly name: string;
  readonly text: string;
  readonly utf8Len: number;
  /** One `null` per token; `null` when no faithful alignment exists (see `spansNullReason`). */
  readonly ids: readonly null[] | null;
  readonly tokens: readonly CtokFixtureToken[] | null;
  readonly spansNullReason?: string;
  /** Verbatim `ctok.tokenize()` output, frame `⟨pad⟩` pieces first. */
  readonly pieces: readonly string[];
  readonly frameCount: number;
  readonly contentCount: number;
  readonly totalCount: number;
  /** Present when NFC changes the text. */
  readonly nfcText?: string;
  readonly absorbed?: readonly CtokAbsorbed[];
}

/** A ctok-tiling fixture (`anthropic-ctok-v3`, `-v4.7`, `-v4.8`): a community reconstruction, never Anthropic's tokenizer. */
export interface CtokFixture extends FixtureHeader {
  readonly family: 'ctok-tiling';
  readonly cases: readonly CtokFixtureCase[];
  /** The ctok label used (`3.0`, `4.7`, `4.8`). */
  readonly version: string;
  readonly ctokFamily: string;
  /** Labels that give identical output. */
  readonly aliases: readonly string[];
  readonly models: string;
  readonly sourceModel: string;
  readonly frame: {
    readonly count: number;
    readonly piece: string;
    readonly position: string;
    readonly endsInBow: boolean;
  };
  /** The bundled pieces file. */
  readonly dataFile: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly vocabSha256Of: string;
  readonly wheelSha256: string;
  readonly vocabSize: number;
  readonly vocabGroups: Readonly<Record<string, number>>;
  readonly byteFallbackPieces: number;
  readonly normalization: { readonly allcapsMin: number | null; readonly foldQuotes: boolean };
  readonly knownGaps: readonly string[];
  readonly versionRouting: {
    readonly defaultVersions: readonly string[];
    readonly observed: Readonly<Record<string, string | null>>;
    readonly rule: string;
  };
  readonly caveat: string;
  readonly description: string;
}

/** Any committed fixture file. */
export type AnyFixture = Fixture | CtokFixture;
