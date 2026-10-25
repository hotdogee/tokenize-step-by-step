/**
 * The monthly "Re-verify inferred mappings" issue (AD-14, 06 §4 `reverify.yml`, 06 §7 pre-launch list): `models.json` rows
 * (and `byok.json`) whose `checkedOn` is more than 90 days old, plus the research §9 watch list as a checklist.
 */

/** A registry row whose evidence is due for re-verification. */
export interface StaleEntry {
  readonly model: string;
  readonly lab: string;
  readonly tokenizer: string | null;
  readonly fidelity: string;
  readonly checkedOn: string;
  readonly evidenceUrl: string;
  readonly ageDays: number;
}

/** Re-verify after this many days (AD-14). */
export const MAX_AGE_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (ISO dates, UTC). */
export function daysBetween(from: string, to: string): number {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to))
    throw new Error(`not an ISO date: "${ISO_DATE.test(from) ? to : from}"`);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The rows of `models.json`: a top-level array (03 §B.7) or `{ models: [...] }`. */
function rowsOf(models: unknown): unknown[] {
  if (Array.isArray(models)) return models;
  if (typeof models === 'object' && models !== null && Array.isArray((models as Record<string, unknown>)['models']))
    return (models as Record<string, unknown[]>)['models'] ?? [];
  throw new Error('models.json is neither an array of rows nor { "models": [...] }');
}

const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  return typeof value === 'string' ? value : '';
};

/** Rows whose `checkedOn` is more than `maxAgeDays` before `today`, inferred rows first, then oldest first. */
export function staleModelRows(models: unknown, today: string, maxAgeDays = MAX_AGE_DAYS): StaleEntry[] {
  const stale: StaleEntry[] = [];
  for (const raw of rowsOf(models)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const checkedOn = text(row, 'checkedOn');
    const ageDays = daysBetween(checkedOn, today);
    if (ageDays <= maxAgeDays) continue;
    stale.push({
      model: text(row, 'model'),
      lab: text(row, 'lab'),
      tokenizer: typeof row['tokenizer'] === 'string' ? row['tokenizer'] : null,
      fidelity: text(row, 'fidelity'),
      checkedOn,
      evidenceUrl: text(row, 'evidenceUrl'),
      ageDays,
    });
  }
  const rank = (entry: StaleEntry): number => (entry.fidelity === 'inferred' ? 0 : 1);
  return stale.sort((a, b) => rank(a) - rank(b) || b.ageDays - a.ageDays || a.model.localeCompare(b.model));
}

/** Age of `byok.json`'s `checkedOn` when it is stale, else null. */
export function staleByok(byok: unknown, today: string, maxAgeDays = MAX_AGE_DAYS): number | null {
  const checkedOn =
    typeof byok === 'object' && byok !== null ? (byok as Record<string, unknown>)['checkedOn'] : undefined;
  if (typeof checkedOn !== 'string') return null;
  const age = daysBetween(checkedOn, today);
  return age > maxAgeDays ? age : null;
}

/** The research §9 watch list, as 06 §7 phrases it. */
export const WATCH_LIST = [
  'OpenAI: `tiktoken/model.py` and issue #608 / PR #616 for a `gpt-6` prefix (GPT-6 Astra / 6.1 Sol).',
  'Google: `python-genai/_local_tokenizer_loader.py` for `gemini-3.6/3.8/4-*` entries (Gemini 4 Argon).',
  'Meta: Meta Model API docs / HF `meta-models` for a Muse Wonder tokenizer statement.',
  'xAI: `xai-org` on HF/GitHub for a Grok 3/4 tokenizer file; `/v1/tokenize-text` docs example still reproduces with Grok-2; model slugs in `byok.json`.',
  'Anthropic: current `anthropic-version`, `Authorization: Bearer` primary, still-callable v3-reference models (Opus 4.6 / Sonnet 4.6) in `byok.json`.',
] as const;

/** The issue title (one open issue at a time; the workflow comments on an existing one). */
export const ISSUE_TITLE = 'Re-verify inferred mappings';

/** Markdown body of the issue. */
export function renderIssue(stale: readonly StaleEntry[], byokAgeDays: number | null, today: string): string {
  const lines = [
    `Monthly re-verification (${today}; AD-14, docs/design/06-quality-ci-deploy.md §7). Rows below have \`checkedOn\` older than ${String(MAX_AGE_DAYS)} days: re-check the evidence, then update \`checkedOn\` (and \`fidelity\` if the status changed) in \`packages/registry/data/models.json\`.`,
    '',
  ];
  if (stale.length > 0) {
    lines.push(
      '| Model | Lab | Tokenizer | Fidelity | Checked on | Age (days) | Evidence |',
      '|---|---|---|---|---|---|---|',
    );
    for (const row of stale)
      lines.push(
        `| ${row.model} | ${row.lab} | ${row.tokenizer ?? '—'} | ${row.fidelity} | ${row.checkedOn} | ${String(row.ageDays)} | ${row.evidenceUrl === '' ? '—' : `<${row.evidenceUrl}>`} |`,
      );
    lines.push('');
  }
  if (byokAgeDays !== null)
    lines.push(
      `\`byok.json\` was last checked ${String(byokAgeDays)} days ago: re-check endpoints, headers, \`anthropic-version\` and model slugs.`,
      '',
    );
  lines.push('Watch list (research §9):', '', ...WATCH_LIST.map((item) => `- [ ] ${item}`), '');
  return lines.join('\n');
}
