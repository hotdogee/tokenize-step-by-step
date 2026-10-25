<script lang="ts">
  /**
   * xAI tokenize panel (05 §13), paired with Grok-2: key (masked) and model slug (byok.json, default `grok-4.7`); one
   * `tokenize-text` request per click, the button disabled while pending. An aligned answer becomes the board's live
   * token tier under the Grok-2 tokens (LiveTierRow) and the panel says "matches Grok-2 ✓ on this text" or "k of n
   * boundaries differ"; an answer whose bytes do not concatenate to the text says "could not align the API tokens to your
   * text ({matched} of {total} bytes matched)" and is shown only as an unaligned strip (TokenList) — never hatched. The
   * token list is also the accessible form of the live tier (which is decorative on the board).
   */
  import { onDestroy } from 'svelte';
  import { byok } from '@tsbs/registry/byok';
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import type { Params } from '../i18n/types.ts';
  import ErrorAlert from './ErrorAlert.svelte';
  import { mapFailure, type ByokError } from './errors.ts';
  import { translateByok, type ByokMessageKey } from './i18n/catalogs.ts';
  import KeyField from './KeyField.svelte';
  import { keys } from './keys.svelte.ts';
  import { answers } from './live-state.svelte.ts';
  import { alignLiveTokens, diffFor } from './live-tier.ts';
  import LiveTierRow from './LiveTierRow.svelte';
  import { pairedEntry } from './pairing.ts';
  import { callProvider } from './request.ts';
  import TokenList from './TokenList.svelte';
  import { parseTokenizeText, xaiRequest } from './xai.ts';

  const app = appState();
  const config = byok.xai;
  const paired = pairedEntry('xai-tokenize');
  const host = new URL(config.endpoint).host;

  let model = $state(config.defaultModel);
  let pending = $state(false);
  let error: ByokError | null = $state.raw(null);
  let controller: AbortController | null = null;

  const tb = (key: ByokMessageKey, params?: Params): string => translateByok(i18n.current, key, params);
  const answer = $derived(answers.xai);
  const stale = $derived(answer !== null && answer.text !== app.text);
  const reference = $derived(answer !== null && !stale && app.tokenizer === paired.id ? app.currentResult : null);
  const diff = $derived(
    answer?.alignment.aligned === true && reference !== null ? diffFor(answer.alignment, reference) : null,
  );
  const ready = $derived(keys.xai.trim() !== '' && app.text !== '');

  async function run(): Promise<void> {
    if (pending || !ready) return;
    const key = keys.xai;
    const text = app.text;
    const chosen = model;
    pending = true;
    error = null;
    controller = new AbortController();
    const outcome = await callProvider(xaiRequest(config, { key, model: chosen, text }), controller.signal);
    controller = null;
    pending = false;
    if (!outcome.ok) {
      if ('failure' in outcome) error = mapFailure('xai', outcome.failure, key);
      return;
    }
    const tokens = parseTokenizeText(outcome.json);
    if (tokens === null) {
      error = mapFailure('xai', { kind: 'bad-response' }, key);
      return;
    }
    const alignment = alignLiveTokens(text, tokens, { id: paired.id, family: paired.family });
    answers.setXai({ text, model: chosen, tokens, alignment }, { tokenizer: paired.id, row: LiveTierRow });
  }

  function forget(): void {
    keys.forget('xai');
    app.announce(tb('byok.forgotten'));
  }

  onDestroy(() => {
    controller?.abort();
  });
</script>

<section class="byok-panel" data-panel="xai-tokenize" aria-labelledby="byok-xai-heading">
  <h3 id="byok-xai-heading" tabindex="-1">{tb('byok.xai.heading')}</h3>
  <p class="prose byok-muted">{tb('byok.xai.intro')}</p>
  <KeyField provider="xai" label={tb('byok.key')} onenter={() => void run()} />
  <label class="byok-field">
    <span>{tb('byok.model')}</span>
    <select
      value={model}
      data-testid="xai-model"
      onchange={(event) => {
        model = event.currentTarget.value;
      }}
    >
      {#each config.models as row (row.id)}
        <option value={row.id}>{row.label} · {row.id}</option>
      {/each}
    </select>
  </label>
  <div class="byok-actions">
    <button
      type="button"
      class="btn byok-run"
      disabled={pending || !ready}
      aria-busy={pending}
      data-testid="xai-run"
      onclick={() => void run()}>{tb('byok.xai.run')}</button
    >
    <button type="button" class="btn btn-quiet" data-testid="xai-forget" onclick={forget}>{tb('byok.forget')}</button>
  </div>
  {#if app.text === ''}<p class="prose byok-muted">{tb('byok.textEmpty')}</p>{/if}
  {#if pending}<p class="prose byok-muted">{tb('byok.pending', { host })}</p>{/if}
  {#if error !== null}<ErrorAlert {error} provider="xai" {host} />{/if}
  <div class="byok-result" role="status" data-testid="xai-result">
    {#if answer !== null}
      <p class="prose">{tb('byok.xai.count', { model: answer.model, n: answer.tokens.length })}</p>
      {#if !answer.alignment.aligned}
        <p class="prose byok-sentence" data-testid="xai-alignment" data-aligned="false">
          {tb('byok.xai.unaligned', { matched: answer.alignment.matched, total: answer.alignment.total })}
        </p>
      {:else if diff !== null}
        <p
          class="prose byok-sentence"
          data-testid="xai-alignment"
          data-aligned="true"
          data-differing={diff.differing.length}
        >
          {diff.differing.length === 0
            ? tb('byok.xai.matches')
            : tb('byok.xai.differ', { k: diff.differing.length, n: diff.union })}
        </p>
      {/if}
      {#if stale}<p class="prose byok-muted">{tb('byok.stale')}</p>{/if}
    {/if}
  </div>
  {#if answer !== null && answer.alignment.aligned && !stale && app.tokenizer !== paired.id}
    <div>
      <button
        type="button"
        class="btn"
        data-testid="xai-compare"
        onclick={() => {
          void app.selectTokenizer(paired.id);
        }}>{tb('byok.xai.compare')}</button
      >
    </div>
  {/if}
  {#if answer !== null}<TokenList {answer} {diff} />{/if}
</section>
