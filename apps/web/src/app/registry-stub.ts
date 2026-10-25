/**
 * TODO(WP-integration): local registry stub shaped exactly like the FROZEN `@tsbs/registry` types (03 §B.7), so the shell
 * builds and tests before WP04 lands `packages/registry/data/*.json`. The integrator replaces the four exports below with
 * imports of `tokenizers.json`, `models.json`, `examples.json` and the notice strings of `licences.json`, and replaces
 * `CHIP_SPLITS` with the per-tokenizer "splits a character" flags of WP03's precomputed examples.
 *
 * Values follow the design text and `tools/oracle/manifest.json`; the chips and their split flags are generated from the
 * committed fixtures (examples.stub.json; registry-stub.test.ts asserts `chip.text === case.text` for every shipping
 * fixture, the rule `registry:check` enforces).
 */
import type { TokenizerId } from '@tsbs/core';
import type { ExampleChip, L10n, ModelRow, NoticeKey, TokenizerEntry } from '@tsbs/registry';
import examplesStub from './examples.stub.json';

const l10n = (en: string, zhTW: string, ja: string): L10n => ({ en, 'zh-TW': zhTW, ja });
const same = (text: string): L10n => l10n(text, text, text);

const sha = {
  o200k: '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d',
} as const;
/** Upstream hashes are WP04's (cross-checked against the manifest by registry:check); the stub repeats one placeholder. */
const PLACEHOLDER_SHA = sha.o200k;

const NO_DEFAULTS = {} as const;

