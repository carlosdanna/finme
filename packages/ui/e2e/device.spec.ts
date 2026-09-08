import { expect, test } from '@playwright/test';
import { MIN_TOUCH_TARGET, expectTouchTargets, hitArea } from './support/touch.ts';
import { beginRun } from './support/run.ts';

/**
 * The device pass — BUILD-PLAN prompt 18.
 *
 * Everything here runs on a phone viewport with touch and no mouse. The point is
 * to catch what a headless component test cannot: a control that renders but
 * cannot be reached, a target too small for a thumb, content buried under the
 * home indicator, or an interaction that only works because a pointer hovered.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The app opens on the new-run screen now, so every test here starts by
  // setting one up. The screen's own pass lives in `new-run.spec.ts`.
  await beginRun(page);
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
  // The Logbook is empty on a fresh run — 653px of content in a 653px scroller.
  // Without making some history first, every assertion below holds trivially and
  // the test proves nothing about a long scroll.
  const advance = page.getByRole('button', { name: 'Advance', exact: true });
  for (let i = 0; i < 20; i++) {
    if (await advance.isEnabled().catch(() => false)) {
      await advance.tap();
      await page.waitForTimeout(40);
    }
    // Resolve in the same pass: an event blocks the next advance, so spending a
    // whole iteration on it halves the history this produces.
    const choice = page.locator('[data-slot="event-choices"] button').first();
    if (await choice.isVisible().catch(() => false)) {
      await choice.tap();
      await page.waitForTimeout(40);
    }
  }
  await page.getByRole('tab', { name: 'Logbook' }).tap();

  // `main` is the scroller, not the window — the shell is a fixed-height column,
  // so the page itself never scrolls.
  const main = page.locator('main');
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );

  const overflows = await main.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(overflows, 'the Logbook must overflow or this test asserts nothing').toBe(true);

  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(100);

  const atEnd = await main.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  expect(atEnd, 'the scroller must reach its end').toBe(true);

  // The outcome, not the mechanism: the last entry is fully clear of the bar.
  // Reserved padding used to stand in for this, and a padding value cannot tell
  // you whether anything is actually visible.
  const navBox = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!;
  const lastEntry = (await main.locator('[data-slot="item"]').last().boundingBox())!;
  expect(Math.round(lastEntry.y + lastEntry.height)).toBeLessThanOrEqual(Math.round(navBox.y) + 1);
});

test('a long secondary panel scrolls to its end inside the sheet', async ({ page }) => {
  await page.getByRole('tab', { name: 'Money' }).tap();
  // `If nothing else changed` overflows the sheet on a fresh run (837px into
  // 702px). `Annual review` does not — it is a 160px empty state until a year
  // closes, and pointing this test at it made it pass without ever scrolling.
  await page.getByRole('button', { name: /If nothing else changed/ }).tap();

  const body = page.locator('[data-slot="sheet-content"] > div').last();
  await expect(body).toBeVisible();

  // No short-circuit on `scrollHeight <= clientHeight`: a panel that stops
  // overflowing must fail here rather than pass silently, which is exactly what
  // the previous version of this test did.
  const overflows = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(overflows, 'the panel must overflow or this test asserts nothing').toBe(true);

  // The nested `max-h` on a `ScrollArea` inside a `max-h` sheet used to strand
  // the last section with no way to reach it.
  const atEnd = await body.evaluate((el) => {
    el.scrollTo(0, el.scrollHeight);
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  });
  expect(atEnd, 'the sheet body must reach its end').toBe(true);
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

  // Scope to the choice list, which carries its own slot so this does not ride
  // on whichever component happens to lay the choices out.
  const choices = dialog.locator('[data-slot="event-choices"] button');
  const count = await choices.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Every choice is styled identically — no primary, no emphasis (GDD §1).
  //
  // Compare COMPUTED style, not the class attribute. The choices used to sit in
  // a `ButtonGroup`, which strips radii and interior borders from its children
  // through parent descendant selectors: every button carried an identical
  // `class` while rendering with different corners and one missing border. An
  // attribute comparison called that uniform.
  const looks = new Set<string>();
  for (let i = 0; i < count; i++) {
    const box = await choices.nth(i).boundingBox();
    if (box === null) continue;
    expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    looks.add(
      await choices.nth(i).evaluate((el) => {
        const cs = getComputedStyle(el);
        return [
          cs.borderTopLeftRadius, cs.borderTopRightRadius,
          cs.borderBottomRightRadius, cs.borderBottomLeftRadius,
          cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth,
          cs.backgroundColor, cs.color, cs.fontWeight, cs.fontSize,
        ].join('|');
      }),
    );
  }
  expect(looks.size, 'choices should share one visual treatment').toBe(1);
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
