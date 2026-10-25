/**
 * `pnpm conformance:gate` — fails when `CONFORMANCE_MODE` is weaker than the engines present allow (AD-32; logic in
 * `lib/conformance-gate.ts`). The CI `vocab` job runs it with the repository variable before `vocab:build`.
 */
import process from 'node:process';
import { ENGINE_FACTORIES, familiesWithEngine } from '@tsbs/conformance';
import * as core from '@tsbs/core';
import type { Family } from '@tsbs/core';
import { evaluateGate } from './lib/conformance-gate.ts';

const all = Object.keys(ENGINE_FACTORIES) as Family[];
const verdict = evaluateGate(
  process.env['CONFORMANCE_MODE'],
  familiesWithEngine(core),
  all,
  process.env['CI'] !== undefined && process.env['CI'] !== '',
);
for (const message of verdict.messages) {
  if (verdict.ok) console.log(message);
  else {
    if (process.env['GITHUB_ACTIONS'] === 'true') console.log(`::error title=conformance gate::${message}`);
    console.error(message);
  }
}
if (!verdict.ok) process.exitCode = 1;
