import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISSUE_TITLE } from '../lib/reverify.ts';

// Consistency of the delivery configuration (WP11): workflows ↔ root scripts ↔ pins, and the budgets of 06 §3 in
// size-limit.json, lighthouserc.json and budgets.json. A failure here means a config drifted from the design or a
// workflow calls something that does not exist.
const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const json = (path: string): unknown => JSON.parse(read(path));

const pkg = json('package.json') as { scripts: Record<string, string>; devDependencies: Record<string, string> };
const e2ePkg = json('e2e/package.json') as { scripts: Record<string, string>; devDependencies: Record<string, string> };
const workflows = readdirSync(new URL('.github/workflows/', root)).map((name) => ({
  name,
  text: read(`.github/workflows/${name}`),
}));
/** pnpm's own commands (everything else after `pnpm ` is a root script). */
const PNPM_BUILTINS = new Set(['install', 'audit', 'exec', 'dlx', 'run', 'add']);

/** Root scripts invoked as `pnpm <name>` in `text`, ignoring YAML comment lines. */
function pnpmScripts(text: string): string[] {
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  return [...code.matchAll(/\bpnpm[ \t]+(?!-)([a-z][\w:.-]*)/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => !PNPM_BUILTINS.has(name));
}

describe('workflows', () => {
  it('are the five of 02 §2', () => {
    expect(workflows.map((workflow) => workflow.name).sort()).toEqual([
      'ci.yml',
      'deploy.yml',
      'nightly-fuzz.yml',
      'oracle.yml',
      'reverify.yml',
    ]);
  });

  it('call only root scripts that exist (and root scripts call only existing scripts)', () => {
    for (const { name, text } of workflows)
      for (const script of pnpmScripts(text)) expect(pkg.scripts, `${name}: pnpm ${script}`).toHaveProperty([script]);
    for (const [name, body] of Object.entries(pkg.scripts))
      for (const script of pnpmScripts(body))
        expect(pkg.scripts, `script ${name}: pnpm ${script}`).toHaveProperty([script]);
    expect(e2ePkg.scripts).toHaveProperty(['e2e']);
    expect(e2ePkg.scripts).toHaveProperty(['e2e:headers']);
  });

  it('pin every action to a full commit SHA', () => {
    for (const { name, text } of workflows)
      for (const match of text.matchAll(/uses:\s*(\S+)/g))
        expect(match[1], name).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });

  it('use the repository wrangler and Playwright pins', () => {
    const wrangler = pkg.devDependencies['wrangler'];
    for (const { name, text } of workflows)
      for (const match of text.matchAll(/wranglerVersion:\s*'([^']+)'/g)) expect(match[1], name).toBe(wrangler);
    expect(e2ePkg.devDependencies['@playwright/test']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('deploy only from a successful ci run on main, never on push (AD-3)', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(
      /on:\n {2}workflow_run:\n {4}workflows: \[ci\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n\n/,
    );
    expect(deploy).not.toMatch(/^\s+push:/m);
    expect(deploy).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(deploy).toContain('run-id: ${{ github.event.workflow_run.id }}');
  });

  it('gate every Cloudflare job on the secrets probe', () => {
    for (const name of ['ci.yml', 'deploy.yml']) {
      const text = read(`.github/workflows/${name}`);
      const jobs = text.split(/\n {2}(?=[\w-]+:\n)/).filter((job) => job.includes('cloudflare/wrangler-action@'));
      expect(jobs.length, name).toBeGreaterThan(0);
      for (const job of jobs)
        expect(job, `${name}: ${job.slice(0, job.indexOf(':'))}`).toContain("has_cf_secrets == 'true'");
    }
  });

  it('build vocab with the CONFORMANCE_MODE variable, behind the AD-32 gate', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('CONFORMANCE_MODE: ${{ vars.CONFORMANCE_MODE }}');
    expect(ci).toContain('pnpm vocab:build --conformance "${CONFORMANCE_MODE:-strict}"');
    expect(ci.indexOf('pnpm conformance:gate')).toBeLessThan(ci.indexOf('pnpm vocab:build'));
  });

  it('open the re-verification issue under the title the script renders', () => {
    expect(read('.github/workflows/reverify.yml')).toContain(`TITLE: ${ISSUE_TITLE}`);
  });
});

describe('budgets (06 §3) — KB = 1024 B', () => {
  it('size-limit.json', () => {
    const entries = json('size-limit.json') as Array<{ name: string; limit: string }>;
    const limits = Object.fromEntries(entries.map((entry) => [entry.name.split(/[:(]/)[0]?.trim() ?? '', entry.limit]));
    expect(limits).toEqual({
      'dist/index.html': '14 KiB',
      'Main JS': '80 KiB',
      'i18n chunk': '8 KiB',
      'Worker core': '12 KiB',
      'Engine chunk': '10 KiB',
      CSS: '20 KiB',
      'Stand-in font': '4 KiB',
      'boot-[hash].js': '0.5 KiB',
    });
    expect(entries.find((entry) => entry.name.includes('bytelevel'))?.limit).toBe('16 KiB');
  });

  it('lighthouserc.json (mobile, Slow 4G, assertions = budgets) and budgets.json agree', () => {
    const rc = json('lighthouserc.json') as {
      ci: {
        collect: { settings: { formFactor: string; throttling: Record<string, number>; throttlingMethod: string } };
        assert: { assertions: Record<string, [string, { minScore?: number; maxNumericValue?: number }]> };
      };
    };
    expect(rc.ci.collect.settings.formFactor).toBe('mobile');
    expect(rc.ci.collect.settings.throttling).toEqual({ rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 });
    const assertion = (key: string): number | undefined => {
      const options = rc.ci.assert.assertions[key]?.[1];
      return options?.maxNumericValue ?? options?.minScore;
    };
    expect(assertion('categories:performance')).toBe(0.95);
    expect(assertion('categories:accessibility')).toBe(1);
    expect(assertion('categories:best-practices')).toBe(1);

    const budgets = (
      json('budgets.json') as Array<{
        resourceSizes: Array<{ resourceType: string; budget: number }>;
        timings: Array<{ metric: string; budget: number }>;
      }>
    )[0];
    const sizes = Object.fromEntries((budgets?.resourceSizes ?? []).map((entry) => [entry.resourceType, entry.budget]));
    expect(sizes).toEqual({ document: 14, script: 110, stylesheet: 20, font: 4, other: 1100, total: 1250 });
    for (const [type, kb] of Object.entries(sizes))
      expect(assertion(`resource-summary:${type}:size`), type).toBe(kb * 1024);
    const timings = Object.fromEntries((budgets?.timings ?? []).map((entry) => [entry.metric, entry.budget]));
    expect(timings).toEqual({
      'first-contentful-paint': 1500,
      'largest-contentful-paint': 2000,
      'total-blocking-time': 150,
      'cumulative-layout-shift': 0.02,
    });
    for (const [metric, value] of Object.entries(timings)) expect(assertion(metric), metric).toBe(value);
  });
});
