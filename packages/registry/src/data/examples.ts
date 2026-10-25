/** `examples.json` as typed constants (see `../data.ts` for why the assertion is sound). */
import examplesJson from '../../data/examples.json' with { type: 'json' };
import type { ExampleChip } from '../schema.ts';

/** The 19 example chips (05 §6); the first one is the default example. */
export const examples: readonly ExampleChip[] = examplesJson as unknown as readonly ExampleChip[];
