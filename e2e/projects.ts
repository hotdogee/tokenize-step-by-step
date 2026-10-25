/**
 * Playwright projects of the functional config (06 §1 "E2E (functional)" and "Visual", §4). Locally `pnpm e2e` runs
 * chromium alone; `E2E_FULL_MATRIX=1` adds firefox, webkit, Pixel 5, iPhone 12, chromium at 320/360/2560 and the `visual`
 * project. CI runs the full matrix as one job per engine (`E2E_ENGINE=chromium|firefox|webkit`) × 3 shards, so each job
 * installs one browser; WebKit projects get one retry in CI (07 §5: WebKit on Linux CI), the others none.
 */
import { devices, type PlaywrightTestProject } from '@playwright/test';

/** Desktop browsers run at 1440×900 (06 §1). */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

/** Tag of the browser-parity specs: they run once per engine (chromium/firefox/webkit), not per device or viewport. */
export const PARITY_TAG = '@parity';
const NOT_PARITY = /@parity/;

/** Browser engines Playwright installs; the CI matrix runs one job per engine. */
export const ENGINES = ['chromium', 'firefox', 'webkit'] as const;
export type Engine = (typeof ENGINES)[number];

/** Which projects a run selects. */
export interface MatrixOptions {
  /** `E2E_FULL_MATRIX=1`: every project, not just chromium. */
  readonly full: boolean;
  /** `E2E_ENGINE`: only the projects on this engine (null: all engines). */
  readonly engine?: Engine | null;
  /** Running in CI (retries for WebKit). */
  readonly ci?: boolean;
}

/** True when the environment asks for the whole matrix. */
export function fullMatrixRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  return env['E2E_FULL_MATRIX'] === '1';
}

/** The engine `E2E_ENGINE` names, or null when unset; any other value is an error (a typo would run nothing). */
export function engineRequested(env: Readonly<Record<string, string | undefined>>): Engine | null {
  const value = env['E2E_ENGINE'];
  if (value === undefined || value === '') return null;
  const engine = ENGINES.find((name) => name === value);
  if (engine === undefined) throw new Error(`E2E_ENGINE must be one of ${ENGINES.join(', ')} (got "${value}")`);
  return engine;
}

/** The engine a project runs on (`use.defaultBrowserType`, chromium when unset). */
export function engineOf(project: PlaywrightTestProject): Engine {
  return project.use?.defaultBrowserType ?? 'chromium';
}

/** Every functional project of the target matrix, chromium first. */
export function allFunctionalProjects(): PlaywrightTestProject[] {
  return [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: DESKTOP_VIEWPORT } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: DESKTOP_VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: DESKTOP_VIEWPORT } },
    // Devices: chromium 393×851 touch; webkit 390×844 touch (touch-target checks run here, 05 §3.3).
    { name: 'pixel-5', use: { ...devices['Pixel 5'] }, grepInvert: NOT_PARITY },
    { name: 'iphone-12', use: { ...devices['iPhone 12'] }, grepInvert: NOT_PARITY },
    // Viewports on chromium: 320×568 reflow (WCAG 1.4.10), 360×780 phone layout, 2560×1440@2× (4K-class).
    {
      name: 'chromium-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } },
      grepInvert: NOT_PARITY,
    },
    {
      name: 'chromium-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } },
      grepInvert: NOT_PARITY,
    },
    {
      name: 'chromium-2560',
      use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 2 },
      grepInvert: NOT_PARITY,
    },
  ];
}

/**
 * The visual-baseline project (06 §1 "Visual"): `visual/*.visual.ts` on chromium, `toHaveScreenshot` with
 * `maxDiffPixelRatio` 0.002, baselines at `visual/__screenshots__/<name>-<platform>.png` (Linux renders only; the specs
 * skip with a notice where a baseline is absent).
 */
export function visualProject(): PlaywrightTestProject {
  return {
    name: 'visual',
    testDir: './visual',
    testMatch: '**/*.visual.ts',
    snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
    expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
    use: { ...devices['Desktop Chrome'] },
  };
}

/** The projects a run selects: chromium alone, or the whole matrix (+ visual) when `full`, narrowed to `engine`. */
export function functionalProjects(options: MatrixOptions): PlaywrightTestProject[] {
  const all = [...allFunctionalProjects(), visualProject()];
  const selected = options.full ? all : all.filter((project) => project.name === 'chromium');
  const engine = options.engine ?? null;
  return selected
    .filter((project) => engine === null || engineOf(project) === engine)
    .map((project) =>
      engineOf(project) === 'webkit'
        ? { ...project, retries: options.ci === true ? 1 : 0, timeout: WEBKIT_TEST_TIMEOUT_MS }
        : project,
    );
}

/**
 * Per-test timeout of the WebKit projects (the default is 30 s): WebKit's `page.evaluate` and axe scans run 2–3× slower
 * than chromium's, so the layout loops and axe specs that take 10–15 s there alone pass 30 s on a busy machine.
 */
export const WEBKIT_TEST_TIMEOUT_MS = 60_000;
