/**
 * The About page's licence data (05 §14): one entry per `shipIntent: ship` asset of `tools/oracle/manifest.json`, with
 * obligations verbatim, provenance, the pinned upstream file and the licence texts served from `/licenses/<assetId>/`.
 *
 * TODO(WP-integration): `licences.stub.json` is a WP06 stub derived from the manifest with the shape below; WP03's
 * `licences()` plugin writes the real `src/generated/licences.json` (adding the shipped `.bin` hash and the MODIFIED
 * statement) and the integrator switches this import to it. licences.test.ts keeps the stub in step with the manifest.
 */
import type { TokenizerId } from '@tsbs/core';
import stub from './licences.stub.json';

export interface GeneratedLicence {
  /** Asset id in tools/oracle/manifest.json (also the `/licenses/<assetId>/` directory). */
  readonly assetId: string;
  /** The registry tokenizer built from this asset. */
  readonly tokenizer: TokenizerId;
  readonly lab: string;
  readonly description: string;
  readonly spdx: string;
  /** Verbatim from the manifest (legal text, not translated). */
  readonly obligations: readonly string[];
  /** Provenance notes, verbatim. */
  readonly notes: string;
  readonly upstream: {
    readonly file: string;
    readonly url: string;
    readonly revision: string;
    readonly sha256: string;
    readonly retrievedOn: string;
  };
  /** Files served verbatim at `/licenses/<assetId>/<file>`. */
  readonly licenceFiles: readonly string[];
  /** A NOTICE the licence requires to be reproduced (Meta Llama 3). */
  readonly notice: { readonly file: string; readonly text: string } | null;
  /** The served `.bin` (vocab manifest); null until the vocabulary has been built. */
  readonly shipped: { readonly path: string; readonly sha256: string } | null;
  /** The MODIFIED statement for the converted asset; null until the converter writes it. */
  readonly modified: string | null;
}

export interface LicencesGenerated {
  readonly schema: 1;
  readonly generatedOn: string;
  readonly assets: readonly GeneratedLicence[];
}

export const LICENCES: LicencesGenerated = stub as LicencesGenerated;

/** URL of a served licence text. */
export function licenceTextUrl(assetId: string, file: string): string {
  return `/licenses/${encodeURIComponent(assetId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}
