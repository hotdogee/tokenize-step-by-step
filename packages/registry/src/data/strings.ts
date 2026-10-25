/** `strings.json` as typed constants (see `../data.ts` for why the assertion is sound). */
import stringsJson from '../../data/strings.json' with { type: 'json' };
import type { RegistryStrings } from '../data-schema.ts';

/** Marker screen-reader text and BYOK messages in three locales. */
export const strings: RegistryStrings = stringsJson as unknown as RegistryStrings;
