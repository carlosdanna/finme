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

  it('collapses a run of order writes in one week into the last one', () => {
    // A slider writes once per step, and §14 calls the log "deliberately terse".
    const { state } = run();
    const change = standingOrderChangeFrom(state);

    let next = { ...state, weekIndex: 12 };
    for (const pct of [0.01, 0.02, 0.03, 0.04, 0.05, 0.06]) {
      next = setStandingOrders(next, { ...change, retirementContributionPct: pct });
    }

    const orders = next.decisionLog.filter((record) => record.t === 'orders');
    expect(orders).toHaveLength(1);
    // Last write wins, which is what makes collapsing them replay identically.
    expect(orders[0]).toMatchObject({ w: 12, p: 0.06 });
    expect(next.retirement.contributionPct).toBeCloseTo(0.06, 10);
  });

  it('keeps an earlier order that another decision has already followed', () => {
    // Only a *trailing* order is superseded: collapsing across an intervening
    // decision would move the earlier one out of the order the player made it.
    const { state } = run();
    const change = standingOrderChangeFrom(state);

    const first = setStandingOrders({ ...state, weekIndex: 12 }, change);
    const withTrade = {
      ...first,
      decisionLog: [...first.decisionLog, { w: 12, t: 'buy', a: 'SAFE', v: 1_000 } as const],
    };
    const second = setStandingOrders(withTrade, { ...change, retirementContributionPct: 0.05 });

    expect(second.decisionLog.map((record) => record.t)).toEqual(['orders', 'buy', 'orders']);
  });

  it('keeps an order made in a different week', () => {
    const { state } = run();
    const change = standingOrderChangeFrom(state);

    const first = setStandingOrders({ ...state, weekIndex: 12 }, change);
    const second = setStandingOrders({ ...first, weekIndex: 13 }, change);

    expect(second.decisionLog.filter((record) => record.t === 'orders')).toHaveLength(2);
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
