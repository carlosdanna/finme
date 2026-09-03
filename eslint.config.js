import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * The engine-purity rule below is the load-bearing part of this file.
 * If packages/engine can reach React or the DOM, the balance harness stops
 * running headless, and the balance harness is what tells us whether the game
 * accidentally teaches gambling. Do not relax it — ask first.
 */
const ENGINE_FORBIDDEN_IMPORTS = [
  { name: 'react', message: 'packages/engine is pure TypeScript. No React.' },
  { name: 'react-dom', message: 'packages/engine is pure TypeScript. No React.' },
  { name: 'zustand', message: 'packages/engine owns state directly; the store lives in the UI.' },
  { name: 'idb-keyval', message: 'Persistence goes through the StorageAdapter interface, never a store directly.' },
];

const ENGINE_FORBIDDEN_IMPORT_PATTERNS = [
  { group: ['react*', 'react-dom/*'], message: 'packages/engine is pure TypeScript. No React.' },
  { group: ['@finme/ui', '@finme/ui/*'], message: 'The engine must never import the UI.' },
  { group: ['**/packages/ui/**'], message: 'The engine must never import the UI.' },
];

/** Browser globals the engine must not touch, plus the determinism bans. */
const ENGINE_FORBIDDEN_GLOBALS = [
  { name: 'window', message: 'No browser APIs in the engine. It must run identically in Node.' },
  { name: 'document', message: 'No browser APIs in the engine. It must run identically in Node.' },
  { name: 'navigator', message: 'No browser APIs in the engine. It must run identically in Node.' },
  { name: 'localStorage', message: 'Persistence goes through the StorageAdapter interface.' },
  { name: 'sessionStorage', message: 'Persistence goes through the StorageAdapter interface.' },
  { name: 'indexedDB', message: 'Persistence goes through the StorageAdapter interface.' },
  { name: 'fetch', message: 'No network in the engine.' },
  { name: 'alert', message: 'No browser APIs in the engine.' },
  { name: 'parseFloat', message: 'All currency is integer cents (TDD §0). parseFloat invites float dollars back in.' },
];

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    '**/dev-dist/**',
    '**/coverage/**',
    'packages/ui/src/components/ui/**',
  ]),

  // Baseline for every TypeScript file in the workspace.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // packages/engine — the purity rules.
  {
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ENGINE_FORBIDDEN_IMPORTS, patterns: ENGINE_FORBIDDEN_IMPORT_PATTERNS },
      ],
      'no-restricted-globals': ['error', ...ENGINE_FORBIDDEN_GLOBALS],
      // Determinism (TDD §2): every draw comes from a named seeded stream.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random() is banned in the engine. Use a named seeded RNG stream (TDD §2.2).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'All currency is integer cents (TDD §0). parseFloat is banned in the engine.',
        },
        {
          selector: "MemberExpression[object.name='Number'][property.name='parseFloat']",
          message: 'All currency is integer cents (TDD §0). parseFloat is banned in the engine.',
        },
      ],
    },
  },

  // packages/sim — headless too. Engine and content only.
  {
    files: ['packages/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ENGINE_FORBIDDEN_IMPORTS,
          patterns: ENGINE_FORBIDDEN_IMPORT_PATTERNS,
        },
      ],
      'no-restricted-globals': ['error', ...ENGINE_FORBIDDEN_GLOBALS.filter((g) => g.name !== 'parseFloat')],
    },
  },

  // packages/ui — React, browser globals allowed.
  {
    files: ['packages/ui/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Persistence goes through the StorageAdapter; only the adapter itself may
      // reach a real store. See CLAUDE.md and BUILD-PLAN Part 2b.
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Only WebStorageAdapter may touch a store directly.' },
        { name: 'indexedDB', message: 'Only WebStorageAdapter may touch a store directly.' },
      ],
    },
  },
  {
    files: ['packages/ui/src/storage/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },

  // Config files.
  {
    files: ['**/*.config.{ts,js}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
]);
