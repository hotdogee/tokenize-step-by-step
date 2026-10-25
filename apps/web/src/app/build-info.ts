/**
 * Build stamp (vite.config.ts `define`). `typeof` guards keep modules importable where the constants are not defined
 * (Vitest renders components without the build defines).
 */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'dev';
