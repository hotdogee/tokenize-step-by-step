/**
 * `byok.json` rules (AD-24, OD-5, 05 §13): the default auth scheme is offered, model lists are unique, frame tokens match
 * the generation (7 / 11 / 6, +2 on 5.5), the xAI default is listed, and no retired xAI slug (2026-05-15) is offered.
 */
import type { ByokConfig } from '../schema.ts';
import type { Report } from './report.ts';

/** Per-message frame tokens by tokenizer generation (research §3.2; ctok fixtures' `frame.count`). */
export const FRAME_TOKENS = { v3: 7, 'v4.7': 11, 'v4.8': 6, 'v5.5': 8 } as const;

/** xAI slugs retired on 2026-05-15 (research §3.5); the panel must never offer them. */
export const RETIRED_XAI_MODELS: readonly RegExp[] = [
  /^grok-3(?:$|-)/,
  /^grok-4-0709$/,
  /^grok-4-fast/,
  /^grok-4-1-fast/,
  /^grok-code-fast-1$/,
];

const duplicates = (values: readonly string[]): string[] => values.filter((v, i) => values.indexOf(v) !== i);

/** All BYOK rules. */
export function checkByok(byok: ByokConfig, report: Report): void {
  const { anthropic, xai } = byok;
  if (!anthropic.authSchemes.includes(anthropic.defaultAuth)) {
    report('byok-config', 'byok.anthropic', `defaultAuth ${anthropic.defaultAuth} is not among authSchemes`);
  }
  for (const d of duplicates(anthropic.authSchemes))
    report('byok-config', 'byok.anthropic', `duplicate auth scheme ${d}`);
  for (const d of duplicates(anthropic.models.map((m) => m.id)))
    report('byok-config', 'byok.anthropic', `duplicate model ${d}`);
  for (const model of anthropic.models) {
    if (!/^claude-[a-z]+-\d+(?:-\d+)?$/.test(model.id)) {
      report('byok-config', `byok.anthropic[${model.id}]`, 'model ids are bare API ids without date suffixes');
    }
    const expected = FRAME_TOKENS[model.generation];
    if (model.frameTokens !== expected) {
      report(
        'byok-config',
        `byok.anthropic[${model.id}]`,
        `generation ${model.generation} has ${String(expected)} frame tokens`,
      );
    }
  }
  const xaiIds = xai.models.map((m) => m.id);
  for (const d of duplicates(xaiIds)) report('byok-config', 'byok.xai', `duplicate model ${d}`);
  if (!xaiIds.includes(xai.defaultModel))
    report('byok-config', 'byok.xai', `defaultModel ${xai.defaultModel} is not listed`);
  for (const id of [...xaiIds, xai.defaultModel]) {
    if (RETIRED_XAI_MODELS.some((re) => re.test(id)))
      report('byok-config', 'byok.xai', `${id} was retired on 2026-05-15`);
  }
}
