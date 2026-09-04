import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The UI's own runner: jsdom, because these tests mount real components.
 * The root config covers the headless packages.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    // Registers Testing Library's auto-cleanup, so renders do not stack up.
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
