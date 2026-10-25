/**
 * `pnpm preview:pr -- <n>` → `wrangler preview --name pr-<n>` (CI only; AD-3, 06 §4). Needs CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const pr = process.argv.slice(2).find((arg) => arg !== '--');
if (pr === undefined || !/^[1-9]\d*$/.test(pr)) {
  console.error('usage: pnpm preview:pr -- <pull request number>');
  process.exit(2);
}
// `pr` is digits only, so running the command line through the shell (portable lookup of pnpm) cannot inject anything.
const result = spawnSync(`pnpm exec wrangler preview --name pr-${pr}`, { stdio: 'inherit', shell: true });
process.exitCode = result.status ?? 1;
