/**
 * `node scripts/reverify.ts` — body of the monthly "Re-verify inferred mappings" issue (logic in `lib/reverify.ts`).
 *
 *   node scripts/reverify.ts [--models packages/registry/data/models.json] [--byok packages/registry/data/byok.json]
 *                            [--today YYYY-MM-DD] [--out issue.md]
 *
 * Prints the body (or writes it to `--out`) and, inside GitHub Actions, sets the step output `stale=<rows + byok>` so
 * `reverify.yml` opens or updates the issue only when something is due. Uses Node built-ins only (no install needed).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { renderIssue, staleByok, staleModelRows } from './lib/reverify.ts';

const fromRoot = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const { values } = parseArgs({
  options: {
    models: { type: 'string', default: fromRoot('packages/registry/data/models.json') },
    byok: { type: 'string', default: fromRoot('packages/registry/data/byok.json') },
    today: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    out: { type: 'string' },
  },
});

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
if (!existsSync(values.models)) console.warn(`reverify: ${values.models} does not exist yet (WP04); nothing to list.`);
const stale = existsSync(values.models) ? staleModelRows(readJson(values.models), values.today) : [];
const byokAge = existsSync(values.byok) ? staleByok(readJson(values.byok), values.today) : null;
const due = stale.length + (byokAge === null ? 0 : 1);
const body = renderIssue(stale, byokAge, values.today);

if (values.out === undefined) console.log(body);
else writeFileSync(values.out, body, 'utf8');
console.log(
  `reverify: ${String(stale.length)} stale models.json rows; byok.json ${byokAge === null ? 'current' : 'stale'}.`,
);
const output = process.env['GITHUB_OUTPUT'];
if (output !== undefined && output !== '') appendFileSync(output, `stale=${String(due)}\n`);
