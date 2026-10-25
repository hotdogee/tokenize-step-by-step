/**
 * Names and ceilings of the `vitest bench` suites (WP12): each benchmark name maps to one 06 §3 Node ceiling from
 * `../helpers/ceilings.ts` (or none: recorded only), so `check-bench.ts` can assert the medians of a `pnpm bench` run.
 */
import type { TokenizerId } from '../../src/index.ts';
import { type CeilingKey, NODE_CEILING_MS } from '../helpers/ceilings.ts';

/** One benchmark: its display name and the ceiling key it is held to (null = recorded, no 06 §3 ceiling). */
export interface BenchSpec {
  readonly name: string;
  readonly ceiling: CeilingKey | null;
}

const BYTELEVEL: readonly TokenizerId[] = [
  'openai-o200k_base',
  'openai-cl100k_base',
  'meta-llama3',
  'meta-llama4-muse',
  'xai-grok2',
  'anthropic-claude-legacy',
];

/** Encode benchmark of `id` on `thousands`k CJK code points. */
export function encodeBench(id: TokenizerId, thousands: 10 | 20): BenchSpec {
  const byteLevel = BYTELEVEL.includes(id);
  const ceiling: CeilingKey | null =
    thousands === 10 ? (byteLevel ? 'encode10kByteLevel' : 'encode10kSpm') : byteLevel ? 'encode20kByteLevel' : null;
  return { name: `encode ${String(thousands)}k CJK · ${id}`, ceiling };
}

/** Vocab init benchmarks: `readTsbv1` of the decompressed built container, and `readTsbv1` + the engine factory. */
export function initBench(id: 'openai-o200k_base' | 'google-gemma4', withFactory: boolean): BenchSpec {
  return {
    name: `init ${withFactory ? 'readTsbv1 + engine factory' : 'readTsbv1'} · ${id}`,
    ceiling: id === 'openai-o200k_base' ? 'initO200k' : 'initGemma4',
  };
}

/** The ceiling in ms of a benchmark name, or null. */
export function ceilingOf(name: string, specs: readonly BenchSpec[]): number | null {
  const spec = specs.find((s) => s.name === name);
  return spec?.ceiling === null || spec === undefined ? null : NODE_CEILING_MS[spec.ceiling];
}

/** Every benchmark of the suites. */
export function allBenches(): BenchSpec[] {
  const ids: readonly TokenizerId[] = [...BYTELEVEL, 'google-gemma4', 'google-gemma2', 'xai-grok1'];
  return [
    ...(['openai-o200k_base', 'google-gemma4'] as const).flatMap((id) => [initBench(id, false), initBench(id, true)]),
    ...ids.flatMap((id) => [encodeBench(id, 10), encodeBench(id, 20)]),
  ];
}
