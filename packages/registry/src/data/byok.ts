/** `byok.json` as typed constants (see `../data.ts` for why the assertion is sound). */
import byokJson from '../../data/byok.json' with { type: 'json' };
import type { ByokConfig } from '../schema.ts';

/** BYOK endpoints, headers and model lists (AD-24). */
export const byok: ByokConfig = byokJson as unknown as ByokConfig;
