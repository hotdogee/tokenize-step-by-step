<script lang="ts">
  /**
   * `/about/` (05 §14), generated from the licence data + models + tokenizers: what the site shows and does not claim,
   * the fidelity table, one licence block per shipped asset, the required notices, engine notes, keyboard help (with the
   * "Single-key shortcuts" setting), privacy, translations and diagnostics (no Worker, no vocabulary).
   */
  import { onMount } from 'svelte';
  import { BUILD_DATE, BUILD_SHA } from '../app/build-info.ts';
  import { at } from '../i18n/about/t.ts';
  import { i18n } from '../i18n/locale.svelte.ts';
  import Footer from '../shell/Footer.svelte';
  import Header from '../shell/Header.svelte';
  import ShortcutTable from '../shell/ShortcutTable.svelte';
  import SingleKeySetting from '../shell/SingleKeySetting.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import FidelityTable from './FidelityTable.svelte';
  import LicenceBlock from './LicenceBlock.svelte';
  import { LICENCES } from './licences.ts';
  import { GEMMA4_CROSS_CHECK } from './cross-check.ts';
  import NoticesSection from './NoticesSection.svelte';
  import { detectUnicodeVersion, PRETOKENIZER_UNICODE } from './unicode.ts';

  const SECTIONS = [
    { id: 'what', key: 'about.intro.heading' },
    { id: 'fidelity', key: 'about.fidelity.heading' },
    { id: 'licences', key: 'about.licences.heading' },
    { id: 'notices', key: 'about.notices.heading' },
    { id: 'engine', key: 'about.engine.heading' },
    { id: 'keyboard', key: 'about.keyboard.heading' },
    { id: 'privacy', key: 'about.privacy.heading' },
    { id: 'translations', key: 'about.translations.heading' },
    { id: 'diagnostics', key: 'about.diagnostics.heading' },
  ] as const;

  /** Oracle versions and the fixture date (tools/oracle, 02 §3). */
  const ORACLES = { tiktoken: '0.14.0', sentencepiece: '0.2.2', tokenizers: '0.23.3', date: '2026-10-25' } as const;

  let browserUnicode: string | null = $state(null);

  onMount(() => {
    i18n.setPage('about');
    browserUnicode = detectUnicodeVersion();
  });
</script>

<Header home={false} skipTarget="#about-main" skipLabel={i18n.t('nav.skipMain')} />

<main class="page about" id="about-main">
  <h1>{at('about.heading')}</h1>
  <nav class="toc" aria-labelledby="toc-heading">
    <h2 id="toc-heading" class="toc-heading">{at('about.toc')}</h2>
    <ul>
      {#each SECTIONS as section (section.id)}
        <li><a href={`#${section.id}`}>{at(section.key)}</a></li>
      {/each}
    </ul>
  </nav>

  <section id="what" aria-labelledby="what-heading">
    <h2 id="what-heading">{at('about.intro.heading')}</h2>
    <p class="prose">{at('about.intro.body')}</p>
    <h3>{at('about.intro.notClaimed')}</h3>
    <ul class="prose">
      <li>{at('about.intro.claude')}</li>
      <li>{at('about.intro.inferred')}</li>
      <li>{at('about.intro.ctok')}</li>
    </ul>
  </section>

  <section id="fidelity" aria-labelledby="fidelity-heading">
    <h2 id="fidelity-heading">{at('about.fidelity.heading')}</h2>
    <FidelityTable />
  </section>

  <section id="licences" aria-labelledby="licences-heading">
    <h2 id="licences-heading">{at('about.licences.heading')}</h2>
    <p class="prose">{at('about.licences.intro')}</p>
    <div class="licences" data-testid="licences">
      {#each LICENCES.assets as licence (licence.assetId)}
        <LicenceBlock {licence} />
      {/each}
    </div>
  </section>

  <section id="notices" aria-labelledby="notices-heading">
    <h2 id="notices-heading">{at('about.notices.heading')}</h2>
    <NoticesSection />
  </section>

  <section id="engine" aria-labelledby="engine-heading">
    <h2 id="engine-heading">{at('about.engine.heading')}</h2>
    <ul class="prose">
      <li>
        {at('about.engine.unicode', { version: PRETOKENIZER_UNICODE })}
        {browserUnicode === null
          ? at('about.engine.browserUnicodeUnknown')
          : at('about.engine.browserUnicode', { version: browserUnicode })}
      </li>
      <li>{at('about.engine.oracles', ORACLES)}</li>
      <li>{at('about.engine.gemma4')}</li>
      <li>
        {at('about.engine.crossCheck', {
          library: GEMMA4_CROSS_CHECK.library,
          version: GEMMA4_CROSS_CHECK.version,
          agreed: GEMMA4_CROSS_CHECK.agreed,
          total: GEMMA4_CROSS_CHECK.total,
        })}
        <ul lang="en">
          {#each GEMMA4_CROSS_CHECK.disagreements as item (item.name)}
            <li><code>{item.name}</code>: {item.explanation}</li>
          {/each}
        </ul>
      </li>
      <li>{at('about.engine.nfkc')}</li>
      <li>{at('about.engine.cl100k')}</li>
      <li>{at('about.engine.build', { sha: BUILD_SHA, date: BUILD_DATE })}</li>
    </ul>
  </section>

  <section id="keyboard" aria-labelledby="keyboard-heading">
    <h2 id="keyboard-heading">{at('about.keyboard.heading')}</h2>
    <SingleKeySetting id="about-single-key" />
    <div class="shortcuts"><ShortcutTable /></div>
  </section>

  <section id="privacy" aria-labelledby="privacy-heading">
    <h2 id="privacy-heading">{at('about.privacy.heading')}</h2>
    <p class="prose">{at('about.privacy.body')}</p>
  </section>

  <section id="translations" aria-labelledby="translations-heading">
    <h2 id="translations-heading">{at('about.translations.heading')}</h2>
    <p class="prose">{at('about.translations.body')}</p>
  </section>

  <section id="diagnostics" aria-labelledby="diagnostics-heading">
    <h2 id="diagnostics-heading">{at('about.diagnostics.heading')}</h2>
    <Diagnostics />
  </section>

  <p><a href="/">{i18n.t('nav.home')}</a></p>
</main>

<Footer />

<style>
  .about {
    display: grid;
    gap: 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
  }

  section {
    min-width: 0;
    scroll-margin-top: 1rem;
  }

  section > h2 {
    margin: 0 0 0.5rem;
    font-size: 1.375rem;
  }

  h3 {
    font-size: 1rem;
  }

  .toc-heading {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    color: var(--fg-muted);
  }

  .toc ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .toc a {
    display: inline-block;
    padding-block: 0.25rem;
  }

  .licences {
    display: grid;
    gap: 1rem;
  }

  .shortcuts {
    margin-top: 1rem;
  }
</style>
