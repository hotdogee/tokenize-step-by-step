/**
 * Svelte compiler options shared by vite-plugin-svelte, svelte-check and eslint-plugin-svelte.
 * Runes only (PD-1, 02 §3).
 * @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig}
 */
export default {
  compilerOptions: { runes: true },
};
