/**
 * Loads everything `checkRegistry` cross-references from a repository checkout (Node only): the six registry data files,
 * the oracle manifest, the fixtures the tokenizer entries name, the licence-text file list and — when
 * `data/vocab/dist/vocab-manifest.generated.json` exists — the META section of every built asset.
 * Shared by the `registry:check` CLI and the tests.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuiltAsset, RegistryFiles, RegistryInput } from '../src/check.ts';
import { readTsbvMeta } from './tsbv-meta.ts';

/** The repository root this package lives in. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** The six data files of `packages/registry/data/`. */
export function loadFiles(root: string = REPO_ROOT): RegistryFiles {
  const file = (name: string): unknown => readJson(join(root, 'packages', 'registry', 'data', `${name}.json`));
  return {
    tokenizers: file('tokenizers'),
    models: file('models'),
    licences: file('licences'),
    examples: file('examples'),
    byok: file('byok'),
    strings: file('strings'),
  };
}

/** Every fixture a tokenizer entry names (the entries are not validated yet, so this reads defensively). */
export function loadFixtures(tokenizers: unknown, root: string = REPO_ROOT): Map<string, unknown> {
  const fixtures = new Map<string, unknown>();
  if (!Array.isArray(tokenizers)) return fixtures;
  for (const entry of tokenizers as unknown[]) {
    const path = typeof entry === 'object' && entry !== null ? (entry as { fixture?: unknown }).fixture : undefined;
    if (typeof path === 'string' && existsSync(join(root, path))) fixtures.set(path, readJson(join(root, path)));
  }
  return fixtures;
}

/** Files under `docs/licenses/` as "<assetId>/<file>" (the paths `/licenses/…` links may point at). */
export function loadLicenceFiles(root: string = REPO_ROOT): Set<string> {
  const dir = join(root, 'docs', 'licenses');
  return new Set(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/')),
  );
}

/** META of every asset the built vocab manifest lists, or null when nothing has been built. */
export function loadBuilt(root: string = REPO_ROOT): Map<string, BuiltAsset> | null {
  const dist = join(root, 'data', 'vocab', 'dist');
  const manifestPath = join(dist, 'vocab-manifest.generated.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath) as { assets?: Record<string, { path?: unknown }> };
  const built = new Map<string, BuiltAsset>();
  for (const [id, entry] of Object.entries(manifest.assets ?? {})) {
    if (typeof entry.path !== 'string') {
      built.set(id, { error: 'vocab manifest entry has no path' });
      continue;
    }
    try {
      built.set(id, { meta: readTsbvMeta(readFileSync(join(dist, ...entry.path.split('/').filter(Boolean)))) });
    } catch (error: unknown) {
      built.set(id, { error: `${entry.path}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return built;
}

/** Everything `checkRegistry` needs, read from the checkout at `root`. */
export function loadRegistryInput(root: string = REPO_ROOT): RegistryInput {
  const files = loadFiles(root);
  return {
    files,
    manifest: readJson(join(root, 'tools', 'oracle', 'manifest.json')),
    fixtures: loadFixtures(files.tokenizers, root),
    licenceFiles: loadLicenceFiles(root),
    built: loadBuilt(root),
  };
}
