/**
 * Shared steps of the WP09 pipeline suites (pipeline-*.spec.ts): the rail's controls, the token tier read back from the
 * DOM as `HEX HEX|id` parts (`▁|id` for a zero-width part, `-` for an id the view does not know), the same parts
 * computed from a golden fixture (`fromFixtureCase` + `TokenizationView.partsAt`, the replay the board must show), and
 * scrubbing to a step with the keyboard.
 */
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  fromFixtureCase,
  TokenizationView,
  type Family,
  type Fixture,
  type PartsAt,
  type TokenizerId,
} from '@tsbs/core';
import { grid } from './board-helpers.ts';

/** The rail region. */
export const rail = (page: Page): Locator => page.getByTestId('pipeline');
/** The merge-step scrubber. */
export const scrubber = (page: Page): Locator => page.getByTestId('scrubber');

/** The checked stop (1–6). */
export function checkedStop(page: Page): Promise<number> {
  return rail(page)
    .locator('input[type="radio"]:checked')
    .evaluate((radio) => Number((radio as HTMLInputElement).value));
}

/** Interacts once and waits until the lazy choreography chunk is in (the rail says `data-motion="ready"`). */
export async function motionReady(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(rail(page)).toHaveAttribute('data-motion', 'ready');
}

/** One part as `HEX HEX|id`. */
export type Part = string;

/**
 * The token tier's parts in order, read from each logical cell's label (first fragment). A byte-fallback part names its
 * piece (`<0xE7>`, as its chip shows it under the id, PA-17) where other parts name their hex.
 */
export async function domParts(page: Page): Promise<Part[]> {
  const labels = await grid(page)
    .locator('[data-tier="token"][data-first]')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label') ?? ''));
  return labels.map((label) => {
    const fields = label.split(', ');
    const id = /\bid (\d+)/.exec(label)?.[1] ?? '-';
    if (fields[0] === 'dummy prefix') return `▁|${id}`;
    const hex = fields.find((field) => /^[0-9A-F]{2}( [0-9A-F]{2})*$/.test(field));
    const piece = fields.map((field) => /^<0x([0-9A-F]{2})>$/.exec(field)?.[1]).find((byte) => byte !== undefined);
    return `${hex ?? piece ?? '?'}|${id}`;
  });
}

/**
 * The ids of single-byte vocabulary entries, from the Python oracle (tiktoken 0.14.0 on the pinned raw vocabularies,
 * `encode_single_token(bytes([b]))`; identical for o200k_base and cl100k_base, whose first 256 ranks are the bytes in
 * GPT-2 order), for every byte a byte-level replay below leaves unnamed.
 */
const SINGLE_BYTE_IDS: Readonly<Record<string, number>> = {
  '20': 220,
  '80': 222,
  '81': 223,
  '82': 224,
  '83': 225,
  '8D': 235,
  '8F': 237,
  '91': 239,
  '97': 245,
  '9D': 251,
  '9F': 253,
  A3: 96,
  AC: 105,
  AF: 107,
  B0: 108,
  B1: 109,
  BA: 118,
  BC: 120,
  BF: 123,
  E2: 158,
  E3: 159,
  E4: 160,
  E5: 161,
  E6: 162,
  E7: 163,
  F0: 172,
};
const SINGLE_BYTE_TOKENIZERS: ReadonlySet<TokenizerId> = new Set(['openai-o200k_base', 'openai-cl100k_base']);

/**
 * `expected` (a fixture replay) with every part it leaves unnamed (`-`) named: since WP13 the board names such parts —
 * single bytes before their first merge — through the Worker's vocabulary lookup, which a fixture replay cannot do, so
 * the oracle's ids above stand in for it and the board's lookup ids are asserted, not masked. Throws for an unnamed part
 * the table does not cover.
 */
export function withLookupIds(expected: readonly Part[], tokenizer: TokenizerId): Part[] {
  return expected.map((part) => {
    if (!part.endsWith('|-')) return part;
    const hex = part.slice(0, -2);
    const id = SINGLE_BYTE_TOKENIZERS.has(tokenizer) ? SINGLE_BYTE_IDS[hex] : undefined;
    if (id === undefined) throw new Error(`no oracle id for the unnamed part ${hex} on ${tokenizer}`);
    return `${hex}|${String(id)}`;
  });
}

const FIXTURES = new URL('../../fixtures/', import.meta.url);
const fixtures = new Map<TokenizerId, Fixture>();

/** `fixtures/<id>.json`. */
export function fixture(id: TokenizerId): Fixture {
  let loaded = fixtures.get(id);
  if (loaded === undefined) {
    loaded = JSON.parse(readFileSync(new URL(`${id}.json`, FIXTURES), 'utf8')) as Fixture;
    fixtures.set(id, loaded);
  }
  return loaded;
}

function describeParts(parts: PartsAt, utf8: Uint8Array): Part[] {
  const out: Part[] = [];
  for (let i = 0; i + 1 < parts.partStart.length; i++) {
    const start = parts.partStart[i] ?? 0;
    const end = parts.partStart[i + 1] ?? 0;
    const id = parts.partId[i] ?? -1;
    const idText = id >= 0 ? String(id) : '-';
    if (start === end) {
      out.push(`▁|${idText}`);
      continue;
    }
    const hex = Array.from(utf8.subarray(start, end), (b) => b.toString(16).toUpperCase().padStart(2, '0'));
    out.push(`${hex.join(' ')}|${idText}`);
  }
  return out;
}

/**
 * The parts of a fixture case after every step k = 0…stepCount, from the fixture's merge record (byte-level); a
 * SentencePiece fixture has no merge record, so its replay is just the final tokens (k = 0).
 */
export function fixtureReplay(id: TokenizerId, family: Family, caseName: string): Part[][] {
  const result = fromFixtureCase(fixture(id), caseName, { id, family });
  const view = new TokenizationView(result);
  const steps: Part[][] = [];
  for (let k = 0; k <= view.stepCount; k++) steps.push(describeParts(view.partsAt(k), result.utf8));
  return steps;
}

/** Byte length of a part. */
export function partBytes(part: Part): number {
  const hex = part.split('|')[0] ?? '';
  return hex === '▁' ? 0 : hex.split(' ').length;
}

/** Focuses the scrubber and walks it Home → step `count` with ArrowRight, calling `visit(k)` at every step. */
export async function walkSteps(page: Page, count: number, visit: (k: number) => Promise<void>): Promise<void> {
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  for (let k = 0; k <= count; k++) {
    if (k > 0) await page.keyboard.press('ArrowRight');
    await expect(scrubber(page)).toHaveAttribute(
      'aria-valuetext',
      new RegExp(`^step ${String(k)} / ${String(count)} · `),
    );
    await visit(k);
  }
}
