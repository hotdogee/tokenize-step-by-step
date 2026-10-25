/**
 * `TSBS_NATIVE_UNICODE=1` parity report (AD-4, 04 §2.3 / §8): Engine A with the runtime's native `\p{…}` classes instead
 * of the pinned Unicode 16.0 tables, run through `runFixture` on all six byte-level fixtures, plus the runtime's
 * `String.prototype.normalize('NFKC')` against the fixtures' Python `unicodedata` (Unicode 15.1) NFKC forms. Divergences
 * are expected only on code points assigned after Unicode 16.0 (Node 26 and current browsers are Unicode 17), which the
 * corpus avoids, so every report must be empty. Opt-in: the production engine never uses native classes.
 */
import process from 'node:process';
import { formatReport, runFixture } from '@tsbs/conformance';
import { describe, expect, it } from 'vitest';
import { BYTELEVEL_IDS, fixtureOf, SKIP_REASON, tokenizerFor } from './assets.ts';

const NATIVE = process.env['TSBS_NATIVE_UNICODE'] === '1';

describe.runIf(NATIVE && SKIP_REASON === null)('TSBS_NATIVE_UNICODE=1 parity (Engine A)', () => {
  it.each(BYTELEVEL_IDS)('%s: native \\p{…} classes reproduce every fixture case', (id) => {
    const tokenizer = tokenizerFor(id, { unicodeMode: 'native' });
    const report = runFixture(fixtureOf(id), tokenizer, { incremental: false });
    const divergent = [...new Set(report.failures.map((f) => f.case))];
    console.info(
      `[native parity] ${id} (node ${process.version}, ICU ${process.versions['icu'] ?? '?'}, Unicode ${process.versions['unicode'] ?? '?'}): ` +
        `${String(divergent.length)} divergent case(s) of ${String(report.cases)}`,
      divergent,
    );
    expect(report.ok, formatReport(report)).toBe(true);
  });

  it('reports the expected divergence outside the corpus: a Unicode 17 ideograph (CJK Extension J)', () => {
    const text = 'x\u{323B0}y';
    const pinned = tokenizerFor('openai-o200k_base').pretokenize(text);
    const native = tokenizerFor('openai-o200k_base', { unicodeMode: 'native' }).pretokenize(text);
    console.info('[native parity] U+323B0 chunks — pinned 16.0:', pinned, 'native:', native);
    const unicode = Number.parseFloat(process.versions['unicode'] ?? '0');
    if (unicode >= 17) expect(native).not.toEqual(pinned);
    else expect(native).toEqual(pinned);
  });

  it('String.prototype.normalize("NFKC") matches the fixture NFKC forms (Python unicodedata 15.1)', () => {
    const fixture = fixtureOf('anthropic-claude-legacy');
    const originals = new Map(fixture.cases.map((c) => [c.name, c.text]));
    const differing = (fixture.normalizedNFKC ?? [])
      .filter((c) => originals.get(c.name)?.normalize('NFKC') !== c.text)
      .map((c) => c.name);
    console.info(`[native parity] NFKC: ${String(differing.length)} of 152 case(s) differ`, differing);
    expect(differing).toEqual([]);
  });
});
