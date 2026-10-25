/**
 * `tsbs-vocab guard` (03 §C.8, 06 §3): deploy-safety checks on the built site directory. Same thresholds as
 * `scripts/check-dist.ts` (which `pnpm check:dist` runs alongside this guard), plus the C.8 extras. Its file count is
 * every file on disk under `--dist`; `check:dist` counts only the files wrangler uploads (after `.assetsignore`), so the
 * two numbers differ by the ignored files (`.assetsignore`, `*.map`, `.vite/`):
 *
 * - any file ≥ 20 MiB fails (platform limit 25 MiB), > 8 MiB warns; ≤ 2,000 files; `/tok` total > 12 MiB warns
 * - no dotfiles except `.assetsignore` (dotfiles are served); `*.map` files must be excluded by `.assetsignore`
 * - every `/tok/*` file has a vocab-manifest entry and vice versa; each `/tok` file ≤ 1.7 MiB unless allow-listed
 * - `_headers` ≤ 100 rules; `index.html` ≤ 14 KB brotli
 * - lazy `examples/*.json` ≤ 16 KB gzip each
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { gzipSize } from './compress.ts';
import { EXAMPLES_BUDGET_GZ } from './examples.ts';

const MiB = 1024 * 1024;

export const GUARD_LIMITS = {
  fileHardBytes: 20 * MiB,
  fileWarnBytes: 8 * MiB,
  maxFiles: 2000,
  tokWarnTotalBytes: 12 * MiB,
  tokAssetBytes: 1.7 * MiB,
  headersRules: 100,
  indexHtmlBrotliBytes: 14 * 1024,
  examplesGzipBytes: EXAMPLES_BUDGET_GZ,
} as const;

export interface GuardOptions {
  /** The built site (`apps/web/dist`). */
  readonly dist: string;
  /** `vocab-manifest.generated.json`; null skips the `/tok` ↔ manifest cross-check. */
  readonly manifest: string | null;
  /** `/tok` paths (root-relative) allowed to exceed the per-asset ceiling. */
  readonly allowLargeAssets?: readonly string[];
}

export interface GuardReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly files: number;
  readonly tokBytes: number;
}

async function walk(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, full)));
    else out.push(relative(root, full).split(sep).join(posix.sep));
  }
  return out.sort();
}

function brotliSize(data: Uint8Array): number {
  return brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}

/** Runs every guard; never throws for a violation (it is reported in `errors`). */
export async function runGuard(options: GuardOptions): Promise<GuardReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isDir = await stat(options.dist).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDir)
    return { errors: [`${options.dist} does not exist — build the site first`], warnings, files: 0, tokBytes: 0 };
  const files = await walk(options.dist, options.dist);
  if (files.length > GUARD_LIMITS.maxFiles)
    errors.push(`${String(files.length)} files (budget ${String(GUARD_LIMITS.maxFiles)})`);

  let tokBytes = 0;
  const allow = new Set(options.allowLargeAssets ?? []);
  for (const file of files) {
    const size = (await stat(join(options.dist, file))).size;
    if (size >= GUARD_LIMITS.fileHardBytes)
      errors.push(`${file} is ${(size / MiB).toFixed(1)} MiB (hard limit 20 MiB)`);
    else if (size > GUARD_LIMITS.fileWarnBytes)
      warnings.push(`${file} is ${(size / MiB).toFixed(1)} MiB (warn above 8 MiB)`);
    if (file.startsWith('tok/')) {
      tokBytes += size;
      if (size > GUARD_LIMITS.tokAssetBytes && !allow.has(`/${file}`))
        errors.push(`/${file} is ${(size / MiB).toFixed(2)} MiB (per-asset gzip ceiling 1.7 MiB unless allow-listed)`);
    }
    if (file.split('/').some((part) => part.startsWith('.')) && file !== '.assetsignore')
      errors.push(`dotfile ${file} would be served`);
    if (/^examples\/[^/]+\.json$/.test(file)) {
      const gz = gzipSize(new Uint8Array(await readFile(join(options.dist, file))));
      if (gz > GUARD_LIMITS.examplesGzipBytes)
        errors.push(`${file} is ${String(gz)} B gzip (budget ${String(GUARD_LIMITS.examplesGzipBytes)} B)`);
    }
  }
  if (tokBytes > GUARD_LIMITS.tokWarnTotalBytes)
    warnings.push(`/tok totals ${(tokBytes / MiB).toFixed(1)} MiB (warn above 12 MiB)`);

  const assetsIgnore = files.includes('.assetsignore')
    ? await readFile(join(options.dist, '.assetsignore'), 'utf8')
    : '';
  if (files.some((f) => f.endsWith('.map')) && !assetsIgnore.split(/\r?\n/).includes('*.map'))
    errors.push('source maps are in dist but .assetsignore does not exclude *.map');

  if (files.includes('_headers')) {
    const rules = (await readFile(join(options.dist, '_headers'), 'utf8'))
      .split(/\r?\n/)
      .filter((line) => /^\S/.test(line) && !line.startsWith('#'));
    if (rules.length > GUARD_LIMITS.headersRules) errors.push(`_headers has ${String(rules.length)} rules (limit 100)`);
  } else errors.push('_headers is missing');

  if (files.includes('index.html')) {
    const br = brotliSize(new Uint8Array(await readFile(join(options.dist, 'index.html'))));
    if (br > GUARD_LIMITS.indexHtmlBrotliBytes) errors.push(`index.html is ${String(br)} B brotli (budget 14 KB)`);
  } else errors.push('index.html is missing');

  if (options.manifest !== null) {
    let listed: Set<string> | null = null;
    try {
      const manifest = JSON.parse(await readFile(options.manifest, 'utf8')) as {
        assets?: Record<string, { path?: unknown }>;
      };
      listed = new Set(
        Object.values(manifest.assets ?? {}).map((entry) =>
          typeof entry.path === 'string' ? entry.path.replace(/^\//, '') : '',
        ),
      );
    } catch {
      errors.push(`cannot read the vocab manifest ${options.manifest} — run pnpm vocab:build`);
    }
    if (listed !== null) {
      const shipped = new Set(files.filter((f) => f.startsWith('tok/')));
      for (const path of listed)
        if (!shipped.has(path)) errors.push(`manifest lists /${path} but dist has no such file`);
      for (const path of shipped)
        if (!listed.has(path)) errors.push(`dist ships /${path} but the vocab manifest does not list it`);
    }
  }
  return { errors, warnings, files: files.length, tokBytes };
}
