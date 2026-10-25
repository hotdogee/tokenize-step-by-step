<script lang="ts">
  /** The localized 404 page (served by Cloudflare's `not_found_handling: 404-page`, 06 §5). */
  import { onMount } from 'svelte';
  import { i18n } from '../i18n/locale.svelte.ts';
  import Footer from '../shell/Footer.svelte';
  import Header from '../shell/Header.svelte';

  onMount(() => {
    i18n.setPage('notFound');
  });
</script>

<Header home={false} skipTarget="#not-found" skipLabel={i18n.t('nav.skipMain')} />
<main class="page" id="not-found">
  <h1>{i18n.t('notFound.heading')}</h1>
  <p class="prose">{i18n.t('notFound.body')}</p>
  <p><a href="/">{i18n.t('notFound.back')}</a></p>
</main>
<Footer />
