<script lang="ts">
  /**
   * WP00 placeholder shell: the app title and the default example text (OD-1) as plain text. WP06 replaces it with the
   * real header, input, notices and footer; WP13 wires the board, rail and inspector.
   */
  import { APP_TITLE, DEFAULT_EXAMPLE } from './constants.ts';
</script>

<header class="header">
  <h1 class="wordmark">{APP_TITLE}</h1>
</header>
<main class="page">
  <p class="example" lang="zh-Hant-TW">{DEFAULT_EXAMPLE}</p>
  <p class="about"><a href="/about/">About</a></p>
</main>

<style>
  .header {
    border-block-end: 1px solid var(--border);
    background: var(--surface);
    padding: 0.75rem 1rem;
  }

  .wordmark {
    margin: 0;
    font-size: 1.25rem;
  }

  .example {
    font-size: 2.5rem;
    letter-spacing: 0.05em;
    margin: 2rem 0 1rem;
  }
</style>
