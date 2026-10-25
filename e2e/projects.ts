/**
 * Playwright projects for the functional suites (06 §1 "E2E (functional)", §4). The full target matrix is defined here;
 * PA-5 lets WP11's first pass run chromium only, so the other projects are included only when `E2E_FULL_MATRIX=1` (WP11's
 * wave-3 pass turns it on in CI together with the firefox/webkit installs and the shards).
 */
import { devices, type PlaywrightTestProject } from '@playwright/test';

/** Desktop browsers run at 1440×900 (06 §1). */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

/** Tag of the browser-parity specs: they run once per engine (chromium/firefox/webkit), not per device or viewport. */
export const PARITY_TAG = '@parity';
const NOT_PARITY = /@parity/;

/** True when the environment asks for the whole matrix. */
export function fullMatrixRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  return env['E2E_FULL_MATRIX'] === '1';
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

/** The projects to run: chromium alone, or the whole matrix when `full`. */
export function functionalProjects(full: boolean): PlaywrightTestProject[] {
  const projects = allFunctionalProjects();
  return full ? projects : projects.filter((project) => project.name === 'chromium');
}
