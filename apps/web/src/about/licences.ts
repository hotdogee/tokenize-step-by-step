/**
 * The About page's licence data (05 §14): one entry per `shipIntent: ship` asset of `tools/oracle/manifest.json`, with
 * obligations verbatim, provenance, the pinned upstream file and the licence texts served from `/licenses/<assetId>/`.
 *
 * Source: `src/generated/licences.json`, the `licences.generated.json` document that WP03's `licences()` plugin (and
 * `pnpm generate`) writes from the oracle manifest, `docs/licenses/**` and — once `pnpm vocab:build` has run — the shipped
 * `.bin` facts and MODIFIED statements. `toGeneratedLicence` maps its assets to the shape the About components render.
 */
import type { TokenizerId } from '@tsbs/core';
import generated from '../generated/licences.json';

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

/** The fields of one `licences.generated.json` asset (WP03 `LicenceAsset`) that the About page reads. */
export interface LicenceAssetJson {
  readonly assetId: string;
  readonly tokenizerId: TokenizerId | null;
  readonly lab: string;
  readonly description: string;
  readonly spdx: string;
  readonly obligations: readonly string[];
  readonly provenance: string;
  readonly notice: { readonly file: string; readonly text: string } | null;
  readonly texts: ReadonlyArray<{ readonly name: string }>;
  readonly upstream: GeneratedLicence['upstream'] | null;
  readonly shipped: { readonly path: string; readonly sha256: string } | null;
  readonly modified: { readonly statement: string } | null;
}

/** `licences.generated.json` as far as the About page reads it. */
export interface LicencesJson {
  readonly schema: 1;
  readonly builtOn: string;
  readonly assets: readonly LicenceAssetJson[];
}

/** Maps one generated asset to the About shape; null for an asset without a tokenizer or upstream file (none ships). */
export function toGeneratedLicence(asset: LicenceAssetJson): GeneratedLicence | null {
  if (asset.tokenizerId === null || asset.upstream === null) return null;
  const { file, url, revision, sha256, retrievedOn } = asset.upstream;
  return {
    assetId: asset.assetId,
    tokenizer: asset.tokenizerId,
    lab: asset.lab,
    description: asset.description,
    spdx: asset.spdx,
    obligations: asset.obligations,
    notes: asset.provenance,
    upstream: { file, url, revision, sha256, retrievedOn },
    licenceFiles: asset.texts.map((text) => text.name),
    notice: asset.notice,
    shipped: asset.shipped === null ? null : { path: asset.shipped.path, sha256: asset.shipped.sha256 },
    modified: asset.modified?.statement ?? null,
  };
}

/** Maps a whole generated document (the JSON is typed by its declared shape: its inferred type depends on the build). */
export function toLicences(json: LicencesJson): LicencesGenerated {
  return {
    schema: 1,
    generatedOn: json.builtOn,
    assets: json.assets.flatMap((asset) => toGeneratedLicence(asset) ?? []),
  };
}

export const LICENCES: LicencesGenerated = toLicences(generated as unknown as LicencesJson);

/** URL of a served licence text. */
export function licenceTextUrl(assetId: string, file: string): string {
  return `/licenses/${encodeURIComponent(assetId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}
