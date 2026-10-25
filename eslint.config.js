// @ts-check
/**
 * ESLint 9 flat config (docs/design/02-architecture.md §2.1, §3, §4; AD-15; PA-2a).
 *
 * - typescript-eslint strictTypeChecked + stylisticTypeChecked (no `any`, no non-null assertions outside tests, no enums).
 * - eslint-plugin-svelte, plus the strict-CSP rules for apps/web: no transition:/in:/out:/animate: directives (they inject
 *   a runtime <style>) and svelte/no-inline-styles (Svelte clones static markup, so a static style="" is an inline style).
 * - Package boundaries: import/no-restricted-paths for relative paths, no-restricted-imports for package specifiers.
 * - eslint-plugin-compat on browser-shipped code against the browserslist floor in package.json (Safari 16.4 / Chrome 109 /
 *   Firefox 115).
 */
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import compat from 'eslint-plugin-compat';
import importPlugin from 'eslint-plugin-import';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteConfig from './apps/web/svelte.config.js';

const NO_ENUM = {
  selector: 'TSEnumDeclaration',
  message: 'Use an `as const` object instead of `enum` (enums are not erasable; 02 §4).',
};
/** PD-5: inline regex modifiers such as (?i:…) are a syntax error before Safari 26; expand them (04 §2.2). */
const NO_REGEX_MODIFIERS = {
  selector: 'Literal[regex.pattern=/\\(\\?[imsx-]*[imsx]:/]',
  message: 'Inline regex modifiers like (?i:…) need Safari 26; expand the alternation instead (PD-5, 04 §2.2).',
};
const NO_MOTION_DIRECTIVES = [
  {
    selector: 'SvelteDirective[kind="Transition"]',
    message:
      'transition:/in:/out: inject a runtime <style> that the strict CSP blocks (AD-15); animate with WAAPI (motion/flip.ts).',
  },
  {
    selector: 'SvelteDirective[kind="Animation"]',
    message:
      'animate: injects a runtime <style> that the strict CSP blocks (AD-15); animate with WAAPI (motion/flip.ts).',
  },
];

const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];
const TOOLING_PACKAGES = ['@tsbs/vocab-tools', '@tsbs/vocab-tools/*', '@tsbs/conformance', '@tsbs/conformance/*'];

