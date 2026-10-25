/**
 * `pnpm -F @tsbs/ui-tokens check` — asserts the 05 §11 / AD-35 contrast contract on src/tokens.css in both themes and
 * exits 1 on any failing pair. The contract itself lives in src/contrast.ts (pure, unit-tested); Node runs it directly
 * (type stripping), so there is no build step.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { checkContrast } from '../src/contrast.ts';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const { checks, warnings } = checkContrast(css);
const failures = checks.filter((check) => !check.pass);

/** @param {string} line */
const out = (line) => process.stdout.write(`${line}\n`);

for (const theme of ['light', 'dark']) {
  const mine = checks.filter((check) => check.theme === theme);
  /** @type {Map<string, import('../src/contrast.ts').ContrastCheck>} */
  const worst = new Map();
  for (const check of mine) {
    const current = worst.get(check.rule);
    if (current === undefined || check.ratio < current.ratio) worst.set(check.rule, check);
  }
  out(`${theme}: ${String(mine.length)} pairs`);
  for (const [rule, check] of worst)
    out(
      `  ${rule.padEnd(9)} min ${check.ratio.toFixed(2)}:1 (${check.fg} on ${check.bg}; needs ${String(check.min)}:1)`,
    );
}
for (const warning of warnings) out(`WARNING ${warning}`);
for (const failure of failures)
  out(
    `FAIL ${failure.theme} ${failure.rule}: ${failure.fg} on ${failure.bg} = ${failure.ratio.toFixed(2)}:1 < ${String(failure.min)}:1`,
  );
out(failures.length === 0 ? 'check-contrast: OK' : `check-contrast: ${String(failures.length)} failing pair(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
