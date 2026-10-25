<script lang="ts">
  /** WP00 placeholder for `/about/`; WP06 generates the real page from the registry and licences (05 §14). */
  import { APP_TITLE } from '../app/constants.ts';
</script>

<main class="page">
  <h1>About {APP_TITLE}</h1>
  <p>
    A client-side visualizer that shows how a tokenizer turns text into tokens: code points, UTF-8 bytes, pre-tokenizer
    chunks and every BPE merge. Licences and provenance of the shipped vocabularies will be listed here.
  </p>
  <p><a href="/">Back to the tokenizer</a></p>
</main>
