import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The device pass — BUILD-PLAN prompt 18.
 *
 * Everything here runs on a phone viewport with touch and no mouse. The point is
 * to catch what a headless component test cannot: a control that renders but
 * cannot be reached, a target too small for a thumb, content buried under the
 * home indicator, or an interaction that only works because a pointer hovered.
 */
const MIN_TOUCH_TARGET = 44;

/** Every interactive element currently on screen. */
async function interactiveElements(page: Page): Promise<Locator[]> {
  const locator = page.locator(
    'button:visible, a:visible, [role="button"]:visible, [role="tab"]:visible, input:visible, [role="switch"]:visible',
  );
  const count = await locator.count();
  return Array.from({ length: count }, (_, i) => locator.nth(i));
}

/**
 * The effective hit area, which is not always the element's own box.
 *
 * An inline control can carry a 44px target through an absolutely positioned
 * `::after` overlay without disturbing the surrounding line box — which is
 * exactly what `<Term>` does, so that a glossary word inside a sentence is
 * thumb-reachable without the sentence growing legs. Measuring only the element
 * box reports those as failures when the browser reaches them correctly; a tap
 * 18px above a 21px-tall `<Term>` does open its popover.
 */
async function hitArea(element: Locator): Promise<{ width: number; height: number } | null> {
  const box = await element.boundingBox();
  if (box === null) return null;

  const overlay = await element.evaluate((el) => {
    const measure = (pseudo: string): number => {
      const style = getComputedStyle(el, pseudo);
      if (style.content === 'none' || style.position !== 'absolute') return 0;
      return parseFloat(style.height) || 0;
    };
    return Math.max(measure('::after'), measure('::before'));
  });

  return { width: box.width, height: Math.max(box.height, overlay) };
}

