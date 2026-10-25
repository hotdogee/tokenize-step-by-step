/**
 * The example chips' "why" sentences (05 §6), split for the startup budget (PA-7): the default chip's sentence ships with
 * the chips (it is on screen at first paint, and the LCP element on phones), every other one loads the first time
 * another chip is selected — a `?raw` import of `examples.json`, which `plugins/registry-trim.ts` leaves whole. Until
 * then (a few milliseconds) the sentence is empty; a failed import is retried on the next selection.
 */
import type { L10n, Locale } from '@tsbs/registry';
import type { SiteExampleChip } from './registry.ts';

/** `key` → `why` of every chip, from the full `examples.json`. */
export function whyByKey(json: string): Readonly<Record<string, L10n>> {
  const chips = JSON.parse(json) as ReadonlyArray<{ readonly key: string; readonly why?: L10n }>;
  return Object.fromEntries(chips.flatMap((chip) => (chip.why === undefined ? [] : [[chip.key, chip.why] as const])));
}

class ExampleWhy {
  #all: Readonly<Record<string, L10n>> | null = $state.raw(null);
  #loading = false;

  /** The sentence of `chip` in `locale` ('' while it loads). Reactive: reading it re-renders when the sentences arrive. */
  text(chip: SiteExampleChip, locale: Locale): string {
    if (chip.why !== undefined) return chip.why[locale];
    const all = this.#all;
    if (all === null) {
      this.#load();
      return '';
    }
    return all[chip.key]?.[locale] ?? '';
  }

  #load(): void {
    if (this.#loading) return;
    this.#loading = true;
    // Deferred so a template read never writes state during render.
    queueMicrotask(() => {
      void loadRaw().then(
        (raw) => {
          this.#all = whyByKey(raw);
        },
        () => {
          this.#loading = false;
        },
      );
    });
  }
}

/** The full `examples.json` text (a lazy chunk). */
async function loadRaw(): Promise<string> {
  return (await import('@tsbs/registry/data/examples.json?raw')).default;
}

/** The page's store. */
export const exampleWhy = new ExampleWhy();
