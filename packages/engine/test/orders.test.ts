/**
 * Standing orders (GDD §6.8).
 *
 * The tick has applied all of these since step 4 was written; what was missing
 * was any way to set them. A save is the seed plus the decision log, so an order
 * the player set and the log did not record would not survive a replay.
 */
import { describe, expect, it } from 'vitest';
import { createRun, type Run } from '../src/run.ts';
import { setStandingOrders, standingOrderChangeFrom } from '../src/orders.ts';
import type { EventDef } from '../src/events/index.ts';

const CARD: EventDef = {
  id: 'TST_NOTHING',
  category: 'windfall',
  baseWeight: 1,
  cooldownWeeks: 0,
  gates: [],
  multipliers: [],
  title: 'Nothing',
  body: 'Nothing happens.',
  choices: [{ id: 'ok', label: 'Fine', effects: [], noop: true, logbookKey: 'quiet' }],
};

function run(): Run {
  return createRun({
    seed: '4F2A9C1B',
    runLengthYears: 30,
    jobs: [],
    eventDefs: [CARD],
    templates: { quiet: ['a', 'b', 'c'] },
    drawNames: (rng) => ({
      friendName: ['Dev', 'Sam'][Math.floor(rng() * 2)],
      advisorName: ['Rae', 'Kim'][Math.floor(rng() * 2)],
    }),
  });
}

describe('setting standing orders', () => {
  it('writes the orders and the contribution rate together', () => {
    const { state } = run();
    const change = standingOrderChangeFrom(state);

    const next = setStandingOrders(
      { ...state, weekIndex: 30 },
      {
        orders: { ...change.orders, autoReinvestDividends: true, savingsWeeklyCents: 2_500 },
        retirementContributionPct: 0.06,
      },
    );

    expect(next.standingOrders.autoReinvestDividends).toBe(true);
    expect(next.standingOrders.savingsWeeklyCents).toBe(2_500);
    expect(next.retirement.contributionPct).toBe(0.06);
  });

  it('records one `orders` decision carrying both (§14)', () => {
    const { state } = run();
    const change = standingOrderChangeFrom(state);
    const next = setStandingOrders({ ...state, weekIndex: 30 }, { ...change, retirementContributionPct: 0.04 });

    expect(next.decisionLog.at(-1)).toEqual({
      w: 30,
      t: 'orders',
      v: next.standingOrders,
      p: 0.04,
    });
  });

  it('clamps the contribution rate and floors weekly amounts at zero', () => {
    const { state } = run();
    const change = standingOrderChangeFrom(state);

    const high = setStandingOrders(state, { ...change, retirementContributionPct: 4 });
    const low = setStandingOrders(state, { ...change, retirementContributionPct: -1 });
    const negative = setStandingOrders(state, {
      ...change,
      orders: { ...change.orders, emergencyFundWeeklyCents: -900 },
    });

    expect(high.retirement.contributionPct).toBe(1);
    expect(low.retirement.contributionPct).toBe(0);
    expect(negative.standingOrders.emergencyFundWeeklyCents).toBe(0);
  });

  it('drops an auto-invest order of nothing rather than keeping a zero', () => {
    // `applyStandingOrders` reads `autoInvest !== null` as "the player set one".
    const { state } = run();
    const change = standingOrderChangeFrom(state);

    const empty = setStandingOrders(state, {
      ...change,
      orders: { ...change.orders, autoInvest: { assetId: 'SAFE', weeklyCents: 0 } },
    });
    const set = setStandingOrders(state, {
      ...change,
      orders: { ...change.orders, autoInvest: { assetId: 'SAFE', weeklyCents: 10_000 } },
    });

    expect(empty.standingOrders.autoInvest).toBeNull();
    expect(set.standingOrders.autoInvest).toEqual({ assetId: 'SAFE', weeklyCents: 10_000 });
  });

  it('moves no money and draws nothing', () => {
    const { state } = run();
    const change = standingOrderChangeFrom(state);
    const next = setStandingOrders(state, { ...change, retirementContributionPct: 0.1 });

    expect(next.cashCents).toBe(state.cashCents);
    expect(next.savingsCents).toBe(state.savingsCents);
    expect(next.holdings).toBe(state.holdings);
    expect(next.logbookEntries).toBe(state.logbookEntries);
  });
});
