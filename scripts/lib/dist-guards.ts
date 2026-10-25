/**
 * Dist guards (03 §C.8, the "Dist" row of 06 §3, 02 §6 `check:dist`). One implementation for two entry points:
 *
 * - `site` (`pnpm check:dist`): the deployable `apps/web/dist`. `check:dist` also runs `tsbs-vocab guard --dist
 *   apps/web/dist` (WP03's 03 §C.8 CLI, which PD-8 names) on the same directory, so each rule has one owner and a
 *   violation is reported once (`scripts/test/dist-guards.test.ts` runs both guards together to prove it):
 *   - `tsbs-vocab guard`: per-file size (20 MiB hard, 8 MiB warn), file count ≤ 2,000 (every file on disk, stricter
 *     than the uploaded count), dotfiles, `/tok` total, the per-asset ceiling, `/tok` ↔ manifest listing both ways,
 *     `_headers` present and ≤ 100 rules, `index.html` present and ≤ 14 KB brotli, `examples/*.json` ≤ 16 KB gzip;
 *   - this script: `.assetsignore` lists the 06 §5 lines (the guard only checks `*.map`, and only when maps exist — the
 *     one failure both report), each listed `.bin` has the manifest's size, sha256 and path form, `_headers` parses and
 *     no line exceeds 2,000 characters, `about/` and `404.html` exist, every page starts `<head>` with the classic boot
 *     script and inlines nothing, and no chunk imports a Worker entry chunk (WebKit would evaluate it twice);
 * - `vocab` (`pnpm vocab:guard`, the CI `vocab` job): the converter output `data/vocab/dist`, where no other guard runs:
 *   sizes, dotfiles, the `/tok` total, the per-asset ceiling and the full manifest cross-check.
 *
 * Everything reads the directory synchronously and returns a report; printing and the exit code belong to the CLI.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { VocabAssetEntry } from '@tsbs/core';
import { MAX_HEADER_LINE_CHARS, parseHeadersFile } from './headers-file.ts';

const KiB = 1024;
const MiB = 1024 * KiB;

/** The limits `vocab` mode enforces (KB = 1024 B, as in the design); `tsbs-vocab guard` uses the same values. */
export const DIST_LIMITS = {
  /** Hard per-file limit (platform: 25 MiB = 26,214,400 B). */
  fileHardBytes: 20 * MiB,
  fileWarnBytes: 8 * MiB,
  /** `/tok` total (warning only). */
  tokWarnBytes: 12 * MiB,
  /** Per vocabulary asset, on the wire (the `.bin` is already gzip), unless whitelisted. */
  assetGzipBytes: Math.round(1.7 * MiB),
} as const;

/** Tokenizer ids allowed above `assetGzipBytes`. Empty: the largest asset (Gemma 4, ≈ 1,620 KB, 03 §C.3) fits. */
export const ASSET_SIZE_WHITELIST: ReadonlySet<string> = new Set();

/** Lines `.assetsignore` must contain (06 §5). */
export const REQUIRED_ASSETSIGNORE = ['*.map', '.vite/', '.DS_Store', 'Thumbs.db'] as const;

/** HTML entries `site` mode requires (`not_found_handling: 404-page` serves `/404.html`); `tsbs-vocab guard` requires `index.html`. */
export const REQUIRED_PAGES = ['about/index.html', '404.html'] as const;

/** Name of the converter's manifest inside its output directory (AD-11). */
export const VOCAB_MANIFEST_FILE = 'vocab-manifest.generated.json';

/** The manifest fields the cross-check reads (FROZEN in `@tsbs/core` format/types.ts). */
type ManifestAsset = Pick<VocabAssetEntry, 'path' | 'bytesCompressed' | 'sha256'>;

/** Outcome of one guard run. */
export interface GuardReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Files that would be uploaded (site) or files under `tok/` (vocab). */
  readonly fileCount: number;
  readonly tokBytes: number;
}

