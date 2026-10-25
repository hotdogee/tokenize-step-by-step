/** xAI `tokenize-text` request builder and answer parser (05 §13, AD-24). */
import { describe, expect, it } from 'vitest';
import { byok } from '@tsbs/registry/byok';
import { parseTokenizeText, xaiHeaders, xaiRequest } from './xai.ts';

describe('xAI request', () => {
  it('sends Bearer auth and a JSON body { text, model } to the byok.json endpoint', () => {
    expect(xaiHeaders({ key: ' xai-test ' })).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer xai-test',
    });
    const request = xaiRequest(byok.xai, { key: 'xai-test', model: byok.xai.defaultModel, text: 'Hello world!' });
    expect(request.url).toBe('https://api.x.ai/v1/tokenize-text');
    expect(JSON.parse(request.body)).toEqual({ text: 'Hello world!', model: 'grok-4.7' });
  });

  it('defaults to grok-4.7 and lists only current slugs', () => {
    expect(byok.xai.defaultModel).toBe('grok-4.7');
    expect(byok.xai.models.map((row) => row.id)).toEqual(['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3']);
  });
});

describe('parseTokenizeText', () => {
  it("reads xAI's documented example (model latest, Hello world!)", () => {
    const tokens = parseTokenizeText({
      token_ids: [
        { token_id: 13902, string_token: 'Hello', token_bytes: [72, 101, 108, 108, 111] },
        { token_id: 1749, string_token: ' world', token_bytes: [32, 119, 111, 114, 108, 100] },
        { token_id: 161, string_token: '!', token_bytes: [33] },
      ],
    });
    expect(tokens?.map((token) => token.id)).toEqual([13902, 1749, 161]);
    expect(tokens?.map((token) => token.text)).toEqual(['Hello', ' world', '!']);
    expect(Array.from(tokens?.[2]?.bytes ?? [])).toEqual([33]);
  });

  it('keeps bytes null when token_bytes is missing or malformed (the alignment guard decides)', () => {
    const tokens = parseTokenizeText({
      token_ids: [
        { token_id: 1, string_token: 'a' },
        { token_id: 2, string_token: 'b', token_bytes: [300] },
        { token_id: 3, string_token: 'c', token_bytes: 'YQ==' },
      ],
    });
    expect(tokens?.map((token) => token.bytes)).toEqual([null, null, null]);
  });

  it('rejects bodies that are not a tokenize-text answer', () => {
    expect(parseTokenizeText({})).toBeNull();
    expect(parseTokenizeText({ token_ids: [{ token_id: -1 }] })).toBeNull();
    expect(parseTokenizeText({ token_ids: [{ token_id: 'x' }] })).toBeNull();
    expect(parseTokenizeText({ token_ids: [7] })).toBeNull();
    expect(parseTokenizeText(null)).toBeNull();
  });
});
