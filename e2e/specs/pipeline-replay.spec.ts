/**
 * Merge replay on the real Worker (05 §2, §4.1; 07 WP09): at every step k the token tier equals the replay of the case's
 * merge timeline — for byte-level the fixture's own merge record (`fromFixtureCase` → `partsAt(k)`), for SentencePiece
 * the fixture's final tokens preceded by the reference's pre-fallback state — on the default example and the four chips
 * 灣/cl100k, 👩‍👩‍👧/o200k, 台灣台南/Grok-1 and 𰻝/Gemma 4; byte-level replays chunk by chunk, left to right; Gemma 2 and
 * Grok-1 shatter a character into byte-fallback pieces as a split step at stop 5, while Gemma 4 (HF order) shows 𰻝
 * already shattered at stop 4 with no step at all.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Family, TokenizerId } from '@tsbs/core';
import { chooseExample, grid } from './board-helpers.ts';
import {
  domParts,
  fixture,
  fixtureReplay,
  partBytes,
  scrubber,
  walkSteps,
  withLookupIds,
  type Part,
} from './pipeline-helpers.ts';
import { openShell, switchTokenizer } from './shell-helpers.ts';

/** Opens `/`, selects the tokenizer (unless it is the default) and the chip, and waits for the live result. */
async function show(page: Page, tokenizer: string | null, chip: string): Promise<void> {
  await openShell(page, 'en', { advanced: true });
  if (tokenizer !== null) await switchTokenizer(page, tokenizer);
  await chooseExample(page, chip);
  await expect(page.locator('#advanced [data-source="live"]')).toBeVisible();
  await expect(grid(page)).not.toHaveAttribute('data-pending', '');
}

/** Walks every step at stop 5 and returns the token tier at each. */
async function replayFromDom(page: Page, count: number): Promise<Part[][]> {
  const seen: Part[][] = [];
  await walkSteps(page, count, async (k) => {
    await expect(grid(page)).toHaveAttribute('data-stage', '5');
    seen[k] = await domParts(page);
  });
  return seen;
}

/** A byte-level fixture replay with the single bytes the board names through the vocabulary lookup named. */
function byteLevelReplay(id: TokenizerId, chip: string): Part[][] {
  return fixtureReplay(id, 'bytelevel-bpe', chip).map((parts) => withLookupIds(parts, id));
}

const BYTE_LEVEL: ReadonlyArray<{ name: string; id: TokenizerId; picker: string | null; chip: string }> = [
  { name: 'the default example 台灣台南 on o200k', id: 'openai-o200k_base', picker: null, chip: 'zh-tw-tainan' },
  { name: '灣 on cl100k (台灣台南)', id: 'openai-cl100k_base', picker: 'cl100k_base', chip: 'zh-tw-tainan' },
  { name: '👩‍👩‍👧 on o200k', id: 'openai-o200k_base', picker: null, chip: 'emoji-family-zwj' },
];

for (const { name, id, picker, chip } of BYTE_LEVEL) {
  test(`token tier at every step equals the fixture replay: ${name}`, async ({ page }) => {
    const expected = byteLevelReplay(id, chip);
    await show(page, picker, chip);
    expect(await replayFromDom(page, expected.length - 1)).toEqual(expected);
  });
}

/**
 * SentencePiece: the fixtures carry final tokens only, so the steps before the byte-fallback split come from the
 * SentencePiece reference (tools/oracle/oracles/spm_bpe_ref.py instrumented per merge: Grok-1 台灣台南 makes 0 merges —
 * pieces ▁ 台 灣 台 南 — and Gemma 1/2 𰻝 makes 0 merges, then the unknown piece falls back to bytes). The last state is
 * the fixture's tokens.
 */
const SPM: ReadonlyArray<{ name: string; id: TokenizerId; picker: string; chip: string; before: Part[][] }> = [
  {
    name: '台灣台南 on Grok-1 (zero-width dummy prefix, 灣 shatters)',
    id: 'xai-grok1',
    picker: 'Grok-1',
    chip: 'zh-tw-tainan',
    before: [['▁|130089', 'E5 8F B0|130876', 'E7 81 A3|-', 'E5 8F B0|130876', 'E5 8D 97|130899']],
  },
  {
    name: '𰻝 on Gemma 4 (HF order: shattered before merging, no steps)',
    id: 'google-gemma4',
    picker: 'Gemma 4',
    chip: 'cjk-ext-g-biang',
    before: [],
  },
];

for (const { name, id, picker, chip, before } of SPM) {
  test(`token tier at every step equals the replay: ${name}`, async ({ page }) => {
    const final = fixtureReplay(id, 'spm-bpe' satisfies Family, chip)[0] ?? [];
    const expected = [...before, final];
    await show(page, picker, chip);
    if (expected.length === 1) {
      await page.keyboard.press('Digit5');
      await expect(grid(page)).toHaveAttribute('data-stage', '5');
      await expect(scrubber(page)).toBeDisabled();
      await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'step 0 / 0 · no merges yet');
      expect(await domParts(page)).toEqual(final);
      return;
    }
    expect(await replayFromDom(page, expected.length - 1)).toEqual(expected);
  });
}

