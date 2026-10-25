import { describe, expect, it } from 'vitest';
import config from '../playwright.config.ts';
import headersConfig from '../playwright.headers.config.ts';
import {
  allFunctionalProjects,
  engineOf,
  engineRequested,
  fullMatrixRequested,
  functionalProjects,
  PARITY_TAG,
  visualProject,
} from '../projects.ts';

const single = <T>(value: T | readonly T[] | undefined): T | undefined =>
  Array.isArray(value) ? (value as readonly T[])[0] : (value as T | undefined);

const names = (projects: ReadonlyArray<{ name?: string }>): Array<string | undefined> =>
  projects.map((project) => project.name);

describe('functional config (playwright.config.ts)', () => {
  it('runs specs/ against vite preview of the built app and never reuses a running server', () => {
    expect(config.testDir).toBe('./specs');
    expect(config.use?.baseURL).toBe('http://localhost:4173');
    expect(config.use?.trace).toBe('retain-on-failure');
    const webServer = single(config.webServer);
    expect(webServer?.command).toContain('@tsbs/web preview');
    expect(webServer?.reuseExistingServer).toBe(false);
  });

  it('runs chromium only unless E2E_FULL_MATRIX=1', () => {
    expect(names(config.projects ?? [])).toEqual(['chromium']);
    expect(fullMatrixRequested({})).toBe(false);
    expect(fullMatrixRequested({ E2E_FULL_MATRIX: '1' })).toBe(true);
    expect(names(functionalProjects({ full: false }))).toEqual(['chromium']);
  });

  it('retries nothing by default; only the WebKit projects retry once, and only in CI (07 §5)', () => {
    expect(config.retries).toBe(0);
    const ci = functionalProjects({ full: true, ci: true });
    expect(ci.filter((project) => project.retries === 1).map((project) => project.name)).toEqual([
      'webkit',
      'iphone-12',
    ]);
    expect(functionalProjects({ full: true, ci: false }).every((project) => (project.retries ?? 0) === 0)).toBe(true);
  });
});

describe('the full matrix (06 §1)', () => {
  const projects = allFunctionalProjects();
  const byName = new Map(projects.map((project) => [project.name, project]));

  it('defines 3 browsers, 2 devices, the 320/360/2560 viewports and the visual project', () => {
    expect(names(functionalProjects({ full: true }))).toEqual([
      'chromium',
      'firefox',
      'webkit',
      'pixel-5',
      'iphone-12',
      'chromium-320',
      'chromium-360',
      'chromium-2560',
      'visual',
    ]);
    for (const name of ['chromium', 'firefox', 'webkit'])
      expect(byName.get(name)?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(byName.get('firefox')?.use?.defaultBrowserType).toBe('firefox');
    expect(byName.get('webkit')?.use?.defaultBrowserType).toBe('webkit');
    expect(byName.get('pixel-5')?.use).toMatchObject({
      defaultBrowserType: 'chromium',
      hasTouch: true,
      isMobile: true,
    });
    expect(byName.get('iphone-12')?.use).toMatchObject({ defaultBrowserType: 'webkit', hasTouch: true });
    expect(byName.get('chromium-320')?.use?.viewport).toEqual({ width: 320, height: 568 });
    expect(byName.get('chromium-360')?.use?.viewport).toEqual({ width: 360, height: 780 });
    expect(byName.get('chromium-2560')?.use).toMatchObject({
      viewport: { width: 2560, height: 1440 },
      deviceScaleFactor: 2,
    });
  });

  it('runs the parity specs once per engine, not per device or viewport', () => {
    for (const project of projects) {
      const skipsParity = project.grepInvert instanceof RegExp && project.grepInvert.test(PARITY_TAG);
      expect(skipsParity, project.name).toBe(!['chromium', 'firefox', 'webkit'].includes(project.name ?? ''));
    }
  });

  it('splits into one CI job per engine (E2E_ENGINE), every project in exactly one', () => {
    expect(engineRequested({})).toBeNull();
    expect(engineRequested({ E2E_ENGINE: 'webkit' })).toBe('webkit');
    expect(() => engineRequested({ E2E_ENGINE: 'safari' })).toThrow(/E2E_ENGINE/);
    const split = (['chromium', 'firefox', 'webkit'] as const).map((engine) =>
      names(functionalProjects({ full: true, engine })),
    );
    expect(split).toEqual([
      ['chromium', 'pixel-5', 'chromium-320', 'chromium-360', 'chromium-2560', 'visual'],
      ['firefox'],
      ['webkit', 'iphone-12'],
    ]);
    expect(engineOf({ name: 'x' })).toBe('chromium');
  });

  it('compares visual baselines with maxDiffPixelRatio 0.002 under visual/__screenshots__ per platform', () => {
    const visual = visualProject();
    expect(visual).toMatchObject({
      testDir: './visual',
      testMatch: '**/*.visual.ts',
      snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
      expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
    });
    expect(engineOf(visual)).toBe('chromium');
  });
});

describe('headers config (playwright.headers.config.ts)', () => {
  it('runs headers/ against wrangler dev on the built dist, never vite preview', () => {
    expect(headersConfig.testDir).toBe('./headers');
    const webServer = single(headersConfig.webServer);
    expect(webServer?.command).toMatch(/^pnpm exec wrangler dev --assets apps\/web\/dist /);
    expect(webServer?.command).not.toContain('preview');
    expect(headersConfig.use?.baseURL).toBe('http://127.0.0.1:8791');
  });
});
