/**
 * Stand-in for a root script whose implementation belongs to a later work package (02 §6).
 *
 *   node scripts/pending.ts <script> <WP> [--skip]
 *
 * With `--skip` (only where the design lets WP00 skip: registry:check, unicode:check, e2e, lhci) it prints
 * "skipped in WP00" and exits 0; otherwise it fails loudly with "not implemented until <WP>" and exits 1.
 */
import process from 'node:process';

const [script, wp, flag] = process.argv.slice(2);
if (script === undefined || wp === undefined || (flag !== undefined && flag !== '--skip')) {
  console.error('usage: node scripts/pending.ts <script> <WP> [--skip]');
  process.exit(2);
}
if (flag === '--skip') {
  console.log(`${script}: skipped in WP00 — implemented by ${wp}.`);
} else {
  console.error(`${script}: not implemented until ${wp}.`);
  process.exitCode = 1;
}
