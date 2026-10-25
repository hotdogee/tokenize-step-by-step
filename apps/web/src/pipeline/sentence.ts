/**
 * The merge sentence of a timeline step (05 §2, §10): `TokenizationView.stepSentence(k)` rendered through the named-
 * placeholder templates — "step 7 / 7 · E7 + 81 → 66285 (part of 灣)", a SentencePiece byte-fallback split as
 * "step 1 / 1 · E7 81 A3 split into bytes (灣)", and step 0 as "step 0 / 7 · no merges yet". The scrubber's
 * `aria-valuetext`, the keyboard-step announcement and the merge list all use it. Ids, hex and steps are raw digits.
 */
import type { TokenizationView } from '@tsbs/core';
import type { Translate } from '../board/labels.ts';

/** The pieces of step `k`'s sentence (1 ≤ k ≤ stepCount). */
export interface StepWords {
  readonly kind: 'merge' | 'split';
  readonly left: string;
  readonly right: string;
  readonly id: number;
  /** "灣", "part of 灣" or "across ーメ". */
  readonly chars: string;
}

export function stepWords(view: TokenizationView, k: number, t: Translate): StepWords {
  const s = view.stepSentence(k);
  const chars =
    s.partOf === 'whole' ? s.charsText : t(s.partOf === 'part' ? 'step.part' : 'step.crosses', { glyph: s.charsText });
  return { kind: s.kind, left: s.leftHex.join(' '), right: s.rightHex.join(' '), id: s.resultId, chars };
}

/** The full sentence of step `k` (0 ≤ k ≤ stepCount). */
export function stepText(view: TokenizationView, k: number, t: Translate): string {
  const stepCount = view.stepCount;
  if (k <= 0) return t('step.none', { stepCount });
  const w = stepWords(view, k, t);
  if (w.kind === 'split') return t('step.split', { step: k, stepCount, left: w.left, chars: w.chars });
  return t('step.sentence', { step: k, stepCount, left: w.left, right: w.right, id: w.id, chars: w.chars });
}
