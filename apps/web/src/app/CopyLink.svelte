<script lang="ts">
  /**
   * "Copy link" (05 §1.1): the page URL with the full state — and the text in `q` when it has at most 2,000 code points —
   * copied to the clipboard and written to the address bar (`history.replaceState`), with a visible confirmation that is
   * also a polite status; when the clipboard refuses (insecure context, denied permission) it says the link is in the
   * address bar instead. This is the only place the text enters the URL.
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import { appState } from './context.ts';
  import { MAX_LINK_TEXT, shareLink } from './url-state.ts';

  const app = appState();
  let message = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    const { url, withText } = shareLink(
      location.href,
      {
        tokenizer: app.tokenizer,
        stage: app.stage,
        step: app.step,
        byteView: app.byteView,
        locale: i18n.current,
        textLang: app.textLang,
      },
      app.text,
    );
    history.replaceState(history.state, '', url);
    let copied = true;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copied = false; // no clipboard (insecure context, permission): only the address bar holds the link
    }
    if (copied) message = withText ? i18n.t('link.copied') : i18n.t('link.copiedWithoutText', { n: MAX_LINK_TEXT });
    else
      message = withText ? i18n.t('link.inAddressBar') : i18n.t('link.inAddressBarWithoutText', { n: MAX_LINK_TEXT });
    clearTimeout(timer);
    timer = setTimeout(() => {
      message = '';
    }, 6000);
  }

  $effect(() => () => {
    clearTimeout(timer);
  });
</script>

<div class="copy-link">
  <button type="button" class="btn btn-quiet" data-testid="copy-link" onclick={() => void copy()}
    >{i18n.t('link.copy')}</button
  >
  <span class="confirm prose" role="status" data-testid="copy-link-status">{message}</span>
</div>

<style>
  .copy-link {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    min-height: 2.5rem;
  }

  .confirm {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }
</style>
