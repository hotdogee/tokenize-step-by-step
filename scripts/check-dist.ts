/**
 * `check:dist` guards for `apps/web/dist` (02 §6, 03 §C.8, 06 §3); `size-limit` (size-limit.json) runs after this.
 *
 * - every file < 20 MiB (hard; platform limit 25 MiB), warn > 8 MiB; ≤ 2,000 files; `/tok` total ≤ 12 MiB (warn)
 * - no dotfiles except `.assetsignore` (dotfiles are served); `*.map` files must be excluded by `.assetsignore`
 * - `_headers` ≤ 100 rules
 * - `/tok/*` files ↔ `vocab-manifest.generated.json` entries, both ways
 * - every HTML page starts its <head> with the classic boot script `<script src="/assets/boot-<hash>.js">` (AD-15) that
 *   exists in dist, and has no inline <script>, <style> or style="" (the strict CSP would block them)
 *
 * WP03's `tsbs-vocab guard` takes over the vocabulary checks; WP11 owns this file afterwards.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../data/vocab/dist/vocab-manifest.generated.json', import.meta.url));
const MiB = 1024 * 1024;

const errors: string[] = [];
const warnings: string[] = [];

/** All files under `dir`, as POSIX paths relative to DIST. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [relative(DIST, full).split(sep).join(posix.sep)];
  });
}

if (!existsSync(DIST)) {
  console.error(`check:dist: ${DIST} does not exist — run the web build first.`);
  process.exit(1);
}
const files = walk(DIST);

// Sizes and counts.
if (files.length > 2000) errors.push(`${String(files.length)} files in dist (budget 2,000)`);
let tokBytes = 0;
for (const file of files) {
  const size = statSync(join(DIST, file)).size;
  if (size >= 20 * MiB) errors.push(`${file} is ${(size / MiB).toFixed(1)} MiB (hard limit 20 MiB)`);
  else if (size > 8 * MiB) warnings.push(`${file} is ${(size / MiB).toFixed(1)} MiB (warn above 8 MiB)`);
  if (file.startsWith('tok/')) tokBytes += size;
}
if (tokBytes > 12 * MiB) warnings.push(`/tok totals ${(tokBytes / MiB).toFixed(1)} MiB (warn above 12 MiB)`);

// Dotfiles and source maps.
const assetsIgnore = existsSync(join(DIST, '.assetsignore')) ? readFileSync(join(DIST, '.assetsignore'), 'utf8') : '';
for (const file of files) {
  if (file.split('/').some((part) => part.startsWith('.')) && file !== '.assetsignore')
    errors.push(`dotfile ${file} would be served`);
}
if (files.some((file) => file.endsWith('.map')) && !assetsIgnore.split(/\r?\n/).includes('*.map')) {
  errors.push('source maps are in dist but .assetsignore does not exclude *.map');
}

// _headers rule count.
const headersFile = join(DIST, '_headers');
if (existsSync(headersFile)) {
  const rules = readFileSync(headersFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^\S/.test(line) && !line.startsWith('#'));
  if (rules.length > 100) errors.push(`_headers has ${String(rules.length)} rules (limit 100)`);
} else {
  errors.push('_headers is missing from dist');
}

// /tok ↔ manifest.
if (existsSync(MANIFEST)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { assets?: Record<string, { path?: string }> };
  const listed = new Set(Object.values(manifest.assets ?? {}).map((entry) => (entry.path ?? '').replace(/^\//, '')));
  const shipped = new Set(files.filter((file) => file.startsWith('tok/')));
  for (const path of listed) if (!shipped.has(path)) errors.push(`manifest lists /${path} but dist has no such file`);
  for (const path of shipped)
    if (!listed.has(path)) errors.push(`dist ships /${path} but the vocab manifest does not list it`);
} else {
  errors.push(`missing ${relative(DIST, MANIFEST)} — run pnpm vocab:build first`);
}

// HTML: boot script first in <head>, nothing inline.
for (const page of files.filter((file) => file.endsWith('.html'))) {
  const html = readFileSync(join(DIST, page), 'utf8');
  const head = /<head>\s*(<[^>]+>)/i.exec(html);
  const boot =
    head?.[1] !== undefined
      ? /^<script src="\/(assets\/boot-[0-9a-f]{8}\.js)"><\/script>$/.exec(`${head[1]}</script>`)
      : null;
  if (boot?.[1] === undefined) errors.push(`${page}: the first element of <head> is not the classic boot script`);
  else if (!files.includes(boot[1])) errors.push(`${page}: ${boot[1]} is not in dist`);
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html))
    errors.push(`${page}: inline <script> (blocked by script-src 'self')`);
  if (/<style[\s>]/i.test(html) || /\sstyle=/i.test(html))
    errors.push(`${page}: inline style (blocked by style-src 'self')`);
}

for (const message of warnings) console.warn(`check:dist WARNING: ${message}`);
if (errors.length > 0) {
  for (const message of errors) console.error(`check:dist ERROR: ${message}`);
  process.exitCode = 1;
} else {
  console.log(`check:dist: ${String(files.length)} files OK (/tok ${(tokBytes / MiB).toFixed(2)} MiB).`);
}
