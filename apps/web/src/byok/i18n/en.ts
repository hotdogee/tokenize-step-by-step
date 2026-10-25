/**
 * Live-check drawer catalog, English — the SOURCE OF TRUTH for the drawer's message keys (05 §10, §13). Only the open
 * drawer shows these strings, so they load with it (a lazy chunk) instead of growing the initial `i18n` chunk (PA-10);
 * the drawer's trigger label stays in the shell catalogs (`liveCheck.heading`). zh-TW.ts and ja.ts define exactly the same
 * keys and placeholders (type-checked here and by catalogs.test.ts). Named placeholders only.
 */
import type { Message } from '../../i18n/types.ts';

export const byokEn = {
  'byok.warning':
    'Your key stays in this tab’s memory, is sent only to the provider over HTTPS and is forgotten when you reload. This site has no backend and no analytics.',
  'byok.key': 'API key',
  'byok.forget': 'Forget key',
  'byok.forgotten': 'Key forgotten',
  'byok.model': 'Model',
  'byok.pending': 'Waiting for {host}…',
  'byok.textEmpty': 'Type some text first.',
  'byok.stale': 'The text has changed since this answer. Run the check again for the new text.',

  'byok.anthropic.heading': 'Anthropic token count (Claude 3 and later)',
  'byok.anthropic.intro':
    'Counts your text with Anthropic’s count_tokens endpoint. The API returns a total only, never token boundaries.',
  'byok.anthropic.auth': 'Send the key as',
  'byok.anthropic.auth.bearer': 'Authorization: Bearer (default)',
  'byok.anthropic.auth.xApiKey': 'x-api-key header',
  'byok.anthropic.modelOption': { one: '{model} (≈ {n} frame token)', other: '{model} (≈ {n} frame tokens)' },
  'byok.anthropic.workspace': 'Workspace id (optional)',
  'byok.anthropic.workspaceHint': 'Needed when your key is not scoped to one workspace.',
  'byok.anthropic.run': 'Count tokens',
  'byok.anthropic.result':
    'API total {total} (includes ≈ {frame} frame tokens → ≈ {content} content tokens) vs legacy-vocabulary count {legacy}; boundaries are not available',
  'byok.anthropic.resultAlone':
    'API total {total} (includes ≈ {frame} frame tokens → ≈ {content} content tokens); boundaries are not available',
  'byok.anthropic.compare': 'Show the legacy-vocabulary count',

  'byok.xai.heading': 'xAI tokenize (Grok 4.x)',
  'byok.xai.intro':
    'Tokenizes your text with xAI’s tokenize-text endpoint and lines the real token bytes up under the Grok-2 tokens.',
  'byok.xai.run': 'Tokenize',
  'byok.xai.count': { one: '{model}: {n} token', other: '{model}: {n} tokens' },
  'byok.xai.matches': 'matches Grok-2 ✓ on this text',
  'byok.xai.differ': '{k} of {n} boundaries differ from Grok-2 (hatched on the live tier)',
  'byok.xai.unaligned': 'could not align the API tokens to your text ({matched} of {total} bytes matched)',
  'byok.xai.compare': 'Select Grok-2 to compare',

  'byok.tokens': 'Tokens from the API',
  'byok.tokens.unaligned': 'Tokens from the API, in order (not aligned to your text)',
  'byok.tokens.more': '… and {n} more',
  'byok.token.differs': 'boundary differs',
  'byok.token.partial': 'partial',
  'byok.token.zeroWidth': '0 bytes',
  'byok.token.noBytes': 'no bytes',

  'byok.error.key': 'The provider rejected this API key (HTTP {status}). Check the key and try again.',
  'byok.error.workspace':
    'Anthropic needs a workspace id for this key (HTTP {status}). Enter the workspace id and try again.',
  'byok.error.model': 'The provider rejected the request for this model (HTTP {status}). Check the model.',
  'byok.error.request': 'The provider rejected the request (HTTP {status}).',
  'byok.error.rateLimit': 'Rate limit reached (HTTP {status}). Wait a moment and try again.',
  'byok.error.server': 'The provider had a problem (HTTP {status}). Try again later.',
  'byok.error.zdr':
    'Could not reach Anthropic from this page (network or CORS). Zero-data-retention organisations cannot call this endpoint from a browser.',
  'byok.error.network': 'Could not reach {host} from this page (network or CORS).',
  'byok.error.timeout': {
    one: 'No answer within {n} second. Try again.',
    other: 'No answer within {n} seconds. Try again.',
  },
  'byok.error.badResponse': 'The provider’s answer was not in the expected format.',
  'byok.error.detail': '{provider} said: “{detail}”',
} as const satisfies Readonly<Record<string, Message>>;

/** Every drawer message key. */
export type ByokMessageKey = keyof typeof byokEn;

/** A complete drawer catalog. */
export type ByokCatalog = Readonly<Record<ByokMessageKey, Message>>;
