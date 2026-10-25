/**
 * registry:check rules (03 §B.7): the committed data passes, and every rule fails on a minimal mutation of it (negative
 * tests). Each mutation starts from a deep copy of the real data files and the real oracle manifest; the fixtures are
 * shared read-only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { BuiltAsset, CheckIssue, RegistryInput, RuleId } from '../src/check.ts';
import { checkRegistry } from '../src/check.ts';
import type { LicencesFile, RegistryStrings } from '../src/data-schema.ts';
import type { ByokConfig, ExampleChip, ModelRow, TokenizerEntry } from '../src/schema.ts';
import { loadRegistryInput } from '../scripts/load-inputs.ts';

/** Mutable, typed view of a deep copy of the inputs. */
interface Draft {
  tokenizers: TokenizerEntry[];
  models: ModelRow[];
  licences: LicencesFile;
  examples: ExampleChip[];
  byok: ByokConfig;
  strings: RegistryStrings;
  manifest: { assets: Array<{ id: string; shipIntent: string }> };
  fixtures: Map<string, unknown>;
  built: Map<string, BuiltAsset> | null;
}

let base: RegistryInput;

beforeAll(() => {
  base = { ...loadRegistryInput(), built: null };
});

/** Runs the check on a mutated copy of the real inputs. */
function check(mutate: (draft: Draft) => void = () => undefined): CheckIssue[] {
  const files = structuredClone(base.files);
  const draft: Draft = {
    ...(files as unknown as Omit<Draft, 'manifest' | 'fixtures' | 'built'>),
    manifest: structuredClone(base.manifest) as Draft['manifest'],
    fixtures: new Map(base.fixtures),
    built: null,
  };
  mutate(draft);
  return checkRegistry({
    files: {
      tokenizers: draft.tokenizers,
      models: draft.models,
      licences: draft.licences,
      examples: draft.examples,
      byok: draft.byok,
      strings: draft.strings,
    },
    manifest: draft.manifest,
    fixtures: draft.fixtures,
    licenceFiles: base.licenceFiles,
    built: draft.built,
  });
}

const rules = (issues: readonly CheckIssue[]): RuleId[] => [...new Set(issues.map((i) => i.rule))].sort();
/** Writable, index-signature view of a (readonly) data object, for mutations the types forbid. */
const w = (value: object): Record<string, unknown> => value as Record<string, unknown>;
const tok = (d: Draft, id: string): TokenizerEntry => d.tokenizers.find((t) => t.id === id)!;
const row = (d: Draft, model: string): ModelRow => d.models.find((m) => m.model === model)!;
const chip = (d: Draft, key: string): ExampleChip => d.examples.find((c) => c.key === key)!;

/** Asserts the mutation produces issues of exactly these rules. */
function expectRules(mutate: (draft: Draft) => void, expected: readonly RuleId[]): CheckIssue[] {
  const issues = check(mutate);
  expect(rules(issues), JSON.stringify(issues, null, 1)).toEqual([...expected].sort());
  return issues;
}

/** META that agrees with an entry, as the converter would write it. */
function metaFor(entry: TokenizerEntry): Record<string, unknown> {
  const {
    kind: _kind,
    pattern: _pattern,
    maxTokenBytes: _max,
    ...shared
  } = entry.engine as unknown as Record<string, unknown>;
  return {
    ...shared,
    ...(entry.engine.kind === 'spm-bpe' ? {} : { maxPieceBytes: entry.engine.maxTokenBytes }),
    tokenizerId: entry.id,
    family: entry.family,
    upstream: { assetId: entry.asset.manifestId, file: entry.asset.sourceFile, sha256: entry.asset.sourceSha256 },
    counts: { pieces: entry.rankCount, specials: 0 },
    unusedCount: 0,
  };
}

describe('the committed registry', () => {
  it('passes every rule', () => {
    expect(check()).toEqual([]);
  });

  it('passes the built-asset rules against agreeing META', () => {
    expect(check((d) => (d.built = new Map(d.tokenizers.map((t) => [t.id, { meta: metaFor(t) }]))))).toEqual([]);
  });
});