test('byte-level replays chunk by chunk, left to right (Hello 台灣! 東京タワー on o200k)', async ({ page }) => {
  const chip = 'mixed-hello-taiwan-tokyo';
  const expected = byteLevelReplay('openai-o200k_base', chip);
  await show(page, null, chip);
  const seen = await replayFromDom(page, expected.length - 1);
  expect(seen).toEqual(expected);
  // At step k the chunk being merged is the one whose merge record holds step k: earlier chunks show their final
  // tokens, later chunks are still single bytes.
  const source = fixture('openai-o200k_base');
  const kase = source.family === 'tiktoken-bpe' ? source.cases.find((c) => c.name === chip) : undefined;
  if (kase === undefined) throw new Error(`no tiktoken case ${chip}`);
  expect(kase.chunks.length).toBeGreaterThan(1);
  const firstStep: number[] = [];
  let total = 0;
  for (const merge of kase.merges) {
    if (merge.steps.length > 0) firstStep[merge.chunk] = total + 1; // direct hits show whole from step 0
    total += merge.steps.length;
  }
  const final = new Set(withStarts(expected.at(-1) ?? []));
  const chunkAt = (offset: number): number => kase.chunks.findIndex(([s, e]) => offset >= s && offset < e);
  let chunksSeen = 0;
  for (let k = 1; k < seen.length; k++) {
    const active = firstStep.findLastIndex((first) => first <= k);
    chunksSeen = Math.max(chunksSeen, active);
    for (const part of withStarts(seen[k] ?? [])) {
      const chunk = chunkAt(Number(part.split('@')[0]));
      if (chunk < active)
        expect(final.has(part), `step ${String(k)}: ${part} (chunk ${String(chunk)}) is final`).toBe(true);
      if (chunk > active && firstStep[chunk] !== undefined)
        expect(partBytes(part.split('@')[1] ?? ''), `step ${String(k)}: chunk ${String(chunk)}`).toBe(1);
    }
  }
  expect(chunksSeen).toBeGreaterThan(0);
});

/** Parts as `offset@HEX|id`, offsets accumulated from the part lengths (parts tile the bytes). */
function withStarts(parts: readonly Part[]): string[] {
  let offset = 0;
  return parts.map((part) => {
    const keyed = `${String(offset)}@${part}`;
    offset += partBytes(part);
    return keyed;
  });
}

test('Gemma 1/2 shatters 𰻝 into byte-fallback pieces as a split step at stop 5', async ({ page }) => {
  await show(page, 'Gemma 1/2', 'cjk-ext-g-biang');
  await scrubber(page).focus();
  await page.keyboard.press('Home');
  await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'step 0 / 1 · no merges yet');
  expect(await domParts(page)).toEqual(['F0 B0 BB 9D|-']);
  await page.keyboard.press('ArrowRight');
  await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'step 1 / 1 · F0 B0 BB 9D split into bytes (𰻝)');
  expect(await domParts(page)).toEqual(fixtureReplay('google-gemma2', 'spm-bpe', 'cjk-ext-g-biang')[0]);
  const pieces = grid(page).locator('[data-tier="token"] .bd-piece');
  await expect(pieces).toHaveText(['<0xF0>', '<0xB0>', '<0xBB>', '<0x9D>']);
  await expect(grid(page).locator('[data-tier="token"][data-just-merged]')).toHaveCount(4);
});

test('Grok-1 shatters 灣 at stop 5; Gemma 4 shows 𰻝 already shattered at stop 4', async ({ page }) => {
  await show(page, 'Grok-1', 'zh-tw-tainan');
  await page.keyboard.press('Digit5');
  await scrubber(page).focus();
  await page.keyboard.press('End');
  await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'step 1 / 1 · E7 81 A3 split into bytes (灣)');
  await expect(grid(page).locator('[data-tier="token"] .bd-piece')).toHaveText(['<0xE7>', '<0x81>', '<0xA3>']);

  await switchTokenizer(page, 'Gemma 4');
  await chooseExample(page, 'cjk-ext-g-biang');
  await expect(page.locator('#advanced [data-source="live"]')).toBeVisible();
  await page.keyboard.press('Digit4');
  await expect(grid(page)).toHaveAttribute('data-stage', '4');
  await expect(grid(page).locator('[data-tier="token"] .bd-piece')).toHaveText([
    '<0xF0>',
    '<0xB0>',
    '<0xBB>',
    '<0x9D>',
  ]);
  await expect(scrubber(page)).toBeDisabled();
});