/** What to check. Paths are absolute or relative to the working directory. */
export type GuardOptions =
  | { readonly mode: 'site'; readonly dist: string; readonly manifest: string }
  | { readonly mode: 'vocab'; readonly dist: string };

/** All files under `dir` (dotfiles included), as POSIX paths relative to `dir`, sorted. */
export function listFiles(dir: string): string[] {
  const walk = (current: string): string[] =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = join(current, entry.name);
      return entry.isDirectory() ? walk(full) : [relative(dir, full).split(sep).join(posix.sep)];
    });
  return walk(dir).sort();
}

/**
 * True when `.assetsignore` (gitignore-like; only the forms 06 §5 uses) excludes `file`: `*.ext` matches a suffix
 * anywhere, `name/` a directory segment, a plain name a path segment. `.assetsignore` itself is never uploaded.
 */
export function isAssetIgnored(file: string, patterns: readonly string[]): boolean {
  if (file === '.assetsignore') return true;
  const segments = file.split('/');
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) return file.endsWith(pattern.slice(1));
    if (pattern.endsWith('/')) return segments.slice(0, -1).includes(pattern.slice(0, -1));
    return segments.includes(pattern);
  });
}

/** Non-empty, non-comment lines of an `.assetsignore` text. */
export function parseAssetsIgnore(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Files with a path segment starting with `.`, except the root `.assetsignore` (dotfiles are served, research §6.4). */
export function dotfiles(files: readonly string[]): string[] {
  return files.filter((file) => file !== '.assetsignore' && file.split('/').some((part) => part.startsWith('.')));
}

/** Size limits: hard error at `fileHardBytes`, warning above `fileWarnBytes`. */
export function checkFileSizes(
  sizes: ReadonlyMap<string, number>,
  errors: string[],
  warnings: string[],
  limits: Pick<typeof DIST_LIMITS, 'fileHardBytes' | 'fileWarnBytes'> = DIST_LIMITS,
): void {
  for (const [file, size] of sizes) {
    if (size >= limits.fileHardBytes)
      errors.push(`${file} is ${mib(size)} MiB (hard limit ${mib(limits.fileHardBytes)} MiB; platform 25 MiB)`);
    else if (size > limits.fileWarnBytes) warnings.push(`${file} is ${mib(size)} MiB (warn above 8 MiB)`);
  }
}

/** `_headers` text → errors: unparsable, or a header line over 2,000 characters (the rule count is the guard's). */
export function checkHeadersText(text: string, errors: string[]): void {
  let blocks;
  try {
    blocks = parseHeadersFile(text);
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
    return;
  }
  for (const block of blocks)
    for (const entry of block.entries) {
      const length = entry.name.length + 2 + entry.value.length;
      if (length > MAX_HEADER_LINE_CHARS)
        errors.push(
          `_headers line ${String(entry.line)} is ${String(length)} characters (limit ${String(MAX_HEADER_LINE_CHARS)})`,
        );
    }
}

function isManifestAsset(value: unknown): value is ManifestAsset {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['path'] === 'string' &&
    typeof entry['bytesCompressed'] === 'number' &&
    typeof entry['sha256'] === 'string' &&
    /^[0-9a-f]{64}$/.test(entry['sha256'])
  );
}

/** Parses a vocab manifest's `assets`; pushes an error and returns null when the shape is wrong. */
export function parseManifestAssets(text: string, errors: string[]): Map<string, ManifestAsset> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    errors.push('the vocab manifest is not valid JSON');
    return null;
  }
  const assets =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['assets'] : undefined;
  if (typeof assets !== 'object' || assets === null) {
    errors.push('the vocab manifest has no "assets" object');
    return null;
  }
  const result = new Map<string, ManifestAsset>();
  for (const [id, entry] of Object.entries(assets)) {
    if (isManifestAsset(entry)) result.set(id, entry);
    else errors.push(`vocab manifest entry "${id}" lacks path / bytesCompressed / sha256`);
  }
  return result;
}

