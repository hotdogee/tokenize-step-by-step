/**
 * Licence and notice rules (03 §B.7, AD-14, 05 §14–§15): every tokenizer's licence key has display strings whose SPDX
 * matches the oracle manifest; every NoticeKey has strings in all three locales; legal notices carry their verbatim
 * string, and the notices a licence demands are required by the tokenizer and match the manifest's quoted wording.
 */
import { NoticeKeySchema } from '../schema.ts';
import type { NoticeKey, TokenizerEntry } from '../schema.ts';
import type { LicencesFile } from '../data-schema.ts';
import type { OracleAsset, OracleManifest } from './inputs.ts';
import type { Report } from './report.ts';
import { at } from './tokenizers.ts';

/**
 * Licences whose obligations demand notices (research §3.4/§3.5, manifest obligations): when an asset's SPDX contains
 * `spdx`, its tokenizer must require `required`, and the `verbatim` of each notice in `fromManifest` must equal a string
 * quoted in the manifest obligations or `license.notice.text` (`[applicable year]` matches any four-digit year).
 */
export const LEGAL_NOTICE_RULES: ReadonlyArray<{
  readonly spdx: string;
  readonly required: readonly NoticeKey[];
  readonly fromManifest: readonly NoticeKey[];
}> = [
  {
    spdx: 'xAI-Community-License',
    required: ['powered-by-xai', 'xai-materials-notice'],
    fromManifest: ['powered-by-xai', 'xai-materials-notice'],
  },
  {
    spdx: 'Llama-3-Community-License',
    required: ['built-with-meta-llama-3', 'llama3-notice'],
    fromManifest: ['built-with-meta-llama-3', 'llama3-notice'],
  },
  { spdx: 'Gemma-Terms-of-Use', required: ['gemma-notice', 'gemma-terms'], fromManifest: ['gemma-notice'] },
];

/** Placeholders the MODIFIED template must contain, exactly. */
export const MODIFIED_PLACEHOLDERS = ['date', 'file', 'sha256', 'version'] as const;

/** `{name}` placeholders of a template, sorted and de-duplicated. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1] ?? ''))].sort();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strings the manifest quotes for an asset: `"…"` spans in its obligations plus `license.notice.text`. */
function quotedStrings(asset: OracleAsset): string[] {
  const quoted = asset.license.obligations.flatMap((o) => [...o.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ''));
  return asset.license.notice === undefined ? quoted : [...quoted, asset.license.notice.text];
}

/** True when `verbatim` equals a manifest-quoted string (with `[applicable year]` as a four-digit year). */
function matchesQuoted(verbatim: string, quoted: readonly string[]): boolean {
  return quoted.some((q) =>
    new RegExp(`^${escapeRegExp(q).replace(escapeRegExp('[applicable year]'), '\\d{4}')}$`).test(verbatim),
  );
}

/** Licence keys ↔ licences.json ↔ manifest SPDX; no orphan licence entries; the MODIFIED template's placeholders. */
function checkLicenceKeys(
  tokenizers: readonly TokenizerEntry[],
  licences: LicencesFile,
  assets: ReadonlyMap<string, OracleAsset>,
  report: Report,
): void {
  for (const entry of tokenizers) {
    const display = licences.licences[entry.licence];
    if (display === undefined) {
      report('licence', at(entry), `licence key ${entry.licence} has no entry in licences.json`);
      continue;
    }
    const asset = assets.get(entry.asset.manifestId);
    if (asset !== undefined && asset.license.spdx !== display.spdx) {
      report(
        'licence',
        `licences[${entry.licence}]`,
        `spdx "${display.spdx}" differs from the manifest ("${asset.license.spdx}")`,
      );
    }
  }
  for (const key of Object.keys(licences.licences)) {
    if (!tokenizers.some((t) => t.licence === key))
      report('licence', `licences[${key}]`, 'no tokenizer uses this licence key');
  }
  const found = placeholders(licences.modifiedTemplate).join(',');
  if (found !== MODIFIED_PLACEHOLDERS.join(',')) {
    report(
      'licence',
      'licences.modifiedTemplate',
      `placeholders must be {${MODIFIED_PLACEHOLDERS.join('}, {')}} (found ${found || 'none'})`,
    );
  }
}

/** Every NoticeKey has an entry; legal ⇔ verbatim; `/licenses/…` links point at a served licence file. */
function checkNoticeEntries(licences: LicencesFile, licenceFiles: ReadonlySet<string>, report: Report): void {
  for (const key of NoticeKeySchema.options) {
    const notice = licences.notices[key];
    if (notice === undefined) {
      report('notice', `notices[${key}]`, 'notice has no strings (all three locales are required)');
      continue;
    }
    if ((notice.kind === 'legal') !== (notice.verbatim !== undefined)) {
      report('notice', `notices[${key}]`, 'a legal notice must carry verbatim text, and only a legal notice may');
    }
    for (const link of notice.links ?? []) {
      if (link.href.startsWith('/licenses/') && !licenceFiles.has(link.href.slice('/licenses/'.length))) {
        report('notice-link', `notices[${key}]`, `${link.href} is not a file under docs/licenses/`);
      }
    }
  }
}

/** requiredNotices exist and are unique; licence-demanded notices are present and worded as the manifest quotes them. */
function checkRequiredNotices(
  tokenizers: readonly TokenizerEntry[],
  licences: LicencesFile,
  assets: ReadonlyMap<string, OracleAsset>,
  report: Report,
): void {
  for (const entry of tokenizers) {
    if (new Set(entry.requiredNotices).size !== entry.requiredNotices.length) {
      report('notice', at(entry), 'requiredNotices must be unique');
    }
    for (const key of entry.requiredNotices) {
      if (licences.notices[key] === undefined) report('notice', at(entry), `required notice ${key} has no strings`);
    }
    const asset = assets.get(entry.asset.manifestId);
    if (asset === undefined) continue;
    for (const rule of LEGAL_NOTICE_RULES.filter((r) => asset.license.spdx.includes(r.spdx))) {
      for (const key of rule.required) {
        if (!entry.requiredNotices.includes(key)) {
          report('legal-notice', at(entry), `${asset.license.spdx} requires the ${key} notice`);
        }
      }
      const quoted = quotedStrings(asset);
      for (const key of rule.fromManifest) {
        const verbatim = licences.notices[key]?.verbatim;
        if (verbatim !== undefined && !matchesQuoted(verbatim, quoted)) {
          report(
            'legal-notice',
            `notices[${key}]`,
            `verbatim text does not match the wording ${asset.id}'s licence requires`,
          );
        }
      }
    }
  }
}

/** All licence and notice rules. */
export function checkLicences(
  tokenizers: readonly TokenizerEntry[],
  licences: LicencesFile,
  manifest: OracleManifest | null,
  licenceFiles: ReadonlySet<string>,
  report: Report,
): void {
  const assets = new Map<string, OracleAsset>((manifest?.assets ?? []).map((a) => [a.id, a]));
  checkLicenceKeys(tokenizers, licences, assets, report);
  checkNoticeEntries(licences, licenceFiles, report);
  checkRequiredNotices(tokenizers, licences, assets, report);
}
