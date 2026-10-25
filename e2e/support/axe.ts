/**
 * axe harness (06 §1 "Accessibility"): WCAG 2.2 AA rule tags, readable findings, the full result attached to the test.
 * Every page/state a spec reaches calls `expectNoAxeViolations`; the gate is zero violations. Criteria axe cannot detect
 * (2.1.4, 2.4.11, 2.5.7, 2.5.8, 1.4.10, 1.4.13) are manual items in `docs/a11y-checklist.md`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

/** axe tags for WCAG 2.0/2.1/2.2 levels A and AA. */
export const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** Narrowing for one scan. Prefer `include`/`exclude` over disabling rules; every disabled rule needs a comment. */
export interface AxeScanOptions {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly disableRules?: readonly string[];
}

/** One violation, reduced to what a failure message needs. */
export interface AxeFinding {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly targets: readonly string[];
}

/** Runs axe on the current page state and returns the violations. */
export async function scanAxe(
  page: Page,
  options: AxeScanOptions = {},
): Promise<{ findings: AxeFinding[]; raw: unknown }> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (options.disableRules !== undefined) builder = builder.disableRules([...options.disableRules]);
  const results = await builder.analyze();
  const findings = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    help: violation.help,
    helpUrl: violation.helpUrl,
    targets: violation.nodes.map((node) =>
      node.target.map((part) => (Array.isArray(part) ? part.join(' >>> ') : part)).join(' '),
    ),
  }));
  return { findings, raw: results };
}

/** Asserts zero axe violations; attaches the full axe result as `axe-<name>.json`. */
export async function expectNoAxeViolations(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: AxeScanOptions = {},
): Promise<void> {
  const { findings, raw } = await scanAxe(page, options);
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(raw, null, 2), contentType: 'application/json' });
  expect(findings, `axe (WCAG 2.2 AA) violations on ${name}`).toEqual([]);
}