/** The nine shipped tokenizers (OD-4) in the picker's lab order (05 §6). */
export const TOKENIZERS: readonly TokenizerEntry[] = [
  {
    id: 'openai-o200k_base',
    lab: 'openai',
    family: 'bytelevel-bpe',
    tier: 'primary',
    default: true,
    displayName: same('o200k_base (GPT-4o → GPT-5.x)'),
    vocabSize: 200019,
    rankCount: 199998,
    asset: { manifestId: 'openai-o200k_base', sourceFile: 'o200k_base.tiktoken', sourceSha256: sha.o200k },
    engine: { kind: 'bytelevel-bpe', pattern: 'o200k', idOffset: 0, maxTokenBytes: 128, bosId: null },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens'],
    fidelity: 'confirmed',
    fidelityNote: l10n(
      'Used by GPT-4o, GPT-4.1, GPT-4.5 and GPT-5.x; GPT-6 is inferred.',
      'GPT-4o、GPT-4.1、GPT-4.5 與 GPT-5.x 使用；GPT-6 為推定。',
      'GPT-4o、GPT-4.1、GPT-4.5、GPT-5.x が使用。GPT-6 は推定。',
    ),
    licence: 'openai-o200k_base',
    requiredNotices: [],
    fixture: 'fixtures/openai-o200k_base.json',
  },
  {
    id: 'openai-cl100k_base',
    lab: 'openai',
    family: 'bytelevel-bpe',
    tier: 'secondary',
    displayName: same('cl100k_base (GPT-4 / GPT-3.5)'),
    vocabSize: 100277,
    rankCount: 100256,
    asset: { manifestId: 'openai-cl100k_base', sourceFile: 'cl100k_base.tiktoken', sourceSha256: PLACEHOLDER_SHA },
    engine: { kind: 'bytelevel-bpe', pattern: 'cl100k', idOffset: 0, maxTokenBytes: 128, bosId: null },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens'],
    fidelity: 'confirmed',
    fidelityNote: l10n('Used by GPT-4 and GPT-3.5.', 'GPT-4 與 GPT-3.5 使用。', 'GPT-4 と GPT-3.5 が使用。'),
    licence: 'openai-cl100k_base',
    requiredNotices: [],
    fixture: 'fixtures/openai-cl100k_base.json',
  },
  {
    id: 'anthropic-claude-legacy',
    lab: 'anthropic',
    family: 'bytelevel-bpe',
    tier: 'primary',
    displayName: same('Claude 1/2 legacy (65k)'),
    vocabSize: 65000,
    rankCount: 64995,
    asset: { manifestId: 'anthropic-claude-legacy', sourceFile: 'claude.json', sourceSha256: PLACEHOLDER_SHA },
    engine: { kind: 'bytelevel-bpe', pattern: 'claude-legacy', idOffset: 5, maxTokenBytes: 128, bosId: null },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens', 'normalize'],
    fidelity: 'legacy',
    fidelityNote: l10n(
      'Claude 1/2-era vocabulary — not the Claude 3+ tokenizer.',
      'Claude 1/2 時期的詞彙表，不是 Claude 3 以後的分詞器。',
      'Claude 1/2 時代の語彙です。Claude 3 以降のトークナイザーではありません。',
    ),
    licence: 'anthropic-claude-legacy',
    requiredNotices: ['claude-legacy-disclaimer'],
    fixture: 'fixtures/anthropic-claude-legacy.json',
    byok: 'anthropic-count',
  },
  {
    id: 'google-gemma4',
    lab: 'google',
    family: 'spm-bpe',
    tier: 'primary',
    displayName: same('Gemma 4 (262k · Gemini 2.0 → 3.5)'),
    vocabSize: 262144,
    rankCount: 262144,
    asset: { manifestId: 'google-gemma4', sourceFile: 'tokenizer.json', sourceSha256: PLACEHOLDER_SHA },
    engine: {
      kind: 'spm-bpe',
      priority: 'merge-rank',
      fallbackOrder: 'before-merge',
      addDummyPrefix: false,
      escapeWhitespace: true,
      byteFirstId: 238,
      unkId: 3,
      bosId: 2,
      eosId: 1,
      padId: 0,
      userDefinedPolicy: 'atomic',
      controlPolicy: 'as-text-unless-match',
    },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens', 'addBos'],
    fidelity: 'confirmed',
    fidelityNote: l10n(
      'Gemma 4 tokenizer.json semantics; used by Gemini 2.0 to 3.5, newer Gemini models inferred.',
      'Gemma 4 tokenizer.json 語意；Gemini 2.0 到 3.5 使用，更新的 Gemini 模型為推定。',
      'Gemma 4 の tokenizer.json の仕様。Gemini 2.0〜3.5 が使用し、新しい Gemini は推定。',
    ),
    licence: 'google-gemma4',
    requiredNotices: [],
    fixture: 'fixtures/google-gemma4.json',
  },
  {
    id: 'google-gemma2',
    lab: 'google',
    family: 'spm-bpe',
    tier: 'secondary',
    displayName: same('Gemma 1/2 (256k · Gemini 1.x)'),
    vocabSize: 256000,
    rankCount: 256000,
    asset: { manifestId: 'google-gemma2', sourceFile: 'tokenizer.model', sourceSha256: PLACEHOLDER_SHA },
    engine: {
      kind: 'spm-bpe',
      priority: 'score',
      fallbackOrder: 'after-merge',
      addDummyPrefix: false,
      escapeWhitespace: true,
      byteFirstId: 217,
      unkId: 3,
      bosId: 2,
      eosId: 1,
      padId: 0,
      userDefinedPolicy: 'atomic',
      controlPolicy: 'as-text-unless-match',
    },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens', 'addBos'],
    fidelity: 'confirmed',
    fidelityNote: l10n(
      'Used by Gemini 1.0 and 1.5 (Vertex AI SDK).',
      'Gemini 1.0 與 1.5 使用（Vertex AI SDK）。',
      'Gemini 1.0 と 1.5 が使用（Vertex AI SDK）。',
    ),
    licence: 'google-gemma2',
    requiredNotices: ['gemma-notice', 'gemma-terms'],
    fixture: 'fixtures/google-gemma2.json',
  },
  {
    id: 'meta-llama4-muse',
    lab: 'meta',
    family: 'bytelevel-bpe',
    tier: 'primary',
    displayName: same('Llama 4 / Muse (202k)'),
    vocabSize: 202048,
    rankCount: 200000,
    asset: { manifestId: 'meta-muse-glimmer', sourceFile: 'tokenizer.json', sourceSha256: PLACEHOLDER_SHA },
    engine: { kind: 'bytelevel-bpe', pattern: 'o200k', idOffset: 0, maxTokenBytes: 113, bosId: 200000 },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens', 'addBos'],
    fidelity: 'confirmed',
    fidelityNote: l10n(
      'Used by Llama 4, Muse Glimmer and Muse Spark Open; Muse Wonder is inferred.',
      'Llama 4、Muse Glimmer 與 Muse Spark Open 使用；Muse Wonder 為推定。',
      'Llama 4、Muse Glimmer、Muse Spark Open が使用。Muse Wonder は推定。',
    ),
    licence: 'meta-muse-glimmer',
    requiredNotices: [],
    fixture: 'fixtures/meta-llama4-muse.json',
  },
  {
    id: 'meta-llama3',
    lab: 'meta',
    family: 'bytelevel-bpe',
    tier: 'secondary',
    displayName: same('Llama 3.x (128k)'),
    vocabSize: 128256,
    rankCount: 128000,
    asset: { manifestId: 'meta-llama3-model', sourceFile: 'tokenizer.model', sourceSha256: PLACEHOLDER_SHA },
    engine: { kind: 'bytelevel-bpe', pattern: 'llama3', idOffset: 0, maxTokenBytes: 128, bosId: 128000 },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens', 'addBos'],
    fidelity: 'confirmed',
    fidelityNote: l10n(
      'Used by Llama 3, 3.1, 3.2 and 3.3.',
      'Llama 3、3.1、3.2 與 3.3 使用。',
      'Llama 3、3.1、3.2、3.3 が使用。',
    ),
    licence: 'meta-llama3-model',
    requiredNotices: ['built-with-meta-llama-3', 'llama3-notice'],
    fixture: 'fixtures/meta-llama3.json',
  },
  {
    id: 'xai-grok2',
    lab: 'xai',
    family: 'bytelevel-bpe',
    tier: 'primary',
    displayName: same('Grok-2 (131k · Grok 2 / 2.5)'),
    vocabSize: 131072,
    rankCount: 130944,
    asset: { manifestId: 'xai-grok2', sourceFile: 'tokenizer.tok.json', sourceSha256: PLACEHOLDER_SHA },
    engine: { kind: 'bytelevel-bpe', pattern: 'grok2-v1', idOffset: 128, maxTokenBytes: 256, bosId: null },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens'],
    fidelity: 'confirmed',
    fidelityNote: l10n(
      'Used by Grok 2 and 2.5; Grok 3 and 4.x are inferred — verify with your own key.',
      'Grok 2 與 2.5 使用；Grok 3 與 4.x 為推定，可用你自己的金鑰驗證。',
      'Grok 2 と 2.5 が使用。Grok 3 と 4.x は推定で、ご自身のキーで確認できます。',
    ),
    licence: 'xai-grok2',
    requiredNotices: ['powered-by-xai', 'xai-materials-notice'],
    fixture: 'fixtures/xai-grok2.json',
    byok: 'xai-tokenize',
  },
  {
    id: 'xai-grok1',
    lab: 'xai',
    family: 'spm-bpe',
    tier: 'secondary',
    displayName: same('Grok-1 (131k, historical)'),
    vocabSize: 131072,
    rankCount: 131072,
    asset: { manifestId: 'xai-grok1', sourceFile: 'tokenizer.model', sourceSha256: PLACEHOLDER_SHA },
    engine: {
      kind: 'spm-bpe',
      priority: 'score',
      fallbackOrder: 'after-merge',
      addDummyPrefix: true,
      escapeWhitespace: true,
      byteFirstId: 69,
      unkId: 0,
      bosId: 1,
      eosId: 2,
      padId: 3,
      userDefinedPolicy: 'atomic',
      controlPolicy: 'as-text-unless-match',
    },
    defaults: NO_DEFAULTS,
    toggles: ['specialTokens', 'addBos'],
    fidelity: 'legacy',
    fidelityNote: l10n(
      'The open-weights Grok-1 tokenizer (2024), kept for history.',
      '開放權重的 Grok-1 分詞器（2024），保留作為歷史。',
      'オープンウェイトの Grok-1 トークナイザー（2024）。履歴として掲載。',
    ),
    licence: 'xai-grok1',
    requiredNotices: [],
    fixture: 'fixtures/xai-grok1.json',
  },
];

