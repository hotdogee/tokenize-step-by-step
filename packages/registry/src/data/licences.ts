/** `licences.json` as typed constants (see `../data.ts` for why the assertion is sound). */
import licencesJson from '../../data/licences.json' with { type: 'json' };
import type { LicencesFile } from '../data-schema.ts';

/** Licence display strings, required notices and the MODIFIED template. */
export const licences: LicencesFile = licencesJson as unknown as LicencesFile;
