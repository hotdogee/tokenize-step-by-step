/**
 * xAI `tokenize-text` client (05 §13, AD-24; research §3.5): `POST https://api.x.ai/v1/tokenize-text` with
 * `Authorization: Bearer <key>` and `{ text, model }` → `{ token_ids: [{ token_id, string_token, token_bytes }] }`, the
 * model's real tokens with their bytes, which live-tier.ts lines up under the Grok-2 tokens.
 */
import type { ByokConfig } from '@tsbs/registry';
import type { LiveToken } from './live-tier.ts';
import type { ProviderRequest } from './request.ts';

export type XaiConfig = ByokConfig['xai'];

export interface XaiInput {
  readonly key: string;
  readonly model: string;
  readonly text: string;
}

/** The request headers (Bearer auth, JSON body). */
export function xaiHeaders(input: Pick<XaiInput, 'key'>): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${input.key.trim()}` };
}

/** The full `tokenize-text` request. */
export function xaiRequest(config: XaiConfig, input: XaiInput): ProviderRequest {
  return {
    url: config.endpoint,
    headers: xaiHeaders(input),
    body: JSON.stringify({ text: input.text, model: input.model }),
  };
}

function byteArray(value: unknown): Uint8Array | null {
  if (!Array.isArray(value)) return null;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const byte: unknown = value[i];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * The tokens of a `tokenize-text` answer in order, or null when the body is not one. A token without a valid
 * `token_bytes` array keeps `bytes: null` (the alignment guard then reports the response as unaligned).
 */
export function parseTokenizeText(json: unknown): LiveToken[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const list = (json as Readonly<Record<string, unknown>>)['token_ids'];
  if (!Array.isArray(list)) return null;
  const tokens: LiveToken[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Readonly<Record<string, unknown>>;
    const id = record['token_id'];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return null;
    const text = record['string_token'];
    tokens.push({ id, text: typeof text === 'string' ? text : null, bytes: byteArray(record['token_bytes']) });
  }
  return tokens;
}
