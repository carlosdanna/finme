import { expect, type Page } from '@playwright/test';

/**
 * Get past the new-run screen and into a game. Pinned to the golden seed, so an
 * e2e failure is reproducible from the same world the engine fixtures use.
 *
 * `click` rather than `tap`, because the desktop project runs without touch.
 * That the screen works by tap alone is asserted in `new-run.spec.ts`.
 */
export async function beginRun(page: Page, seed = '4F2A9C1B'): Promise<void> {
  const field = page.getByLabel('Seed', { exact: true });
  await expect(field).toBeVisible();
  await field.fill(seed);

  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
}
