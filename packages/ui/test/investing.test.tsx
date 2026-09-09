/**
 * The Investing panel's controls, through the store.
 *
 * Both halves of this panel shipped as declarations rather than behaviour: the
 * slider and the switch moved under the finger and sprang back, and there was
 * no buy or sell control at all. The assertions below are on the run state and
 * the decision log, because a control that changes neither is the bug.
 */
import { WEEKS_PER_YEAR, sellLotsFifo } from '@finme/engine';
import type { AssetId, Run } from '@finme/engine';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { InvestingPanel } from '../src/panels/InvestingPanel.tsx';
import { defaultSetup, useGameStore } from '../src/store/useGameStore.ts';
import { formatCents } from '../src/lib/format.ts';

/** `useIsMobile` reads `matchMedia`, which jsdom does not implement. */
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

/** The trade sheet, which portals outside the panel's own container. */
function sheet() {
  const content = document.querySelector('[data-slot="sheet-content"]');
  expect(content, 'the trade sheet is not open').not.toBeNull();
  return within(content as HTMLElement);
}

/** The panel wired to the store exactly as `App` wires it. */
function panel() {
  const { run } = useGameStore.getState();
  const { buyAsset, sellAsset, setStandingOrders } = useGameStore.getState();
  const state = run!.state;
  return (
    <InvestingPanel
      state={state}
      world={run!.world}
      onBuy={buyAsset}
      onSell={sellAsset}
      onContributionChange={(pct) =>
        setStandingOrders({
          orders: state.standingOrders,
          retirementContributionPct: pct,
        })
      }
      onAutoReinvestChange={(enabled) =>
        setStandingOrders({
          orders: { ...state.standingOrders, autoReinvestDividends: enabled },
          retirementContributionPct: state.retirement.contributionPct,
        })
      }
      onAutoInvestChange={(autoInvest) =>
        setStandingOrders({
          orders: { ...state.standingOrders, autoInvest },
          retirementContributionPct: state.retirement.contributionPct,
        })
      }
    />
  );
}

/** Advance one 4-4-5 month, answering any card that comes up. */
function advanceMonth() {
  const start = useGameStore.getState().run!.state.weekIndex;
  while (useGameStore.getState().run!.state.weekIndex < start + 5) {
    const { pendingEvent, pendingChainStep } = useGameStore.getState();
    if (pendingEvent !== null) useGameStore.getState().resolveEvent(pendingEvent.choiceIds[0]);
    else if (pendingChainStep !== null)
      useGameStore.getState().resolveChainStep(pendingChainStep.choiceIds[0]);
    else useGameStore.getState().advanceTime();
  }
}

const state = () => useGameStore.getState().run!.state;

/**
 * The slider's own range input. Base UI hides the thumb until it has measured
 * the track, so the accessibility tree has no `slider` role under jsdom.
 */
function contributionSlider(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-slot="slider"] input[type="range"]') as HTMLElement;
}

/**
 * Put the run on a real loss. The week pair comes from the seed's own price
 * series rather than being invented, so this is a state the sim could reach.
 */
function holdAtALoss(assetId: AssetId = 'BOND'): void {
  const run = useGameStore.getState().run as Run;
  const prices = run.world.market.series[assetId].priceCents;

  let bought = -1;
  let now = -1;
  for (let a = 0; a < 260 && bought < 0; a++) {
    for (let b = a + 1; b < 260; b++) {
      if (prices[b] < prices[a]) {
        bought = a;
        now = b;
        break;
      }
    }
  }
  expect(bought, 'no falling stretch in the first five years').toBeGreaterThanOrEqual(0);

  const shares = 4;
  useGameStore.setState({
    run: {
      ...run,
      state: {
        ...run.state,
        weekIndex: now,
        holdings: {
          ...run.state.holdings,
          [assetId]: {
            shares,
            lots: [
              {
                assetId,
                shares,
                purchasedWeek: bought,
                costBasisCents: Math.round(shares * prices[bought]),
              },
            ],
          },
        },
      },
    },
  });
}

beforeEach(() => {
  useGameStore.getState().start(defaultSetup('4F2A9C1B'));
  useGameStore.setState({ granularity: 'week' });
});

