/**
 * TODO(WP-integration): delete this file when `engines/bytelevel.ts` and `engines/spm.ts` re-export the real factories
 * from `@tsbs/core/engines/<family>/index` (WP05A / WP05B).
 *
 * A stand-in engine over a decoded TSBV1 container, so the Worker host, loader and client can run end to end (and the
 * real-Worker browser test can load a real `.bin`) before the engines merge. It is NOT a tokenizer: it emits one token
 * per code point whose bytes are a vocabulary entry, else one token per byte, with no merge timeline; it yields every
 * `budgetMs` like the real `encodeIncremental` (04 §1.3).
 */
import type { Tsbv1 } from '@tsbs/core/format/types';
import { buildResult } from '@tsbs/core/model/build-result';
import type { Tokenizer, TokenizerInfo } from '@tsbs/core/model/engine';
import {
  ChunkKind,
  DEFAULT_OPTIONS,
  TokenKind,
  type EncodeOptions,
  type TokenizationResult,
} from '@tsbs/core/model/result';
import { analyzeText } from '@tsbs/core/text/analyze';

/** Reads a numeric field of the structurally typed engine entry. */
function numberAt(entry: unknown, key: string): number | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const engine = (entry as { engine?: unknown }).engine;
  if (typeof engine !== 'object' || engine === null) return null;
  const value = (engine as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

/** Builds the stand-in tokenizer for either family. */
export function createMockTokenizer(tsbv: Tsbv1, entry: unknown): Tokenizer {
  let tables: Tsbv1 | null = tsbv;
  const { meta } = tsbv;
  const idOffset = tsbv.family === 'bytelevel-bpe' ? (numberAt(entry, 'idOffset') ?? meta.idOffset ?? 0) : 0;
  const bosId = numberAt(entry, 'bosId') ?? meta.bosId ?? null;
  const vocab = (): Tsbv1['vocab'] => {
    if (tables === null) throw new Error('the tokenizer was disposed');
    return tables.vocab;
  };
  const info: TokenizerInfo = {
    id: meta.tokenizerId,
    family: tsbv.family,
    vocabSize: tsbv.vocab.count + tsbv.specials.length,
    rankCount: tsbv.vocab.count,
    specials: tsbv.specials.map((s) => ({ id: s.id, text: s.text })),
    bosId,
    unicodeVersion: '16.0.0',
    sourceSha256: meta.upstream.sha256,
    supports: { nfkc: meta.tokenizerId === 'anthropic-claude-legacy', bos: bosId !== null, specialsToggle: true },
  };

  function* run(
    text: string,
    options: Partial<EncodeOptions>,
    budgetMs: number,
  ): Generator<{ bytesDone: number; bytesTotal: number }, TokenizationResult> {
    const t0 = performance.now();
    const analysis = analyzeText(text);
    const { utf8, chars } = analysis;
    const ids: number[] = [];
    const starts: number[] = [0];
    const kinds: number[] = [];
    let sliceStart = performance.now();
    for (let c = 0; c < chars.count; c++) {
      const start = chars.byteStart[c] ?? 0;
      const end = chars.byteStart[c + 1] ?? start;
      const whole = vocab().indexOf(utf8, start, end);
      if (whole >= 0) {
        ids.push(whole + idOffset);
        starts.push(end);
        kinds.push(TokenKind.Normal);
      } else {
        for (let b = start; b < end; b++) {
          ids.push(Math.max(vocab().indexOf(utf8, b, b + 1), 0) + idOffset);
          starts.push(b + 1);
          kinds.push(TokenKind.Byte);
        }
      }
      if ((c & 255) === 255 && performance.now() - sliceStart >= budgetMs) {
        yield { bytesDone: end, bytesTotal: utf8.length };
        sliceStart = performance.now();
      }
    }
    const n = utf8.length;
    return buildResult({
      tokenizer: info.id,
      family: info.family,
      options: {
        ...DEFAULT_OPTIONS,
        ...options,
        trace: false,
        specialTokens: 'as-text',
        addBos: false,
        normalize: 'none',
      },
      analysis,
      chunks: {
        byteStart: n > 0 ? [0, n] : [0],
        kind: n > 0 ? [info.family === 'spm-bpe' ? ChunkKind.SpmText : ChunkKind.Regex] : [],
      },
      tokens: { id: ids, byteStart: starts, kind: kinds },
      timeline: null,
      timings: { analyzeMs: 0, encodeMs: performance.now() - t0 },
    });
  }

  return {
    info,
    encode(text, options = {}) {
      const steps = run(text, options, Number.POSITIVE_INFINITY);
      for (;;) {
        const step = steps.next();
        if (step.done === true) return step.value;
      }
    },
    encodeIncremental(text, options = {}, budgetMs = 4) {
      return run(text, options, budgetMs);
    },
    tokenBytes(id) {
      const index = id - idOffset;
      return index >= 0 && index < vocab().count ? vocab().bytesOf(index) : null;
    },
    pieceString(id) {
      if (info.family !== 'spm-bpe' || id < 0 || id >= vocab().count) return null;
      return vocab().pieceOf(id);
    },
    idOf(bytes) {
      const index = vocab().indexOf(bytes, 0, bytes.length);
      return index < 0 ? null : index + idOffset;
    },
    pretokenize(text) {
      const n = analyzeText(text, { segmenter: null }).utf8.length;
      return n > 0 ? [[0, n]] : [];
    },
    dispose() {
      tables = null;
    },
  };
}
