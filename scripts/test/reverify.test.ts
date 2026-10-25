import { describe, expect, it } from 'vitest';
import { daysBetween, renderIssue, staleByok, staleModelRows, WATCH_LIST } from '../lib/reverify.ts';

const row = (model: string, fidelity: string, checkedOn: string) => ({
  model,
  lab: 'openai',
  tokenizer: fidelity === 'unavailable' ? null : 'openai-o200k_base',
  fidelity,
  status: 'current',
  evidenceUrl: `https://example.org/${model}`,
  checkedOn,
  note: { en: '', 'zh-TW': '', ja: '' },
});

describe('reverify', () => {
  it('counts whole UTC days', () => {
    expect(daysBetween('2026-10-25', '2027-01-23')).toBe(90);
    expect(daysBetween('2026-10-25', '2027-01-24')).toBe(91);
    expect(() => daysBetween('2026/10/25', '2027-01-24')).toThrow(/not an ISO date/);
  });

  it('lists rows checked more than 90 days ago, inferred first, oldest first', () => {
    const rows = [
      row('GPT-4o', 'confirmed', '2026-07-01'),
      row('GPT-6 Astra', 'inferred', '2026-10-25'),
      row('Gemini 4 Argon', 'inferred', '2026-09-01'),
      row('Claude Opus 5.5', 'unavailable', '2026-12-01'),
    ];
    const stale = staleModelRows(rows, '2027-01-24');
    expect(stale.map((entry) => [entry.model, entry.ageDays])).toEqual([
      ['Gemini 4 Argon', 145],
      ['GPT-6 Astra', 91],
      ['GPT-4o', 207],
    ]);
    expect(staleModelRows({ models: rows }, '2026-11-01').map((entry) => entry.model)).toEqual(['GPT-4o']);
    expect(() => staleModelRows({ rows }, '2026-11-01')).toThrow(/neither an array/);
  });

  it('flags a stale byok.json', () => {
    expect(staleByok({ checkedOn: '2026-10-25' }, '2027-02-01')).toBe(99);
    expect(staleByok({ checkedOn: '2026-10-25' }, '2026-12-01')).toBeNull();
    expect(staleByok({}, '2026-12-01')).toBeNull();
  });

  it('renders a table and the watch list', () => {
    const body = renderIssue(
      staleModelRows([row('GPT-6 Astra', 'inferred', '2026-10-25')], '2027-02-01'),
      99,
      '2027-02-01',
    );
    expect(body).toContain(
      '| GPT-6 Astra | openai | openai-o200k_base | inferred | 2026-10-25 | 99 | <https://example.org/GPT-6 Astra> |',
    );
    expect(body).toContain('`byok.json` was last checked 99 days ago');
    for (const item of WATCH_LIST) expect(body).toContain(`- [ ] ${item}`);
  });
});
