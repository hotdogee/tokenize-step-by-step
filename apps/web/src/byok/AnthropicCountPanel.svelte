<script lang="ts">
  /**
   * Anthropic count panel (05 §13), paired with the legacy Claude vocabulary: key (masked), auth scheme (Bearer default,
   * `x-api-key` option), model (byok.json, each with its frame tokens), optional workspace id; one `count_tokens`
   * request per click, the button disabled while it is pending. The answer reads "API total N (includes ≈ f frame
   * tokens → ≈ N−f content tokens) vs legacy-vocabulary count M; boundaries are not available"; M is the board's count
   * while the legacy tokenizer shows this text (otherwise a button selects it). Failures appear in a `role="alert"`.
   */
  import { onDestroy } from 'svelte';
  import { byok } from '@tsbs/registry/byok';
  import { appState } from '../app/context.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import type { Params } from '../i18n/types.ts';
  import { anthropicRequest, countSummary, frameTokensOf, parseCountTokens, type AnthropicAuth } from './anthropic.ts';
  import ErrorAlert from './ErrorAlert.svelte';
  import { mapFailure, type ByokError } from './errors.ts';
  import { translateByok, type ByokMessageKey } from './i18n/catalogs.ts';
  import KeyField from './KeyField.svelte';
  import { keys } from './keys.svelte.ts';
  import { answers } from './live-state.svelte.ts';
  import { pairedEntry } from './pairing.ts';
  import { callProvider } from './request.ts';

  const app = appState();
  const config = byok.anthropic;
  const paired = pairedEntry('anthropic-count');
  const host = new URL(config.endpoint).host;
  const AUTH_KEYS = {
    bearer: 'byok.anthropic.auth.bearer',
    'x-api-key': 'byok.anthropic.auth.xApiKey',
  } as const satisfies Record<AnthropicAuth, ByokMessageKey>;

  let auth: AnthropicAuth = $state(config.defaultAuth);
  let model = $state(config.models[0]?.id ?? '');
  let workspaceId = $state('');
  let pending = $state(false);
  let error: ByokError | null = $state.raw(null);
  let controller: AbortController | null = null;

  const tb = (key: ByokMessageKey, params?: Params): string => translateByok(i18n.current, key, params);
  const answer = $derived(answers.anthropic);
  const stale = $derived(answer !== null && answer.text !== app.text);
  const legacy = $derived(
    answer !== null && !stale && app.tokenizer === paired.id ? (app.currentResult?.stats.tokens ?? null) : null,
  );
  const ready = $derived(keys.anthropic.trim() !== '' && app.text !== '');

  async function run(): Promise<void> {
    if (pending || !ready) return;
    const key = keys.anthropic;
    const text = app.text;
    const chosen = model;
    pending = true;
    error = null;
    controller = new AbortController();
    const outcome = await callProvider(
      anthropicRequest(config, { key, auth, model: chosen, workspaceId, text }),
      controller.signal,
    );
    controller = null;
    pending = false;
    if (!outcome.ok) {
      if ('failure' in outcome) error = mapFailure('anthropic', outcome.failure, key);
      return;
    }
    const total = parseCountTokens(outcome.json);
    if (total === null) {
      error = mapFailure('anthropic', { kind: 'bad-response' }, key);
      return;
    }
    answers.anthropic = { text, model: chosen, summary: countSummary(total, frameTokensOf(config, chosen)) };
  }

  function forget(): void {
    keys.forget('anthropic');
    app.announce(tb('byok.forgotten'));
  }

  onDestroy(() => {
    controller?.abort();
  });
</script>

<section class="byok-panel" data-panel="anthropic-count" aria-labelledby="byok-anthropic-heading">
  <h3 id="byok-anthropic-heading" tabindex="-1">{tb('byok.anthropic.heading')}</h3>
  <p class="prose byok-muted">{tb('byok.anthropic.intro')}</p>
  <KeyField provider="anthropic" label={tb('byok.key')} onenter={() => void run()} />
  <fieldset class="byok-auth">
    <legend>{tb('byok.anthropic.auth')}</legend>
    {#each config.authSchemes as scheme (scheme)}
      <label>
        <input
          type="radio"
          name="byok-anthropic-auth"
          value={scheme}
          checked={auth === scheme}
          data-testid={`auth-${scheme}`}
          onchange={() => {
            auth = scheme;
          }}
        />
        <span class="control-label">{tb(AUTH_KEYS[scheme])}</span>
      </label>
    {/each}
  </fieldset>
  <label class="byok-field">
    <span>{tb('byok.model')}</span>
    <select
      value={model}
      data-testid="anthropic-model"
      onchange={(event) => {
        model = event.currentTarget.value;
      }}
    >
      {#each config.models as row (row.id)}
        <option value={row.id}>{tb('byok.anthropic.modelOption', { model: row.label, n: row.frameTokens })}</option>
      {/each}
    </select>
  </label>
  <label class="byok-field">
    <span>{tb('byok.anthropic.workspace')}</span>
    <input
      type="text"
      autocomplete="off"
      spellcheck="false"
      autocapitalize="off"
      aria-describedby="byok-workspace-hint"
      data-testid="anthropic-workspace"
      value={workspaceId}
      oninput={(event) => {
        workspaceId = event.currentTarget.value;
      }}
    />
  </label>
  <p id="byok-workspace-hint" class="prose byok-muted">{tb('byok.anthropic.workspaceHint')}</p>
  <div class="byok-actions">
    <button
      type="button"
      class="btn byok-run"
      disabled={pending || !ready}
      aria-busy={pending}
      data-testid="anthropic-run"
      onclick={() => void run()}>{tb('byok.anthropic.run')}</button
    >
    <button type="button" class="btn btn-quiet" data-testid="anthropic-forget" onclick={forget}
      >{tb('byok.forget')}</button
    >
  </div>
  {#if app.text === ''}<p class="prose byok-muted">{tb('byok.textEmpty')}</p>{/if}
  {#if pending}<p class="prose byok-muted">{tb('byok.pending', { host })}</p>{/if}
  {#if error !== null}<ErrorAlert {error} provider="anthropic" {host} />{/if}
  <div class="byok-result" role="status" data-testid="anthropic-result">
    {#if answer !== null}
      {@const { total, frame, content } = answer.summary}
      <p class="prose byok-sentence">
        {legacy === null
          ? tb('byok.anthropic.resultAlone', { total, frame, content })
          : tb('byok.anthropic.result', { total, frame, content, legacy })}
      </p>
      {#if stale}<p class="prose byok-muted">{tb('byok.stale')}</p>{/if}
    {/if}
  </div>
  {#if answer !== null && !stale && app.tokenizer !== paired.id}
    <div>
      <button
        type="button"
        class="btn"
        data-testid="anthropic-compare"
        onclick={() => {
          void app.selectTokenizer(paired.id);
        }}>{tb('byok.anthropic.compare')}</button
      >
    </div>
  {/if}
</section>