describe('tokenizers.json', () => {
  it('needs every TokenizerId exactly once', () => {
    // Removing Grok-1 also orphans its manifest asset, licence key and model row.
    expectRules((d) => d.tokenizers.pop(), ['tokenizer-set', 'manifest', 'licence', 'model-rows']);
    expectRules((d) => d.tokenizers.push(structuredClone(tok(d, 'xai-grok1'))), ['tokenizer-set']);
  });

  it('needs exactly one default, primary and not withdrawn', () => {
    expectRules((d) => (tok(d, 'google-gemma4').default = true), ['tokenizer-default']);
    expectRules((d) => delete tok(d, 'openai-o200k_base').default, ['tokenizer-default']);
    expectRules((d) => (tok(d, 'openai-o200k_base').withdrawn = true), ['tokenizer-default']);
  });

  it('rejects a missing locale in a display name or fidelity note', () => {
    const issues = expectRules((d) => delete w(tok(d, 'xai-grok2').fidelityNote)['zh-TW'], ['json-schema']);
    expect(issues[0]?.where).toContain('fidelityNote');
    expectRules((d) => (w(tok(d, 'meta-llama3').displayName)['ja'] = ''), ['json-schema']);
  });

  it('checks identity fields', () => {
    expectRules(
      (d) => (tok(d, 'openai-cl100k_base').fixture = 'fixtures/openai-o200k_base.json'),
      ['tokenizer-identity', 'fixture', 'fixture-data'],
    );
    expectRules((d) => (tok(d, 'openai-cl100k_base').family = 'spm-bpe'), ['tokenizer-identity', 'fixture']);
  });

  it('checks the id-space arithmetic', () => {
    expectRules((d) => (tok(d, 'google-gemma4').rankCount = 514906), ['tokenizer-sizes']);
    expectRules(
      (d) => {
        const engine = tok(d, 'meta-llama3').engine;
        if (engine.kind === 'bytelevel-bpe') engine.bosId = 5;
      },
      ['tokenizer-sizes'],
    );
  });

  it('only offers toggles the engine can honour', () => {
    expectRules((d) => (tok(d, 'openai-o200k_base').toggles = ['specialTokens', 'addBos']), ['tokenizer-toggles']);
    expectRules((d) => (tok(d, 'xai-grok2').toggles = ['specialTokens', 'normalize']), ['tokenizer-toggles']);
    expectRules((d) => (tok(d, 'meta-llama3').defaults = { trace: false }), ['tokenizer-toggles']);
  });

  it('pairs a tokenizer-level live check with its own lab', () => {
    expectRules((d) => (tok(d, 'xai-grok2').byok = 'anthropic-count'), ['byok-panel']);
  });
});

describe('oracle manifest cross-references', () => {
  it('fails when asset.sourceSha256 differs from the manifest', () => {
    expectRules((d) => (tok(d, 'openai-o200k_base').asset.sourceSha256 = '0'.repeat(64)), ['manifest', 'fixture']);
  });

  it('fails when the source file is not a vocab file of the asset', () => {
    expectRules((d) => (tok(d, 'xai-grok2').asset.sourceFile = 'LICENSE'), ['manifest']);
  });

  it('fails when a ship asset has no tokenizer entry', () => {
    expectRules(
      (d) => (d.manifest.assets.find((a) => a.id === 'meta-llama4-model')!.shipIntent = 'ship'),
      ['manifest'],
    );
  });

  it('fails when a tokenizer names an asset that is not shipIntent: ship', () => {
    expectRules(
      (d) => (d.manifest.assets.find((a) => a.id === 'google-gemma2')!.shipIntent = 'oracle-only'),
      ['manifest'],
    );
  });

  it('lets a withdrawn tokenizer keep a non-ship asset', () => {
    expectRules((d) => {
      d.manifest.assets.find((a) => a.id === 'xai-grok2')!.shipIntent = 'withdrawn';
      tok(d, 'xai-grok2').withdrawn = true;
    }, []);
  });
});

