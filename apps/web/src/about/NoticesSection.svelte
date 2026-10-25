<script lang="ts">
  /**
   * About › Required notices (05 §14 item 4), rendered prominently and exactly: xAI (Agreement, the exact notice, "Powered
   * by xAI" as a heading-sized line), Meta Llama 3 ("Built with Meta Llama 3", the Notice sentence, Agreement and Use
   * Policy), Gemma 1/2 (Notice, Prohibited Use Policy, Terms copy, the §3.2 restrictions statement), the Apache-2.0 and MIT
   * vocabularies (with the rank-file basis disclosure). Legal strings come verbatim from the registry.
   */
  import { notice, noticeText } from '../app/registry.ts';
  import { at } from '../i18n/about/t.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import { licenceTextUrl } from './licences.ts';

  /** The exact legal string of a notice (licences.json `verbatim`, identical in every locale). */
  const legal = (
    key: 'powered-by-xai' | 'xai-materials-notice' | 'built-with-meta-llama-3' | 'llama3-notice' | 'gemma-notice',
  ) => noticeText(notice(key), 'en');
  /** The Gemma Prohibited Use Policy (the external link of the gemma-terms notice). */
  const gemmaPolicy = notice('gemma-terms').links?.find((link) => link.href.startsWith('https://'))?.href;
</script>

<div class="notices">
  <section aria-labelledby="notice-xai">
    <h3 id="notice-xai">{at('about.notices.xai')}</h3>
    <p class="headline" lang="en">{legal('powered-by-xai')}</p>
    <p class="prose" lang="en">{legal('xai-materials-notice')}</p>
    <p><a href={licenceTextUrl('xai-grok2', 'LICENSE')}>{at('about.notices.agreement')}</a></p>
  </section>

  <section aria-labelledby="notice-llama">
    <h3 id="notice-llama">{at('about.notices.llama')}</h3>
    <p class="headline" lang="en">{legal('built-with-meta-llama-3')}</p>
    <p class="prose" lang="en">{legal('llama3-notice')}</p>
    <p class="links">
      <a href={licenceTextUrl('meta-llama3-model', 'LICENSE')}>{at('about.notices.agreement')}</a>
      <a href={licenceTextUrl('meta-llama3-model', 'USE_POLICY.md')} lang="en">Acceptable Use Policy</a>
    </p>
  </section>

  <section aria-labelledby="notice-gemma">
    <h3 id="notice-gemma">{at('about.notices.gemma')}</h3>
    <p class="prose" lang="en">{legal('gemma-notice')}</p>
    <p class="prose">{at('about.notices.gemmaRestrictions')}</p>
    <p class="links">
      <a href={gemmaPolicy} rel="noopener noreferrer">{at('about.notices.policy')}</a>
      <a href={licenceTextUrl('google-gemma2', 'gemma-terms-of-use.txt')}>{at('about.notices.terms')}</a>
    </p>
  </section>

  <section aria-labelledby="notice-apache">
    <h3 id="notice-apache">{at('about.notices.apache')}</h3>
    <p class="prose">{at('about.notices.apacheBody')}</p>
  </section>

  <section aria-labelledby="notice-mit">
    <h3 id="notice-mit">{at('about.notices.mit')}</h3>
    <p class="prose">{at('about.notices.mitBody')}</p>
    <p class="prose">{noticeText(notice('tiktoken-rank-file-basis'), i18n.current)}</p>
  </section>
</div>

<style>
  .notices {
    display: grid;
    gap: 1rem;
  }

  section {
    padding: 1rem;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 1.0625rem;
  }

  p {
    margin: 0.25rem 0;
  }

  .headline {
    font-size: 1.375rem;
    font-weight: 700;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
  }
</style>
