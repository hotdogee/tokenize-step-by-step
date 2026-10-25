<script lang="ts">
  /**
   * The xAI answer as a list in token order (05 §13): id, bytes (hex) and `string_token` per token. For an aligned answer
   * it is the accessible form of the board's live tier — partial tokens and tokens touching a differing boundary say so
   * (the latter also carry the hatched edge). For an unaligned answer it is the **unaligned token strip**: ids and bytes
   * in order, no spans, no flags, never hatched. Long answers show the first `LIMIT` tokens.
   */
  import { TokenFlag } from '@tsbs/core/model/result';
  import { hexByte } from '@tsbs/core/text/utf8';
  import { i18n } from '../i18n/locale.svelte.ts';
  import type { Params } from '../i18n/types.ts';
  import { translateByok, type ByokMessageKey } from './i18n/catalogs.ts';
  import type { XaiAnswer } from './live-state.svelte.ts';
  import { tokenDiffers, type BoundaryDiff } from './live-tier.ts';

  interface Props {
    answer: XaiAnswer;
    /** The comparison with Grok-2 (aligned answers while Grok-2 shows the same text), or null. */
    diff: BoundaryDiff | null;
  }
  let { answer, diff }: Props = $props();

  const LIMIT = 300;
  const tb = (key: ByokMessageKey, params?: Params): string => translateByok(i18n.current, key, params);
  const tier = $derived(answer.alignment.aligned ? answer.alignment : null);
  const shown = $derived(answer.tokens.slice(0, LIMIT));

  function hex(bytes: Uint8Array): string {
    return Array.from(bytes, hexByte).join(' ');
  }
</script>

<div class="tokens">
  <h4 id="byok-xai-tokens">{tier === null ? tb('byok.tokens.unaligned') : tb('byok.tokens')}</h4>
  <ol
    class="strip"
    aria-labelledby="byok-xai-tokens"
    data-testid={tier === null ? 'unaligned-strip' : 'live-token-list'}
  >
    {#each shown as token, t (t)}
      {@const differs = tier !== null && diff !== null && tokenDiffers(tier, diff, t)}
      {@const partial = tier !== null && ((tier.flags[t] ?? 0) & TokenFlag.Partial) !== 0}
      <li class={`tok bd-t${String(t % 8)}`} class:differs data-differs={differs ? '' : undefined}>
        <span class="id mono">{token.id}</span>
        <span class="bytes mono"
          >{token.bytes === null
            ? tb('byok.token.noBytes')
            : token.bytes.length === 0
              ? tb('byok.token.zeroWidth')
              : hex(token.bytes)}</span
        >
        {#if token.text !== null && token.text !== ''}<span class="piece">{token.text}</span>{/if}
        {#if partial}<span class="flag">{tb('byok.token.partial')}</span>{/if}
        {#if differs}<span class="flag">{tb('byok.token.differs')}</span>{/if}
      </li>
    {/each}
  </ol>
  {#if answer.tokens.length > LIMIT}
    <p class="prose byok-muted">{tb('byok.tokens.more', { n: answer.tokens.length - LIMIT })}</p>
  {/if}
</div>

<style>
  .tokens {
    display: grid;
    gap: 0.375rem;
    min-width: 0;
  }

  h4 {
    margin: 0;
    font-size: 0.875rem;
    color: var(--fg-muted);
  }

  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 16rem;
    overflow-y: auto;
  }

  .tok {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    gap: 1px;
    padding: 0.125rem 0.375rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--tint, var(--surface));
    font-size: 0.75rem;
    line-height: 1.2;
  }

  /* A token touching a differing boundary: the two-tone hatch on its leading edge (AD-35: --fg stripe on its tint). */
  .tok.differs {
    padding-left: 0.625rem;
  }

  .tok.differs::before {
    content: '';
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 4px;
    border-radius: var(--radius) 0 0 var(--radius);
    background: repeating-linear-gradient(45deg, var(--fg) 0 1.5px, var(--tint, var(--surface)) 1.5px 3px);
  }

  .id {
    font-weight: 700;
  }

  .bytes {
    font-size: 0.6875rem;
  }

  .piece {
    white-space: pre;
  }

  .flag {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  @media (forced-colors: active) {
    .tok {
      border-color: CanvasText;
    }

    .tok.differs::before {
      forced-color-adjust: none;
      background: repeating-linear-gradient(45deg, Highlight 0 1.5px, Canvas 1.5px 3px);
    }
  }
</style>
