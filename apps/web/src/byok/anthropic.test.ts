/**
 * Anthropic `count_tokens` request builder (05 §13, AD-24): headers exactly per byok.json — Bearer by default, x-api-key
 * as the option, anthropic-version, the browser-access header, the workspace id only when given — and the body.
 */
import { describe, expect, it } from 'vitest';
import { byok } from '@tsbs/registry/byok';
import { anthropicHeaders, anthropicRequest, countSummary, frameTokensOf, parseCountTokens } from './anthropic.ts';

const config = byok.anthropic;

describe('anthropicHeaders', () => {
  it('sends Authorization: Bearer by default, with the version and browser-access header from byok.json', () => {
    expect(config.defaultAuth).toBe('bearer');
    expect(anthropicHeaders(config, { key: 'sk-ant-test', auth: config.defaultAuth, workspaceId: '' })).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-ant-test',
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('sends x-api-key instead of Authorization when that scheme is chosen', () => {
    expect(config.authSchemes).toContain('x-api-key');
    const headers = anthropicHeaders(config, { key: 'sk-ant-test', auth: 'x-api-key', workspaceId: '' });
    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': config.version,
      [config.browserAccessHeader]: 'true',
    });
    expect(headers).not.toHaveProperty('authorization');
  });

  it('adds anthropic-workspace-id only when a workspace id is given (trimmed)', () => {
    expect(anthropicHeaders(config, { key: 'k', auth: 'bearer', workspaceId: '  wrkspc_01  ' })).toMatchObject({
      'anthropic-workspace-id': 'wrkspc_01',
    });
    expect(anthropicHeaders(config, { key: 'k', auth: 'bearer', workspaceId: '   ' })).not.toHaveProperty(
      'anthropic-workspace-id',
    );
  });

  it('trims the key (a pasted newline never reaches the header)', () => {
    const headers = anthropicHeaders(config, { key: ' sk-ant-x\n', auth: 'bearer', workspaceId: '' });
    expect(headers['authorization']).toBe('Bearer sk-ant-x');
  });
});

describe('anthropicRequest', () => {
  it('POSTs { model, messages: [{ role: user, content: text }] } to the byok.json endpoint', () => {
    const request = anthropicRequest(config, {
      key: 'k',
      auth: 'bearer',
      model: 'claude-opus-5-5',
      workspaceId: '',
      text: '台灣台南',
    });
    expect(request.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(JSON.parse(request.body)).toEqual({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: '台灣台南' }],
    });
  });
});

describe('answers and frame tokens', () => {
  it('reads input_tokens and rejects anything else', () => {
    expect(parseCountTokens({ input_tokens: 25 })).toBe(25);
    expect(parseCountTokens({ input_tokens: 0 })).toBe(0);
    expect(parseCountTokens({ input_tokens: -1 })).toBeNull();
    expect(parseCountTokens({ input_tokens: 2.5 })).toBeNull();
    expect(parseCountTokens({ tokens: 25 })).toBeNull();
    expect(parseCountTokens(null)).toBeNull();
  });

  it('takes the frame tokens per model from byok.json', () => {
    for (const row of config.models) expect(frameTokensOf(config, row.id)).toBe(row.frameTokens);
    expect(frameTokensOf(config, 'claude-unknown')).toBe(0);
  });

  it('subtracts the frame for the content estimate, never below zero', () => {
    expect(countSummary(25, 8)).toEqual({ total: 25, frame: 8, content: 17 });
    expect(countSummary(5, 8)).toEqual({ total: 5, frame: 8, content: 0 });
  });
});
