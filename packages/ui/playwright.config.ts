import { defineConfig, devices } from '@playwright/test';

/**
 * The device pass.
 *
 * **The default viewport is a phone, not a desktop.** 390x844 is the design
 * target; 360x740 is the narrower Android that catches anything tuned to the
 * iPhone width. Desktop is checked only where the layout is meant to change.
 *
 * Runs against the production build rather than the dev server, so the service
 * worker, the precache manifest and the minified CSS are the ones under test.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Touch, not mouse: nothing in this game may depend on hover.
    hasTouch: true,
    isMobile: true,
  },
  projects: [
    /*
     * Both mobile projects run on Chromium rather than each device's default
     * engine. The CPU-throttling check needs CDP, which is Chromium-only, and
     * running one engine keeps the pass fast enough to be routine.
     *
     * That leaves a real gap: WebKit is where the safe-area insets and the
     * storage eviction §14.2 warns about actually bite. Installing webkit and
     * adding a project would close it — see docs/DECISIONS.md.
     */
    {
      name: 'iphone-390',
      use: {
        ...devices['iPhone 12'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
      // `testMatch` on the desktop project only adds; the phones must opt out.
      testIgnore: /.*\.desktop\.spec\.ts/,
    },
    {
      name: 'android-360',
      use: {
        ...devices['Pixel 5'],
        browserName: 'chromium',
        viewport: { width: 360, height: 740 },
      },
      testIgnore: /.*\.desktop\.spec\.ts/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], hasTouch: false, isMobile: false },
      testMatch: /.*\.desktop\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
  },
});
