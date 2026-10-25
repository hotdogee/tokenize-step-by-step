/**
 * Rules on `tokenizers.json` alone (03 §B.7, AD-14, AD-38): the nine TokenizerIds exactly once, exactly one default,
 * identity fields that agree with each other, id-space arithmetic, toggles/defaults the engine can honour, and the BYOK
 * panel of each entry.
 */
import { TokenizerIdSchema } from '../schema.ts';
import type { TokenizerEntry } from '../schema.ts';
import type { Report } from './report.ts';

/** `where` label of a tokenizer entry. */
export const at = (entry: TokenizerEntry): string => `tokenizers[${entry.id}]`;

/** The BOS id an entry declares, or null (byte-level entries without BOS: OpenAI, Grok-2, Claude). */
export function bosIdOf(entry: TokenizerEntry): number | null {
  return entry.engine.bosId;
}

/** Live-check panel → the only lab whose models it can count (OD-5). */
export const BYOK_LAB = { 'anthropic-count': 'anthropic', 'xai-tokenize': 'xai' } as const;

/** Every TokenizerId exactly once, and exactly one non-withdrawn primary `default: true`. */
export function checkTokenizerSet(tokenizers: readonly TokenizerEntry[], report: Report): void {
  for (const id of TokenizerIdSchema.options) {
    const n = tokenizers.filter((t) => t.id === id).length;
    if (n !== 1) report('tokenizer-set', 'tokenizers', `${id} must appear exactly once (found ${String(n)})`);
  }
  const defaults = tokenizers.filter((t) => t.default === true);
  if (defaults.length !== 1) {
    report(
      'tokenizer-default',
      'tokenizers',
      `exactly one entry must be default: true (found ${String(defaults.length)})`,
    );
  }
  for (const entry of defaults) {
    if (entry.withdrawn === true) report('tokenizer-default', at(entry), 'the default tokenizer cannot be withdrawn');
    if (entry.tier !== 'primary')
      report('tokenizer-default', at(entry), 'the default tokenizer must be a primary tier');
  }
}

/** Identity fields agree: family ↔ engine kind, id ↔ lab prefix, fixture ↔ id. */
function checkIdentity(entry: TokenizerEntry, report: Report): void {
  if (entry.family !== entry.engine.kind) {
    report('tokenizer-identity', at(entry), `family ${entry.family} differs from engine.kind ${entry.engine.kind}`);
  }
  if (!entry.id.startsWith(`${entry.lab}-`)) {
    report('tokenizer-identity', at(entry), `lab ${entry.lab} does not match the id prefix`);
  }
  if (entry.fixture !== `fixtures/${entry.id}.json`) {
    report('tokenizer-identity', at(entry), `fixture must be fixtures/${entry.id}.json (got ${entry.fixture})`);
  }
}

/**
 * Id-space arithmetic. Byte-level: rank r has id r + idOffset, so `idOffset + rankCount ≤ vocabSize` and the BOS id is a
 * special id outside the rank range. SentencePiece: every piece has an id (`rankCount === vocabSize`), the 256 BYTE
 * pieces fit, and unk/bos/eos/pad are distinct ids inside the vocabulary.
 */
function checkSizes(entry: TokenizerEntry, report: Report): void {
  const { engine, vocabSize, rankCount } = entry;
  if (engine.kind === 'bytelevel-bpe') {
    if (engine.idOffset + rankCount > vocabSize) {
      report(
        'tokenizer-sizes',
        at(entry),
        `idOffset + rankCount (${String(engine.idOffset + rankCount)}) exceeds vocabSize ${String(vocabSize)}`,
      );
    }
    if (engine.bosId !== null) {
      if (engine.bosId >= vocabSize) report('tokenizer-sizes', at(entry), `bosId ${String(engine.bosId)} ≥ vocabSize`);
      if (engine.bosId >= engine.idOffset && engine.bosId < engine.idOffset + rankCount) {
        report('tokenizer-sizes', at(entry), `bosId ${String(engine.bosId)} lies inside the rank range`);
      }
    }
    return;
  }
  if (rankCount !== vocabSize) {
    report(
      'tokenizer-sizes',
      at(entry),
      `spm: rankCount (${String(rankCount)}) must equal vocabSize (${String(vocabSize)})`,
    );
  }
  if (engine.byteFirstId + 256 > vocabSize) report('tokenizer-sizes', at(entry), 'byteFirstId + 256 exceeds vocabSize');
  const ids = [engine.unkId, engine.bosId, engine.eosId, engine.padId];
  if (ids.some((id) => id < 0 || id >= vocabSize))
    report('tokenizer-sizes', at(entry), 'unk/bos/eos/pad ids must lie in [0, vocabSize)');
  if (new Set(ids).size !== ids.length) report('tokenizer-sizes', at(entry), 'unk/bos/eos/pad ids must be distinct');
}

/** Toggles and defaults the engine can honour (03 §B.1: BOS only with a BOS id, NFKC only for the legacy Claude pattern). */
function checkToggles(entry: TokenizerEntry, report: Report): void {
  const { toggles, defaults, engine } = entry;
  const nfkcCapable = engine.kind === 'bytelevel-bpe' && engine.pattern === 'claude-legacy';
  if (new Set(toggles).size !== toggles.length) report('tokenizer-toggles', at(entry), 'toggles must be unique');
  if (toggles.includes('addBos') && bosIdOf(entry) === null) {
    report('tokenizer-toggles', at(entry), 'the addBos toggle needs a BOS id');
  }
  if (toggles.includes('normalize') && !nfkcCapable) {
    report('tokenizer-toggles', at(entry), 'only the claude-legacy pattern supports the NFKC toggle');
  }
  if (defaults.addBos === true && bosIdOf(entry) === null) {
    report('tokenizer-toggles', at(entry), 'defaults.addBos is true but the entry has no BOS id');
  }
  if (defaults.normalize === 'NFKC' && !nfkcCapable) {
    report('tokenizer-toggles', at(entry), "defaults.normalize 'NFKC' is only valid for the claude-legacy pattern");
  }
  if (defaults.trace !== undefined) {
    report('tokenizer-toggles', at(entry), 'defaults.trace is a UI policy (AD-27), not a per-tokenizer default');
  }
}

/** A tokenizer-level live-check panel belongs to the tokenizer's own lab. */
function checkByokPanel(entry: TokenizerEntry, report: Report): void {
  if (entry.byok !== undefined && BYOK_LAB[entry.byok] !== entry.lab) {
    report('byok-panel', at(entry), `byok ${entry.byok} cannot belong to a ${entry.lab} tokenizer`);
  }
}

/** Per-entry rules. */
export function checkTokenizerEntries(tokenizers: readonly TokenizerEntry[], report: Report): void {
  for (const entry of tokenizers) {
    checkIdentity(entry, report);
    checkSizes(entry, report);
    checkToggles(entry, report);
    checkByokPanel(entry, report);
  }
}
