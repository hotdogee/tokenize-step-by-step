/**
 * Pre-tokenization (04 §2.1 step 3): the tokenizer's compiled pattern (`unicode/expand.ts`, pinned Unicode 16.0 classes,
 * flags `gu`) is run over each ordinary segment, and the matches must tile it — the shipped patterns end in `\s+` /
 * `[^…]+` alternatives, so every code point matches; anything else is an engine bug surfaced as {@link PretokenizeError}
 * (04 §5), never a silent gap. Offsets are converted from UTF-16 to UTF-8 bytes through `analyzeText`'s `utf16ToByte`.
 *
 * When the timeline is traced, each chunk also gets the index of the alternative that produced it, detected IN CONTEXT
 * on the full segment (`ruleAt`): the isolated chunk string can satisfy an earlier alternative that failed in context
 * (a tab before a letter on claude-legacy, `' '` before a digit on o200k).
 */
import { ChunkKind } from '../../model/result.ts';
import { NO_RULE, ruleAt, type CompiledPattern } from '../../unicode/expand.ts';

/** The pre-tokenizer's matches do not tile a segment (04 §5); Worker `error.code = 'pretokenize'`, non-retryable. */
export class PretokenizeError extends Error {
  /** Worker error code (04 §5). */
  readonly code = 'pretokenize';
  /** UTF-8 byte offset into the encoded text where tiling broke. */
  readonly offset: number;

  constructor(offset: number, reason: string) {
    super(`pre-tokenizer matches do not tile the text at byte ${String(offset)} (${reason})`);
    this.name = 'PretokenizeError';
    this.offset = offset;
  }
}

/** Chunk columns under construction (count + 1 `start` entries once the plan is closed). */
export interface ChunkPlan {
  /** Byte offset where each chunk starts. */
  readonly start: number[];
  /** `ChunkKind` per chunk. */
  readonly kind: number[];
  /** Regex alternative per chunk (`NO_RULE` when untraced or for special strings). */
  readonly rule: number[];
  /** Token id of a `SpecialString` chunk, −1 for regex chunks. */
  readonly special: number[];
}

/** An empty plan. */
export function emptyPlan(): ChunkPlan {
  return { start: [], kind: [], rule: [], special: [] };
}

/**
 * Appends the regex chunks of `text[from, to)` (UTF-16 offsets) to `plan`. The pattern runs on that slice alone, as
 * tiktoken runs it on the text between special tokens. Throws {@link PretokenizeError} at the first gap.
 */
export function pretokenizeSegment(
  pattern: CompiledPattern,
  text: string,
  from: number,
  to: number,
  utf16ToByte: ArrayLike<number>,
  withRules: boolean,
  plan: ChunkPlan,
): void {
  const segment = from === 0 && to === text.length ? text : text.slice(from, to);
  const { regex } = pattern;
  regex.lastIndex = 0;
  for (let pos = 0; pos < segment.length;) {
    const match = regex.exec(segment);
    const byte = utf16ToByte[from + pos] ?? 0;
    if (match === null) throw new PretokenizeError(byte, 'no match before the segment end');
    if (match.index !== pos)
      throw new PretokenizeError(byte, `next match starts at UTF-16 offset ${String(from + match.index)}`);
    const end = pos + match[0].length;
    if (end === pos) throw new PretokenizeError(byte, 'empty match');
    plan.start.push(byte);
    plan.kind.push(ChunkKind.Regex);
    plan.rule.push(withRules ? ruleAt(pattern, segment, pos, end) : NO_RULE);
    plan.special.push(-1);
    pos = end;
  }
}