describe('fixtures', () => {
  it('fails when a fixture is missing or its header disagrees', () => {
    expectRules((d) => d.fixtures.delete('fixtures/xai-grok1.json'), ['fixture']);
    expectRules(
      (d) => {
        const fixture = d.fixtures.get('fixtures/google-gemma2.json') as Record<string, unknown>;
        d.fixtures.set('fixtures/google-gemma2.json', { ...fixture, vocabAsset: 'google-gemma3-spiece' });
      },
      ['fixture'],
    );
  });

  it('pins idOffset/rankCount, byteFirstId and the dummy prefix to the fixture data', () => {
    expectRules(
      (d) => {
        const engine = tok(d, 'xai-grok2').engine;
        if (engine.kind === 'bytelevel-bpe') engine.idOffset = 0;
      },
      ['fixture-data'],
    );
    expectRules(
      (d) => {
        const engine = tok(d, 'google-gemma2').engine;
        if (engine.kind === 'spm-bpe') engine.byteFirstId = 238;
      },
      ['fixture-data'],
    );
    expectRules(
      (d) => {
        const engine = tok(d, 'xai-grok1').engine;
        if (engine.kind === 'spm-bpe') engine.addDummyPrefix = false;
      },
      ['fixture-data'],
    );
  });
});

describe('models.json', () => {
  it('fails when a shipped tokenizer lacks a confirmed or legacy row', () => {
    expectRules((d) => (d.models = d.models.filter((m) => m.tokenizer !== 'xai-grok1')), ['model-coverage']);
    expectRules((d) => (row(d, 'Grok-1').fidelity = 'inferred'), ['model-coverage']);
  });

  it('fails when an inferred row lacks evidenceUrl or checkedOn', () => {
    const noUrl = expectRules((d) => delete (row(d, 'GPT-6 Astra') as Partial<ModelRow>).evidenceUrl, ['json-schema']);
    expect(noUrl[0]?.where).toMatch(/^models\.\d+\.evidenceUrl$/);
    const noDate = expectRules((d) => delete (row(d, 'Muse Wonder') as Partial<ModelRow>).checkedOn, ['json-schema']);
    expect(noDate[0]?.where).toMatch(/^models\.\d+\.checkedOn$/);
    expectRules((d) => (row(d, 'Gemini 4 Argon').checkedOn = '25 Oct 2026'), ['json-schema']);
  });

  it('rejects a null-tokenizer row without byok, or with a fidelity other than unavailable (and vice versa)', () => {
    const noByok = expectRules((d) => delete row(d, 'Claude Opus 5.5').byok, ['json-schema']);
    expect(noByok[0]?.where).toMatch(/\.byok$/);
    expectRules((d) => (row(d, 'Claude Sonnet 5.5').fidelity = 'inferred'), ['json-schema']);
    expectRules((d) => (row(d, 'GPT-4o').fidelity = 'unavailable'), ['json-schema']);
  });

  it('checks the cross-file row rules', () => {
    expectRules((d) => (row(d, 'GPT-4').lab = 'meta'), ['model-rows']);
    expectRules((d) => (row(d, 'Grok 4.7').byok = 'anthropic-count'), ['model-rows']);
    expectRules((d) => (row(d, 'GPT-6.1 Sol').fidelity = 'reconstruction'), ['model-rows']);
    expectRules((d) => d.models.push(structuredClone(row(d, 'GPT-4o'))), ['model-rows']);
  });
});