const CHECKED = '2026-10-25';
const TIKTOKEN_MODEL = 'https://github.com/openai/tiktoken/blob/main/tiktoken/model.py';
const ROW_NOTES: Readonly<Record<ModelRow['fidelity'], L10n>> = {
  confirmed: l10n('Documented by the vendor or its SDK.', '廠商或其 SDK 有明確記載。', 'ベンダーまたは SDK に記載。'),
  inferred: l10n('Inferred from public evidence.', '依公開資料推定。', '公開情報からの推定。'),
  legacy: l10n('Historical tokenizer.', '歷史分詞器。', '過去のトークナイザー。'),
  reconstruction: l10n('Community reconstruction.', '社群重建。', 'コミュニティによる再構成。'),
  unavailable: l10n(
    'No public tokenizer; use the live check.',
    '沒有公開的分詞器，請用即時檢查。',
    '公開トークナイザーなし。ライブチェックを使用。',
  ),
};

function row(
  model: string,
  lab: ModelRow['lab'],
  tokenizer: TokenizerId | null,
  fidelity: ModelRow['fidelity'],
  status: ModelRow['status'],
  evidenceUrl: string,
  byok?: NonNullable<ModelRow['byok']>,
): ModelRow {
  const base = { model, lab, tokenizer, fidelity, status, evidenceUrl, checkedOn: CHECKED, note: ROW_NOTES[fidelity] };
  return byok === undefined ? base : { ...base, byok };
}

