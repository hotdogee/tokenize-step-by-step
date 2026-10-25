/**
 * Local Lighthouse smoke read (06 §1 "Performance", §4; WP11).
 *
 *   pnpm lhci-local [--port 8792] [--runs 1]        # after `pnpm build`
 *
 * Starts `wrangler dev --assets apps/web/dist` (workerd applies `_headers`, `html_handling` and `not_found_handling` like
 * the edge), runs `lhci collect` with `lighthouserc.json` (mobile preset, Lighthouse "Slow 4G") against it, then
 * `lhci assert` (the 06 §3 budgets) and `lhci upload` (filesystem, `.lighthouseci/`), and stops wrangler.
 *
 * REPORT ONLY: loopback `wrangler dev` has no edge compression, HTTP/3 or real RTT, so its sizes and timings are not the
 * budget numbers — an assertion failure is printed and the script still exits 0. The budget-authoritative run is the
 * `lighthouse` job in ci.yml against the deployed `wrangler preview` URL (`pnpm lhci --collect.url=<preview url>`);
 * `vite preview` is never a target. Exit code 1 only when wrangler or `lhci collect` cannot run.
 *
 * Chrome: `CHROME_PATH` when set, else Playwright's chromium from the e2e package (`playwright install chromium`).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('../', import.meta.url));
const WINDOWS = process.platform === 'win32';
const BANNER =
  'lhci-local: smoke read only — loopback wrangler dev has no edge compression, HTTP/3 or real RTT; ' +
  'the deployed preview URL (ci `lighthouse` job) is the only budget-authoritative Lighthouse run.';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { port: { type: 'string', default: '8792' }, runs: { type: 'string', default: '1' } },
});
const port = Number(values.port);
const runs = Number(values.runs);
if (!Number.isInteger(port) || !Number.isInteger(runs) || runs < 1) {
  console.error('usage: pnpm lhci-local [--port 8792] [--runs 1]');
  process.exit(2);
}
if (!existsSync(`${repo}apps/web/dist/index.html`)) {
  console.error('lhci-local: apps/web/dist is missing — run `pnpm build` first.');
  process.exit(2);
}

/** The exact `@lhci/cli@x.y.z` of the root `lhci` script (one pin for both scripts). */
function lhciPackage(): string {
  const pkg = JSON.parse(readFileSync(`${repo}package.json`, 'utf8')) as { scripts: Record<string, string> };
  const pin = /@lhci\/cli@\d+\.\d+\.\d+/.exec(pkg.scripts['lhci'] ?? '')?.[0];
  if (pin === undefined) throw new Error('the root `lhci` script names no exact @lhci/cli version');
  return pin;
}

/** `CHROME_PATH`, or Playwright's chromium resolved through the e2e package. */
function chromePath(): string | undefined {
  const fromEnv = process.env['CHROME_PATH'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  try {
    const playwright = createRequire(`${repo}e2e/package.json`)('@playwright/test') as {
      chromium: { executablePath(): string };
    };
    const path = playwright.chromium.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs `pnpm dlx @lhci/cli@… <args>` in the repository root; returns its exit status. Under `pnpm lhci-local`,
 * `npm_execpath` names the running pnpm (an executable or a JS entry), so no shell is needed; otherwise `pnpm` is looked
 * up on PATH, through the shell on Windows (`pnpm.cmd`; no argument contains spaces or shell metacharacters).
 */
function lhci(args: readonly string[], chrome: string | undefined): number {
  const options = {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, ...(chrome === undefined ? {} : { CHROME_PATH: chrome }) },
  } as const;
  const full = ['dlx', lhciPackage(), ...args];
  const pnpm = process.env['npm_execpath'] ?? '';
  const result = /\.(?:c?js|mjs)$/.test(pnpm)
    ? spawnSync(process.execPath, [pnpm, ...full], options)
    : /pnpm(?:\.exe)?$/i.test(pnpm)
      ? spawnSync(pnpm, full, options)
      : spawnSync('pnpm', full, { ...options, shell: WINDOWS });
  return result.status ?? 1;
}

/** Polls `url` until it answers 200 (wrangler dev printing "Ready" is not enough on a cold workerd). */
async function waitFor(url: string, wrangler: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (wrangler.exitCode !== null) throw new Error(`wrangler dev exited with ${String(wrangler.exitCode)}`);
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer within ${String(timeoutMs / 1000)} s`);
}

/** Stops wrangler and its workerd child (a process tree on Windows, a process group elsewhere). */
function stop(wrangler: ChildProcess): void {
  if (wrangler.pid === undefined || wrangler.exitCode !== null) return;
  if (WINDOWS) spawnSync('taskkill', ['/pid', String(wrangler.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-wrangler.pid, 'SIGTERM');
}

const url = `http://127.0.0.1:${String(port)}/`;
console.log(BANNER);
const wrangler = spawn(
  process.execPath,
  [
    `${repo}node_modules/wrangler/bin/wrangler.js`,
    'dev',
    '--assets',
    'apps/web/dist',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--show-interactive-dev-session=false',
  ],
  { cwd: repo, stdio: 'ignore', detached: !WINDOWS, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
let collected = false;
let asserted = false;
try {
  await waitFor(url, wrangler);
  const chrome = chromePath();
  console.log(`lhci-local: ${url} is up; Chrome: ${chrome ?? '(lhci default)'}; ${String(runs)} run(s).`);
  collected =
    lhci(['collect', '--config=lighthouserc.json', `--url=${url}`, `--numberOfRuns=${String(runs)}`], chrome) === 0;
  if (collected) {
    asserted = lhci(['assert', '--config=lighthouserc.json'], chrome) === 0;
    lhci(['upload', '--config=lighthouserc.json'], chrome);
  }
} catch (error: unknown) {
  console.error(`lhci-local: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  stop(wrangler);
}
if (!collected) {
  console.error('lhci-local: Lighthouse did not run (see above).');
  process.exitCode = 1;
} else {
  console.log(
    asserted
      ? 'lhci-local: every lighthouserc.json assertion held on wrangler dev (smoke read; not budget-authoritative).'
      : 'lhci-local: some assertions failed on wrangler dev — informational only; the preview URL run decides (06 §3).',
  );
  console.log(BANNER);
}
