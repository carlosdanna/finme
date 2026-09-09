/**
 * Standing orders — GDD §6.8, TDD §6.4.
 *
 * The tick already applies every one of these (step 4, and step 5 for dividend
 * reinvestment); this is the missing write path. Like the chain actions and the
 * trades it is an **action, not a tick input**: setting an order happens inside
 * the week the player is already in and moves no money on its own.
 *
 * The retirement contribution rides along even though it lives on
 * `state.retirement`. §6.8 puts every recurring behaviour in one place, the
 * panel sets them side by side, and a save is the seed plus the decision log —
 * so recording one without the other would replay a run that contributed
 * nothing. Nothing here nudges toward a rate: GDD §3.10 is explicit that
 * discovering the 0% default in the epilogue is the lesson.
 *
 * No RNG, no Logbook entry, no interrupts. Nothing observable moves until the
 * next tick reads the orders.
 */
import { clamp } from './math.ts';
import type { DecisionRecord } from './persistence.ts';
import { type RunState, type StandingOrders } from './state.ts';

export interface StandingOrderChange {
  readonly orders: StandingOrders;
  /** §6.4's contribution rate, as a fraction. Clamped to 0–1. */
  readonly retirementContributionPct: number;
}

/** What the panel edits, read back out of a run so a caller can change one field. */
export function standingOrderChangeFrom(state: RunState): StandingOrderChange {
  return {
    orders: state.standingOrders,
    retirementContributionPct: state.retirement.contributionPct,
  };
}

/**
 * Write standing orders, recording the change for replay (§14).
 *
 * Weekly amounts are floored at zero and rounded to whole cents; an auto-invest
 * order of nothing is dropped rather than kept as a zero, so the tick's
 * `autoInvest !== null` check keeps meaning "the player set one".
 */
export function setStandingOrders(state: RunState, change: StandingOrderChange): RunState {
  const autoInvest = change.orders.autoInvest;
  const weeklyCents = autoInvest === null ? 0 : wholeCents(autoInvest.weeklyCents);

  const orders: StandingOrders = {
    ...change.orders,
    emergencyFundWeeklyCents: wholeCents(change.orders.emergencyFundWeeklyCents),
    savingsWeeklyCents: wholeCents(change.orders.savingsWeeklyCents),
    autoInvest:
      autoInvest === null || weeklyCents === 0 ? null : { ...autoInvest, weeklyCents },
  };
  const contributionPct = clamp(change.retirementContributionPct, 0, 1);

  return {
    ...state,
    standingOrders: orders,
    retirement: { ...state.retirement, contributionPct },
    decisionLog: [
      ...withoutTrailingOrder(state.decisionLog, state.weekIndex),
      { w: state.weekIndex, t: 'orders', v: orders, p: contributionPct },
    ],
  };
}

/**
 * Drop a trailing `orders` record from the same week: a slider writes once per
 * step, and §14 calls the log "deliberately terse". Replay is last-write-wins,
 * so collapsing them replays identically. Only a *trailing* one goes, so an
 * order made before some other decision stays where the player made it.
 */
function withoutTrailingOrder(
  log: readonly DecisionRecord[],
  weekIndex: number,
): readonly DecisionRecord[] {
  const last = log[log.length - 1];
  const supersedes = last !== undefined && last.t === 'orders' && last.w === weekIndex;
  return supersedes ? log.slice(0, -1) : log;
}

function wholeCents(value: number): number {
  return Math.max(0, Math.round(value));
}