/** Model → tokenizer rows (03 §B.7 initial rows). */
export const MODELS: readonly ModelRow[] = [
  row('GPT-5.x', 'openai', 'openai-o200k_base', 'confirmed', 'current', TIKTOKEN_MODEL),
  row('GPT-4o / 4.1 / 4.5 / o-series', 'openai', 'openai-o200k_base', 'confirmed', 'current', TIKTOKEN_MODEL),
  row(
    'GPT-6 Astra / GPT-6.1 Sol',
    'openai',
    'openai-o200k_base',
    'inferred',
    'current',
    'https://github.com/openai/tiktoken/issues/608',
  ),
  row('GPT-4 / GPT-3.5', 'openai', 'openai-cl100k_base', 'confirmed', 'previous', TIKTOKEN_MODEL),
  row(
    'Claude 1 / Claude 2',
    'anthropic',
    'anthropic-claude-legacy',
    'legacy',
    'historical',
    'https://www.npmjs.com/package/@anthropic-ai/tokenizer',
  ),
  row(
    'Claude 3 → 5.5 / Fable / Mythos',
    'anthropic',
    null,
    'unavailable',
    'current',
    'https://docs.anthropic.com/en/docs/build-with-claude/token-counting',
    'anthropic-count',
  ),
  row(
    'Gemini 2.0 → 3.5',
    'google',
    'google-gemma4',
    'confirmed',
    'current',
    'https://github.com/googleapis/python-genai',
  ),
  row(
    'Gemini 3.6 / 3.8 / 4 Argon',
    'google',
    'google-gemma4',
    'inferred',
    'current',
    'https://github.com/googleapis/python-genai',
  ),
  row(
    'Gemini 1.0 / 1.5',
    'google',
    'google-gemma2',
    'confirmed',
    'previous',
    'https://github.com/googleapis/python-aiplatform',
  ),
  row(
    'Llama 4 / Muse Glimmer / Muse Spark Open',
    'meta',
    'meta-llama4-muse',
    'confirmed',
    'current',
    'https://huggingface.co/meta-models/Muse-Glimmer-30B',
  ),
  row('Muse Wonder', 'meta', 'meta-llama4-muse', 'inferred', 'current', 'https://huggingface.co/meta-models'),
  row('Llama 3.x', 'meta', 'meta-llama3', 'confirmed', 'previous', 'https://github.com/meta-llama/llama-models'),
  row('Grok 2 / 2.5', 'xai', 'xai-grok2', 'confirmed', 'previous', 'https://huggingface.co/xai-org/grok-2'),
  row(
    'Grok 3 / 4.x',
    'xai',
    'xai-grok2',
    'inferred',
    'current',
    'https://docs.x.ai/docs/api-reference',
    'xai-tokenize',
  ),
  row('Grok-1', 'xai', 'xai-grok1', 'legacy', 'historical', 'https://github.com/xai-org/grok-1'),
];

/** The 19 example chips (05 §6), verbatim fixture texts. */
export const EXAMPLES: readonly ExampleChip[] = examplesStub.chips as readonly ExampleChip[];

