/**
 * `models.json` rules (03 §B.7, PD-6, AD-23, AD-38). The row-level iff rules (null tokenizer ⇔ `unavailable` fidelity,
 * null tokenizer ⇒ `byok`) and the required `evidenceUrl`/`checkedOn` live in the FROZEN `ModelRowSchema`; these rules add
 * the cross-file ones: rows point at known tokenizers of the same lab, panels match labs, `reconstruction` stays reserved,
 * and every shipped tokenizer is backed by at least one `confirmed` or `legacy` row.
 */
import type { ModelRow, TokenizerEntry } from '../schema.ts';
import type { Report } from './report.ts';
import { BYOK_LAB, at } from './tokenizers.ts';

/** Rules on the rows themselves. */
function checkRows(models: readonly ModelRow[], tokenizers: readonly TokenizerEntry[], report: Report): void {
  const seen = new Set<string>();
  for (const row of models) {
    const where = `models[${row.model}]`;
    if (seen.has(row.model)) report('model-rows', where, 'duplicate model name');
    seen.add(row.model);
    if (row.tokenizer !== null) {
      const entry = tokenizers.find((t) => t.id === row.tokenizer);
      if (entry === undefined) report('model-rows', where, `tokenizer ${row.tokenizer} is not in tokenizers.json`);
      else if (entry.lab !== row.lab)
        report('model-rows', where, `lab ${row.lab} differs from the tokenizer's lab ${entry.lab}`);
    }
    if (row.byok !== undefined && BYOK_LAB[row.byok] !== row.lab) {
      report('model-rows', where, `byok ${row.byok} cannot check a ${row.lab} model`);
    }
    if (row.fidelity === 'reconstruction') {
      report('model-rows', where, "fidelity 'reconstruction' is reserved for the Phase-2 ctok lane (AD-23)");
    }
  }
}

/** Every non-withdrawn tokenizer has a `confirmed` or `legacy` row; no tokenizer claims `reconstruction` in v1. */
function checkCoverage(models: readonly ModelRow[], tokenizers: readonly TokenizerEntry[], report: Report): void {
  for (const entry of tokenizers) {
    if (entry.fidelity === 'reconstruction') {
      report('model-rows', at(entry), "fidelity 'reconstruction' is reserved for the Phase-2 ctok lane (AD-23)");
    }
    if (entry.withdrawn === true) continue;
    const backed = models.some(
      (m) => m.tokenizer === entry.id && (m.fidelity === 'confirmed' || m.fidelity === 'legacy'),
    );
    if (!backed) report('model-coverage', at(entry), 'no confirmed or legacy model row maps to this tokenizer');
  }
}

/** All model-row rules. */
export function checkModels(models: readonly ModelRow[], tokenizers: readonly TokenizerEntry[], report: Report): void {
  checkRows(models, tokenizers, report);
  checkCoverage(models, tokenizers, report);
}
