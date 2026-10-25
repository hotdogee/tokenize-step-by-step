/**
 * The issue record every registry rule reports. A rule id names the rule (03 §B.7 lists them) so the negative tests can
 * assert that exactly the intended rule fired; `where` is a JSON-ish path into the data ("tokenizers[openai-o200k_base]").
 */

/** Rule ids, one per family of checks in 03 §B.7 plus the consistency rules this package adds. */
export type RuleId =
  | 'json-schema'
  | 'tokenizer-set'
  | 'tokenizer-default'
  | 'tokenizer-identity'
  | 'tokenizer-sizes'
  | 'tokenizer-toggles'
  | 'byok-panel'
  | 'manifest'
  | 'fixture'
  | 'fixture-data'
  | 'licence'
  | 'notice'
  | 'legal-notice'
  | 'notice-link'
  | 'model-rows'
  | 'model-coverage'
  | 'examples'
  | 'byok-config'
  | 'l10n-placeholders'
  | 'l10n-glossary'
  | 'l10n-punctuation'
  | 'built-asset';

export interface CheckIssue {
  readonly rule: RuleId;
  readonly where: string;
  readonly message: string;
}

/** Callback the rules use to record an issue. */
export type Report = (rule: RuleId, where: string, message: string) => void;
