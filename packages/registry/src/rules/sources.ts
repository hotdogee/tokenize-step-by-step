/**
 * Cross-references between `tokenizers.json` and its sources (03 §B.7): the oracle manifest (asset id, file, SHA-256,
 * `shipIntent`) and the golden fixtures (header provenance plus id-space facts the fixtures pin: rank range, BYTE ids,
 * the zero-width dummy prefix).
 */
import type { TokenizerEntry } from '../schema.ts';
import type { FixtureSubset, OracleAsset, OracleManifest } from './inputs.ts';
import { FixtureSubsetSchema } from './inputs.ts';
import type { Report } from './report.ts';
import { at } from './tokenizers.ts';

/** Fixture `family` values per engine family. */
const FIXTURE_FAMILY = { 'bytelevel-bpe': 'tiktoken-bpe', 'spm-bpe': 'sentencepiece-bpe' } as const;

/** Every tokenizer names a `ship` manifest asset, file and hash; every `ship` asset has a tokenizer (withdrawn or not). */
export function checkManifest(tokenizers: readonly TokenizerEntry[], manifest: OracleManifest, report: Report): void {
  const assets = new Map<string, OracleAsset>(manifest.assets.map((a) => [a.id, a]));
  for (const entry of tokenizers) {
    const asset = assets.get(entry.asset.manifestId);
    if (asset === undefined) {
      report('manifest', at(entry), `asset.manifestId ${entry.asset.manifestId} is not in tools/oracle/manifest.json`);
      continue;
    }
    const file = asset.files.find((f) => f.name === entry.asset.sourceFile && f.role === 'vocab');
    if (file === undefined) {
      report('manifest', at(entry), `${entry.asset.sourceFile} is not a vocab file of manifest asset ${asset.id}`);
    } else if (file.sha256 !== entry.asset.sourceSha256) {
      report('manifest', at(entry), `asset.sourceSha256 differs from the manifest (${file.sha256})`);
    }
    if (entry.withdrawn !== true && asset.shipIntent !== 'ship') {
      report('manifest', at(entry), `manifest asset ${asset.id} has shipIntent ${asset.shipIntent}, not ship`);
    }
  }
  for (const asset of manifest.assets) {
    if (asset.shipIntent === 'ship' && !tokenizers.some((t) => t.asset.manifestId === asset.id)) {
      report('manifest', `manifest[${asset.id}]`, 'a shipIntent: ship asset has no tokenizer entry');
    }
  }
}

/** Reports at most `limit` examples of one kind of violation, then a count. */
function limited(report: Report, entry: TokenizerEntry, messages: readonly string[], limit = 3): void {
  for (const message of messages.slice(0, limit)) report('fixture-data', at(entry), message);
  if (messages.length > limit) {
    report('fixture-data', at(entry), `… and ${String(messages.length - limit)} more of the same kind`);
  }
}

/** Facts every case of the entry's fixture must satisfy. */
function checkFixtureData(entry: TokenizerEntry, fixture: FixtureSubset, report: Report): void {
  const { engine, vocabSize, rankCount } = entry;
  const outOfRange: string[] = [];
  const badSpecial: string[] = [];
  const badByte: string[] = [];
  let zeroWidth = 0;
  const [lo, hi] = engine.kind === 'bytelevel-bpe' ? [engine.idOffset, engine.idOffset + rankCount] : [0, vocabSize];
  for (const c of fixture.cases) {
    for (const id of c.ids) {
      if (id < lo || id >= hi)
        outOfRange.push(`case ${c.name}: id ${String(id)} outside [${String(lo)}, ${String(hi)})`);
    }
    for (const id of c.idsWithSpecials ?? []) {
      if (id < 0 || id >= vocabSize) badSpecial.push(`case ${c.name}: idsWithSpecials id ${String(id)} ≥ vocabSize`);
    }
    for (const token of c.tokens) {
      if (token.zeroWidth) zeroWidth++;
      // Byte-level: the 256 single-byte tokens are the first 256 ranks, i.e. ids [idOffset, idOffset + 256).
      if (engine.kind === 'bytelevel-bpe' && token.bytes.length === 2 && token.id - engine.idOffset >= 256) {
        badByte.push(`case ${c.name}: single-byte token ${String(token.id)} lies above idOffset + 256`);
      }
      if (engine.kind === 'spm-bpe' && token.type === 'BYTE') {
        const offset = token.id - engine.byteFirstId;
        if (offset !== Number.parseInt(token.bytes, 16)) {
          badByte.push(
            `case ${c.name}: BYTE piece ${String(token.id)} (0x${token.bytes}) disagrees with byteFirstId ${String(engine.byteFirstId)}`,
          );
        }
      }
    }
  }
  limited(report, entry, outOfRange);
  limited(report, entry, badSpecial);
  limited(report, entry, badByte);
  const dummy = engine.kind === 'spm-bpe' && engine.addDummyPrefix;
  if (dummy && zeroWidth === 0)
    report('fixture-data', at(entry), 'addDummyPrefix is true but no fixture token is zero-width');
  if (!dummy && zeroWidth > 0) {
    report(
      'fixture-data',
      at(entry),
      `${String(zeroWidth)} zero-width fixture tokens, but the entry has no dummy prefix`,
    );
  }
}

/**
 * Parses each entry's fixture (looked up by `TokenizerEntry.fixture`), checks its provenance header and data, and returns
 * the parsed fixtures by tokenizer id for the example-chip rules.
 */
export function checkFixtures(
  tokenizers: readonly TokenizerEntry[],
  fixtures: ReadonlyMap<string, unknown>,
  report: Report,
): Map<string, FixtureSubset> {
  const parsed = new Map<string, FixtureSubset>();
  for (const entry of tokenizers) {
    const raw = fixtures.get(entry.fixture);
    if (raw === undefined) {
      report('fixture', at(entry), `${entry.fixture} was not found`);
      continue;
    }
    const result = FixtureSubsetSchema.safeParse(raw);
    if (!result.success) {
      report(
        'fixture',
        at(entry),
        `${entry.fixture} is not a golden fixture: ${result.error.issues[0]?.message ?? 'invalid'}`,
      );
      continue;
    }
    const fixture = result.data;
    if (fixture.tokenizer !== entry.id) report('fixture', at(entry), `fixture tokenizer is ${fixture.tokenizer}`);
    if (fixture.vocabAsset !== entry.asset.manifestId) {
      report('fixture', at(entry), `fixture vocabAsset ${fixture.vocabAsset} differs from asset.manifestId`);
    }
    if (fixture.vocabSha256 !== entry.asset.sourceSha256) {
      report('fixture', at(entry), 'fixture vocabSha256 differs from asset.sourceSha256');
    }
    if (fixture.family !== FIXTURE_FAMILY[entry.family]) {
      report('fixture', at(entry), `fixture family ${fixture.family} does not match ${entry.family}`);
    }
    checkFixtureData(entry, fixture, report);
    parsed.set(entry.id, fixture);
  }
  return parsed;
}
