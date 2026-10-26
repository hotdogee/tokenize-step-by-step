/**
 * English About-page catalog — source of truth for `AboutMessageKey` (05 §14). Kept apart from the shell catalogs
 * so these long texts load only with `/about/` (they would otherwise sit in the main bundle's i18n chunk, 06 §3).
 * Same rules as ../en.ts: named placeholders, legal text never translated.
 */
import type { Message } from '../types.ts';

export const aboutEn = {
  'fidelity.legend.confirmed': 'The vendor publishes or documents this tokenizer for the model.',
  'fidelity.legend.inferred': 'Our reading of public evidence on the date shown; not confirmed by the vendor.',
  'fidelity.legend.legacy': 'An older tokenizer, kept for history and comparison.',
  'fidelity.legend.reconstruction': 'A community reconstruction, not the vendor’s tokenizer.',
  'about.heading': 'About',
  'about.toc': 'On this page',
  'about.intro.heading': 'What this site shows',
  'about.intro.body':
    'This visualizer runs real tokenizers in your browser and shows every step from text to tokens: code points, UTF-8 bytes, pre-tokenizer chunks, each BPE merge and the final token ids, including tokens that cover only part of a character.',
  'about.intro.notClaimed': 'What it does not claim',
  'about.intro.claude':
    'The Anthropic tokenizer here is the Claude 1/2-era vocabulary. Claude 3 and later use a tokenizer that is not public; the live check counts their tokens with your own API key but cannot show token boundaries.',
  'about.intro.inferred':
    'Model mappings marked “inferred” are our reading of public evidence on the date shown and are re-checked every month.',
  'about.intro.ctok': 'Community reconstructions of newer Claude tokenizers are not included in this version.',
  'about.fidelity.heading': 'Fidelity',
  'about.fidelity.caption': 'Which tokenizer each model uses, and how sure we are',
  'about.fidelity.model': 'Model',
  'about.fidelity.tokenizer': 'Tokenizer',
  'about.fidelity.status': 'Status',
  'about.fidelity.evidence': 'Evidence',
  'about.fidelity.checked': 'Checked on',
  'about.fidelity.liveCheck': 'live check only',
  'about.fidelity.source': 'source',
  'about.licences.heading': 'Licences & provenance',
  'about.licences.intro':
    'Every vocabulary the site serves, where it came from and the terms it ships under. Legal texts are reproduced verbatim and are not translated.',
  'about.licence.lab': 'Lab',
  'about.licence.spdx': 'Licence',
  'about.licence.obligations': 'Obligations',
  'about.licence.provenance': 'Provenance',
  'about.licence.upstream': 'Upstream file',
  'about.licence.revision': 'Revision',
  'about.licence.retrieved': 'Retrieved on',
  'about.licence.sha': 'SHA-256 of the upstream file',
  'about.licence.shaShipped': 'SHA-256 of the served file',
  'about.licence.shaPending': 'listed once the vocabulary has been built',
  'about.licence.modified': 'Modifications',
  'about.licence.text': 'Licence text: {file}',
  'about.licence.textLoading': 'Loading…',
  'about.licence.textFailed': 'The text could not be loaded here.',
  'about.licence.open': 'Open {file}',
  'about.notices.heading': 'Required notices',
  'about.notices.xai': 'Grok-2 (xAI)',
  'about.notices.llama': 'Llama 3 (Meta)',
  'about.notices.gemma': 'Gemma 1/2 (Google)',
  'about.notices.apache': 'Apache-2.0 vocabularies',
  'about.notices.mit': 'MIT-licensed vocabularies',
  'about.notices.agreement': 'Licence agreement',
  'about.notices.policy': 'Prohibited Use Policy',
  'about.notices.terms': 'Gemma Terms of Use',
  'about.notices.gemmaRestrictions':
    'The Gemma 1/2 tokenizer is provided subject to the use restrictions in section 3.2 of the Gemma Terms of Use. By using it you agree not to use it for any purpose that the Prohibited Use Policy forbids.',
  'about.notices.apacheBody':
    'The Gemma 4, Muse Glimmer and Grok-1 vocabularies are distributed under the Apache License 2.0; its text is in their licence blocks above. The legacy Claude package also declares Apache-2.0 (in its package.json), so its licence block reproduces the Apache-2.0 text too.',
  'about.notices.mitBody':
    'The OpenAI rank files are covered by the MIT licence reproduced above. The legacy Claude package (@anthropic-ai/tokenizer 0.0.4) declares both licences, MIT in its LICENSE file and Apache-2.0 in its package.json, so both texts are reproduced in its licence block and both are satisfied.',
  'about.notices.fonts': 'Fonts',
  'about.notices.fontsBody':
    'The token ids on the alignment board are set in a digits-only subset of Noto Sans, © 2022 The Noto Project Authors, used under the SIL Open Font License 1.1 (reduced to the ten digits, with the width axis kept and tabular figures built in).',
  'about.engine.heading': 'Engine',
  'about.engine.unicode':
    'Pre-tokenizer patterns use Unicode {version} tables, the version the reference tokenizers use.',
  'about.engine.browserUnicode': 'Your browser reports Unicode {version} or later.',
  'about.engine.browserUnicodeUnknown': 'Your browser’s Unicode version could not be detected.',
  'about.engine.oracles':
    'Results are checked against tiktoken {tiktoken}, SentencePiece {sentencepiece} and Hugging Face tokenizers {tokenizers}; the test fixtures were generated on {date}.',
  'about.engine.crossCheck':
    'For Gemma 4, the Gemma 3 SentencePiece model ({library} {version}) is a second reference: it agrees on {agreed} of {total} test cases and differs on these:',
  'about.engine.gemma4':
    'Gemma 4 follows its tokenizer.json (Hugging Face semantics) and matches Gemini’s SentencePiece model on all test text except literal special-token strings. The Gemma 3 model file marks some whitespace pieces USER_DEFINED; here they are ordinary tokens.',
  'about.engine.nfkc':
    'The legacy Claude NFKC option uses your browser’s Unicode normalization; the reference results used Python’s Unicode 15.1 tables.',
  'about.engine.cl100k': 'cl100k_base uses the current tiktoken pattern (tiktoken 0.8.0 and later).',
  'about.engine.build': 'Build {sha}, {date}.',
  'about.keyboard.heading': 'Keyboard',
  'about.privacy.heading': 'Privacy',
  'about.privacy.body':
    'No analytics, no cookies, no accounts. The text you type never leaves your browser. The site contacts only its own server, for the app, the example results and the tokenizer vocabularies. The optional live check sends your text to Anthropic or xAI with your own key, which stays in memory and is forgotten when you reload.',
  'about.translations.heading': 'Translations',
  'about.translations.body':
    'The Traditional Chinese and Japanese interface texts are drafts. Corrections are welcome as GitHub issues.',
  'about.diagnostics.heading': 'Diagnostics',
  'about.diagnostics.features': 'Browser features',
  'about.diagnostics.cacheApi': 'Cache API (offline vocabulary cache)',
  'about.diagnostics.segmenter': 'Intl.Segmenter (grapheme clusters)',
  'about.diagnostics.brotli': 'Brotli decompression',
  'about.diagnostics.subtleCrypto': 'Web Crypto (download verification)',
  'about.diagnostics.yes': 'available',
  'about.diagnostics.no': 'not available',
  'about.diagnostics.cache': 'Downloaded vocabularies',
  'about.diagnostics.cacheEmpty': 'Nothing is cached yet.',
  'about.diagnostics.cacheUnavailable':
    'The Cache API is not available here, for example in private browsing or on an insecure connection.',
  'about.diagnostics.clear': 'Clear cache',
  'about.diagnostics.cleared': 'Cache cleared.',
  'about.diagnostics.safari': 'Safari removes this cache after 7 days without a visit.',
  'about.diagnostics.lastLoad': 'Last tokenizer load in this tab',
  'about.diagnostics.lastLoadNone': 'No tokenizer has been loaded in this tab yet.',
  'about.diagnostics.lastLoadValue':
    '{name}: {ms}, {source}, {bytes} transferred, layer {layer}, content encoding {encoding}',
  'about.diagnostics.fromCache': 'from the cache',
  'about.diagnostics.fromNetwork': 'from the network',
  'about.diagnostics.none': 'none',
  'about.diagnostics.workerFeatures': 'In the tokenizer worker',
  'about.diagnostics.workerNone': 'The tokenizer worker has not started in this tab yet.',
  'about.diagnostics.cacheEntry': '{path} ({size})',
  'about.diagnostics.unicode': 'Pre-tokenizer Unicode {pinned}; your browser reports ≈ Unicode {version}.',
  'about.diagnostics.unicodeUnknown':
    'Pre-tokenizer Unicode {pinned}; your browser’s Unicode version could not be detected.',
  'about.diagnostics.build': 'Build {sha}, {date}.',
} as const satisfies Readonly<Record<string, Message>>;

/** Every About-page message key. */
export type AboutMessageKey = keyof typeof aboutEn;

/** A complete About-page catalog. */
export type AboutCatalog = Readonly<Record<AboutMessageKey, Message>>;
