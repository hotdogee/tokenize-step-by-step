/**
 * Precomputed example results while a tokenizer loads (AD-16, 05 §12): every example chip × tokenizer was computed from
 * the golden fixtures at build time. The default chip on each lab's primary tokenizer is inlined in the main bundle
 * (`generated/examples-default.json`, PA-19); the others are the lazy `examples/<tokenizer>.<sha8>.json` files
 * (`examples-index.json` › `files`), fetched on the first lookup for that tokenizer and expanded by `fromFixtureCase`
 * on the main thread. Best effort: a text that is no chip, a missing file or an option the wire cannot express (special
 * tokens matched, NFKC) answers `null`, and the board waits for the engine instead.
 */
import type { EncodeOptions, TokenizationResult, TokenizerId } from '@tsbs/core';
import type { ExamplesWire } from '@tsbs/core/fixture/examples-wire';
import { fromFixtureCase, type FixtureTokenizerRef } from '@tsbs/core/fixture/from-fixture-case';

type Fetch = (url: string) => Promise<Response>;

/** What AppState asks of a precomputed source (tests pass their own). */
export interface PrecomputedSource {
  /** The precomputed result of `text` on `ref` with `options`, or null when there is none. */
  find(ref: FixtureTokenizerRef, text: string, options: EncodeOptions): Promise<TokenizationResult | null>;
}

/** The case of `wire` whose text is `text`, or null. */
function caseOf(wire: ExamplesWire | null, text: string): string | null {
  if (wire === null) return null;
  for (const [name, wireCase] of Object.entries(wire.cases)) if (wireCase.text === text) return name;
  return null;
}

export class PrecomputedExamples implements PrecomputedSource {
  readonly #files: Readonly<Partial<Record<TokenizerId, string>>>;
  readonly #fetch: Fetch;
  readonly #inline = new Map<TokenizerId, ExamplesWire>();
  readonly #lazy = new Map<TokenizerId, Promise<ExamplesWire | null>>();

  /** `inline`: wires already in the bundle (the default rows). */
  constructor(
    files: Readonly<Partial<Record<TokenizerId, string>>>,
    inline: readonly ExamplesWire[] = [],
    fetchImpl?: Fetch,
  ) {
    this.#files = files;
    this.#fetch = fetchImpl ?? ((url) => fetch(url, { credentials: 'omit' }));
    for (const wire of inline) this.#inline.set(wire.tokenizer, wire);
  }

  async find(ref: FixtureTokenizerRef, text: string, options: EncodeOptions): Promise<TokenizationResult | null> {
    if (options.specialTokens !== 'as-text' || options.normalize !== 'none') return null;
    const inline = this.#inline.get(ref.id) ?? null;
    const inlineCase = caseOf(inline, text);
    if (inline !== null && inlineCase !== null) return expand(inline, inlineCase, ref, options);
    const lazy = await this.#lazyWire(ref.id);
    const lazyCase = caseOf(lazy, text);
    return lazy === null || lazyCase === null ? null : expand(lazy, lazyCase, ref, options);
  }

  /** The tokenizer's lazy examples file, fetched once; a failed fetch (offline, stale deploy) is retried next time. */
  #lazyWire(id: TokenizerId): Promise<ExamplesWire | null> {
    const cached = this.#lazy.get(id);
    if (cached !== undefined) return cached;
    const url = this.#files[id];
    const wire: Promise<ExamplesWire | null> =
      url === undefined
        ? Promise.resolve(null)
        : this.#fetch(url).then(
            async (response) => {
              if (!response.ok) return null;
              const data = (await response.json()) as ExamplesWire;
              return data.tokenizer === id ? data : null;
            },
            () => null,
          );
    this.#lazy.set(id, wire);
    void wire.then((value) => {
      if (value === null) this.#lazy.delete(id);
    });
    return wire;
  }
}

function expand(
  wire: ExamplesWire,
  name: string,
  ref: FixtureTokenizerRef,
  options: EncodeOptions,
): TokenizationResult | null {
  try {
    return fromFixtureCase(wire, name, ref, { addBos: options.addBos });
  } catch {
    return null; // a wire this runtime cannot expand: the engine answers instead
  }
}
