/**
 * Our engines under fuzz: the BUILT assets (`data/vocab/dist`, gunzipped and decoded by `readTsbv1` — the bytes the Worker
 * loads) with their registry entries, through the shared suite helpers of `../engines/{bytelevel,spm}`. Default options
 * (the fixture policy: special strings are text, no BOS, no NFKC), trace on — the UI's path.
 */
import type { TokenizationResult, Tokenizer, TokenizerId } from '../../src/index.ts';
import { BYTELEVEL_IDS, tokenizerFor, type ByteLevelId } from '../engines/bytelevel/assets.ts';
import { SPM_IDS, spmTokenizer, type SpmId } from '../engines/spm/helpers.ts';

/** The nine shipped tokenizers in fuzz order (byte-level first). */
export const FUZZ_TOKENIZERS: readonly TokenizerId[] = [...BYTELEVEL_IDS, ...SPM_IDS];

/** Ids and `[start, end)` byte spans of one encoding. */
export interface Encoded {
  readonly ids: readonly number[];
  readonly spans: ReadonlyArray<readonly [number, number]>;
}

const isByteLevel = (id: TokenizerId): id is ByteLevelId => (BYTELEVEL_IDS as readonly TokenizerId[]).includes(id);
const isSpm = (id: TokenizerId): id is SpmId => (SPM_IDS as readonly TokenizerId[]).includes(id);

/** The engine of `id` over its built asset (throws when `data/vocab/dist` lacks it). */
export function engineFor(id: TokenizerId): Tokenizer {
  if (isByteLevel(id)) return tokenizerFor(id);
  if (isSpm(id)) return spmTokenizer(id);
  throw new Error(`no engine for ${String(id)}`);
}

/** Ids and spans of a result. */
export function encodedOf(result: TokenizationResult): Encoded {
  const { id, byteStart, count } = result.tokens;
  const spans: Array<readonly [number, number]> = [];
  for (let t = 0; t < count; t++) spans.push([byteStart[t] ?? -1, byteStart[t + 1] ?? -1]);
  return { ids: Array.from(id), spans };
}

/** Encodes `text` with `engine`; an exception becomes an `error` (reported as an engine failure, never swallowed). */
export function encodeWith(engine: Tokenizer, text: string): Encoded | { readonly error: string } {
  try {
    return encodedOf(engine.encode(text));
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}
