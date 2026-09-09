import { expect, type Page, test } from '@playwright/test';
import { beginRun } from './support/run.ts';

/**
 * Buying and selling, end to end (GDD §3.2).
 *
 * The claim under test is that the figures the trade sheet quotes are the
 * figures the run actually moves by. A preview that is merely plausible is the
 * failure mode this catches: the engine clamps to cash and consumes lots FIFO,
 * and the panel has to be quoting the same arithmetic.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await beginRun(page);
});

/**
 * The balance sheet renders whole dollars, so a delta read from it carries up to
 * two roundings. The trade sheet quotes cents, and that is the figure under
 * test — this is slack in the reading, not in the arithmetic.
 */
const ROUNDING_SLACK_CENTS = 100;

function expectMoved(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ROUNDING_SLACK_CENTS);
}

/** "$4,512.34" as integer cents. Display strings are the only source here. */
function cents(text: string): number {
  return Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100);
}

async function openPanel(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Money' }).tap();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** A named figure from the balance sheet, in cents. */
async function balanceLine(page: Page, label: string): Promise<number> {
  await openPanel(page, 'Balance sheet');
  const row = page.locator('[data-slot="item"]', { hasText: label }).first();
  const value = (await row.locator('[data-slot="money"]').first().textContent()) ?? '';
  await closePanel(page);
  return cents(value);
}

/** The trade sheet, which opens over the Investing panel. */
function tradeSheet(page: Page) {
  return page.locator('[data-slot="sheet-content"]').last();
}

test('a buy and a sell move the run by the amounts the sheet quoted', async ({ page }) => {
  const cashAtStart = await balanceLine(page, 'Cash');

  // --- Buy
  await openPanel(page, 'Investing');
  await page.getByRole('button', { name: 'Buy' }).first().tap();

  const buy = tradeSheet(page);
  await buy.getByLabel('Amount to spend').fill('300');
  const quotedShares = (await buy.getByText(/^\d+\.\d{3}$/).first().textContent())!;
  await buy.getByRole('button', { name: 'Buy' }).tap();
  await expect(tradeSheet(page).getByLabel('Amount to spend')).toHaveCount(0);

  // The row states the holding the preview promised.
  await expect(page.getByText(`${quotedShares} shares`)).toBeVisible();
  await closePanel(page);

  expectMoved(await balanceLine(page, 'Cash'), cashAtStart - 30_000);
  expect(await balanceLine(page, 'Investments')).toBe(30_000);

  // --- A month passes, so the sale is priced at a different week.
  await page.getByRole('button', { name: /^Advance granularity/ }).tap();
  await page.getByRole('button', { name: /^Advance granularity/ }).tap();
  await page.getByRole('button', { name: 'Advance', exact: true }).tap();
  // A month can present a card, which has to be answered before anything else.
  const card = page.getByRole('group').filter({ has: page.locator('[data-slot="event-choices"]') });
  if (await card.isVisible().catch(() => false)) {
    await card.getByRole('button').first().tap();
  }

  const cashBeforeSale = await balanceLine(page, 'Cash');

  // --- Sell
  await openPanel(page, 'Investing');
  await page.getByRole('button', { name: 'Sell' }).first().tap();

  const sell = tradeSheet(page);
  await sell.getByRole('button', { name: 'Everything' }).tap();
  const quotedProceeds = (await sell
    .locator('div', { hasText: /^Cash in/ })
    .locator('[data-slot="money"]')
    .first()
    .textContent())!;
  await sell.getByRole('button', { name: 'Sell' }).tap();
  await closePanel(page);

  expectMoved(await balanceLine(page, 'Cash'), cashBeforeSale + cents(quotedProceeds));

  // A zero line is dropped from the balance sheet, so selling out removes the row.
  await openPanel(page, 'Balance sheet');
  await expect(page.locator('[data-slot="item"]', { hasText: 'Investments' })).toHaveCount(0);
});

test('the trade sheet states a loss with no destructive styling', async ({ page }) => {
  // GDD §1: `destructive` is for destructive *user actions*, never for a figure.
  await openPanel(page, 'Investing');
  await page.getByRole('button', { name: 'Buy' }).first().tap();

  const buy = tradeSheet(page);
  await buy.getByLabel('Amount to spend').fill('100');
  const colours = await buy.locator('[data-slot="money"]').evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).color),
  );
  const destructive = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim(),
  );

  expect(colours.length).toBeGreaterThan(0);
  for (const colour of colours) expect(colour).not.toBe(destructive);
});

test('the standing-order controls stick rather than springing back', async ({ page }) => {
  // The bug this closes was that `App` passed neither handler, so every control
  // here moved under the finger and reverted on the next render. A component
  // test that wires the panel itself cannot see that — only the real app can.
  await openPanel(page, 'Investing');

  const contribution = page.locator('[data-slot="slider"] input[type="range"]');
  for (let i = 0; i < 6; i++) await contribution.press('ArrowRight');
  await page.getByRole('switch').tap();
  await page.getByLabel('Invest every week').fill('25');
  await page.getByRole('group', { name: 'Asset to buy' }).getByText('SafeCo Index').tap();
  await closePanel(page);

  await openPanel(page, 'Investing');
  await expect(
    page.locator('[data-slot="field-label"]', { hasText: 'Retirement contribution' }),
  ).toContainText('6%');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByRole('group', { name: 'Asset to buy' }).getByText('SafeCo Index'),
  ).toHaveAttribute('aria-pressed', 'true');
});
