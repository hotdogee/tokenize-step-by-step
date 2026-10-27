/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Short commit SHA of the build (the first 7 characters of `GITHUB_SHA`, or "dev"); defined in vite.config.ts. */
declare const __BUILD_SHA__: string;
/** UTC build date (YYYY-MM-DD); defined in vite.config.ts. */
declare const __BUILD_DATE__: string;
