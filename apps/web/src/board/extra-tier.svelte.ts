/**
 * The board's extra-tier hook (an additive extension for WP10's BYOK live token tier, 05 §13). One more row-aligned tier
 * is drawn under the token tier of every packed row at stop 6 — the xAI live tokens lined up by their bytes under the
 * Grok-2 tokens. The board knows nothing about BYOK: whoever fills the slot supplies a component that renders one packed
 * row's fragments as grid items of a K-column grid (the `.bd-extra` layer of Row.svelte, `aria-hidden`; the slot's owner
 * provides the accessible equivalent, e.g. the drawer's token list), and names the tokenizer and text it belongs to.
 * While the slot is filled and applies, each packed row grows by one decorative track (board.css `.bd-grid.extra`).
 */
import type { Component } from 'svelte';
import type { RowModel, TokenizationResult, TokenizerId } from '@tsbs/core';
import type { Stage } from '../app/app-state.svelte.ts';

/** What the board passes to the extra tier's component for each mounted packed row. */
export interface ExtraTierProps {
  readonly row: RowModel;
  /** The result the board shows (the slot's tokenizer and text, see `extraTierFor`). */
  readonly result: TokenizationResult;
}

/** An extra tier: drawn only while the board shows a real result of `tokenizer` for exactly `text`. */
export interface ExtraTier {
  readonly tokenizer: TokenizerId;
  readonly text: string;
  readonly component: Component<ExtraTierProps>;
}

class ExtraTierSlot {
  /** The registered extra tier, or null (the board then draws nothing extra). */
  current: ExtraTier | null = $state.raw(null);
}

/** The app-wide slot (one extra tier at a time). */
export const extraTier = new ExtraTierSlot();

/**
 * The extra tier the board draws: the slot's tier at stop 6 (final tokens) when a tokenizer result — not the text-only
 * placeholder of a pending board — of the slot's tokenizer for the slot's exact text is on screen; otherwise null.
 */
export function extraTierFor(
  slot: ExtraTier | null,
  result: TokenizationResult,
  stage: Stage,
  pending: boolean,
): ExtraTier | null {
  if (slot === null || pending || stage !== 6) return null;
  return result.tokenizer === slot.tokenizer && result.input.text === slot.text ? slot : null;
}