/** Chips whose precomputed result has a partial-character token, per tokenizer (the chip's SVG hatch mark, 05 §6). */
export const CHIP_SPLITS: Readonly<Record<TokenizerId, readonly string[]>> = examplesStub.splits;

/** Short licence tags per `licence` key, for the picker (licences.json display strings, 03 §B.7). */
export const LICENCE_TAGS: Readonly<Record<string, string>> = {
  'openai-o200k_base': 'MIT',
  'openai-cl100k_base': 'MIT',
  'anthropic-claude-legacy': 'MIT',
  'google-gemma4': 'Apache-2.0',
  'google-gemma2': 'Apache-2.0 + Gemma Terms',
  'meta-muse-glimmer': 'Apache-2.0',
  'meta-llama3-model': 'Llama 3 Community License',
  'xai-grok2': 'xAI Community License',
  'xai-grok1': 'Apache-2.0',
};

/** A notice from licences.json: legal strings are verbatim in every locale (`legal: true`), the rest are localised. */
export interface NoticeText {
  readonly legal: boolean;
  readonly text: L10n;
  readonly href?: string;
}

/** Notice strings (licences.json display strings, 03 §B.7). */
export const NOTICES: Readonly<Record<NoticeKey, NoticeText>> = {
  'powered-by-xai': { legal: true, text: same('Powered by xAI') },
  'xai-materials-notice': {
    legal: true,
    text: same(
      'This product includes materials licensed under the xAI Community License. All rights reserved. Copyright © xAI 2026.',
    ),
    href: '/licenses/xai-grok2/LICENSE',
  },
  'built-with-meta-llama-3': { legal: true, text: same('Built with Meta Llama 3') },
  'llama3-notice': {
    legal: true,
    text: same(
      'Meta Llama 3 is licensed under the Meta Llama 3 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.',
    ),
    href: '/licenses/meta-llama3-model/LICENSE',
  },
  'gemma-notice': {
    legal: true,
    text: same('Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms'),
    href: 'https://ai.google.dev/gemma/terms',
  },
  'gemma-terms': {
    legal: false,
    text: l10n(
      'Use of this tokenizer is subject to the Gemma Terms of Use and its Prohibited Use Policy.',
      '使用此分詞器須遵守 Gemma 使用條款及其禁止使用政策。',
      'このトークナイザーの使用には Gemma 利用規約と禁止用途ポリシーが適用されます。',
    ),
    href: 'https://ai.google.dev/gemma/prohibited_use_policy',
  },
  'claude-legacy-disclaimer': {
    legal: false,
    text: l10n(
      'This is the Claude 1/2-era vocabulary, not the Claude 3+ tokenizer; counts for current Claude models need the live check.',
      '這是 Claude 1/2 時期的詞彙表，不是 Claude 3 以後的分詞器；目前 Claude 模型的詞元數需要用即時檢查計算。',
      'これは Claude 1/2 時代の語彙で、Claude 3 以降のトークナイザーではありません。現行の Claude のトークン数はライブチェックで確認してください。',
    ),
  },
  'tiktoken-rank-file-basis': {
    legal: false,
    text: l10n(
      'The .tiktoken rank files carry no licence of their own; they are redistributed on the basis of the MIT-licensed tiktoken project.',
      '.tiktoken rank 檔案本身沒有授權聲明，本網站依 MIT 授權的 tiktoken 專案重新散布。',
      '.tiktoken の rank ファイル自体にはライセンス表記がなく、MIT ライセンスの tiktoken プロジェクトに基づいて再配布しています。',
    ),
  },
  'modified-asset': {
    legal: false,
    text: l10n(
      'Vocabularies are converted to a compact container; their contents are unchanged.',
      '詞彙表已轉換為精簡的容器格式，內容未經更動。',
      '語彙はコンパクトな形式に変換していますが、内容は変更していません。',
    ),
  },
};

/** The default tokenizer (exactly one `default: true`). */
export const DEFAULT_TOKENIZER: TokenizerId =
  TOKENIZERS.find((entry) => entry.default === true)?.id ?? 'openai-o200k_base';

/** The entry of `id` (every TokenizerId has one). */
export function tokenizerEntry(id: TokenizerId): TokenizerEntry {
  const entry = TOKENIZERS.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`no registry entry for ${id}`);
  return entry;
}