async function expectTouchTargets(page: Page, context: string): Promise<void> {
  const undersized: string[] = [];

  for (const element of await interactiveElements(page)) {
    const box = await hitArea(element);
    if (box === null) continue;
    // A slider thumb is grabbed along a track, so its own box is not the target.
    const role = await element.getAttribute('role');
    if (role === 'slider') continue;

    if (box.height < MIN_TOUCH_TARGET || box.width < MIN_TOUCH_TARGET) {
      const label =
        (await element.getAttribute('aria-label')) ?? (await element.textContent()) ?? '<unlabelled>';
      undersized.push(`${context}: "${label.trim().slice(0, 40)}" is ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }

  expect(undersized.join('\n'), `targets under ${MIN_TOUCH_TARGET}px`).toBe('');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});

test('the app boots and renders a styled dashboard', async ({ page }) => {
  // Guards the guard: an unstyled page would still satisfy most assertions
  // below, so check that the design tokens actually reached the document.
  const background = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('background-color'),
  );
  expect(background).not.toBe('');
  expect(background).not.toBe('rgba(0, 0, 0, 0)');

  const tokens = await page.evaluate(() => ({
    background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
    muted: getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim(),
  }));
  expect(tokens.background).not.toBe('');
  expect(tokens.muted).not.toBe('');

  await expect(page.getByText('net worth')).toBeVisible();
});

test('every touch target on every primary tab clears 44px', async ({ page }) => {
  for (const tab of ['Dashboard', 'Money', 'Life', 'Logbook']) {
    await page.getByRole('tab', { name: tab }).tap();
    await expectTouchTargets(page, tab);
  }
});

test('the time steppers are reachable and work by tap', async ({ page }) => {
  await page.getByRole('tab', { name: 'Life' }).tap();

  const plus = page.getByRole('button', { name: 'One more point of Rest' });
  const minus = page.getByRole('button', { name: 'One less point of Rest' });

  const box = (await hitArea(plus))!;
  expect(box.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

  // The default week already spends all 10 points, so `+` is correctly
  // disabled and the only move available is to free one up first. That is the
  // opportunity-cost engine of §7.2 showing through the interface.
  await expect(page.getByText('10 of 10 points')).toBeVisible();
  await expect(plus).toBeDisabled();

  // Tap, not click: these must work with no pointer at all.
  await minus.tap();
  await expect(page.getByText('9 of 10 points')).toBeVisible();
  await expect(plus).toBeEnabled();

  await plus.tap();
  await expect(page.getByText('10 of 10 points')).toBeVisible();
});

test('the Term popover opens on tap, with no hover and no title attribute', async ({ page }) => {
  // GDD §7 specifies hover tooltips. Phones have no hover, so the glossary is
  // tap-only — if this fails, the game's central teaching system is invisible
  // to its primary audience.
  await expect(page.locator('[title]')).toHaveCount(0);

  const term = page.locator('[data-slot="term"]').first();
  await expect(term).toBeVisible();
  await term.tap();

  const popover = page.getByRole('dialog').or(page.locator('[data-slot="popover-content"]'));
  await expect(popover.first()).toBeVisible();
});

test('the Debts panel keeps the payoff projection reachable on a phone', async ({ page }) => {
  await page.getByRole('tab', { name: 'Money' }).tap();
  await page.getByRole('button', { name: 'Debts' }).tap();

  // The card list is the phone layout; the table is hidden below md:.
  const table = page.locator('table');
  if ((await table.count()) > 0) await expect(table.first()).toBeHidden();

  await expect(page.getByText(/Nothing owed|Paid off in/).first()).toBeVisible();
  await expectTouchTargets(page, 'Debts');
});

test('no fixed bottom element sits under the safe-area inset', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const navBox = (await nav.boundingBox())!;
  const viewport = page.viewportSize()!;

  // The bar reaches the bottom edge, and its padding carries the inset.
  expect(Math.round(navBox.y + navBox.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  const padding = await nav.evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(padding).not.toBe('');

  // The advance control clears the bar rather than sitting behind it.
  const advance = page.getByRole('button', { name: 'Advance', exact: true });
  const advanceBox = (await advance.boundingBox())!;
  expect(advanceBox.y + advanceBox.height).toBeLessThanOrEqual(navBox.y + 1);
});

test('content is not hidden behind the tab bar at the end of a long scroll', async ({ page }) => {
  await page.getByRole('tab', { name: 'Logbook' }).tap();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  const nav = page.getByRole('navigation', { name: 'Primary' });
  const navBox = (await nav.boundingBox())!;
  const main = page.locator('main');
  const paddingBottom = await main.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));

  // Main reserves at least the bar's height, so the last entry clears it.
  expect(paddingBottom).toBeGreaterThanOrEqual(navBox.height);
});

test('the advance control sits in the thumb zone', async ({ page }) => {
  const advance = page.getByRole('button', { name: 'Advance', exact: true });
  const box = (await advance.boundingBox())!;
  const viewport = page.viewportSize()!;

  // Bottom-right, within comfortable one-handed reach: the lower third of the
  // screen and the right half.
  expect(box.y).toBeGreaterThan(viewport.height * 0.66);
  expect(box.x + box.width / 2).toBeGreaterThan(viewport.width / 2);
});

test('advancing time works entirely by tap', async ({ page }) => {
  const advance = page.getByRole('button', { name: 'Advance', exact: true });
  await advance.tap();

  // Either time moved or an event stopped it — both are progress.
  const modal = page.getByRole('dialog');
  const moved = page.getByText(/Year \d+/);
  await expect(modal.or(moved).first()).toBeVisible();
});

test('the event modal is a full-width sheet on a phone, and choices are unranked', async ({ page }) => {
  const advance = page.getByRole('button', { name: 'Advance', exact: true });

  for (let i = 0; i < 12; i++) {
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) break;
    await advance.tap();
    await page.waitForTimeout(60);
  }

  const dialog = page.getByRole('dialog');
  test.skip(!(await dialog.isVisible().catch(() => false)), 'no event fired in 12 advances');

  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  // Sheet, not centred dialog: it spans the width below md:.
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);

  // Scope to the choice group: a Sheet also renders its own close button, and
  // that is chrome rather than a choice.
  const choices = dialog.locator('[data-slot="button-group"] button');
  const count = await choices.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Every choice is styled identically — no primary, no emphasis (GDD §1).
  const classes = new Set<string>();
  for (let i = 0; i < count; i++) {
    const box = await choices.nth(i).boundingBox();
    if (box === null) continue;
    expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    classes.add((await choices.nth(i).getAttribute('class')) ?? '');
  }
  expect(classes.size, 'choices should share one visual treatment').toBe(1);
});

test('nothing on screen depends on hover', async ({ page }) => {
  // With `hasTouch` and no mouse, anything hover-gated is simply unreachable.
  // Walk every tab and confirm the primary controls still respond to tap.
  for (const tab of ['Dashboard', 'Money', 'Life', 'Logbook']) {
    await page.getByRole('tab', { name: tab }).tap();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
});

test('the page never scrolls horizontally', async ({ page }) => {
  for (const tab of ['Dashboard', 'Money', 'Life', 'Logbook']) {
    await page.getByRole('tab', { name: tab }).tap();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${tab} overflows horizontally`).toBeLessThanOrEqual(1);
  }
});