/** @param {string} target @param {string[]} from @param {string} message */
const zone = (target, from, message) => ({ target, from, message });

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.claude/**',
      '.wrangler/**',
      'data/**',
      'docs/**',
      'fixtures/**',
      'tools/oracle/**',
      'apps/web/src/generated/**',
      'e2e/playwright-report/**',
      'e2e/test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  svelte.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { node: { extensions: ['.ts', '.js', '.svelte'] } } },
    rules: {
      'no-restricted-syntax': ['error', NO_ENUM],
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // Package boundaries for relative imports (02 §2.1); package specifiers are covered by no-restricted-imports below.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            zone(
              './packages/core',
              [
                './apps',
                './e2e',
                './packages/worker',
                './packages/registry',
                './packages/vocab-tools',
                './packages/conformance',
                './packages/ui-tokens',
              ],
              '@tsbs/core depends on nothing (02 §2.1).',
            ),
            zone(
              './packages/worker',
              [
                './apps',
                './e2e',
                './packages/registry',
                './packages/vocab-tools',
                './packages/conformance',
                './packages/ui-tokens',
              ],
              '@tsbs/worker depends only on @tsbs/core (02 §2.1).',
            ),
            zone(
              './packages/registry',
              [
                './apps',
                './e2e',
                './packages/worker',
                './packages/vocab-tools',
                './packages/conformance',
                './packages/ui-tokens',
              ],
              '@tsbs/registry depends only on @tsbs/core types (02 §2.1).',
            ),
            zone(
              './packages/conformance',
              [
                './apps',
                './e2e',
                './packages/worker',
                './packages/registry',
                './packages/vocab-tools',
                './packages/ui-tokens',
              ],
              '@tsbs/conformance depends only on @tsbs/core (02 §2.1).',
            ),
            zone(
              './packages/vocab-tools',
              ['./apps', './e2e', './packages/worker', './packages/ui-tokens'],
              '@tsbs/vocab-tools depends on core, conformance and registry only (02 §2.1).',
            ),
            zone(
              './packages/ui-tokens',
              [
                './apps',
                './e2e',
                './packages/core',
                './packages/worker',
                './packages/registry',
                './packages/vocab-tools',
                './packages/conformance',
              ],
              '@tsbs/ui-tokens depends on nothing.',
            ),
            zone(
              './apps/web/src',
              [
                './packages/core/src/engines',
                './packages/core/src/format',
                './packages/core/src/agenda',
                './packages/vocab-tools',
                './packages/conformance',
              ],
              'Engines, the TSBV1 format, the agenda loop and Node-only tooling must not reach the main bundle (02 §2.1).',
            ),
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser, svelteConfig } },
  },

  // ---- Browser code of the site (main thread) ----
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.svelte'],
    rules: {
      'no-restricted-syntax': ['error', NO_ENUM, NO_REGEX_MODIFIERS, ...NO_MOTION_DIRECTIVES],
      'svelte/no-inline-styles': ['error', { allowTransitions: false }],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tsbs/core',
              allowTypeImports: true,
              message: 'Import values from @tsbs/core/{model,text,layout,timeline,fixture}/… (02 §2.1).',
            },
            { name: '@tsbs/worker', message: 'apps/web imports @tsbs/worker/client only (02 §2.1).' },
            {
              name: '@tsbs/registry/schema',
              message: 'zod schemas are build/test only (AD-28); import types from @tsbs/registry.',
            },
            { name: 'zod', message: 'zod never ships to the browser (AD-28).' },
          ],
          patterns: [
            {
              group: [
                '@tsbs/core/engines',
                '@tsbs/core/engines/*',
                '@tsbs/core/format',
                '@tsbs/core/format/*',
                '@tsbs/core/agenda',
                '@tsbs/core/agenda/*',
              ],
              message: 'Engines, the TSBV1 format and the agenda loop must not reach the main bundle (02 §2.1).',
            },
            {
              group: ['@tsbs/worker/*', '!@tsbs/worker/client'],
              message: 'apps/web imports @tsbs/worker/client only (02 §2.1).',
            },
            { group: TOOLING_PACKAGES, message: 'Node-only packages never reach the browser (02 §2.1).' },
          ],
        },
      ],
    },
  },

  // ---- Package boundaries for package specifiers (02 §2.1) ----
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', NO_ENUM, NO_REGEX_MODIFIERS],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message: '@tsbs/core is portable: no Node APIs (02 §2.1, §4).',
          })),
          patterns: [{ group: ['@tsbs/*'], message: '@tsbs/core depends on nothing (02 §2.1).' }],
        },
      ],
    },
  },
  {
    files: ['packages/worker/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', NO_ENUM, NO_REGEX_MODIFIERS],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message: '@tsbs/worker runs in a browser Worker: no Node APIs.',
          })),
          patterns: [
            {
              group: ['@tsbs/*', '!@tsbs/core', '!@tsbs/core/*'],
              message: '@tsbs/worker depends only on @tsbs/core (02 §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/registry/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tsbs/core',
              allowTypeImports: true,
              message: '@tsbs/registry uses @tsbs/core for types only (02 §2.1).',
            },
          ],
          patterns: [
            {
              group: ['@tsbs/*', '!@tsbs/core'],
              message: '@tsbs/registry depends only on @tsbs/core types (02 §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/conformance/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tsbs/*', '!@tsbs/core', '!@tsbs/core/*'],
              message: '@tsbs/conformance depends only on @tsbs/core (02 §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/vocab-tools/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@tsbs/*',
                '!@tsbs/core',
                '!@tsbs/core/*',
                '!@tsbs/conformance',
                '!@tsbs/registry',
                '!@tsbs/registry/*',
              ],
              message: '@tsbs/vocab-tools depends on core, conformance and registry only (02 §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui-tokens/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@tsbs/*'], message: '@tsbs/ui-tokens depends on nothing.' }] },
      ],
    },
  },

  // ---- Browser API floor (PD-5) for code that ships to browsers ----
  {
    ...compat.configs['flat/recommended'],
    files: [
      'apps/web/src/**/*.ts',
      'apps/web/src/**/*.svelte',
      'packages/core/src/**/*.ts',
      'packages/worker/src/**/*.ts',
    ],
    ignores: ['**/*.test.ts'],
  },

  // ---- Node tooling, configs and tests ----
  {
    files: [
      '**/*.js',
      'scripts/**',
      'apps/web/plugins/**',
      'packages/vocab-tools/**',
      '**/test/**',
      'e2e/**',
      '**/*.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
