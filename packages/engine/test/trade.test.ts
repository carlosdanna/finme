/**
 * Buying and selling (GDD §3.2).
 *
 * The selling machinery has existed since §6.3 was implemented and had no
 * caller outside its own tests, so the holding-period split TDD §4.1 calls
 * mandatory had never been computed in a real run. These pin it end to end.
 */
import { describe, expect, it } from 'vitest';
import { createRun } from '../src/run.ts';
import type { Run } from '../src/run.ts';
import type { RunStreams } from '../src/state.ts';
import { buyAsset, sellAsset } from '../src/trade.ts';
import type { EventDef } from '../src/events/index.ts';
import type { JobDef } from '../src/jobs.ts';

const SEED = '4F2A9C1B';

const JOB: JobDef = {
  id: 'clerk',
  title: 'Clerk',
  tier: 'entry',
  workMode: 'full-time',
  employer: 'A Shop',
  pay: { kind: 'hourly', rateCents: 2_000, hoursPerWeek: 40 },
  requirements: { educationYears: 0, experienceYears: 0 },
  requiresVehicle: false,
  alwaysAvailable: true,
};

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

const TEMPLATES = {
  quiet: ['a', 'b', 'c'],
  first_trade_buy: ['bought {{assetName}}', 'in on {{assetName}}', 'a piece of {{assetName}}'],
  first_trade_sell: ['sold {{assetName}}', 'out of {{assetName}}', 'done with {{assetName}}'],
};

function run(cashCents = 1_000_000): Run {
  return createRun({
    seed: SEED,
    runLengthYears: 30,
    startAge: 25,
    jobs: [JOB],
    eventDefs: [CARD],
    templates: TEMPLATES,
    // Two draws, exactly as content's `drawRunNames` takes.
    drawNames: (rng) => ({
      friendName: ['Dev', 'Sam'][Math.floor(rng() * 2)],
      advisorName: ['Rae', 'Kim'][Math.floor(rng() * 2)],
    }),
    startingCashCents: cashCents,
    startingJobId: 'clerk',
  });
}

/** A run positioned at `week`, holding `lots` bought at the weeks given. */
function holding(week: number, purchasedWeeks: readonly number[], sharesEach: number) {
  const base = run();
  const price = (w: number) => base.world.market.series.SAFE.priceCents[w];
  return {
    ...base,
    state: {
      ...base.state,
      weekIndex: week,
      holdings: {
        ...base.state.holdings,
        SAFE: {
          shares: sharesEach * purchasedWeeks.length,
          lots: purchasedWeeks.map((w) => ({
            assetId: 'SAFE' as const,
            shares: sharesEach,
            purchasedWeek: w,
            costBasisCents: Math.round(sharesEach * price(w)),
          })),
        },
      },
    },
  };
}

/** Wraps every stream so a test can say which ones an action touched. */
function counted(streams: RunStreams): { streams: RunStreams; draws: Record<string, number> } {
  const draws: Record<string, number> = {};
  const wrapped = {} as Record<string, () => number>;
  for (const [name, rng] of Object.entries(streams)) {
    draws[name] = 0;
    wrapped[name] = () => {
      draws[name] += 1;
      return rng();
    };
  }
  return { streams: wrapped as unknown as RunStreams, draws };
}

describe('buying (GDD §3.2)', () => {
  it('buys at the week\'s price and records a lot', () => {
    const { world, streams, state } = run();
    const week = 40;
    const at = { ...state, weekIndex: week };
    const price = world.market.series.SAFE.priceCents[week];

    const result = buyAsset(world, streams, at, 'SAFE', 250_000);

    expect(result.state.cashCents).toBe(750_000);
    expect(result.state.holdings.SAFE.shares).toBe(250_000 / price);
    expect(result.state.holdings.SAFE.lots).toEqual([
      { assetId: 'SAFE', shares: 250_000 / price, purchasedWeek: week, costBasisCents: 250_000 },
    ]);
  });

  it('is the same arithmetic as the auto-invest standing order', () => {
    // A manual buy and a weekly order must not drift apart — `applyStandingOrders`
    // computes `shares = amount / price` with the lot's basis as the whole amount.
    const { world, streams, state } = run();
    const price = world.market.series.BLUE.priceCents[0];
    const result = buyAsset(world, streams, state, 'BLUE', 33_333);
    const lot = result.state.holdings.BLUE.lots[0];

    expect(lot.shares).toBe(33_333 / price);
    expect(lot.costBasisCents).toBe(33_333);
  });

  it('clamps to cash rather than going negative — no margin', () => {
    const { world, streams, state } = run(400_000);
    const result = buyAsset(world, streams, state, 'SAFE', 900_000);

    expect(result.state.cashCents).toBe(0);
    expect(result.state.holdings.SAFE.lots[0].costBasisCents).toBe(400_000);
  });

  it('does nothing on a non-positive amount', () => {
    const { world, streams, state } = run();
    expect(buyAsset(world, streams, state, 'SAFE', 0).state).toBe(state);
    expect(buyAsset(world, streams, state, 'SAFE', -5_000).state).toBe(state);
  });

  it('records the buy for replay (§14)', () => {
    const { world, streams, state } = run();
    const result = buyAsset(world, streams, { ...state, weekIndex: 12 }, 'MOON', 60_000);

    expect(result.state.decisionLog.at(-1)).toEqual({ w: 12, t: 'buy', a: 'MOON', v: 60_000 });
  });
});

