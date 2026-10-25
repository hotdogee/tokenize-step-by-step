/**
 * Dist guards (03 §C.8, the "Dist" row of 06 §3, 02 §6 `check:dist`). One implementation for two entry points:
 *
 * - `site` (`pnpm check:dist`): the deployable `apps/web/dist` — sizes, file count, dotfiles, `.assetsignore`, `_headers`,
 *   `/tok` ↔ vocab manifest, HTML (classic boot script first, nothing inline), `index.html` brotli, examples gzip;
 * - `vocab` (`pnpm vocab:guard`, the CI `vocab` job): the converter output `data/vocab/dist` — the `/tok` part only.
 *
 * Everything reads the directory synchronously and returns a report; printing and the exit code belong to the CLI.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import type { VocabAssetEntry } from '@tsbs/core';
import { MAX_HEADER_LINE_CHARS, parseHeadersFile } from './headers-file.ts';

const KiB = 1024;
const MiB = 1024 * KiB;

/** Every limit the guards enforce (KB = 1024 B, as in the design). */
export const DIST_LIMITS = {
  /** Hard per-file limit (platform: 25 MiB = 26,214,400 B). */
  fileHardBytes: 20 * MiB,
  fileWarnBytes: 8 * MiB,
  /** Deployable files (platform: 20,000, enforced only server-side at deploy). */
  maxFiles: 2000,
  /** `/tok` total (warning only). */
  tokWarnBytes: 12 * MiB,
  /** `_headers` path blocks (platform limit 100). */
  maxHeaderRules: 100,
  indexHtmlBrotliBytes: 14 * KiB,
  /** Per vocabulary asset, on the wire (the `.bin` is already gzip), unless whitelisted. */
  assetGzipBytes: Math.round(1.7 * MiB),
  /** Per `examples/<tokenizer>.<sha8>.json`, gzip-9. */
  examplesGzipBytes: 16 * KiB,
} as const;

/** Tokenizer ids allowed above `assetGzipBytes`. Empty: the largest asset (Gemma 4, ≈ 1,620 KB, 03 §C.3) fits. */
export const ASSET_SIZE_WHITELIST: ReadonlySet<string> = new Set();

/** Lines `.assetsignore` must contain (06 §5). */
export const REQUIRED_ASSETSIGNORE = ['*.map', '.vite/', '.DS_Store', 'Thumbs.db'] as const;

/** HTML entries the site must ship (`not_found_handling: 404-page` serves `/404.html`). */
export const REQUIRED_PAGES = ['index.html', 'about/index.html', '404.html'] as const;

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

/** `_headers` text → errors: unparsable, more than `maxHeaderRules` path blocks, or a header line over 2,000 chars. */
export function checkHeadersText(text: string, errors: string[]): void {
  let blocks;
  try {
    blocks = parseHeadersFile(text);
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
    return;
  }
  if (blocks.length > DIST_LIMITS.maxHeaderRules)
    errors.push(`_headers has ${String(blocks.length)} rules (limit ${String(DIST_LIMITS.maxHeaderRules)})`);
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
 * `/tok` ↔ manifest, both ways (03 §C.8): every listed path exists with the recorded size and sha256 and has the form
 * `/tok/<id>/<sha256[0:12]>.bin`; every `tok/` file is listed; each asset is ≤ `assetGzipBytes` unless whitelisted.
 */
export function checkTokAgainstManifest(
  root: string,
  files: readonly string[],
  assets: ReadonlyMap<string, ManifestAsset>,
  errors: string[],
): void {
  const tokFiles = new Set(files.filter((file) => file.startsWith('tok/')));
  const listed = new Set<string>();
  for (const [id, entry] of assets) {
    const file = entry.path.replace(/^\//, '');
    listed.add(file);
    if (entry.path !== `/tok/${id}/${entry.sha256.slice(0, 12)}.bin`)
      errors.push(`manifest path ${entry.path} for ${id} is not /tok/${id}/<sha256[0:12]>.bin`);
    if (!tokFiles.has(file)) {
      errors.push(`manifest lists ${entry.path} but there is no such file`);
      continue;
    }
    const bytes = readFileSync(join(root, file));
    if (bytes.length !== entry.bytesCompressed)
      errors.push(
        `${entry.path} is ${String(bytes.length)} B but the manifest says ${String(entry.bytesCompressed)} B`,
      );
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      errors.push(`${entry.path} does not match its manifest sha256`);
    if (bytes.length > DIST_LIMITS.assetGzipBytes && !ASSET_SIZE_WHITELIST.has(id))
      errors.push(
        `${entry.path} is ${kib(bytes.length)} KB gzip (limit ${kib(DIST_LIMITS.assetGzipBytes)} KB unless whitelisted)`,
      );
  }
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

/** Brotli-11 size, the compression `size-limit` and the edge budget use. */
export function brotliSize(bytes: Uint8Array): number {
  return brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }).length;
}

/** gzip-9 size. */
export function gzipSize(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 9 }).length;
}

