/**
 * Inspector catalog, English — the SOURCE OF TRUTH for the inspector's message keys (05 §5, §10). The inspector's section
 * titles, field labels and sentences live in their own catalog set so they load with the inspector after first paint (a
 * lazy chunk) instead of growing the initial `i18n` chunk (06 §3: ≤ 8 KB br, PA-7). zh-TW.ts and ja.ts define exactly
 * the same keys and placeholders (type-checked here and by catalogs.test.ts). Named placeholders only; ids, hex/dec and
 * steps are raw digits (RAW_PLACEHOLDERS of ../../i18n/t.ts).
 */
import type { Message } from '../../i18n/types.ts';

export const inspectorEn = {
  // The keyboard hint under the board (05 §8), shown once this catalog has loaded.
  'board.hint': 'Arrow keys move between cells · Enter pins the inspector · i opens it',
  'inspector.headingChar': 'Inspector — character {index} of {count}',
  'inspector.headingByte': 'Inspector — byte {index} of {count}',
  'inspector.headingChunk': 'Inspector — chunk {index} of {count}',
  'inspector.headingPart': 'Inspector — part {index} of {count}',
  'inspector.section.token': 'Token',
  'inspector.section.char': 'Character',
  'inspector.section.byte': 'Byte',
  'inspector.section.step': 'Step',
  'inspector.section.chunk': 'Chunk',
  'inspector.field.id': 'id',
  'inspector.field.span': 'byte range',
  'inspector.field.length': 'length',
  'inspector.field.hex': 'hex',
  'inspector.field.dec': 'decimal',
  'inspector.field.binary': 'binary',
  'inspector.field.text': 'text',
  'inspector.field.piece': 'piece',
  'inspector.field.kind': 'kind',
  'inspector.field.flags': 'flags',
  'inspector.field.codePoint': 'code point',
  'inspector.field.grapheme': 'grapheme cluster',
  'inspector.field.chunk': 'chunk',
  'inspector.field.tokens': 'tokens',
  'inspector.field.role': 'role',
  'inspector.field.char': 'character',
  'inspector.field.token': 'token',
  'inspector.field.pair': 'pair',
  'inspector.field.result': 'result',
  'inspector.field.priority': 'priority',
  'inspector.field.rule': 'rule',
  'inspector.field.step': 'step',
  'inspector.role.ascii': 'ASCII',
  'inspector.role.lead': 'lead byte of a {n}-byte sequence',
  'inspector.role.continuation': 'continuation byte',
  'inspector.covers': 'covers {list}',
  'inspector.needs': 'needs {n} more ({hex}) to complete {glyph}',
  'inspector.completesWith': 'completes {glyph} together with {ids}',
  'inspector.zeroWidthDummy': 'covers 0 bytes (dummy prefix added by the tokenizer)',
  'inspector.zeroWidthBos': 'covers 0 bytes (beginning-of-sequence token)',
  'inspector.formedAt': 'formed at step {step}: {left} + {right}',
  'inspector.splitAt': 'split into bytes at step {step}',
  'inspector.notFormed': 'not formed by a merge',
  'inspector.noId': 'not a vocabulary entry yet',
  'inspector.unpaired': 'unpaired surrogate, encoded as U+FFFD',
  'inspector.graphemeInfo': 'cluster {index}: {cps}, {bytes}',
  'inspector.showStep': 'Show this step',
  'inspector.selectInText': 'Select in text',
  'inspector.copy': 'Copy {label}',
  'inspector.kind.normal': 'normal',
  'inspector.kind.byte': 'byte fallback',
  'inspector.kind.userDefined': 'user-defined symbol',
  'inspector.kind.control': 'control',
  'inspector.kind.unk': 'unknown',
  'inspector.kind.special': 'special token',
  'inspector.kind.bos': 'beginning of sequence',
  'inspector.kind.dummyPrefix': 'dummy prefix',
  'inspector.flag.partial': 'partial',
  'inspector.flag.zeroWidth': 'zero-width',
  'inspector.flag.special': 'special',
  'inspector.flag.startsMidChar': 'starts mid-character',
  'inspector.flag.endsMidChar': 'ends mid-character',
  'inspector.flag.byteFallback': 'byte fallback',
  'inspector.flag.userDefined': 'user-defined',
  'inspector.flag.directHit': 'direct hit',
  'inspector.field.utf8': 'UTF-8',
  'inspector.field.utf16': 'UTF-16',
} as const satisfies Readonly<Record<string, Message>>;

/** Every inspector message key. */
export type InspectorMessageKey = keyof typeof inspectorEn;

/** A complete inspector catalog. */
export type InspectorCatalog = Readonly<Record<InspectorMessageKey, Message>>;
