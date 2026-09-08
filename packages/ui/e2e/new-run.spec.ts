import { expect, test } from '@playwright/test';
import { MIN_TOUCH_TARGET, expectTouchTargets, hitArea } from './support/touch.ts';

/**
 * The new-run screen.
 *
 * The first screen a player sees, and the one that has to work before anything
 * else does. Everything here is by tap, with no pointer at all — the seed field
 * and the reroll button are the two controls a player uses before they have any
 * idea how the game works, so neither may depend on hover or on a mouse.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A new life' })).toBeVisible();
});

test('every target on the setup screen clears 44px', async ({ page }) => {
  await expectTouchTargets(page, 'new run');

  // The two that are drawn smaller than their target and reach it through an
  // `::after` overlay, so a regression in that technique is named rather than
  // being one line in a sweep.
  for (const label of ['One year older', 'One year younger']) {
    const box = (await hitArea(page.getByRole('button', { name: label })))!;
    expect(box.width, label).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(box.height, label).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  }
});

test('starts a run from a typed seed, name and age', async ({ page }) => {
  await page.getByLabel('Your name').fill('Rosa');
  await page.getByLabel('Seed', { exact: true }).fill('4F2A9C1B');

  // Tap, not click: the setup screen must work with no pointer at all.
  await page.getByRole('button', { name: '10 yr' }).tap();
  await page.getByRole('button', { name: 'One year older' }).tap();
  await page.getByRole('button', { name: 'Begin' }).tap();

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  // The name and the seed the player set, read back off the dashboard. The seed
  // carries its ruleset (§2.3) because that is the form it gets shared in.
  await expect(page.getByText('Rosa')).toBeVisible();
  await expect(page.getByText(/^4F2A9C1B\/v\d+\.\d+\.\d+$/)).toBeVisible();

  // Age 23 rather than the default 22, so the stepper reached engine state
  // rather than only the form.
  await expect(page.getByText(/·\s*23$/)).toBeVisible();
});

test('rerolling changes the world the run starts in', async ({ page }) => {
  const field = page.getByLabel('Seed', { exact: true });
  const before = await field.inputValue();

  await page.getByRole('button', { name: 'Reroll the seed' }).tap();
  const after = await field.inputValue();

  expect(after).not.toBe(before);
  expect(after).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
});

test('a seed typed in lower case with a dash is still that seed', async ({ page }) => {
  // GDD §13 has players reading seeds to each other and writing them down.
  await page.getByLabel('Seed', { exact: true }).fill('4f2a-9c1b');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('4F2A9C1B');
});

test('will not begin without a seed', async ({ page }) => {
  await page.getByLabel('Seed', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Begin' })).toBeDisabled();

  await page.getByLabel('Seed', { exact: true }).fill('4F2A9C1B');
  await expect(page.getByRole('button', { name: 'Begin' })).toBeEnabled();
});