describe('licences.json', () => {
  it('fails when a required notice is missing from any locale', () => {
    const issues = expectRules((d) => delete w(d.licences.notices['powered-by-xai']!.body)['ja'], ['json-schema']);
    expect(issues[0]?.where).toBe('licences.notices.powered-by-xai.body.ja');
    expectRules((d) => delete w(d.licences.notices)['gemma-notice'], ['notice']);
  });

  it('requires verbatim text on legal notices only', () => {
    expectRules((d) => delete d.licences.notices['built-with-meta-llama-3']!.verbatim, ['notice']);
    expectRules((d) => (d.licences.notices['modified-asset']!.verbatim = 'x'), ['notice']);
  });

  it('requires the notices a licence demands, worded as the manifest quotes them', () => {
    expectRules((d) => (tok(d, 'xai-grok2').requiredNotices = ['xai-materials-notice']), ['legal-notice']);
    expectRules((d) => (tok(d, 'meta-llama3').requiredNotices = ['built-with-meta-llama-3']), ['legal-notice']);
    expectRules(
      (d) => (tok(d, 'google-gemma2').requiredNotices = ['gemma-notice', 'modified-asset']),
      ['legal-notice'],
    );
    expectRules(
      (d) =>
        (d.licences.notices['xai-materials-notice']!.verbatim =
          'This product includes materials licensed under the xAI Community License.'),
      ['legal-notice'],
    );
    expectRules((d) => (d.licences.notices['powered-by-xai']!.verbatim = 'Powered by XAI'), ['legal-notice']);
    expectRules(
      (d) =>
        (d.licences.notices['llama3-notice']!.verbatim =
          'Meta Llama 3 is licensed under the Meta Llama 3 Community License.'),
      ['legal-notice'],
    );
  });

  it('checks required-notice keys and links', () => {
    expectRules(
      (d) => (tok(d, 'openai-o200k_base').requiredNotices = ['tiktoken-rank-file-basis', 'tiktoken-rank-file-basis']),
      ['notice'],
    );
    expectRules(
      (d) =>
        (d.licences.notices['gemma-terms']!.links = [
          { href: '/licenses/google-gemma2/missing.txt', label: { en: 'a', 'zh-TW': 'a', ja: 'a' } },
        ]),
      ['notice-link'],
    );
  });

  it('checks licence keys, SPDX and the MODIFIED template', () => {
    expectRules((d) => (tok(d, 'xai-grok1').licence = 'xai-grok1-typo'), ['licence']);
    expectRules((d) => (d.licences.licences['meta-muse-glimmer']!.spdx = 'MIT'), ['licence']);
    expectRules((d) => (d.licences.modifiedTemplate = 'Converted from {file} on {date}.'), ['licence']);
  });
});

describe('examples.json', () => {
  it('fails when a chip names a case missing from a shipping fixture', () => {
    expectRules((d) => (chip(d, 'cjk-saba').fixtureCase = 'no-such-case'), ['examples']);
  });

  it('fails when chip.text differs from case.text, even invisibly', () => {
    expectRules((d) => (chip(d, 'zh-tw-renao').text = '熱鬧 '), ['examples']);
    expectRules((d) => (chip(d, 'emoji-heart-vs16').text = '❤'), ['examples']); // VS16 dropped
    expectRules((d) => (chip(d, 'en-contraction-code').text = "I'm here\r\n\r\n code();"), ['examples']);
  });

  it('ignores the fixture of a withdrawn tokenizer', () => {
    expectRules(
      (d) => {
        tok(d, 'xai-grok2').withdrawn = true;
        d.fixtures.delete('fixtures/xai-grok2.json');
      },
      ['fixture'],
    );
  });

  it('keeps the default example first and labels exactly the paragraph chips', () => {
    expectRules((d) => d.examples.reverse(), ['examples']);
    expectRules((d) => delete chip(d, 'ja-paragraph').label, ['examples']);
    expectRules((d) => (chip(d, 'cjk-turtle').label = { en: 'turtle', 'zh-TW': '龜', ja: '亀' }), ['examples']);
    expectRules((d) => ((chip(d, 'zh-date') as { lang: string }).lang = 'zh-TW'), ['json-schema']);
  });
});

