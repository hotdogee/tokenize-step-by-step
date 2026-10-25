/** `models.json` as typed constants (see `../data.ts` for why the assertion is sound). */
import modelsJson from '../../data/models.json' with { type: 'json' };
import type { ModelRow } from '../schema.ts';

/** Model → tokenizer mapping rows with fidelity, status and dated evidence (PD-6). */
export const models: readonly ModelRow[] = modelsJson as unknown as readonly ModelRow[];
