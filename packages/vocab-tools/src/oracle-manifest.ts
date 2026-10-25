/**
 * Typed view of `tools/oracle/manifest.json` (tools/oracle/README.md § "Manifest"): only the fields the converter,
 * the licences output and the guards read. Validation is by hand (zod is not a dependency of this Node tool).
 */
import { readFile } from 'node:fs/promises';

/** Roles that are snapshotted into `docs/licenses/<assetId>/` (oracle_lib/manifest.py `SNAPSHOT_ROLES`). */
export const SNAPSHOT_ROLES = ['license', 'notice', 'policy', 'license-evidence'] as const;

export interface OracleFile {
  readonly name: string;
  readonly role: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly url: string;
  readonly revision: string;
  readonly retrievedOn: string;
  /** `false` keeps a volatile file out of `docs/licenses/` (PA-4). */
  readonly snapshot: boolean;
}

export interface OracleLicense {
  readonly spdx: string;
  readonly file: string;
  readonly sourceUrl: string;
  readonly snapshotPath: string;
  readonly obligations: readonly string[];
  readonly notice: { readonly file: string; readonly text: string } | null;
}

export interface OracleAsset {
  readonly id: string;
  readonly lab: string;
  readonly description: string;
  readonly notes: string;
  readonly shipIntent: string;
  readonly shipNote: string | null;
  /** xAI revocability (AD-14): a withdrawn asset is never converted. */
  readonly withdrawn: boolean;
  readonly license: OracleLicense;
  readonly files: readonly OracleFile[];
}

export interface OracleManifest {
  readonly schemaVersion: number;
  readonly assets: readonly OracleAsset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`${where}.${key} must be a string`);
  return value;
}

function parseFile(value: unknown, where: string): OracleFile {
  if (!isRecord(value)) throw new Error(`${where} must be an object`);
  const bytes = value['bytes'];
  if (!Number.isSafeInteger(bytes)) throw new Error(`${where}.bytes must be an integer`);
  const sha256 = str(value, 'sha256', where);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${where}.sha256 is not a lower-case SHA-256`);
  return {
    name: str(value, 'name', where),
    role: str(value, 'role', where),
    sha256,
    bytes: bytes as number,
    url: str(value, 'url', where),
    revision: str(value, 'revision', where),
    retrievedOn: str(value, 'retrievedOn', where),
    snapshot: value['snapshot'] !== false,
  };
}

function parseLicense(value: unknown, where: string): OracleLicense {
  if (!isRecord(value)) throw new Error(`${where} must be an object`);
  const obligations = value['obligations'];
  if (!Array.isArray(obligations) || !obligations.every((o) => typeof o === 'string'))
    throw new Error(`${where}.obligations must be a list of strings`);
  const notice = value['notice'];
  if (
    notice !== undefined &&
    (!isRecord(notice) || typeof notice['file'] !== 'string' || typeof notice['text'] !== 'string')
  )
    throw new Error(`${where}.notice must be { file, text }`);
  return {
    spdx: str(value, 'spdx', where),
    file: str(value, 'file', where),
    sourceUrl: str(value, 'sourceUrl', where),
    snapshotPath: str(value, 'snapshotPath', where),
    obligations: obligations.map(String),
    notice: notice === undefined ? null : { file: String(notice['file']), text: String(notice['text']) },
  };
}

/** Validates a parsed oracle manifest. */
export function parseOracleManifest(value: unknown): OracleManifest {
  if (!isRecord(value) || !Array.isArray(value['assets'])) throw new Error('oracle manifest: assets[] missing');
  const assets = (value['assets'] as unknown[]).map((asset, i): OracleAsset => {
    const where = `assets[${String(i)}]`;
    if (!isRecord(asset) || !Array.isArray(asset['files'])) throw new Error(`${where} must be an object with files[]`);
    const shipNote = asset['shipNote'];
    return {
      id: str(asset, 'id', where),
      lab: str(asset, 'lab', where),
      description: str(asset, 'description', where),
      notes: str(asset, 'notes', where),
      shipIntent: str(asset, 'shipIntent', where),
      shipNote: typeof shipNote === 'string' ? shipNote : null,
      withdrawn: asset['withdrawn'] === true,
      license: parseLicense(asset['license'], `${where}.license`),
      files: (asset['files'] as unknown[]).map((file, j) => parseFile(file, `${where}.files[${String(j)}]`)),
    };
  });
  const ids = new Set<string>();
  for (const asset of assets) {
    if (ids.has(asset.id)) throw new Error(`oracle manifest: duplicate asset id ${asset.id}`);
    ids.add(asset.id);
  }
  const schemaVersion = value['schemaVersion'];
  return { schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : 0, assets };
}

/** Reads and validates the manifest at `path`; also returns the raw JSON (for `resolveBuiltOn`). */
export async function readOracleManifest(path: string): Promise<{ manifest: OracleManifest; json: unknown }> {
  const json: unknown = JSON.parse(await readFile(path, 'utf8'));
  return { manifest: parseOracleManifest(json), json };
}

/** The file entry `name` of `asset`, or a descriptive error. */
export function oracleFile(asset: OracleAsset, name: string): OracleFile {
  const file = asset.files.find((f) => f.name === name);
  if (file === undefined) throw new Error(`oracle manifest: asset ${asset.id} has no file ${name}`);
  return file;
}

/** True iff the file is copied into `docs/licenses/<assetId>/`. */
export function isSnapshotted(file: OracleFile): boolean {
  return (SNAPSHOT_ROLES as readonly string[]).includes(file.role) && file.snapshot;
}