/**
 * `/tok` ↔ manifest (03 §C.8): every listed path has the form `/tok/<id>/<sha256[0:12]>.bin` and its file the recorded
 * size and sha256. With `listing` (vocab mode) also: every listed path exists, every `tok/` file is listed, and each
 * asset is ≤ `assetGzipBytes` unless whitelisted — in site mode those three are `tsbs-vocab guard`'s.
 */
export function checkTokAgainstManifest(
  root: string,
  files: readonly string[],
  assets: ReadonlyMap<string, ManifestAsset>,
  errors: string[],
  listing = true,
): void {
  const tokFiles = new Set(files.filter((file) => file.startsWith('tok/')));
  const listed = new Set<string>();
  for (const [id, entry] of assets) {
    const file = entry.path.replace(/^\//, '');
    listed.add(file);
    if (entry.path !== `/tok/${id}/${entry.sha256.slice(0, 12)}.bin`)
      errors.push(`manifest path ${entry.path} for ${id} is not /tok/${id}/<sha256[0:12]>.bin`);
    if (!tokFiles.has(file)) {
      if (listing) errors.push(`manifest lists ${entry.path} but there is no such file`);
      continue;
    }
    const bytes = readFileSync(join(root, file));
    if (bytes.length !== entry.bytesCompressed)
      errors.push(
        `${entry.path} is ${String(bytes.length)} B but the manifest says ${String(entry.bytesCompressed)} B`,
      );
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      errors.push(`${entry.path} does not match its manifest sha256`);
    if (listing && bytes.length > DIST_LIMITS.assetGzipBytes && !ASSET_SIZE_WHITELIST.has(id))
      errors.push(
        `${entry.path} is ${kib(bytes.length)} KB gzip (limit ${kib(DIST_LIMITS.assetGzipBytes)} KB unless whitelisted)`,
      );
  }
  if (listing)
    for (const file of tokFiles) if (!listed.has(file)) errors.push(`/${file} is not listed in the vocab manifest`);
}

/**
 * One HTML page (AD-15): the first element of `<head>` is the classic boot script `<script src="/assets/boot-<hash>.js">`
 * (no `type`, `defer` or `async`) and it exists; no inline `<script>`, `<style>` or `style=""` (the strict CSP blocks them).
 */
export function checkHtmlPage(page: string, html: string, files: ReadonlySet<string>, errors: string[]): void {
  const first = /<head>\s*(<[^>]+>)/i.exec(html)?.[1];
  const boot = first === undefined ? null : /^<script src="\/(assets\/boot-[0-9a-f]{8}\.js)">$/.exec(first);
  if (boot?.[1] === undefined) errors.push(`${page}: the first element of <head> is not the classic boot script`);
  else if (!files.has(boot[1])) errors.push(`${page}: ${boot[1]} is not in dist`);
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html))
    errors.push(`${page}: inline <script> (blocked by script-src 'self')`);
  if (/<style[\s>]/i.test(html) || /\sstyle=/i.test(html))
    errors.push(`${page}: inline style (blocked by style-src 'self')`);
}

