/**
 * Anthropic `count_tokens` client (05 §13, AD-24; research §3.2): the request is built exactly from `byok.json` — the
 * endpoint, `anthropic-version`, the browser-access header, the auth scheme (`Authorization: Bearer` by default,
 * `x-api-key` as the option) and `anthropic-workspace-id` when one is given — with the body
 * `{ model, messages: [{ role: 'user', content: text }] }`. The answer is a total only (`{ input_tokens }`), never
 * boundaries; it includes a per-message frame whose size per model is `frameTokens` in `byok.json`.
 */
import type { ByokConfig } from '@tsbs/registry';
import type { ProviderRequest } from './request.ts';

export type AnthropicConfig = ByokConfig['anthropic'];
export type AnthropicAuth = AnthropicConfig['authSchemes'][number];

/** What the panel collects (the key lives in keys.svelte.ts and is passed in per request). */
export interface AnthropicInput {
  readonly key: string;
  readonly auth: AnthropicAuth;
  readonly model: string;
  /** Optional; sent as `anthropic-workspace-id` when non-blank. */
  readonly workspaceId: string;
  readonly text: string;
}

/** The request headers, exactly per `byok.json` (lower-case names; fetch sends them case-insensitively). */
export function anthropicHeaders(
  config: AnthropicConfig,
  input: Pick<AnthropicInput, 'key' | 'auth' | 'workspaceId'>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': config.version,
    [config.browserAccessHeader]: 'true',
  };
  const key = input.key.trim();
  if (input.auth === 'x-api-key') headers['x-api-key'] = key;
  else headers['authorization'] = `Bearer ${key}`;
  const workspace = input.workspaceId.trim();
  if (workspace !== '') headers[config.workspaceHeader] = workspace;
  return headers;
}

/** The full `count_tokens` request. */
export function anthropicRequest(config: AnthropicConfig, input: AnthropicInput): ProviderRequest {
  return {
    url: config.endpoint,
    headers: anthropicHeaders(config, input),
    body: JSON.stringify({ model: input.model, messages: [{ role: 'user', content: input.text }] }),
  };
}

/** `input_tokens` of a `count_tokens` answer, or null when the body is not one. */
export function parseCountTokens(json: unknown): number | null {
  if (typeof json !== 'object' || json === null) return null;
  const value = (json as Readonly<Record<string, unknown>>)['input_tokens'];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The frame tokens `byok.json` records for `model` (0 for a model it does not list). */
export function frameTokensOf(config: AnthropicConfig, model: string): number {
  return config.models.find((row) => row.id === model)?.frameTokens ?? 0;
}

/** The panel's numbers: the API total, the ≈ frame it includes and the ≈ content tokens (never below 0). */
export interface CountSummary {
  readonly total: number;
  readonly frame: number;
  readonly content: number;
}

export function countSummary(total: number, frame: number): CountSummary {
  return { total, frame, content: Math.max(0, total - frame) };
}