describe('standing orders (GDD §6.8)', () => {
  it('writes the retirement contribution the slider shows, and records it', () => {
    const { container } = render(panel());

    fireEvent.change(contributionSlider(container), { target: { value: '6' } });

    expect(state().retirement.contributionPct).toBeCloseTo(0.06, 10);
    // A save is the seed plus the decision log (§14), so the order has to be in it.
    expect(state().decisionLog.at(-1)).toMatchObject({ t: 'orders', p: 0.06 });
  });

  it('lands the employer match in the retirement balance over a month', () => {
    const { container } = render(panel());
    fireEvent.change(contributionSlider(container), { target: { value: '6' } });
    const before = state().retirement.balanceCents;

    advanceMonth();

    expect(state().retirement.balanceCents).toBeGreaterThan(before);
    expect(state().employerMatchedThisYearCents).toBeGreaterThan(0);
  });

  it('turns auto-reinvest on, and records that too', () => {
    render(panel());
    fireEvent.click(screen.getByRole('switch'));

    expect(state().standingOrders.autoReinvestDividends).toBe(true);
    expect(state().decisionLog.at(-1)).toMatchObject({ t: 'orders' });
  });

  it('sets an auto-invest order, and buys with it every week', () => {
    const { rerender } = render(panel());
    fireEvent.change(screen.getByLabelText('Invest every week'), { target: { value: '25.00' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Asset to buy' })).getByText('SafeCo Index'),
    );

    expect(state().standingOrders.autoInvest).toEqual({ assetId: 'SAFE', weeklyCents: 2_500 });

    rerender(panel());
    useGameStore.getState().advanceTime();

    expect(state().holdings.SAFE.shares).toBeGreaterThan(0);
    expect(state().holdings.SAFE.lots).toHaveLength(1);
  });

  it('clears the order when the chosen asset is tapped again', () => {
    const { rerender } = render(panel());
    fireEvent.change(screen.getByLabelText('Invest every week'), { target: { value: '25.00' } });
    const pills = within(screen.getByRole('group', { name: 'Asset to buy' }));
    fireEvent.click(pills.getByText('SafeCo Index'));

    rerender(panel());
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Asset to buy' })).getByText('SafeCo Index'),
    );

    expect(state().standingOrders.autoInvest).toBeNull();
  });
});

describe('buying and selling (GDD §3.2)', () => {
  /** Open the Buy or Sell sheet for the first asset row. */
  function open(side: 'Buy' | 'Sell') {
    // The first row is the first asset in declaration order; the confirm button
    // inside the sheet shares the name, so everything after this is scoped.
    fireEvent.click(screen.getAllByRole('button', { name: side })[0]);
  }

  it('buys the amount the sheet quotes', () => {
    const { rerender } = render(panel());
    const price = state().holdings.BOND !== undefined
      ? useGameStore.getState().run!.world.market.series.BOND.priceCents[0]
      : 0;
    const cashBefore = state().cashCents;

    open('Buy');
    fireEvent.change(sheet().getByLabelText('Amount to spend'), { target: { value: '200' } });
    // The preview states the shares before the trade is taken.
    expect(sheet().getByText((20_000 / price).toFixed(3))).toBeDefined();
    fireEvent.click(sheet().getByRole('button', { name: 'Buy' }));

    expect(state().cashCents).toBe(cashBefore - 20_000);
    expect(state().holdings.BOND.shares).toBe(20_000 / price);

    rerender(panel());
    expect(screen.getByText(`${(20_000 / price).toFixed(3)} shares`)).toBeDefined();
  });

  it('sells everything, and the proceeds are the ones it quoted', () => {
    const { rerender } = render(panel());
    open('Buy');
    fireEvent.change(sheet().getByLabelText('Amount to spend'), { target: { value: '500' } });
    fireEvent.click(sheet().getByRole('button', { name: 'Buy' }));
    rerender(panel());

    advanceMonth();
    rerender(panel());

    const held = state().holdings.BOND;
    const week = state().weekIndex;
    const price = useGameStore.getState().run!.world.market.series.BOND.priceCents[week];
    const expected = sellLotsFifo(held.lots, 'BOND', held.shares, week, price);
    const cashBefore = state().cashCents;

    open('Sell');
    fireEvent.click(sheet().getByRole('button', { name: 'Everything' }));
    expect(sheet().getAllByText(formatCents(expected.proceedsCents, { cents: true })).length)
      .toBeGreaterThan(0);
    fireEvent.click(sheet().getByRole('button', { name: 'Sell' }));

    expect(state().holdings.BOND.shares).toBe(0);
    expect(state().cashCents).toBe(cashBefore + expected.proceedsCents);
    // A sale under 52 weeks held is short-term, and the year-end settlement
    // reads it from here (TDD §6.3).
    expect(state().ytd.shortTermGainsCents).toBe(
      expected.realized.reduce((sum, lot) => sum + lot.gainCents, 0),
    );
    expect(week).toBeLessThan(WEEKS_PER_YEAR);
  });

  it('offers no Sell control for an asset that is not held', () => {
    render(panel());
    const sells = screen.getAllByRole('button', { name: 'Sell' });
    expect(sells.every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('records both trades for replay (§14)', () => {
    const { rerender } = render(panel());
    open('Buy');
    fireEvent.change(sheet().getByLabelText('Amount to spend'), { target: { value: '100' } });
    fireEvent.click(sheet().getByRole('button', { name: 'Buy' }));

    expect(state().decisionLog.at(-1)).toMatchObject({ t: 'buy', a: 'BOND', v: 10_000 });

    rerender(panel());
    open('Sell');
    fireEvent.click(sheet().getByRole('button', { name: 'Everything' }));
    fireEvent.click(sheet().getByRole('button', { name: 'Sell' }));

    expect(state().decisionLog.at(-1)).toMatchObject({ t: 'sell', a: 'BOND' });
  });
});

describe('the tone of a trade (GDD §1)', () => {
  /**
   * The sell sheet is the one screen that must state a realized loss, so it is
   * the likeliest to reach for red — which GDD §1 reserves for destructive
   * *actions*, never a figure.
   *
   * On class names, not computed colour: `getComputedStyle().color` resolves to
   * `rgb(...)` while `--destructive` is authored as `oklch(...)`, so comparing
   * the two is a test that cannot fail. **Both sides are swept**, or a
   * `text-destructive` on the buy branch slips past the sell branch's guard.
   */
  function openSheet(side: 'Buy' | 'Sell'): HTMLElement {
    const { rerender } = render(panel());
    holdAtALoss();
    rerender(panel());
    fireEvent.click(screen.getAllByRole('button', { name: side })[0]);
    if (side === 'Buy') {
      fireEvent.change(sheet().getByLabelText('Amount to spend'), { target: { value: '50' } });
    } else {
      fireEvent.click(sheet().getByRole('button', { name: 'Everything' }));
    }
    return document.querySelector('[data-slot="sheet-content"]') as HTMLElement;
  }

  it('states the loss at all, so the assertions below have something to guard', () => {
    const content = openSheet('Sell');
    const row = within(content).getByText('Realized gain').closest('div');

    // Guards the guard: a sheet that quoted no loss would pass the styling
    // check vacuously, which is exactly how the first version of this went wrong.
    expect(row?.textContent).toMatch(/^Realized gain-\$\d/);
  });

  for (const side of ['Buy', 'Sell'] as const) {
    it(`carries no destructive styling on any figure in the ${side} sheet`, () => {
      const content = openSheet(side);
      const figures = content.querySelectorAll('[data-slot="money"], [data-slot="pct"]');

      expect(figures.length).toBeGreaterThan(0);
      for (const node of figures) {
        const classes = `${node.className} ${node.parentElement?.className ?? ''}`;
        expect(classes).not.toMatch(/destructive|text-red|bg-red|danger|warning/);
      }
    });

    it(`never says whether the ${side} is a good one`, () => {
      expect(openSheet(side).textContent ?? '').not.toMatch(
        /should|mistake|wisely|smart|well done|good job|careful|warning|are you sure/i,
      );
    });
  }
});