function mib(bytes: number): string {
  return (bytes / MiB).toFixed(1);
}

function kib(bytes: number): string {
  return (bytes / KiB).toFixed(1);
}

/** Runs every guard of `options.mode` and returns the report. */
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
  const files = options.mode === 'site' ? all : all.filter((file) => file.startsWith('tok/'));
  const sizes = new Map(files.map((file) => [file, statSync(join(options.dist, file)).size] as const));
  checkFileSizes(sizes, errors, warnings);
  for (const file of dotfiles(files)) errors.push(`dotfile ${file} would be served`);

  let tokBytes = 0;
  for (const [file, size] of sizes) if (file.startsWith('tok/')) tokBytes += size;
  if (tokBytes > DIST_LIMITS.tokWarnBytes) warnings.push(`/tok totals ${mib(tokBytes)} MiB (warn above 12 MiB)`);

  const manifestPath = options.mode === 'site' ? options.manifest : join(options.dist, VOCAB_MANIFEST_FILE);
  if (existsSync(manifestPath)) {
    const assets = parseManifestAssets(readFileSync(manifestPath, 'utf8'), errors);
    if (assets !== null) checkTokAgainstManifest(options.dist, files, assets, errors);
  } else {
    errors.push(`missing ${manifestPath} — run pnpm vocab:build first`);
  }
  if (options.mode === 'vocab') return { errors, warnings, fileCount: files.length, tokBytes };

  // Site only.
  const fileSet = new Set(files);
  const ignorePath = join(options.dist, '.assetsignore');
  const ignore = existsSync(ignorePath) ? parseAssetsIgnore(readFileSync(ignorePath, 'utf8')) : null;
  if (ignore === null) errors.push('.assetsignore is missing from dist');
  else
    for (const line of REQUIRED_ASSETSIGNORE)
      if (!ignore.includes(line)) errors.push(`.assetsignore does not list ${line} (06 §5)`);
  const uploaded = files.filter((file) => !isAssetIgnored(file, ignore ?? []));
  if (uploaded.length > DIST_LIMITS.maxFiles)
    errors.push(`${String(uploaded.length)} deployable files (budget ${String(DIST_LIMITS.maxFiles)})`);

  if (fileSet.has('_headers')) checkHeadersText(readFileSync(join(options.dist, '_headers'), 'utf8'), errors);
  else errors.push('_headers is missing from dist');

  for (const page of REQUIRED_PAGES) if (!fileSet.has(page)) errors.push(`${page} is missing from dist`);
  for (const page of files.filter((file) => file.endsWith('.html')))
    checkHtmlPage(page, readFileSync(join(options.dist, page), 'utf8'), fileSet, errors);
  if (fileSet.has('index.html')) {
    const size = brotliSize(readFileSync(join(options.dist, 'index.html')));
    if (size > DIST_LIMITS.indexHtmlBrotliBytes)
      errors.push(`index.html is ${kib(size)} KB brotli (budget ${kib(DIST_LIMITS.indexHtmlBrotliBytes)} KB)`);
  }
  for (const file of files.filter((name) => /^examples\/[^/]+\.json$/.test(name))) {
    const size = gzipSize(readFileSync(join(options.dist, file)));
    if (size > DIST_LIMITS.examplesGzipBytes)
      errors.push(`${file} is ${kib(size)} KB gzip (budget ${kib(DIST_LIMITS.examplesGzipBytes)} KB)`);
  }
  return { errors, warnings, fileCount: uploaded.length, tokBytes };
}
