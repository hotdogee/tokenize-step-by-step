/**
 * The panels' last answers (05 §13: "results are never stored"): runes state in memory only, cleared with the keys when
 * the drawer collapses or the page is hidden. The xAI answer also fills the board's extra-tier slot while it is aligned,
 * so the live token tier appears under the Grok-2 token tier (board/extra-tier.svelte.ts).
 */
import type { Component } from 'svelte';
import type { TokenizerId } from '@tsbs/core';
import { extraTier, type ExtraTierProps } from '../board/extra-tier.svelte.ts';
import type { CountSummary } from './anthropic.ts';
import type { Alignment, LiveToken } from './live-tier.ts';

/** An Anthropic count for `text` with `model`. */
export interface AnthropicAnswer {
  readonly text: string;
  readonly model: string;
  readonly summary: CountSummary;
}

/** An xAI tokenization of `text` with `model`, aligned (or not) by bytes. */
export interface XaiAnswer {
  readonly text: string;
  readonly model: string;
  readonly tokens: readonly LiveToken[];
  readonly alignment: Alignment;
}

class LiveAnswers {
  anthropic: AnthropicAnswer | null = $state.raw(null);
  xai: XaiAnswer | null = $state.raw(null);

  /**
   * Shows an xAI answer; an aligned one becomes the board's live tier under `paired` (drawn by `row`), an unaligned one
   * never reaches the board.
   */
  setXai(answer: XaiAnswer, paired: ExtraTierPairing): void {
    this.xai = answer;
    extraTier.current = answer.alignment.aligned
      ? { tokenizer: paired.tokenizer, text: answer.text, component: paired.row }
      : null;
  }

  /** Forgets both answers and removes the live tier from the board. */
  clear(): void {
    this.anthropic = null;
    this.xai = null;
    extraTier.current = null;
  }
}

/** Where an aligned xAI answer is drawn: under `tokenizer`'s token tier, one `row` component per packed row. */
export interface ExtraTierPairing {
  readonly tokenizer: TokenizerId;
  readonly row: Component<ExtraTierProps>;
}

/** The app-wide answers. */
export const answers = new LiveAnswers();
