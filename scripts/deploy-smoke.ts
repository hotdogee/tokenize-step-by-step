/**
 * Post-deploy smoke test (06 §7 items 6–8; checks in `lib/smoke.ts`).
 *
 *   pnpm deploy:smoke --url https://tokenize-step-by-step.<account>.workers.dev [--dist apps/web/dist]
 *
 * Run by CI after `wrangler preview` (PR previews) and after `wrangler deploy` (production), with the `dist` artifact that
 * was deployed, and usable by hand against `wrangler dev`. Prints one line per check; exit code 1 if any check fails.
 */
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runSmoke, targetFromDist } from './lib/smoke.ts';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { url: { type: 'string' }, dist: { type: 'string' } },
});
const dist = values.dist ?? fileURLToPath(new URL('../apps/web/dist', import.meta.url));
if (values.url === undefined || !/^https?:\/\//.test(values.url)) {
  console.error('usage: pnpm deploy:smoke --url <http(s) base URL> [--dist apps/web/dist]');
  process.exit(2);
}
if (!existsSync(dist)) {
  console.error(`deploy:smoke: ${dist} does not exist — pass the dist that was deployed with --dist.`);
  process.exit(2);
}

const results = await runSmoke(targetFromDist(values.url, dist), (url, init) => fetch(url, init));
for (const result of results) {
  const mark = result.skipped ? 'SKIP' : result.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${result.name} — ${result.detail}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(
  `deploy:smoke: ${String(results.length - failed)}/${String(results.length)} checks passed against ${values.url}.`,
);
if (failed > 0) process.exitCode = 1;
