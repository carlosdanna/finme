import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Touch-target measurement, shared by every spec that sweeps a screen.
 *
 * Lifted out of `device.spec.ts` when the new-run screen arrived: it is the
 * first screen a player sees and it has a stepper and an icon button on it, so
 * it needs the same sweep the primary tabs get. The logic is unchanged.
 */
export const MIN_TOUCH_TARGET = 44;

/** Every interactive element currently on screen. */
export async function interactiveElements(page: Page): Promise<Locator[]> {
  const locator = page.locator(
    'button:visible, a:visible, [role="button"]:visible, [role="tab"]:visible, input:visible, [role="switch"]:visible',
  );
  const count = await locator.count();
  return Array.from({ length: count }, (_, i) => locator.nth(i));
}

/**
 * The effective hit area, which is not always the element's own box.
 *
 * A control can carry a 44px target through an absolutely positioned `::after`
 * overlay without disturbing its own box — which is what `<Term>` does, so that a
 * glossary word inside a sentence is thumb-reachable without the sentence growing
 * legs, and what the allocation steppers do, so that a 36px circle still answers
 * to a 44px thumb. Measuring only the element box reports both as failures when
 * the browser reaches them correctly; a tap 18px above a 21px-tall `<Term>` does
 * open its popover, and `elementFromPoint` returns the stepper out to ±22px from
 * its centre.
 *
 * **Both axes.** This measured the overlay's height only, which was enough while
 * `<Term>` was the sole user — it is wide and short, so only height was ever in
 * question. A stepper is undersized in both directions.
 */
export async function hitArea(element: Locator): Promise<{ width: number; height: number } | null> {
  const box = await element.boundingBox();
  if (box === null) return null;

  const overlay = await element.evaluate((el) => {
    const measure = (pseudo: string): { width: number; height: number } => {
      const style = getComputedStyle(el, pseudo);
      if (style.content === 'none' || style.position !== 'absolute') return { width: 0, height: 0 };
      return { width: parseFloat(style.width) || 0, height: parseFloat(style.height) || 0 };
    };
    const after = measure('::after');
    const before = measure('::before');
    return {
      width: Math.max(after.width, before.width),
      height: Math.max(after.height, before.height),
    };
  });

  return {
    width: Math.max(box.width, overlay.width),
    height: Math.max(box.height, overlay.height),
  };
}

export async function expectTouchTargets(page: Page, context: string): Promise<void> {
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
