/**
 * `examples.json` rules (AD-16, AD-38, 05 §6): chips are the verbatim corpus texts, so `chip.text === case.text`
 * byte-for-byte in every shipping fixture; the first chip is the default example of OD-1; long (paragraph) chips carry a
 * display `label` and short ones do not.
 */
import type { ExampleChip, TokenizerEntry } from '../schema.ts';
import type { FixtureSubset } from './inputs.ts';
import type { Report } from './report.ts';

/** The default example (OD-1); it is the first chip. */
export const DEFAULT_EXAMPLE_TEXT = '台灣台南';

/** Chips longer than this many code points are paragraph chips and need a `label`. */
export const LONG_CHIP_CODE_POINTS = 40;

/** Number of code points (not UTF-16 units, not graphemes) — the unit of the char tier (PD-4). */
function codePoints(text: string): number {
  let n = 0;
  for (const _codePoint of text) n++;
  return n;
}

/** All example-chip rules; `fixtures` holds the parsed fixture of every tokenizer whose fixture parsed. */
export function checkExamples(
  chips: readonly ExampleChip[],
  tokenizers: readonly TokenizerEntry[],
  fixtures: ReadonlyMap<string, FixtureSubset>,
  report: Report,
): void {
  if (chips[0]?.text !== DEFAULT_EXAMPLE_TEXT) {
    report('examples', 'examples[0]', `the first chip must be the default example ${DEFAULT_EXAMPLE_TEXT} (OD-1)`);
  }
  const keys = new Set<string>();
  const cases = new Set<string>();
  const shipping = tokenizers.filter((t) => t.withdrawn !== true);
  for (const chip of chips) {
    const where = `examples[${chip.key}]`;
    if (keys.has(chip.key)) report('examples', where, 'duplicate chip key');
    if (cases.has(chip.fixtureCase)) report('examples', where, `fixtureCase ${chip.fixtureCase} is used by two chips`);
    keys.add(chip.key);
    cases.add(chip.fixtureCase);
    const long = codePoints(chip.text) > LONG_CHIP_CODE_POINTS;
    if (long && chip.label === undefined) report('examples', where, 'a paragraph chip needs a label');
    if (!long && chip.label !== undefined) report('examples', where, 'a short chip shows its text; drop the label');
    for (const entry of shipping) {
      const fixture = fixtures.get(entry.id);
      if (fixture === undefined) continue; // reported by the fixture rules
      const found = fixture.cases.find((c) => c.name === chip.fixtureCase);
      if (found === undefined) {
        report('examples', where, `case ${chip.fixtureCase} is missing from ${entry.fixture}`);
      } else if (found.text !== chip.text) {
        report(
          'examples',
          where,
          `chip.text ${JSON.stringify(chip.text)} !== case.text ${JSON.stringify(found.text)} in ${entry.fixture}`,
        );
      }
    }
  }
}
