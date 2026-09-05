import { expect, test } from '@playwright/test';

/**
 * The PWA — BUILD-PLAN prompt 18.
 *
 * The game has no backend. Every asset is in the bundle and every save lives in
 * the player's own browser, so it should work fully offline. These run against
 * the production build, where the service worker actually exists.
 */
test('serves an installable manifest', async ({ page, request }) => {
  await page.goto('/');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();

  const manifest = await (await request.get(href!)).json();
  expect(manifest.name).toBe('FinMe');
  // Designed at 390x844: portrait, standalone, no browser chrome.
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('portrait');

  const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);
  expect(purposes).toContain('any');
  // Without a maskable icon Android crops the mark into a circle.
  expect(purposes).toContain('maskable');

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
});

test('registers a service worker that precaches the whole game', async ({ page, request }) => {
  await page.goto('/');

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active !== null;
  });
  expect(registered).toBe(true);

  // The precache manifest should carry the app, not just the shell.
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain('precache');
});

test('loads with the network offline', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });

  // Cut the network entirely and reload from the cache alone.
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByText('net worth')).toBeVisible();

  // Not just the shell: the game is playable.
  await page.getByRole('tab', { name: 'Life' }).tap();
  await expect(page.getByText('10 of 10 points')).toBeVisible();

  await context.setOffline(false);
});