const WORKER_URL = /new Worker\(\s*["'`]\/(assets\/[\w.-]+\.js)["'`]/g;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The Worker entry chunks (`new Worker("/assets/<name>.js")` in any chunk) must not be imported by another chunk: WebKit
 * evaluates a module Worker's top-level script a second time when a module imports its URL, which starts a second host
 * (`workerManualChunks` in apps/web/vite.config.ts). A site without any Worker construction is an error too, so a change
 * in the bundler's output cannot turn this check off silently.
 */
export function checkWorkerEntries(scripts: ReadonlyMap<string, string>, errors: string[]): void {
  const entries = new Set<string>();
  for (const text of scripts.values())
    for (const match of text.matchAll(WORKER_URL)) if (match[1] !== undefined) entries.add(match[1]);
  if (entries.size === 0) {
    errors.push(
      'no chunk constructs the Worker (new Worker("/assets/<entry>.js")): the Worker-entry check found nothing',
    );
    return;
  }
  for (const entry of entries) {
    if (!scripts.has(entry)) errors.push(`the Worker entry ${entry} is not in dist`);
    const name = escapeRegExp(entry.slice('assets/'.length));
    const imports = new RegExp(`(?:\\bfrom|\\bimport)\\s*\\(?\\s*["'\`]\\./${name}["'\`]`);
    for (const [file, text] of scripts)
      if (file !== entry && imports.test(text))
        errors.push(`${file} imports the Worker entry ${entry} (WebKit would evaluate the Worker script twice)`);
  }
}

function mib(bytes: number): string {
  return (bytes / MiB).toFixed(1);
}

function kib(bytes: number): string {
  return (bytes / KiB).toFixed(1);
}

/** Runs the guards of `options.mode` (the module comment lists them) and returns the report. */
export function runGuards(options: GuardOptions): GuardReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!existsSync(options.dist)) {
    errors.push(
      `${options.dist} does not exist — run ${options.mode === 'site' ? 'the web build' : 'pnpm vocab:build'} first`,
    );
    return { errors, warnings, fileCount: 0, tokBytes: 0 };
  }
  const all = listFiles(options.dist);
  const vocab = options.mode === 'vocab';
  const files = vocab ? all.filter((file) => file.startsWith('tok/')) : all;
  const sizes = new Map(files.map((file) => [file, statSync(join(options.dist, file)).size] as const));
  let tokBytes = 0;
  for (const [file, size] of sizes) if (file.startsWith('tok/')) tokBytes += size;
  if (vocab) {
    checkFileSizes(sizes, errors, warnings);
    for (const file of dotfiles(files)) errors.push(`dotfile ${file} would be served`);
    if (tokBytes > DIST_LIMITS.tokWarnBytes) warnings.push(`/tok totals ${mib(tokBytes)} MiB (warn above 12 MiB)`);
  }

  const manifestPath = vocab ? join(options.dist, VOCAB_MANIFEST_FILE) : options.manifest;
  if (existsSync(manifestPath)) {
    const assets = parseManifestAssets(readFileSync(manifestPath, 'utf8'), errors);
    if (assets !== null) checkTokAgainstManifest(options.dist, files, assets, errors, vocab);
  } else {
    errors.push(`missing ${manifestPath} — run pnpm vocab:build first`);
  }
  if (vocab) return { errors, warnings, fileCount: files.length, tokBytes };

  // Site only (the rules `tsbs-vocab guard` does not have).
  const fileSet = new Set(files);
  const ignorePath = join(options.dist, '.assetsignore');
  const ignore = existsSync(ignorePath) ? parseAssetsIgnore(readFileSync(ignorePath, 'utf8')) : null;
  if (ignore === null) errors.push('.assetsignore is missing from dist');
  else
    for (const line of REQUIRED_ASSETSIGNORE)
      if (!ignore.includes(line)) errors.push(`.assetsignore does not list ${line} (06 §5)`);
  const uploaded = files.filter((file) => !isAssetIgnored(file, ignore ?? []));

  if (fileSet.has('_headers')) checkHeadersText(readFileSync(join(options.dist, '_headers'), 'utf8'), errors);
  for (const page of REQUIRED_PAGES) if (!fileSet.has(page)) errors.push(`${page} is missing from dist`);
  for (const page of files.filter((file) => file.endsWith('.html')))
    checkHtmlPage(page, readFileSync(join(options.dist, page), 'utf8'), fileSet, errors);
  const scripts = new Map(
    files
      .filter((file) => /^assets\/[^/]+\.js$/.test(file))
      .map((file) => [file, readFileSync(join(options.dist, file), 'utf8')] as const),
  );
  checkWorkerEntries(scripts, errors);
  return { errors, warnings, fileCount: uploaded.length, tokBytes };
}
