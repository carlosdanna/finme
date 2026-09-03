import { defineConfig } from 'vitest/config';

/**
 * Root test runner. Covers packages/engine and packages/sim only — both run
 * headless in Node with no browser. packages/ui gets its own browser-flavoured
 * setup when there is UI to test (prompt 15 onward).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/{engine,sim}/**/*.test.ts'],
    passWithNoTests: true,
  },
});
