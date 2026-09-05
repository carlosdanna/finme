import { expect, test } from '@playwright/test';

/**
 * The wide breakpoint.
 *
 * Desktop is not the design target, so this checks only the two places the
 * layout is *meant* to change — everything else should look like the phone
 * layout with more room around it.
 */
test('the Debts panel becomes a table above md:', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Money' }).click();
  await page.getByRole('button', { name: 'Debts' }).click();

  const table = page.locator('table');
  const cards = page.locator('[data-slot="item-group"]');

  // Nothing in the tick opens a credit line yet, so a fresh run carries no
  // debt and the panel shows its empty state. The layout swap becomes testable
  // the moment borrowing is a player action — the same gap that leaves C2
  // invalid. Skipping states that plainly rather than passing on nothing.
  if ((await table.count()) === 0 && (await cards.count()) === 0) {
    await expect(page.getByText('Nothing owed.')).toBeVisible();
    test.skip(true, 'no debt exists yet: borrowing is not a player action');
  }

  // Above md: the table is the visible layout and the card list is not.
  await expect(table.first()).toBeVisible();
  await expect(cards.first()).toBeHidden();
});

test('the event modal is a centred dialog above md:, not a full-width sheet', async ({ page }) => {
  await page.goto('/');
  const advance = page.getByRole('button', { name: 'Advance', exact: true });

  for (let i = 0; i < 12; i++) {
    if (await page.getByRole('dialog').isVisible().catch(() => false)) break;
    await advance.click();
    await page.waitForTimeout(60);
  }

  const dialog = page.getByRole('dialog');
  test.skip(!(await dialog.isVisible().catch(() => false)), 'no event fired in 12 advances');

  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  // Centred and constrained, rather than spanning the viewport.
  expect(box.width).toBeLessThan(viewport.width * 0.7);
  expect(box.x).toBeGreaterThan(viewport.width * 0.1);
});