describe('selling (GDD §3.2, TDD §6.3)', () => {
  it('credits proceeds and splits the gain by holding period', () => {
    const week = 200;
    const { world, streams, state } = holding(week, [week - 60, week - 10], 4);
    const price = world.market.series.SAFE.priceCents[week];

    const result = sellAsset(world, streams, state, 'SAFE', 8);
    const proceeds = Math.round(4 * price) * 2;

    expect(result.state.cashCents).toBe(state.cashCents + proceeds);
    expect(result.state.holdings.SAFE.shares).toBe(0);
    expect(result.state.holdings.SAFE.lots).toEqual([]);

    const oldBasis = Math.round(4 * world.market.series.SAFE.priceCents[week - 60]);
    const newBasis = Math.round(4 * world.market.series.SAFE.priceCents[week - 10]);
    expect(result.state.ytd.longTermGainsCents).toBe(Math.round(4 * price) - oldBasis);
    expect(result.state.ytd.shortTermGainsCents).toBe(Math.round(4 * price) - newBasis);
  });

  it('is long-term at 52 weeks held and short-term at 51 — [F]', () => {
    const week = 300;
    for (const [held, expected] of [[51, 'short'], [52, 'long']] as const) {
      const { world, streams, state } = holding(week, [week - held], 3);
      const result = sellAsset(world, streams, state, 'SAFE', 3);
      const moved =
        expected === 'long'
          ? result.state.ytd.longTermGainsCents
          : result.state.ytd.shortTermGainsCents;
      const still =
        expected === 'long'
          ? result.state.ytd.shortTermGainsCents
          : result.state.ytd.longTermGainsCents;

      expect(moved, `${held} weeks held`).not.toBe(0);
      expect(still, `${held} weeks held`).toBe(0);
    }
  });

  it('consumes the oldest lot first, and FIFO order is never sorted', () => {
    const week = 400;
    // The younger lot is listed first on purpose: only insertion order decides.
    const { world, streams, state } = holding(week, [week - 5, week - 100], 2);
    const result = sellAsset(world, streams, state, 'SAFE', 2);

    expect(result.state.holdings.SAFE.lots).toHaveLength(1);
    expect(result.state.holdings.SAFE.lots[0].purchasedWeek).toBe(week - 100);
    // The lot sold was the *listed* first one, which is 5 weeks old.
    expect(result.state.ytd.longTermGainsCents).toBe(0);
  });

  it('clamps to shares held rather than going short', () => {
    const week = 150;
    const { world, streams, state } = holding(week, [week - 20], 5);
    const price = world.market.series.SAFE.priceCents[week];

    const result = sellAsset(world, streams, state, 'SAFE', 500);

    expect(result.state.holdings.SAFE.shares).toBe(0);
    expect(result.state.cashCents).toBe(state.cashCents + Math.round(5 * price));
  });

  it('does nothing when there is nothing held', () => {
    const { world, streams, state } = run();
    expect(sellAsset(world, streams, state, 'SAFE', 10).state).toBe(state);
  });

  it('records the sale for replay (§14)', () => {
    const week = 90;
    const { world, streams, state } = holding(week, [week - 30], 6);
    const result = sellAsset(world, streams, state, 'SAFE', 2.5);

    expect(result.state.decisionLog.at(-1)).toEqual({ w: 90, t: 'sell', a: 'SAFE', s: 2.5 });
  });
});

describe('a trade is not a tick (TDD §2, §10)', () => {
  it('does not advance the week or touch the pending card', () => {
    const { world, streams, state } = run();
    const at = { ...state, weekIndex: 77 };

    expect(buyAsset(world, streams, at, 'SAFE', 10_000).state.weekIndex).toBe(77);
    expect(buyAsset(world, streams, at, 'SAFE', 10_000).state.eventHistory).toBe(at.eventHistory);
  });

  it('draws from `flavor` and from no other stream', () => {
    const base = run();
    const { streams, draws } = counted(base.streams);

    const bought = buyAsset(base.world, streams, base.state, 'SAFE', 100_000);
    const sold = sellAsset(base.world, streams, bought.state, 'SAFE', 1);

    expect(draws.eventOutcome).toBe(0);
    expect(draws.jobApplication).toBe(0);
    expect(draws.eventMagnitude).toBe(0);
    expect(draws.chain).toBe(0);
    // The two first-time entries, and nothing else.
    expect(draws.flavor).toBeGreaterThan(0);
    expect(sold.state.logbookEntries.map((entry) => entry.key)).toEqual([
      'first_trade_buy',
      'first_trade_sell',
    ]);

    const flavorAfterFirsts = draws.flavor;
    sellAsset(base.world, streams, buyAsset(base.world, streams, sold.state, 'SAFE', 5_000).state, 'SAFE', 0.5);
    // First-time means first time: later trades narrate nothing and draw nothing.
    expect(draws.flavor).toBe(flavorAfterFirsts);
  });
});
