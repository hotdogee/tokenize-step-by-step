/**
 * The 03 §B.3 invariants of a `TokenizationResult`, asserted by the conformance suite, the property tests and (in debug
 * builds) the engines: `concat(tokenBytes) === utf8`; spans contiguous and non-overlapping; chunks tile `utf8`; `Partial`
 * iff the bytes are not complete UTF-8 (⇔ `StartsMidChar || EndsMidChar` inside valid text); `replay(timeline,
 * stepCount)` boundaries equal the token boundaries inside every byte-level / spm-text chunk; `chars.byteStart` strictly
 * increasing; the byte maps, char columns, chunk columns and stats consistent with the tables.
 *
 * `checkInvariants` returns human-readable violations (empty when the result is sound); `assertInvariants` throws them.
 */
import { encodeUtf8, isValidUtf8, utf8Length } from '../text/utf8.ts';
import { replay } from '../timeline/replay.ts';
import { ALIVE, ChunkKind, NEVER, StepKind, TokenFlag, TokenKind, type TokenizationResult } from './result.ts';

/** Thrown by `assertInvariants`. */
export class InvariantError extends Error {
  readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super(`${String(violations.length)} invariant violation(s): ${violations.slice(0, 5).join('; ')}`);
    this.name = 'InvariantError';
    this.violations = violations;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function checkChars(r: TokenizationResult, out: string[]): void {
  const { chars, utf8, text } = r;
  const n = utf8.length;
  if (chars.byteStart[0] !== 0 || chars.byteStart[chars.count] !== n) out.push('chars.byteStart does not span utf8');
  if (chars.utf16Start[chars.count] !== text.length) out.push('chars.utf16Start sentinel is not text.length');
  for (let i = 0; i < chars.count; i++) {
    const s = chars.byteStart[i] ?? 0;
    const e = chars.byteStart[i + 1] ?? 0;
    const len = e - s;
    if (len < 1 || len > 4) out.push(`char ${String(i)} has ${String(len)} bytes`);
    if (len !== utf8Length(chars.cp[i] ?? 0)) out.push(`char ${String(i)} byte length disagrees with its code point`);
    for (let b = s; b < e; b++) if (r.byteToChar[b] !== i) out.push(`byteToChar[${String(b)}] is not ${String(i)}`);
    if (chars.chunk[i] !== r.byteToChunk[s]) out.push(`chars.chunk[${String(i)}] disagrees with byteToChunk`);
    if (chars.tokenFirst[i] !== r.byteToToken[s] || chars.tokenLast[i] !== r.byteToToken[e - 1]) {
      out.push(`chars.tokenFirst/tokenLast[${String(i)}] disagree with byteToToken`);
    }
  }
  if (chars.sourceRunStart !== null && chars.sourceRunStart.length !== chars.count) {
    out.push('chars.sourceRunStart length is not chars.count');
  }
  const g = r.graphemes;
  if (g.charStart[0] !== 0 || g.charStart[g.count] !== chars.count) {
    out.push('graphemes.charStart does not span the chars');
  }
  if (g.source === 'fallback' && g.count !== chars.count) out.push('fallback graphemes must be one per code point');
  for (let k = 0; k < g.count; k++) {
    const first = g.charStart[k] ?? 0;
    if (!((g.charStart[k + 1] ?? 0) > first)) out.push(`grapheme ${String(k)} is empty`);
    if (g.byteStart[k] !== chars.byteStart[first]) out.push(`graphemes.byteStart[${String(k)}] is off`);
    if (chars.grapheme[first] !== k) out.push(`chars.grapheme[${String(first)}] is not ${String(k)}`);
  }
}

function checkTokens(r: TokenizationResult, out: string[]): void {
  const { tokens, utf8, chars } = r;
  const n = utf8.length;
  if (tokens.byteStart[0] !== 0 || tokens.byteStart[tokens.count] !== n) out.push('tokens do not span utf8');
  const isCharStart = (b: number): boolean => b === n || chars.byteStart[r.byteToChar[b] ?? 0] === b;
  for (let t = 0; t < tokens.count; t++) {
    const s = tokens.byteStart[t] ?? 0;
    const e = tokens.byteStart[t + 1] ?? 0;
    const f = tokens.flags[t] ?? 0;
    const name = `token ${String(t)}`;
    if (e < s) out.push(`${name} has a reversed span`);
    const zeroWidth = s === e;
    if (zeroWidth !== ((f & TokenFlag.ZeroWidth) !== 0)) out.push(`${name}: ZeroWidth flag disagrees with its span`);
    const invalid = !zeroWidth && !isValidUtf8(utf8, s, e);
    if (invalid !== ((f & TokenFlag.Partial) !== 0)) out.push(`${name}: Partial flag disagrees with UTF-8 validity`);
    const mid = !zeroWidth && (!isCharStart(s) || !isCharStart(e));
    if (mid !== ((f & (TokenFlag.StartsMidChar | TokenFlag.EndsMidChar)) !== 0)) {
      out.push(`${name}: StartsMidChar/EndsMidChar disagree with char boundaries`);
    }
    if (invalid !== mid) out.push(`${name}: Partial is not StartsMidChar || EndsMidChar`);
    const kind = tokens.kind[t] ?? 0;
    if (kind === TokenKind.Bos && (!zeroWidth || (f & TokenFlag.Special) === 0))
      out.push(`${name}: BOS must be zero-width Special`);
    if (zeroWidth) {
      if (tokens.chunk[t] !== -1) out.push(`${name}: zero-width token must have chunk -1`);
      if (tokens.charLast[t] !== (tokens.charFirst[t] ?? 0) - 1)
        out.push(`${name}: zero-width char range must be empty`);
    } else {
      if (tokens.chunk[t] !== r.byteToChunk[s] || r.byteToChunk[e - 1] !== r.byteToChunk[s]) {
        out.push(`${name}: chunk disagrees with its bytes`);
      }
      if (tokens.charFirst[t] !== r.byteToChar[s] || tokens.charLast[t] !== r.byteToChar[e - 1]) {
        out.push(`${name}: charFirst/charLast disagree with its bytes`);
      }
      for (let b = s; b < e; b++) if (r.byteToToken[b] !== t) out.push(`byteToToken[${String(b)}] is not ${String(t)}`);
    }
    const formed = tokens.stepFormed[t] ?? -1;
    if (formed < -1 || formed > (r.timeline?.stepCount ?? 0)) out.push(`${name}: stepFormed out of range`);
  }
}

function checkChunks(r: TokenizationResult, out: string[]): void {
  const { chunks, utf8, tokens } = r;
  const n = utf8.length;
  if (chunks.byteStart[0] !== 0 || chunks.byteStart[chunks.count] !== n) out.push('chunks do not tile utf8');
  if (chunks.tokenStart[chunks.count] !== tokens.count) out.push('chunks.tokenStart sentinel is not tokens.count');
  for (let c = 0; c < chunks.count; c++) {
    const s = chunks.byteStart[c] ?? 0;
    const e = chunks.byteStart[c + 1] ?? 0;
    if (!(e > s)) out.push(`chunk ${String(c)} is empty`);
    for (let b = s; b < e; b++) if (r.byteToChunk[b] !== c) out.push(`byteToChunk[${String(b)}] is not ${String(c)}`);
    if (chunks.charStart[c] !== r.byteToChar[s]) out.push(`chunks.charStart[${String(c)}] is off`);
    const first = chunks.tokenStart[c] ?? 0;
    if (tokens.byteStart[first] !== s || tokens.chunk[first] !== c) out.push(`chunks.tokenStart[${String(c)}] is off`);
    if (chunks.kind[c] === ChunkKind.SpecialString) {
      const t = r.byteToToken[s] ?? -1;
      if (tokens.byteStart[t] !== s || tokens.byteStart[t + 1] !== e)
        out.push(`special chunk ${String(c)} is not one token`);
    }
  }
}

function checkTimeline(r: TokenizationResult, out: string[]): void {
  const { timeline, utf8, chunks, tokens } = r;
  if (timeline === null) return;
  const n = utf8.length;
  const steps = timeline.stepCount;
  if (timeline.boundaryBorn.length !== n + 1 || timeline.boundaryDied.length !== n + 1) {
    out.push('timeline born/died must have byteCount+1 entries');
    return;
  }
  for (const [name, arr] of [
    ['stepKind', timeline.stepKind],
    ['stepLeft', timeline.stepLeft],
    ['stepMid', timeline.stepMid],
    ['stepEnd', timeline.stepEnd],
    ['stepRank', timeline.stepRank],
    ['stepResultId', timeline.stepResultId],
    ['stepChunk', timeline.stepChunk],
  ] as const) {
    if (arr.length !== steps) out.push(`timeline.${name} has ${String(arr.length)} entries, not ${String(steps)}`);
  }
  for (let i = 0; i < steps; i++) {
    const l = timeline.stepLeft[i] ?? 0;
    const m = timeline.stepMid[i] ?? 0;
    const e = timeline.stepEnd[i] ?? 0;
    const split = timeline.stepKind[i] === StepKind.ByteFallbackSplit;
    if (!(l <= m && m <= e && e <= n) || (split && m !== l)) out.push(`step ${String(i + 1)} has bad offsets`);
  }
  for (let b = 0; b <= n; b++) {
    const born = timeline.boundaryBorn[b] ?? 0;
    const died = timeline.boundaryDied[b] ?? 0;
    if (born !== NEVER && (born < 0 || born > steps)) out.push(`boundary ${String(b)} born out of range`);
    if (died !== ALIVE && (died < 0 || died > steps)) out.push(`boundary ${String(b)} died out of range`);
  }
  // replay(stepCount) == token boundaries inside every non-special chunk.
  const live = new Uint8Array(n + 1);
  for (const b of replay(timeline, steps)) live[b] = 1;
  const tokenEdge = new Uint8Array(n + 1);
  for (let t = 0; t <= tokens.count; t++) tokenEdge[tokens.byteStart[t] ?? 0] = 1;
  for (let c = 0; c < chunks.count; c++) {
    if (chunks.kind[c] === ChunkKind.SpecialString) continue;
    for (let b = (chunks.byteStart[c] ?? 0) + 1; b < (chunks.byteStart[c + 1] ?? 0); b++) {
      if (live[b] !== tokenEdge[b]) out.push(`replay(stepCount) boundary ${String(b)} disagrees with the tokens`);
    }
  }
}

function checkStats(r: TokenizationResult, out: string[]): void {
  const { stats, tokens, chars } = r;
  let partial = 0;
  let zero = 0;
  let special = 0;
  for (let t = 0; t < tokens.count; t++) {
    const f = tokens.flags[t] ?? 0;
    if (f & TokenFlag.Partial) partial++;
    if (f & TokenFlag.ZeroWidth) zero++;
    if (f & TokenFlag.Special) special++;
  }
  let split = 0;
  for (let i = 0; i < chars.count; i++) if ((chars.tokenLast[i] ?? 0) > (chars.tokenFirst[i] ?? 0)) split++;
  const expected = {
    codePoints: chars.count,
    utf16Units: r.text.length,
    bytes: r.utf8.length,
    graphemes: r.graphemes.count,
    chunks: r.chunks.count,
    tokens: tokens.count,
    partialTokens: partial,
    splitChars: split,
    zeroWidthTokens: zero,
    specialTokens: special,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (stats[key as keyof typeof expected] !== value) out.push(`stats.${key} is not ${String(value)}`);
  }
}

/** All invariant violations of `r` (empty when sound). */
export function checkInvariants(r: TokenizationResult): string[] {
  const out: string[] = [];
  if (!sameBytes(r.utf8, encodeUtf8(r.text))) out.push('utf8 is not the UTF-8 of text');
  if (
    r.byteToChar.length !== r.utf8.length ||
    r.byteToToken.length !== r.utf8.length ||
    r.byteToChunk.length !== r.utf8.length
  ) {
    out.push('byte maps must have utf8.length entries');
    return out;
  }
  if (r.normalization === null && r.input.text !== r.text)
    out.push('text differs from input.text without normalization');
  checkChars(r, out);
  checkTokens(r, out);
  checkChunks(r, out);
  checkTimeline(r, out);
  checkStats(r, out);
  return out;
}

/** Throws an `InvariantError` listing every violation of `r`. */
export function assertInvariants(r: TokenizationResult): void {
  const violations = checkInvariants(r);
  if (violations.length > 0) throw new InvariantError(violations);
}