describe('byok.json', () => {
  it('validates the frozen literals', () => {
    expectRules((d) => ((d.byok.anthropic as { defaultAuth: string }).defaultAuth = 'x-api-key'), ['json-schema']);
    expectRules((d) => (d.byok.anthropic.version = 'latest'), ['json-schema']);
    expectRules((d) => delete (d.byok as Partial<ByokConfig>).checkedOn, ['json-schema']);
  });

  it('checks the cross-field rules', () => {
    expectRules((d) => (d.byok.anthropic.authSchemes = ['x-api-key']), ['byok-config']);
    expectRules((d) => (d.byok.xai.defaultModel = 'grok-3'), ['byok-config']);
    expectRules(
      (d) => (d.byok.xai.models = [...d.byok.xai.models, { id: 'grok-4-fast-reasoning', label: 'x' }]),
      ['byok-config'],
    );
    expectRules(
      (d) => (d.byok.anthropic.models = d.byok.anthropic.models.map((m) => ({ ...m, frameTokens: 6 }))),
      ['byok-config'],
    );
    expectRules(
      (d) =>
        (d.byok.anthropic.models = [{ id: 'claude-opus-4-6-20260101', label: 'x', frameTokens: 7, generation: 'v3' }]),
      ['byok-config'],
    );
  });
});

describe('strings.json and localization', () => {
  it('fails when marker SR text is missing in a locale or entirely', () => {
    expectRules((d) => delete w(d.strings.marker.zeroWidthDummy)['ja'], ['json-schema']);
    expectRules((d) => delete w(d.strings.marker)['splits'], ['json-schema']);
  });

  it('requires the same placeholders in every locale, and the template placeholders', () => {
    expectRules((d) => (w(d.strings.marker.byteFallback)['zh-TW'] = '位元組回退詞片'), ['l10n-placeholders']);
    expectRules(
      (d) => (w(d.strings.marker)['combining'] = { en: 'combining mark', 'zh-TW': '組合記號', ja: '結合文字' }),
      ['l10n-placeholders'],
    );
  });

  it('enforces the zh-TW glossary and fullwidth punctuation after CJK text', () => {
    expectRules((d) => (w(tok(d, 'openai-o200k_base').fidelityNote)['zh-TW'] = 'OpenAI 的標記器。'), ['l10n-glossary']);
    expectRules((d) => (w(chip(d, 'cjk-saba').why)['ja'] = '鯖は1文字です.'), ['l10n-punctuation']);
  });
});

describe('built assets (data/vocab/dist)', () => {
  const built = (d: Draft, id: string, patch: (meta: Record<string, unknown>) => void): void => {
    const meta = metaFor(tok(d, id));
    patch(meta);
    d.built = new Map([[id, { meta }]]);
  };

  it('fails when maxTokenBytes differs from META.maxPieceBytes', () => {
    expectRules(
      (d) => {
        built(d, 'openai-o200k_base', (m) => (m['maxPieceBytes'] = 127));
      },
      ['built-asset'],
    );
  });

  it('fails when engine facts, counts or provenance disagree with META', () => {
    expectRules(
      (d) => {
        built(d, 'google-gemma4', (m) => (m['byteFirstId'] = 217));
      },
      ['built-asset'],
    );
    expectRules(
      (d) => {
        built(d, 'xai-grok2', (m) => (m['counts'] = { pieces: 131072, specials: 128 }));
      },
      ['built-asset'],
    );
    expectRules(
      (d) => {
        built(d, 'meta-llama3', (m) => (m['upstream'] = { sha256: 'x' }));
      },
      ['built-asset'],
    );
  });

  it('fails on an unreadable asset and on a built withdrawn tokenizer', () => {
    expectRules((d) => (d.built = new Map([['xai-grok1', { error: 'bad magic' }]])), ['built-asset']);
    expectRules(
      (d) => {
        tok(d, 'xai-grok1').withdrawn = true;
        d.built = new Map([['xai-grok1', { meta: metaFor(tok(d, 'xai-grok1')) }]]);
      },
      ['built-asset'],
    );
  });

  it('ignores assets that have not been built yet', () => {
    expectRules((d) => (d.built = new Map()), []);
  });
});
