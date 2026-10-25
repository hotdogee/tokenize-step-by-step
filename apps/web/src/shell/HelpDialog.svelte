<script lang="ts">
  /** The `?` help dialog (AD-22): the keyboard map and the "Single-key shortcuts" setting. */
  import { i18n } from '../i18n/locale.svelte.ts';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';
  import ShortcutTable from './ShortcutTable.svelte';
  import SingleKeySetting from './SingleKeySetting.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();
</script>

<Dialog {open} labelledby="help-title" {onclose}>
  <div class="head">
    <h2 id="help-title">{i18n.t('help.title')}</h2>
    <button type="button" class="btn btn-icon btn-quiet" aria-label={i18n.t('help.close')} onclick={onclose}>
      <Icon name="close" />
    </button>
  </div>
  <p class="prose intro">{i18n.t('help.intro')}</p>
  <SingleKeySetting id="help-single-key" />
  <div class="table">
    <ShortcutTable />
  </div>
</Dialog>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  .intro {
    margin: 0.25rem 0 0.75rem;
  }

  .table {
    margin-top: 1rem;
  }
</style>
