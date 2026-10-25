/**
 * Console output of `pnpm test:fuzz`: the minimal-repro printer (`printable` makes invisible and confusable characters
 * visible as `\u{…}` escapes, so a repro can be pasted into a test or the corpus) and the summary table.
 */
import { DIVERGENCE_CLASSES } from './classify.ts';
import type { TokenizerReport } from './run.ts';

/** Category escapes: controls, format characters, line/paragraph separators, private use. */
const INVISIBLE_CATEGORY = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}]$/u;
/** Spaces other than U+0020, the variation selectors and the SentencePiece mark, as inclusive code point ranges. */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x2581, 0x2581],
  [0x3000, 0x3000],
  [0xfe00, 0xfe0f],
];

function invisible(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return INVISIBLE_CATEGORY.test(ch) || INVISIBLE_RANGES.some(([first, last]) => cp >= first && cp <= last);
}

/** `text` as a double-quoted literal with invisible characters escaped (`\n`, `\t`, `\u{85}`, `\u{feff}`, …). */
export function printable(text: string): string {
  let out = '"';
  for (const ch of text) {
    if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (invisible(ch)) out += `\\u{${(ch.codePointAt(0) ?? 0).toString(16)}}`;
    else out += ch;
  }
  return `${out}"`;
}

const pad = (text: string, width: number): string => text.padEnd(width);
const num = (value: number, width: number): string => String(value).padStart(width);

/** The run summary: one line per tokenizer and the totals (what WP12's acceptance pastes). */
export function summaryTable(reports: readonly TokenizerReport[], seed: number, n: number, seconds: number): string {
  const lines = [
    `test:fuzz summary — seed ${String(seed)}, ${String(n)} strings × ${String(reports.length)} tokenizer(s), ${seconds.toFixed(1)} s`,
    `${pad('tokenizer', 25)} ${'strings'.padStart(7)} ${'ids≠'.padStart(5)} ${'spans≠'.padStart(6)} ${'errors'.padStart(6)}  second opinions (compared / divergences by class)`,
  ];
  for (const r of reports) {
    const opinions =
      r.opinions.length === 0
        ? '—'
        : r.opinions
            .map((o) => {
              const classes = DIVERGENCE_CLASSES.flatMap((c) => {
                const count = o.divergences[c] ?? 0;
                return count > 0 ? [`${c} ${String(count)}`] : [];
              });
              return `${o.library}: ${String(o.compared)} / ${classes.length === 0 ? '0' : classes.join(', ')}`;
            })
            .join('; ');
    lines.push(
      `${pad(r.tokenizer, 25)} ${num(r.strings, 7)} ${num(r.idMismatches, 5)} ${num(r.spanMismatches, 6)} ${num(r.engineErrors + r.oracleErrors, 6)}  ${opinions}`,
    );
  }
  const strings = reports.reduce((sum, r) => sum + r.strings, 0);
  const mismatches = reports.reduce((sum, r) => sum + r.idMismatches + r.spanMismatches + r.engineErrors, 0);
  const oracleErrors = reports.reduce((sum, r) => sum + r.oracleErrors, 0);
  const divergences = reports
    .flatMap((r) => r.opinions)
    .reduce((sum, o) => sum + Object.values(o.divergences).reduce((s, c) => s + c, 0), 0);
  const unclassified = reports
    .flatMap((r) => r.opinions)
    .reduce((sum, o) => sum + (o.divergences.unclassified ?? 0), 0);
  lines.push(
    `total: ${String(strings)} strings, ids + spans vs the Python oracle: ${String(mismatches)} mismatch(es), ` +
      `${String(oracleErrors)} oracle error(s); ${String(divergences)} oracle divergence(s), ${String(unclassified)} unclassified`,
  );
  return lines.join('\n');
}
