/**
 * The Examples menu's groups (PA-19, 05 §6): app code keyed by chip key, so the registry schema stays as it is. A chip
 * missing from the table falls back to its `lang` (`zh-Hant`, `ja`, `en`; `auto` → mixed), so a new chip still lands in a
 * group.
 */
import type { SiteExampleChip } from '../app/registry.ts';

export type ExampleGroup = 'zhHant' | 'ja' | 'en' | 'mixed';

/** Display order of the groups. */
export const EXAMPLE_GROUPS: readonly ExampleGroup[] = ['zhHant', 'ja', 'en', 'mixed'];

const GROUP_OF: Readonly<Record<string, ExampleGroup>> = {
  'zh-tw-tainan': 'zhHant',
  'zh-tw-taiwan-formal': 'zhHant',
  'zh-tw-renao': 'zhHant',
  'cjk-turtle': 'zhHant',
  'cjk-ext-g-biang': 'zhHant',
  'zh-date': 'zhHant',
  bopomofo: 'zhHant',
  'zh-tw-paragraph': 'zhHant',
  'cjk-saba': 'ja',
  'ja-text': 'ja',
  'ja-shibuya-ramen': 'ja',
  'ja-paragraph': 'ja',
  'en-contraction-code': 'en',
  'fullwidth-latin': 'en',
  'en-paragraph': 'en',
  'mixed-hello-taiwan-tokyo': 'mixed',
  'emoji-family-zwj': 'mixed',
  'emoji-flag-tw': 'mixed',
  'emoji-heart-vs16': 'mixed',
};

const BY_LANG: Readonly<Record<SiteExampleChip['lang'], ExampleGroup>> = {
  'zh-Hant': 'zhHant',
  ja: 'ja',
  en: 'en',
  auto: 'mixed',
};

/** The group of `chip`. */
export function groupOf(chip: Pick<SiteExampleChip, 'key' | 'lang'>): ExampleGroup {
  return GROUP_OF[chip.key] ?? BY_LANG[chip.lang];
}

/** `chips` by group, in group order (registry order inside a group), empty groups left out. */
export function groupChips<T extends Pick<SiteExampleChip, 'key' | 'lang'>>(
  chips: readonly T[],
): ReadonlyArray<{ readonly group: ExampleGroup; readonly chips: readonly T[] }> {
  return EXAMPLE_GROUPS.map((group) => ({ group, chips: chips.filter((chip) => groupOf(chip) === group) })).filter(
    (entry) => entry.chips.length > 0,
  );
}
