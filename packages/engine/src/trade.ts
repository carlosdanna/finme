/**
 * Buying and selling from the Investing panel — GDD §3.2, TDD §4.1.
 *
 * **These are actions, not tick inputs**, for exactly the reason the chain
 * actions are (see `beginChain`): a trade happens inside the week the player is
 * already in. It must not advance time and it must not touch the card that week
 * is holding — routing a player action through `tick` resolves the week's event
 * unseen, with its first-listed choice, which is a correctness bug and a GDD §1
 * bug at once.
 *
 * **No stream but `flavor`.** The price is a lookup into the pre-drawn market
 * path, and the tax split is arithmetic, so a run that takes no trade produces
 * byte-identical numbers and `RULESET_VERSION` does not move. A draw-count test
 * pins that.
 *
 * GDD §3.2's other two rules are enforced by the clamps below: no margin, so a
 * buy is capped by cash; no shorting, so a sale is capped by shares held.
 * Neither can take a balance negative. There is no commission — FIFO is the
 * only friction, and it is a tax rule rather than a toll.
 */
import { ASSETS, type AssetId } from './market.ts';
import { type RunState, type RunStreams, type RunWorld, addFlag, hasFlag } from './state.ts';
import { emitEntries } from './logbook/index.ts';
import { longTermGainsCents, sellLotsFifo, shortTermGainsCents } from './tax.ts';
import { type Interrupt, evaluateInterrupts, templateVarsFor } from './tick.ts';

export interface TradeResult {
  readonly state: RunState;
  readonly interrupts: readonly Interrupt[];
}

/** [F] Set the first time the player buys, and the first time they sell. */
export const FIRST_BUY_FLAG = 'has_bought';
export const FIRST_SELL_FLAG = 'has_sold';

/**
 * Put cash into an asset at this week's price.
 *
 * The arithmetic is `applyStandingOrders`' auto-invest branch, deliberately:
 * a manual buy and a standing order must not be able to drift apart.
 */
export function buyAsset(
  world: RunWorld,
  streams: RunStreams,
  state: RunState,
  assetId: AssetId,
  cashCents: number,
): TradeResult {
  const week = state.weekIndex;
  const holding = state.holdings[assetId];
  // Cash only — savings and the emergency fund are not swept into a trade.
  const amount = Math.min(Math.max(0, Math.round(cashCents)), state.cashCents);
  if (holding === undefined || amount <= 0) return { state, interrupts: [] };

  const price = world.market.series[assetId].priceCents[week];
  const shares = amount / price;

  const next = narrate(
    world,
    streams,
    {
      ...state,
      cashCents: state.cashCents - amount,
      holdings: {
        ...state.holdings,
        [assetId]: {
          shares: holding.shares + shares,
          lots: [
            ...holding.lots,
            { assetId, shares, purchasedWeek: week, costBasisCents: amount },
          ],
        },
      },
      decisionLog: [...state.decisionLog, { w: week, t: 'buy', a: assetId, v: amount }],
    },
    assetId,
    'first_trade_buy',
    FIRST_BUY_FLAG,
  );

  return { state: next, interrupts: evaluateInterrupts(next, state) };
}

/**
 * Sell shares at this week's price, oldest lot first.
 *
 * **FIFO is [F]**: `sellLotsFifo` walks the lots in insertion order and nothing
 * here sorts them, because insertion order is what decides which lots are
 * long-term and therefore the tax bill. The short/long split goes into `ytd`,
 * where `settleAnnualTax` finds it at the year boundary — the first path in the
 * game that makes TDD §4.1's mandatory holding-period split reachable at all.
 */
export function sellAsset(
  world: RunWorld,
  streams: RunStreams,
  state: RunState,
  assetId: AssetId,
  shares: number,
): TradeResult {
  const week = state.weekIndex;
  const holding = state.holdings[assetId];
  if (holding === undefined) return { state, interrupts: [] };

  const selling = Math.min(Math.max(0, shares), holding.shares);
  if (selling <= 0) return { state, interrupts: [] };

  const price = world.market.series[assetId].priceCents[week];
  const sale = sellLotsFifo(holding.lots, assetId, selling, week, price);

  const next = narrate(
    world,
    streams,
    {
      ...state,
      cashCents: state.cashCents + sale.proceedsCents,
      holdings: {
        ...state.holdings,
        [assetId]: { shares: holding.shares - selling, lots: sale.lots },
      },
      ytd: {
        ...state.ytd,
        shortTermGainsCents: state.ytd.shortTermGainsCents + shortTermGainsCents(sale.realized),
        longTermGainsCents: state.ytd.longTermGainsCents + longTermGainsCents(sale.realized),
      },
      decisionLog: [...state.decisionLog, { w: week, t: 'sell', a: assetId, s: selling }],
    },
    assetId,
    'first_trade_sell',
    FIRST_SELL_FLAG,
  );

  return { state: next, interrupts: evaluateInterrupts(next, state) };
}

/**
 * The first-time Logbook entry, or the state untouched once the flag is set.
 *
 * Gated on a flag rather than emitted every trade: a player who rebalances
 * monthly would otherwise crowd 30 years of narration out of their own Logbook.
 */
function narrate(
  world: RunWorld,
  streams: RunStreams,
  state: RunState,
  assetId: AssetId,
  logbookKey: string,
  flag: string,
): RunState {
  if (hasFlag(state, flag)) return state;

  const emitted = emitEntries(
    [{ trigger: { k: 'firstTime', action: 'trade' }, key: logbookKey }],
    state.weekIndex,
    world.templates,
    {
      ...templateVarsFor(state, world, state.netWorthHistory[state.netWorthHistory.length - 1] ?? 0),
      assetName: ASSETS[assetId].name,
    },
    streams.flavor,
    state.logbook,
  );

  return {
    ...state,
    flags: addFlag(state.flags, flag),
    logbook: emitted.state,
    logbookEntries: [...state.logbookEntries, ...emitted.entries],
  };
}
