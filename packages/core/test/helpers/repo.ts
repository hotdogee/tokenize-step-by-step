/**
 * Test helpers shared by the core suites: repository paths, golden fixtures, UTF-16 → UTF-8 offset mapping, and the
 * location of the raw upstream vocabularies (gitignored, so often absent: suites that need them skip).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Repository root (this checkout, which may be a git worktree). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Parses `fixtures/<name>.json`. */
export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', `${name}.json`), 'utf8'));
}

/** UTF-8 byte offset of every UTF-16 index of `text` (length + 1; a lone surrogate counts 3 bytes, as `TextEncoder`). */
export function utf16ToUtf8Offsets(text: string): Uint32Array {
  const out = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) ?? 0;
    const units = cp > 0xffff ? 2 : 1;
    out[i] = bytes;
    if (units === 2) out[i + 1] = bytes;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += units;
  }
  out[text.length] = bytes;
  return out;
}

/** All matches of a `g` regex over `text` as UTF-8 byte spans `[start, end]` (the fixture `chunks` form). */
export function chunkByteSpans(regex: RegExp, text: string): Array<[number, number]> {
  const offsets = utf16ToUtf8Offsets(text);
  regex.lastIndex = 0;
  return [...text.matchAll(regex)].map((m) => [offsets[m.index]!, offsets[m.index + m[0].length]!]);
}

/** The main checkout of a git worktree (`<main>/.git/worktrees/<name>` → `<main>`), or null. */
function mainCheckoutOfWorktree(root: string): string | null {
  const dotGit = join(root, '.git');
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return null;
  const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
  if (gitdir === undefined) return null;
  const worktreeGitDir = resolve(root, gitdir);
  const commondirFile = join(worktreeGitDir, 'commondir');
  const commonDir = existsSync(commondirFile)
    ? resolve(worktreeGitDir, readFileSync(commondirFile, 'utf8').trim())
    : resolve(worktreeGitDir, '..', '..');
  return dirname(commonDir);
}

/**
 * `data/vocab/raw` with the upstream files (`pnpm vocab:fetch`): `$TSBS_VOCAB_RAW` when set (authoritative, so
 * `TSBS_VOCAB_RAW=none` forces the raw-vocabulary suites to skip), else this checkout's, else the main checkout's when
 * this is a git worktree (read-only use). `null` when none exists.
 */
export function findRawVocabDir(): string | null {
  const override = process.env['TSBS_VOCAB_RAW'];
  if (override !== undefined && override !== '') return existsSync(override) ? override : null;
  const main = mainCheckoutOfWorktree(REPO_ROOT);
  const candidates = [
    join(REPO_ROOT, 'data', 'vocab', 'raw'),
    main === null ? null : join(main, 'data', 'vocab', 'raw'),
  ];
  return candidates.find((dir): dir is string => dir !== null && existsSync(dir)) ?? null;
}
