import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ISSUE_TITLE } from '../lib/reverify.ts';

// Consistency of the delivery configuration (WP11): workflows and composite actions parse and are well-formed,
// workflows ↔ root scripts ↔ pins, and the budgets of 06 §3 in size-limit.json, lighthouserc.json and budgets.json. A
// failure here means a config drifted from the design or a workflow calls something that does not exist.
const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const json = (path: string): unknown => JSON.parse(read(path));

const pkg = json('package.json') as { scripts: Record<string, string>; devDependencies: Record<string, string> };
const e2ePkg = json('e2e/package.json') as { scripts: Record<string, string>; devDependencies: Record<string, string> };
const workflows = readdirSync(new URL('.github/workflows/', root)).map((name) => ({
  name,
  text: read(`.github/workflows/${name}`),
}));
/** Composite actions under .github/actions/<name>/action.yml. */
const actions = readdirSync(new URL('.github/actions/', root)).map((name) => ({
  name: `actions/${name}`,
  text: read(`.github/actions/${name}/action.yml`),
}));

/** The parts of a workflow file the structural checks read. */
interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: string };
  jobs?: Record<
    string,
    {
      name?: string;
      'runs-on'?: string;
      'timeout-minutes'?: number;
      needs?: string | string[];
      if?: string;
      env?: Record<string, string>;
      strategy?: { matrix?: Record<string, unknown> };
      steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown>; if?: string }>;
    }
  >;
}
const parsed = (name: string): Workflow => parse(read(`.github/workflows/${name}`)) as Workflow;
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

  it('parse as YAML: every job has runs-on, a timeout and steps, and needs only jobs that exist', () => {
    for (const { name } of workflows) {
      const workflow = parsed(name);
      expect(workflow.name, name).toBe(name.replace(/\.yml$/, ''));
      expect(Object.keys(workflow.on ?? {}).length, `${name}: on`).toBeGreaterThan(0);
      const jobs = Object.entries(workflow.jobs ?? {});
      expect(jobs.length, `${name}: jobs`).toBeGreaterThan(0);
      for (const [id, job] of jobs) {
        expect(job['runs-on'], `${name} ${id}: runs-on`).toBe('ubuntu-24.04');
        expect(job['timeout-minutes'], `${name} ${id}: timeout-minutes`).toBeGreaterThan(0);
        expect(job.steps?.length, `${name} ${id}: steps`).toBeGreaterThan(0);
        for (const need of [job.needs ?? []].flat())
          expect(workflow.jobs, `${name} ${id} needs ${need}`).toHaveProperty([need]);
      }
    }
    for (const { name, text } of actions) {
      const action = parse(text) as { name?: string; runs?: { using?: string; steps?: unknown[] } };
      expect(action.name, name).toBeTruthy();
      expect(action.runs?.using, name).toBe('composite');
      expect(action.runs?.steps?.length, name).toBeGreaterThan(0);
    }
  });

  it('call only root scripts that exist (and root scripts call only existing scripts)', () => {
    for (const { name, text } of [...workflows, ...actions])
      for (const script of pnpmScripts(text)) expect(pkg.scripts, `${name}: pnpm ${script}`).toHaveProperty([script]);
    for (const [name, body] of Object.entries(pkg.scripts))
      for (const script of pnpmScripts(body))
        expect(pkg.scripts, `script ${name}: pnpm ${script}`).toHaveProperty([script]);
    expect(e2ePkg.scripts).toHaveProperty(['e2e']);
    expect(e2ePkg.scripts).toHaveProperty(['e2e:headers']);
  });

  it('pin every action to a full commit SHA (local composite actions by path)', () => {
    for (const { name, text } of [...workflows, ...actions])
      for (const match of text.matchAll(/uses:\s*(\S+)/g)) {
        const ref = match[1] ?? '';
        if (ref.startsWith('./'))
          expect(existsSync(new URL(`${ref.slice(2)}/action.yml`, root)), `${name}: ${ref}`).toBe(true);
        else expect(ref, name).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
  });

  it('install browsers only through the shared Playwright action (cache keyed on the Playwright version)', () => {
    for (const { name, text } of workflows) expect(text, name).not.toMatch(/playwright install/);
    const action = actions.find((entry) => entry.name === 'actions/playwright')?.text ?? '';
    expect(action).toContain(`jq -r '.devDependencies["@playwright/test"]' e2e/package.json`);
    expect(action).toMatch(/key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.key\.outputs\.version \}\}-/);
    // Browsers come from Playwright's CDN; their apt packages install through install-deps from a cached archive dir.
    expect(action).toContain('playwright install $BROWSERS');
    expect(action).toContain('playwright install-deps $BROWSERS');
    expect(action).toContain('archive.ubuntu.com');
    expect(action).toMatch(/key: apt-deps-\$\{\{ runner\.os \}\}-\$\{\{ steps\.key\.outputs\.version \}\}-/);
    expect(action).toContain('fonts-noto-cjk');
  });

  it('run the full e2e matrix as engine × 3 shards with the CJK fonts (06 §4)', () => {
    const e2e = parsed('ci.yml').jobs?.['e2e-matrix'];
    expect(e2e?.strategy?.matrix).toMatchObject({ engine: ['chromium', 'firefox', 'webkit'], shard: [1, 2, 3] });
    expect(e2e?.env).toEqual({ E2E_FULL_MATRIX: '1', E2E_ENGINE: '${{ matrix.engine }}' });
    const steps = e2e?.steps ?? [];
    expect(steps.find((step) => step.uses === './.github/actions/playwright')?.with).toEqual({
      browsers: '${{ matrix.engine }}',
      'cjk-fonts': 'true',
    });
    expect(steps.some((step) => step.run === 'pnpm e2e --shard=${{ matrix.shard }}/3')).toBe(true);
    expect(steps.some((step) => step.if === 'failure()' && step.with?.['path'] !== undefined)).toBe(true);
  });

  it('report the matrix as one stable `e2e` check that fails unless every shard succeeded (06 §4)', () => {
    const jobs = parsed('ci.yml').jobs ?? {};
    const gate = jobs['e2e'];
    expect(gate?.name).toBeUndefined();
    expect(gate?.needs).toBe('e2e-matrix');
    expect(gate?.if).toBe("always() && github.event.action != 'closed'");
    expect(gate?.steps?.[0]?.run).toContain('test "$RESULT" = success');
    expect(jobs['e2e-matrix']?.name).toMatch(/^e2e \(/);
    // No other job may claim the required check's name.
    for (const [id, job] of Object.entries(jobs)) if (id !== 'e2e') expect(job.name ?? id, id).not.toBe('e2e');
  });

  it('keep a dispatched ci run out of the push group, so it never cancels a pending push run on main', () => {
    const { concurrency } = parsed('ci.yml');
    expect(concurrency?.group).toBe(
      "ci-${{ github.event_name == 'workflow_dispatch' && 'dispatch-' || '' }}${{ github.event.pull_request.number || github.ref }}",
    );
    expect(concurrency?.['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it('render the visual baselines only on workflow_dispatch, never on push or pull_request', () => {
    const ci = parsed('ci.yml');
    expect(ci.on).toHaveProperty(['workflow_dispatch']);
    const job = ci.jobs?.['visual-baselines'];
    expect(job?.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(job?.steps?.some((step) => step.run === 'pnpm e2e --project=visual --update-snapshots=all')).toBe(true);
    // A dispatched ci run on main must never deploy (deploy.yml requires a push run).
    expect(read('.github/workflows/deploy.yml')).toContain("github.event.workflow_run.event == 'push'");
  });

  it('lhci-local reuses the exact @lhci/cli pin of the lhci script', () => {
    expect(pkg.scripts['lhci']).toMatch(/@lhci\/cli@\d+\.\d+\.\d+ /);
    expect(pkg.scripts['lhci-local']).toBe('node scripts/lhci-local.ts');
    expect(read('scripts/lhci-local.ts')).toContain("pkg.scripts['lhci']");
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
      'Main JS': '81 KiB',
      'i18n chunk': '9 KiB',
      'Worker core': '12 KiB',
      'Engine chunk': '10 KiB',
      CSS: '20 KiB',
      'Stand-in font': '4 KiB',
      'boot-[hash].js': '0.5 KiB',
      'first-paint-[hash].js': '0.5 KiB',
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
    // script and total are stated as served by the edge (PA-14: zstd / fast brotli ≈ 1.3× the brotli-11 engineering budgets);
    // font counts transfer size with response headers (two WOFF2 responses: 3.27 kB of bytes measured 4,976–4,988 B on PR #1).
    expect(sizes).toEqual({ document: 14, script: 143, stylesheet: 20, font: 6, other: 1100, total: 1300 });
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
