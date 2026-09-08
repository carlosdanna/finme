/**
 * ============================================================================
 * THE WEEKLY TICK PIPELINE — TDD §10.
 *
 * **THE ORDER OF THE STEPS BELOW IS CONTRACTUAL AND IS PART OF THE RULESET
 * VERSION.** Any reordering changes outcomes for every existing seed. Do not
 * move a step, do not merge two steps, and do not insert a step without
 * bumping RULESET_VERSION and recording it in docs/DECISIONS.md.
 *
 * Step 7 before step 9 matters specifically: an event that costs energy must
 * constrain *that* week's allocation, not the next one's.
 * ============================================================================
 */
import {
  HOME_PRICE_TO_RENT,
  carValueCents,
  homeCarryingCostWeeklyCents,
  homeSaleProceedsCents,
  homeValueCents,
} from './assets.ts';
import {
  type ActiveChain,
  advanceChain,
  chainById,
  dueChain,
  recordChainEnd,
  slipChain,
  startBlockedReason,
  startChain,
  stepById,
  withChain,
} from './chains/index.ts';
import { type CreditState, applyCreditEvent, decayWeek, recordMissedPayment, recordOnTimePayment, updateMonthly } from './credit.ts';
import { closeStatement, minimumPaymentCents } from './debt/creditCard.ts';
import { type AmortizingLoan, payMonth } from './debt/amortizing.ts';
import { openDebtFromInstrument } from './debt/open.ts';
import { type Debt, monthlyRate, totalLiabilitiesCents } from './debt/types.ts';
import {
  JOB_TIERS,
  type JobTier,
  applicationProbability,
  availableJobIds,
  tierRank,
  weeklyGrossCents,
} from './jobs.ts';
import {
  type EffectOutcome,
  type EventState,
  applyEffects,
  passesGate,
  recordFiring,
  resolveChoice,
  selectEvent,
} from './events/index.ts';
import {
  EMPLOYER_MATCH_CAP_PCT,
  annualRaiseRate,
  applyRaiseCents,
  retirementContributionCents,
} from './income.ts';
import { type PendingEntry, emitEntries } from './logbook/index.ts';
import { ASSET_IDS, type AssetId, dividendPaymentCents, isDividendWeek } from './market.ts';
import { bankruptcyTriggered } from './bankruptcy.ts';
import { clamp } from './math.ts';
import { balanceSheet, portfolioValueCents } from './netWorth.ts';
import {
  type AnnualSnapshot,
  type RecurringExpense,
  type RunState,
  type RunStreams,
  type RunWorld,
  addFlag,
  emptyYearToDate,
  removeFlag,
  tierRentCents,
  BASE_MONTHLY_EXPENSES_CENTS,
  DISCRETIONARY_BASELINE_CENTS,
  HOUSING_TIER_RENT_CENTS,
} from './state.ts';
import { settleAnnualTax, unpaidBillPenaltyCents, weeklyWithholdingCents } from './tax.ts';
import { WEEKS_PER_YEAR, isMonthBoundary, isYearBoundary, yearIndex } from './time.ts';
import {
  type Allocation,
  REACH_OUT_MOOD_THRESHOLD,
  evaluatePerformanceTrack,
  nextEnergy,
  nextMood,
  nextPerformance,
  shouldForceReachOut,
} from './vitals.ts';

/** GDD §2.1. Time-advance halts on any of these. */
export type InterruptReason =
  | 'event'
  | 'unpayable-bill'
  | 'job-offer'
  | 'firing-risk'
  | 'debt-threshold'
  | 'energy-floor'
  | 'mood-floor'
  | 'milestone'
  | 'life-stage'
  | 'bankruptcy'
  | 'run-complete';

/** [T] What the home-search chain puts down. §5.2's floor is 10%. */
export const HOME_SEARCH_DOWN_PAYMENT_PCT = 0.2;

/** [T] Floors below which the game stops and hands control back. */
export const ENERGY_INTERRUPT_FLOOR = 20;
export const MOOD_INTERRUPT_FLOOR = 25;
/** [T] Unsecured debt above this multiple of annual gross interrupts. */
export const DEBT_INTERRUPT_DTI = 0.75;

export interface Interrupt {
  readonly reason: InterruptReason;
  readonly weekIndex: number;
  readonly detail?: string;
}

export interface TickInput {
  /** How the player spent the week. Defaults to the standing order. */
  readonly allocation?: Allocation;
  /**
   * Which choice to take if an event fires. Defaults to the first available.
   * Returning `null` means "not answered yet" — the week is abandoned and the
   * caller re-ticks the same state once a choice exists.
   */
  readonly chooseEvent?: (eventId: string, choiceIds: readonly string[]) => string | null;
  /** Discretionary spending this week, for the mood term. */
  readonly discretionarySpendCents?: number;
  /**
   * The magnitude roll from a previous `tick` that returned
   * `awaitingEventChoice`. Supplying it takes no new draw, so the choice is
   * charged the price the card quoted.
   */
  readonly eventRoll?: number;
  /** As `chooseEvent`, for a chain step. `null` means "not answered yet". */
  readonly chooseChainStep?: (
    chainId: string,
    stepId: string,
    choiceIds: readonly string[],
  ) => string | null;
  /** The roll from a previous `tick` that returned `awaitingChainStep`. */
  readonly chainRoll?: number;
}

export interface TickResult {
  readonly state: RunState;
  readonly interrupts: readonly Interrupt[];
  readonly firedEventId: string | null;
  /**
   * The event whose choice the caller declined to make, or `null`. `state` is
   * then the state `tick` was given — the week did not happen.
   *
   * [F] Only `eventMagnitude` is touched, taking its single per-event draw and
   * returning it as `eventRoll`. Fed back into the resolving tick, the total is
   * one draw per fired event either way — the count a §14 replay produces.
   */
  readonly awaitingEventChoice: string | null;
  /** The roll drawn for the awaited event. Pass it back as `TickInput.eventRoll`. */
  readonly eventRoll: number | null;
  /**
   * The chain step whose choice the caller declined to make, or `null`. Carried
   * alongside `awaitingEventChoice` rather than replacing it: the two can never
   * both be set, because a week presents at most one card.
   */
  readonly awaitingChainStep: { readonly chainId: string; readonly stepId: string } | null;
  /** The roll drawn for the awaited chain step. Pass back as `TickInput.chainRoll`. */
  readonly chainRoll: number | null;
  /** The chain step that resolved this week, or `null`. */
  readonly firedChainStep: { readonly chainId: string; readonly stepId: string } | null;
}

// --- helpers ----------------------------------------------------------------

function annualGrossCents(state: RunState): number {
  return (state.job?.weeklyGrossCents ?? 0) * WEEKS_PER_YEAR;
}

function unsecuredDebtCents(debts: readonly Debt[]): number {
  return debts
    .filter((debt) => debt.kind !== 'amortizing')
    .reduce((sum, debt) => sum + debt.balanceCents, 0);
}

/** The read-only slice of state an event gate may see (§9.2). */
export function eventStateFrom(state: RunState, world: RunWorld): EventState {
  const week = state.weekIndex;
  const cpi = world.market.inflation.cpi[Math.min(yearIndex(week), state.runLengthYears)];
  const monthlyIncome = (state.job?.weeklyGrossCents ?? 0) * (WEEKS_PER_YEAR / 12);
  const monthlyExpenses = (BASE_MONTHLY_EXPENSES_CENTS + tierRentCents(state.housingTier)) * cpi;

  return {
    weekIndex: week,
    age: state.startAge + yearIndex(week),
    employed: state.job !== null,
    ownsCar: state.car !== null,
    ownsHome: state.home !== null,
    lifeStage: lifeStageFor(state.startAge + yearIndex(week)),
    flags: new Set(state.flags),
    debtTypes: new Set(state.debts.map((debt) => debt.kind)),
    heldAssets: new Set(ASSET_IDS.filter((id) => state.holdings[id].shares > 0)),
    stats: {
      cashCents: state.cashCents,
      mood: state.mood,
      energy: state.energy,
      performance: state.performance,
      carAgeYears: state.car === null ? 0 : (week - state.car.purchasedWeek) / WEEKS_PER_YEAR,
      emergencyFundMonths: monthlyExpenses <= 0 ? 0 : state.emergencyFundCents / monthlyExpenses,
      weeksInCurrentJob: state.job === null ? 0 : week - state.job.startedWeek,
      lastRaisePct: state.lastRaisePct,
      inflationThisYear: world.market.inflation.annualRate[Math.min(yearIndex(week), state.runLengthYears - 1)],
      cryptoPriceChange52w: priceChange52w(world, 'CRYP', week),
      monthlyIncome,
      // A thin file reads as 0 rather than absent, so a `>=` gate on it fails
      // rather than silently not applying.
      creditScore: state.credit.score ?? 0,
    },
  };
}

function priceChange52w(world: RunWorld, assetId: AssetId, week: number): number {
  const prices = world.market.series[assetId].priceCents;
  const then = prices[Math.max(0, week - WEEKS_PER_YEAR)];
  return then === 0 ? 0 : prices[Math.min(week, prices.length - 1)] / then - 1;
}

/** [T] Life stages, used for event gating and pacing. */
export function lifeStageFor(age: number): string {
  if (age < 25) return 'starting-out';
  if (age < 35) return 'early-career';
  if (age < 50) return 'mid-career';
  if (age < 62) return 'late-career';
  return 'retirement';
}

/**
 * The formula context an event's magnitudes are evaluated against (§9.3).
 *
 * `roll` is a uniform in [0, 1) drawn once per fired event, so a magnitude like
 * `0.6*monthlyIncome*(0.5+1.5*roll)` costs a different amount each firing. It
 * falls back to 0.5 only for contexts with no event behind them — a deferred
 * effect carries its scheduling roll instead (see `ScheduledEffect.roll`).
 */
export function formulaContextFrom(state: RunState, world: RunWorld, roll = 0.5) {
  const week = state.weekIndex;
  return {
    vars: {
      cpi: world.market.inflation.cpi[Math.min(yearIndex(week), state.runLengthYears)],
      monthlyIncome: (state.job?.weeklyGrossCents ?? 0) * (WEEKS_PER_YEAR / 12),
      carScrapValue: state.car === null ? 0 : carValueCents(state.car, week),
      performanceNorm: state.performance / 100,
      cashCents: state.cashCents,
      mood: state.mood,
      energy: state.energy,
      roll,
      // Fractions, not percentages — a card writes `inflationThisYear*100`.
      inflationThisYear:
        world.market.inflation.annualRate[Math.min(yearIndex(week), state.runLengthYears - 1)],
      lastRaisePct: state.lastRaisePct,
    },
    price: (assetId: string) =>
      world.market.series[assetId as AssetId]?.priceCents[week] ?? Number.NaN,
  };
}

/**
 * The context the *next* `tick` will evaluate this week's event in.
 *
 * Step 1 increments `weekIndex` before anything reads it, so a caller holding
 * the pre-tick state is one week behind — quoting a card from it is wrong by a
 * whole year's inflation whenever the event lands on a year boundary. The `+ 1`
 * lives here because it is a fact about the pipeline, not about the UI.
 */
export function pendingEventContext(state: RunState, world: RunWorld, roll: number) {
  return formulaContextFrom({ ...state, weekIndex: state.weekIndex + 1 }, world, roll);
}

/**
 * The context the *next* `tick` will evaluate a pending chain card in.
 *
 * The `+ 1` is the same fact about the pipeline that `pendingEventContext`
 * carries: step 1 increments `weekIndex` before anything reads it, so a caller
 * holding the pre-tick state is one week behind.
 */
export function pendingChainContext(
  state: RunState,
  world: RunWorld,
  chain: ActiveChain,
  roll: number,
) {
  return chainFormulaContext({ ...state, weekIndex: state.weekIndex + 1 }, world, chain, roll);
}

/** The week a pending event will fire in, given the state before its tick. */
export function pendingEventWeek(state: RunState): number {
  return state.weekIndex + 1;
}

// --- chains (§9.6) ----------------------------------------------------------

/**
 * Years of experience relevant to a role: time spent at its tier **or a higher
 * one**. Higher-tier work subsumes lower — a former specialist applying to an
 * entry role is not inexperienced — while time at a lower tier does not count
 * towards a role above it.
 */
export function relevantExperienceYears(
  experienceWeeks: Readonly<Record<JobTier, number>>,
  tier: JobTier,
): number {
  const floor = tierRank(tier);
  return (
    JOB_TIERS.filter((candidate) => tierRank(candidate) >= floor).reduce(
      (sum, candidate) => sum + experienceWeeks[candidate],
      0,
    ) / WEEKS_PER_YEAR
  );
}

const HOUSING_TARGET = /^(rent|buy)-(\d)$/;

/** A `rent-N` / `buy-N` target's tier, or `null` for anything else. */
function housingTargetTier(target: string | null): number | null {
  const match = target === null ? null : HOUSING_TARGET.exec(target);
  return match === null ? null : Number(match[2]);
}

/**
 * The gate state a chain step sees: the ordinary event state plus the two facts
 * only a chain has — whether what it is chasing is still there, and how long it
 * has been chasing it.
 */
export function chainEventStateFrom(
  state: RunState,
  world: RunWorld,
  chain: ActiveChain,
): EventState {
  const base = eventStateFrom(state, world);
  const vars = chainFormulaContext(state, world, chain, 0.5).vars;

  return {
    ...base,
    stats: {
      ...base.stats,
      targetOpen: vars.targetOpen,
      weeksSearching: vars.weeksSearching,
      targetTier: vars.targetTier,
      targetIsBuy: vars.targetIsBuy,
      targetRentCents: vars.targetRentCents,
      homePriceCents: vars.homePriceCents,
      downPaymentCents: vars.downPaymentCents,
      applicationOdds: vars.applicationOdds,
    },
  };
}

/**
 * The formula context a chain step's magnitudes are evaluated against.
 *
 * `applicationOdds` is computed here rather than written in content: GDD §3.1's
 * formula reads experience, networking and time out of work, none of which a
 * content formula can see, and restating the constants in JSON would let the
 * two drift.
 */
export function chainFormulaContext(
  state: RunState,
  world: RunWorld,
  chain: ActiveChain,
  roll: number,
) {
  const base = formulaContextFrom(state, world, roll);
  const week = state.weekIndex;
  const cpi = world.market.inflation.cpi[Math.min(yearIndex(week), state.runLengthYears)];

  const targetJob = world.jobs.find((job) => job.id === chain.target);
  const targetTier = housingTargetTier(chain.target) ?? state.housingTier;
  /**
   * Whether what the chain is chasing is still there. A job posting closes on
   * its own schedule (`OPENING_WEEKS_MIN..MAX`), so a slow search can arrive to
   * find nothing — which is the point. A housing target is always "open".
   */
  const targetOpen =
    targetJob === undefined || availableJobIds(world.jobTimeline, world.jobs, week).includes(targetJob.id)
      ? 1
      : 0;
  /**
   * [F] Derived from the rent, never set independently. TDD §8.2: the
   * buy-vs-rent comparison only teaches the right thing if the home price and
   * the rent tiers are the same number seen two ways.
   */
  const homePriceCents = Math.round(tierRentCents(targetTier) * cpi * 12 * HOME_PRICE_TO_RENT);

  const odds =
    targetJob === undefined
      ? 0
      : applicationProbability({
          relevantExperienceYears: relevantExperienceYears(state.experienceWeeks, targetJob.tier),
          hasNetworkingContact: state.flags.includes(`networking_${targetJob.employer}`),
          weeksUnemployed: state.weeksUnemployed,
        });

  return {
    ...base,
    vars: {
      ...base.vars,
      applicationOdds: odds,
      targetOpen,
      creditScore: state.credit.score ?? 0,
      weeksSearching: week - chain.startedWeek,
      targetTier,
      targetIsBuy: chain.target?.startsWith('buy-') === true ? 1 : 0,
      targetRentCents: Math.round(tierRentCents(targetTier) * cpi),
      currentRentCents: Math.round(tierRentCents(state.housingTier) * cpi),
      homePriceCents,
      /** [T] §5.2 requires at least 10% down; the chain asks for a conventional 20%. */
      downPaymentCents: Math.round(homePriceCents * HOME_SEARCH_DOWN_PAYMENT_PCT),
      /**
       * The pay of the role being chased, so a card can size a signing bonus
       * against the job applied for rather than the one being left.
       */
      targetMonthlyIncomeCents:
        targetJob === undefined ? 0 : Math.round(weeklyGrossCents(targetJob) * (WEEKS_PER_YEAR / 12)),
    },
  };
}

// --- chain actions (§9.6) ---------------------------------------------------

/**
 * Begin a chain, or leave one.
 *
 * **These are actions, not tick inputs.** Deciding to look for a job happens
 * *within* the week the player is already in; it does not advance time and it
 * must not touch the card that week is holding. Routing them through `tick` did
 * both: a tick with no `chooseEvent` falls back to the first available choice,
 * so tapping Apply on a slot week resolved that week's event with its
 * first-listed option and the player never saw the card. That is a correctness
 * bug and a GDD §1 one — the first-listed option is exactly the signal the
 * ordering rules exist to avoid.
 *
 * The Logbook entry is emitted here rather than queued, so the action is
 * complete when it returns. `flavor` is the only stream touched, which is the
 * §2.2 guarantee.
 */
function chainActionState(
  world: RunWorld,
  streams: RunStreams,
  state: RunState,
  outcome: EffectOutcome,
  logbookKey: string,
): RunState {
  const week = state.weekIndex;
  const priceAt = (assetId: AssetId): number => world.market.series[assetId].priceCents[week];
  const next = applyOutcome(state, outcome, priceAt, week, world);

  const emitted = emitEntries(
    [{ trigger: { k: 'firstTime', action: 'chain' }, key: logbookKey }],
    week,
    world.templates,
    templateVarsFor(next, world, next.netWorthHistory[next.netWorthHistory.length - 1] ?? 0),
    streams.flavor,
    next.logbook,
  );

  return {
    ...next,
    logbook: emitted.state,
    logbookEntries: [...next.logbookEntries, ...emitted.entries],
  };
}

/**
 * Open a chain at the current week.
 *
 * Refused, silently, if the chain is unknown, already running, gated out or
 * still cooling down — the engine owns that rule, so no caller can start
 * something the simulation would not. Returns the state unchanged in that case.
 */
export function beginChain(
  world: RunWorld,
  streams: RunStreams,
  state: RunState,
  chainId: string,
  target: string | null = null,
): RunState {
  const definition = chainById(world.chainDefs, chainId);
  const blocked = startBlockedReason(
    world.chainDefs,
    state.chains,
    state.chainHistory,
    chainId,
    eventStateFrom(state, world),
  );
  if (definition === undefined || blocked !== null) return state;

  const opened = startChain(definition, state.weekIndex, target);
  if (opened === null) return state;

  const outcome = applyEffects(definition.startEffects, formulaContextFrom(state, world));
  const next = chainActionState(world, streams, state, outcome, definition.logbookKeyStart);

  return {
    ...next,
    chains: withChain(next.chains, definition.id, opened),
    decisionLog: [
      ...next.decisionLog,
      { w: state.weekIndex, t: 'chainStart', k: definition.id, g: target ?? undefined },
    ],
  };
}

/** Walk away from a chain in flight, paying its `abandonEffects`. */
export function abandonChain(
  world: RunWorld,
  streams: RunStreams,
  state: RunState,
  chainId: string,
): RunState {
  const leaving = state.chains.find((entry) => entry.chainId === chainId);
  const definition = chainById(world.chainDefs, chainId);
  if (leaving === undefined || definition === undefined) return state;

  const outcome = applyEffects(definition.abandonEffects, formulaContextFrom(state, world));
  const next = chainActionState(world, streams, state, outcome, definition.logbookKeyAbandon);

  return {
    ...next,
    chains: withChain(next.chains, chainId, null),
    chainHistory: recordChainEnd(next.chainHistory, chainId, state.weekIndex),
    decisionLog: [...next.decisionLog, { w: state.weekIndex, t: 'chainAbandon', k: chainId }],
  };
}

// --- the pipeline -----------------------------------------------------------

/**
 * Advance one week.
 *
 * The numbered comments below are TDD §10's steps, in its order. They are not
 * decoration — keep them, and keep them in this sequence.
 */
export function tick(
  world: RunWorld,
  streams: RunStreams,
  previous: RunState,
  input: TickInput = {},
): TickResult {
  const interrupts: Interrupt[] = [];
  const pending: PendingEntry[] = [];

  // ---- 1. weekIndex++
  let state: RunState = { ...previous, weekIndex: previous.weekIndex + 1 };
  const week = state.weekIndex;

  if (week >= world.market.weeks) {
    return {
      state: previous,
      interrupts: [{ reason: 'run-complete', weekIndex: previous.weekIndex }],
      firedEventId: null,
      awaitingEventChoice: null,
      eventRoll: null,
      awaitingChainStep: null,
      chainRoll: null,
      firedChainStep: null,
    };
  }

  const year = Math.min(yearIndex(week), state.runLengthYears);
  const cpi = world.market.inflation.cpi[year];

  // ---- 2. Apply market prices for weekIndex (lookup only — no RNG)
  const priceAt = (assetId: AssetId): number => world.market.series[assetId].priceCents[week];

  // ---- 3. Accrue income: gross pay, retirement + match, withholding, net → cash
  if (state.job !== null) {
    const gross = state.job.weeklyGrossCents;
    const contribution = retirementContributionCents(gross, state.retirement.contributionPct);
    const withheld = weeklyWithholdingCents(gross - contribution.employeeCents, cpi);
    const net = gross - contribution.employeeCents - withheld;

    state = {
      ...state,
      cashCents: state.cashCents + net,
      retirement: { ...state.retirement, balanceCents: state.retirement.balanceCents + contribution.totalCents },
      employerMatchedThisYearCents: state.employerMatchedThisYearCents + contribution.employerCents,
      ytd: {
        ...state.ytd,
        employmentGrossCents: state.ytd.employmentGrossCents + gross,
        retirementContributionsCents: state.ytd.retirementContributionsCents + contribution.employeeCents,
        withheldCents: state.ytd.withheldCents + withheld,
      },
    };
  }

  // ---- 4. Standing orders, in declared order
  state = applyStandingOrders(state, priceAt, week);

  // ---- 5. Quarter boundary: dividends, auto-reinvest
  if (isDividendWeek(week)) {
    let dividends = 0;
    let holdings = { ...state.holdings };
    for (const id of ASSET_IDS) {
      const shares = holdings[id].shares;
      if (shares === 0) continue;
      const paid = dividendPaymentCents(world.market, id, shares, week);
      if (paid === 0) continue;
      dividends += paid;
      if (state.standingOrders.autoReinvestDividends) {
        const price = priceAt(id);
        holdings = {
          ...holdings,
          [id]: {
            shares: shares + paid / price,
            lots: [...holdings[id].lots, { assetId: id, shares: paid / price, purchasedWeek: week, costBasisCents: paid }],
          },
        };
      }
    }
    // The tax is incurred whether or not the cash was ever seen (§3.5).
    state = {
      ...state,
      holdings,
      cashCents: state.standingOrders.autoReinvestDividends ? state.cashCents : state.cashCents + dividends,
      ytd: { ...state.ytd, dividendsCents: state.ytd.dividendsCents + dividends },
    };
  }

  // ---- 6. Month boundary
  if (isMonthBoundary(week)) {
    const monthly = monthlyOutgoings(state, world, cpi);
    const shortfall = monthly - state.cashCents;

    let cashAfterBills = Math.max(0, state.cashCents - monthly);
    let unpaid = state.accruedUnpaidBillsCents + Math.max(0, shortfall);

    // Unpaid bills accrue a penalty and are then paid down when there is cash
    // to do it. Without the paydown they could only ever grow, which turned a
    // single bad month into a permanent and compounding liability.
    if (unpaid > 0) {
      unpaid += unpaidBillPenaltyCents(unpaid) * (WEEKS_PER_YEAR / 12);
      const paid = Math.min(cashAfterBills, unpaid);
      cashAfterBills -= paid;
      unpaid -= paid;
    }

    state = {
      ...state,
      cashCents: Math.round(cashAfterBills),
      accruedUnpaidBillsCents: Math.round(unpaid),
    };
    if (shortfall > 0) {
      interrupts.push({ reason: 'unpayable-bill', weekIndex: week, detail: `${shortfall} cents short` });
    }

    // 6b-c. Debt interest, minimums and BNPL installments. Serviced against the
    // cash left after the fixed bills, so debt service can never overdraw.
    const serviced = serviceDebts(state, shortfall > 0, state.cashCents);
    state = {
      ...state,
      debts: serviced.debts,
      cashCents: state.cashCents - serviced.paidCents,
      interestPaidThisYearCents: state.interestPaidThisYearCents + serviced.interestCents,
    };

    // 6d. Credit score recompute.
    state = {
      ...state,
      credit: updateMonthly(
        serviced.missedAny ? recordMissedPayment(state.credit) : recordOnTimePayment(state.credit),
        {
          revolvingBalanceCents: unsecuredDebtCents(state.debts),
          totalRevolvingLimitCents: revolvingLimitCents(state.debts),
          weekIndex: week,
        },
        world.entryCreditScore,
      ),
    };

    // 6e. Bankruptcy trigger (§13). All three conditions, or nothing.
    state = {
      ...state,
      consecutiveMissedPaymentMonths: serviced.missedAny
        ? state.consecutiveMissedPaymentMonths + 1
        : 0,
    };
    if (
      bankruptcyTriggered({
        unsecuredDebtCents: unsecuredDebtCents(state.debts) + state.accruedUnpaidBillsCents,
        annualGrossCents: annualGrossCents(state),
        cashCents: state.cashCents,
        monthlyExpensesCents: monthly,
        consecutiveMissedPaymentMonths: state.consecutiveMissedPaymentMonths,
      })
    ) {
      state = { ...state, flags: addFlag(state.flags, 'bankruptcy_eligible') };
      interrupts.push({ reason: 'bankruptcy', weekIndex: week });
    }
  }

  // ---- 7. Event check (BEFORE the allocation, so an event can constrain the week)
  let firedEventId: string | null = null;
  const slotIndex = world.events.slots.indexOf(week);
  if (slotIndex !== -1) {
    const selected = selectEvent(
      world.eventDefs,
      eventStateFrom(state, world),
      state.eventHistory,
      world.events.slotTickets[slotIndex],
    );
    if (selected !== null) {
      firedEventId = selected.id;
      const available = selected.choices.filter(
        (choice) => (choice.requires ?? []).every((gate) => passesGate(gate, eventStateFrom(state, world))),
      );
      // [F] One draw per fired event. A count that varied with the choice
      // taken would put two players sharing a seed out of step.
      const roll = input.eventRoll ?? streams.eventMagnitude();

      const pick = input.chooseEvent?.(selected.id, available.map((c) => c.id));

      if (pick === null) {
        return {
          state: previous,
          interrupts: [{ reason: 'event', weekIndex: week, detail: selected.id }],
          firedEventId: selected.id,
          awaitingEventChoice: selected.id,
          eventRoll: roll,
          awaitingChainStep: null,
          chainRoll: null,
          firedChainStep: null,
        };
      }

      const choice = available.find((c) => c.id === pick) ?? available[0];

      if (choice !== undefined) {
        state = {
          ...state,
          decisionLog: [
            ...state.decisionLog,
            { w: week, t: 'event', e: selected.id, c: choice.id },
          ],
        };
        const outcome = resolveChoice(choice, formulaContextFrom(state, world, roll), week, streams.eventOutcome);
        state = applyOutcome(state, outcome, priceAt, week, world);
        state = { ...state, eventHistory: recordFiring(state.eventHistory, selected.id, week) };
        for (const key of outcome.logbookKeys) {
          pending.push({ trigger: { k: 'event', eventId: selected.id, choiceId: choice.id }, key });
        }
        for (const jobId of outcome.jobOffers) {
          // A slot event has no chain behind it, so an offer that named no job
          // has nothing to mean and is inert.
          if (jobId !== null) interrupts.push({ reason: 'job-offer', weekIndex: week, detail: jobId });
        }
      }
      interrupts.push({ reason: 'event', weekIndex: week, detail: selected.id });
    }
  }

  // ---- 7b. Chain check (§9.6)
  //
  // After 7 for the same reason 7 sits before 9: a chain step that costs energy
  // must constrain *this* week's allocation. Before 8 so a step can schedule an
  // ordinary deferred effect.
  let firedChainStep: { chainId: string; stepId: string } | null = null;

  const dueEntry = dueChain(state.chains, week);
  if (dueEntry !== null) {
    const definition = chainById(world.chainDefs, dueEntry.chainId);
    const step = definition === undefined ? undefined : stepById(definition, dueEntry.stepId);

    if (definition === undefined || step === undefined) {
      // Content lost the chain out from under an in-flight run. Ending it is
      // the only option that cannot strand the player mid-search.
      state = { ...state, chains: withChain(state.chains, dueEntry.chainId, null) };
    } else if (firedEventId !== null) {
      // [F] One card a week. The slot schedule is the seeded world and never
      // yields; the player-initiated chain is the thing that waits.
      state = { ...state, chains: withChain(state.chains, dueEntry.chainId, slipChain(dueEntry, week)) };
    } else if (
      step.card.choices.filter((choice) =>
        (choice.requires ?? []).every((gate) =>
          passesGate(gate, chainEventStateFrom(state, world, dueEntry)),
        ),
      ).length === 0
    ) {
      // Every choice gated out. Ending is the only safe answer: the step is
      // due, so leaving it in place would present the same empty card every
      // week for the rest of the run.
      state = {
        ...state,
        chains: withChain(state.chains, dueEntry.chainId, null),
        chainHistory: recordChainEnd(state.chainHistory, dueEntry.chainId, week),
      };
    } else {
      const chainState = chainEventStateFrom(state, world, dueEntry);
      const available = step.card.choices.filter((choice) =>
        (choice.requires ?? []).every((gate) => passesGate(gate, chainState)),
      );

      // One draw per presented chain card, on the chain's own stream.
      const roll = input.chainRoll ?? streams[definition.stream]();
      const pick = input.chooseChainStep?.(definition.id, step.id, available.map((c) => c.id));

      if (pick === null) {
        return {
          state: previous,
          interrupts: [{ reason: 'event', weekIndex: week, detail: `${definition.id}/${step.id}` }],
          firedEventId,
          awaitingEventChoice: null,
          eventRoll: null,
          awaitingChainStep: { chainId: definition.id, stepId: step.id },
          chainRoll: roll,
          firedChainStep: null,
        };
      }

      const choice = available.find((c) => c.id === pick) ?? available[0];
      if (choice !== undefined) {
        firedChainStep = { chainId: definition.id, stepId: step.id };
        state = {
          ...state,
          decisionLog: [
            ...state.decisionLog,
            { w: week, t: 'chainStep', k: definition.id, s: step.id, c: choice.id },
          ],
        };

        const outcome = resolveChoice(
          choice,
          chainFormulaContext(state, world, dueEntry, roll),
          week,
          streams[definition.stream],
        );
        state = applyOutcome(state, outcome, priceAt, week, world, dueEntry.target);

        const next = advanceChain(definition, dueEntry, outcome.chainGoto, week);
        state = { ...state, chains: withChain(state.chains, definition.id, next) };
        if (next === null) {
          state = { ...state, chainHistory: recordChainEnd(state.chainHistory, definition.id, week) };
        }

        for (const key of outcome.logbookKeys) {
          pending.push({ trigger: { k: 'event', eventId: step.card.id, choiceId: choice.id }, key });
        }
        for (const offered of outcome.jobOffers) {
          interrupts.push({
            reason: 'job-offer',
            weekIndex: week,
            detail: offered ?? dueEntry.target ?? '',
          });
        }
        interrupts.push({ reason: 'event', weekIndex: week, detail: `${definition.id}/${step.id}` });
      }
    }
  }

  // ---- 8. Resolve deferred effects due this week
  const due = state.deferredEffects.filter((deferred) => deferred.dueWeek === week);
  if (due.length > 0) {
    const eventState = eventStateFrom(state, world);
    for (const deferred of due) {
      if (deferred.condition !== undefined && !passesGate(deferred.condition, eventState)) continue;
      const outcome = applyEffects(deferred.effects, formulaContextFrom(state, world, deferred.roll));
      state = applyOutcome(state, outcome, priceAt, week, world);
      if (deferred.logbookKey !== undefined) {
        pending.push({ trigger: { k: 'firstTime', action: 'deferred' }, key: deferred.logbookKey });
      }
    }
    state = { ...state, deferredEffects: state.deferredEffects.filter((d) => d.dueWeek !== week) };
  }

  // ---- 9. Apply the time allocation → energy, mood, performance, side hustle
  const allocation = input.allocation ?? state.standingOrders.defaultAllocation;
  const energy = nextEnergy(state.energy, state.mood, allocation);
  const mood = nextMood(state.mood, allocation, {
    discretionarySpendCents: input.discretionarySpendCents ?? 0,
    discretionaryBaselineCents: Math.round(DISCRETIONARY_BASELINE_CENTS * cpi),
    housingTier: state.housingTier,
    unsecuredDebtCents: unsecuredDebtCents(state.debts),
    annualGrossCents: annualGrossCents(state),
  });
  const workedThisWeek = allocation.work !== 'none' && state.job !== null;
  const consecutiveOvertimeWeeks = allocation.overtime > 0 ? state.consecutiveOvertimeWeeks + 1 : 0;
  const performance = nextPerformance(state.performance, {
    energy,
    workedThisWeek,
    consecutiveOvertimeWeeks,
  });

  // Experience accrues only for a week actually worked, at the tier of the job
  // held — which is what an application's "relevant experience" then reads.
  const workedTier =
    workedThisWeek ? world.jobs.find((job) => job.id === state.job!.jobId)?.tier : undefined;

  state = {
    ...state,
    energy,
    mood,
    performance,
    experienceWeeks:
      workedTier === undefined
        ? state.experienceWeeks
        : { ...state.experienceWeeks, [workedTier]: state.experienceWeeks[workedTier] + 1 },
    consecutiveOvertimeWeeks,
    consecutiveLowMoodWeeks: mood < REACH_OUT_MOOD_THRESHOLD ? state.consecutiveLowMoodWeeks + 1 : 0,
    weeksUnemployed: state.job === null ? state.weeksUnemployed + 1 : 0,
  };

  // ---- 10. Check firing / warning thresholds
  if (state.job !== null) {
    const track = evaluatePerformanceTrack(state.job.track, state.performance, week);
    if (track.standing !== state.job.track.standing) {
      interrupts.push({ reason: 'firing-risk', weekIndex: week, detail: track.standing });
      pending.push({ trigger: { k: 'threshold', metric: 'performance', crossed: state.performance, direction: 'down' }, key: `standing_${track.standing}` });
    }
    const terminated = track.terminationWeek !== null && week >= track.terminationWeek;
    state = terminated
      ? { ...state, job: null, flags: addFlag(state.flags, 'was_fired') }
      : { ...state, job: { ...state.job, track } };
  }

  // ---- 11. Anti-spiral force-schedule (§7.4)
  if (
    shouldForceReachOut(
      state.consecutiveLowMoodWeeks,
      state.lastReachOutWeek === null ? null : week - state.lastReachOutWeek,
    )
  ) {
    state = {
      ...state,
      mood: clamp(state.mood + 25, 0, 100),
      lastReachOutWeek: week,
      consecutiveLowMoodWeeks: 0,
    };
    pending.push({ trigger: { k: 'streakBreak', streak: 'low_mood' }, key: 'SOC_REACH_OUT' });
  }

  // ---- 12. Recompute net worth, append to history
  const netWorth = balanceSheet({
    cashCents: state.cashCents,
    savingsCents: state.savingsCents,
    emergencyFundCents: state.emergencyFundCents,
    portfolioValueCents: portfolioValueCents(
      Object.fromEntries(ASSET_IDS.map((id) => [id, state.holdings[id].shares])),
      world.market,
      week,
    ),
    retirementBalanceCents: state.retirement.balanceCents,
    carValueCents: state.car === null ? 0 : carValueCents(state.car, week),
    homeValueCents: state.home === null ? 0 : homeValueCents(state.home, world.market.homeValuePath, week),
    debts: state.debts,
    accruedUnpaidBillsCents: state.accruedUnpaidBillsCents,
  }).netWorthCents;
  state = { ...state, netWorthHistory: [...state.netWorthHistory, netWorth] };

  // ---- 13. Evaluate Logbook triggers, emit entries
  //          [F] `streams.flavor` and nothing else — see §2.2.
  const emitted = emitEntries(
    pending,
    week,
    world.templates,
    templateVarsFor(state, world, netWorth),
    streams.flavor,
    state.logbook,
  );
  state = {
    ...state,
    logbook: emitted.state,
    logbookEntries: [...state.logbookEntries, ...emitted.entries],
  };

  // ---- 14. Year boundary: tax settlement, raise, inflation step
  //          (the inflation path is pre-generated, so the "step" is a lookup;
  //           the annual review screen is the UI's job)
  if (isYearBoundary(week)) {
    state = settleYear(state, world, cpi, netWorth);
  }

  // ---- 15. Evaluate interrupt conditions
  interrupts.push(...evaluateInterrupts(state, previous));

  return {
    state,
    interrupts,
    firedEventId,
    awaitingEventChoice: null,
    eventRoll: null,
    awaitingChainStep: null,
    chainRoll: null,
    firedChainStep,
  };
}

// --- step helpers -----------------------------------------------------------

function applyStandingOrders(
  state: RunState,
  priceAt: (assetId: AssetId) => number,
  week: number,
): RunState {
  const orders = state.standingOrders;
  let cash = state.cashCents;

  // a. Emergency fund
  const toEmergency = Math.min(orders.emergencyFundWeeklyCents, cash);
  cash -= toEmergency;
  // b. Savings
  const toSavings = Math.min(orders.savingsWeeklyCents, cash);
  cash -= toSavings;

  // c. Auto-invest
  let holdings = state.holdings;
  if (orders.autoInvest !== null) {
    const amount = Math.min(orders.autoInvest.weeklyCents, cash);
    if (amount > 0) {
      const id = orders.autoInvest.assetId;
      const price = priceAt(id);
      const shares = amount / price;
      cash -= amount;
      holdings = {
        ...holdings,
        [id]: {
          shares: holdings[id].shares + shares,
          lots: [...holdings[id].lots, { assetId: id, shares, purchasedWeek: week, costBasisCents: amount }],
        },
      };
    }
  }
  // d. Debt payments happen at the month boundary, in step 6.

  return {
    ...state,
    cashCents: cash,
    holdings,
    emergencyFundCents: state.emergencyFundCents + toEmergency,
    savingsCents: state.savingsCents + toSavings,
    emergencyStreakWeeks: toEmergency > 0 ? state.emergencyStreakWeeks + 1 : 0,
  };
}

function monthlyOutgoings(state: RunState, world: RunWorld, cpi: number): number {
  const rent = state.home === null ? tierRentCents(state.housingTier) * cpi : 0;
  const recurring = state.recurringExpenses.reduce((sum, expense) => sum + expense.cents, 0);
  const homeCarry =
    state.home === null
      ? 0
      : homeCarryingCostWeeklyCents(homeValueCents(state.home, world.market.homeValuePath, state.weekIndex)) *
        (WEEKS_PER_YEAR / 12);
  return Math.round(BASE_MONTHLY_EXPENSES_CENTS * cpi + rent + recurring + homeCarry);
}

function revolvingLimitCents(debts: readonly Debt[]): number {
  return debts
    .filter((debt) => debt.kind === 'credit-card')
    .reduce((sum, debt) => sum + (debt as { creditLimitCents?: number }).creditLimitCents!, 0);
}

/**
 * One month of debt service.
 *
 * `availableCents` is a hard ceiling: an instrument that cannot be paid from the
 * cash actually present is **missed**, not paid on credit. Without it the tick
 * subtracted the scheduled payments unclamped and cash went silently negative —
 * survivable at a card minimum of tens of dollars, not at a mortgage payment of
 * thousands.
 */
function serviceDebts(
  state: RunState,
  broke: boolean,
  availableCents: number,
): { debts: readonly Debt[]; paidCents: number; interestCents: number; missedAny: boolean } {
  let paidCents = 0;
  let interestCents = 0;
  let missedAny = false;
  let remaining = availableCents;
  const debts: Debt[] = [];

  // Iterate in the order the debts were opened — stable, and never sorted by
  // balance, which would make payment order depend on market movement.
  for (const debt of state.debts) {
    // An amortizing loan takes its scheduled payment: interest first, the rest
    // against principal. Without this a mortgage would sit at its opening
    // balance for thirty years, which is the opposite of §5.2's lesson.
    if (debt.kind === 'amortizing') {
      const loan = debt as AmortizingLoan;
      if (loan.balanceCents <= 0 || loan.monthsPaid >= loan.termMonths) {
        debts.push(loan);
        continue;
      }

      const scheduled = Math.min(
        loan.monthlyPaymentCents,
        loan.balanceCents + Math.round(loan.balanceCents * monthlyRate(loan.aprAnnual)),
      );
      if (broke || scheduled > remaining) {
        // The payment is missed. **The interest is not forgiven** — it accrues
        // onto the balance, so a missed month makes the debt larger rather than
        // free. Skipping it outright let a player who stayed broke ride a
        // mortgage for thirty years without paying a cent of interest, which
        // inverts §5.2's lesson on the one instrument the buy path rests on.
        // `monthsPaid` does not advance: a missed month is not a month served.
        const accrued = Math.round(loan.balanceCents * monthlyRate(loan.aprAnnual));
        missedAny = true;
        interestCents += accrued;
        debts.push({ ...loan, balanceCents: loan.balanceCents + accrued });
        continue;
      }

      const result = payMonth(loan);
      paidCents += result.entry.paymentCents;
      interestCents += result.entry.interestCents;
      remaining -= result.entry.paymentCents;
      debts.push(result.loan);
      continue;
    }

    if (debt.kind !== 'credit-card') {
      debts.push(debt);
      continue;
    }
    const card = debt as Parameters<typeof closeStatement>[0];
    const minimum = minimumPaymentCents(card);
    const due = broke || minimum > remaining ? 0 : minimum;
    if (due === 0 && card.balanceCents > 0) missedAny = true;
    const result = closeStatement(card, due);
    paidCents += result.paidCents;
    interestCents += result.interestChargedCents;
    remaining -= result.paidCents;
    debts.push(result.card);
  }

  return { debts, paidCents, interestCents, missedAny };
}

function applyOutcome(
  state: RunState,
  outcome: EffectOutcome,
  priceAt: (assetId: AssetId) => number,
  week: number,
  world: RunWorld,
  chainTarget: string | null = null,
): RunState {
  let holdings = state.holdings;
  for (const trade of outcome.assetTrades) {
    const id = trade.assetId as AssetId;
    if (holdings[id] === undefined) continue;
    const price = priceAt(id);
    holdings = {
      ...holdings,
      [id]: {
        shares: holdings[id].shares + trade.sharesDelta,
        lots:
          trade.sharesDelta > 0
            ? [...holdings[id].lots, { assetId: id, shares: trade.sharesDelta, purchasedWeek: week, costBasisCents: Math.round(trade.sharesDelta * price) }]
            : holdings[id].lots,
      },
    };
  }

  let flags = state.flags;
  for (const flag of outcome.flagsAdded) flags = addFlag(flags, flag);
  for (const flag of outcome.flagsRemoved) flags = removeFlag(flags, flag);

  // A `debt` effect computes a principal and must actually open the line. The
  // list is walked in declared order so two debts opened by one choice get
  // stable ids, and `sequence` disambiguates them within the week.
  let debts = state.debts;
  let unabsorbedCents = 0;
  outcome.debtsOpened.forEach((opened, sequence) => {
    const result = openDebtFromInstrument(debts, opened.instrument, opened.principalCents, {
      weekIndex: week,
      creditScore: state.credit.score,
      sequence,
    });
    debts = result.debts;
    unabsorbedCents += result.unabsorbedCents;
  });

  // A `jobOffer` effect *is* the acceptance — content only emits it from a
  // choice the player took. Pay is read from the definition, so it starts at
  // the role's rate rather than carrying the old job's raises across.
  let job = state.job;
  for (const offered of outcome.jobOffers) {
    const jobId = offered ?? chainTarget;
    const definition = world.jobs.find((candidate) => candidate.id === jobId);
    if (definition === undefined) continue;
    job = {
      jobId: definition.id,
      startedWeek: week,
      weeklyGrossCents: weeklyGrossCents(definition),
      workMode: definition.workMode,
      // A new employer has not seen the last one's warnings.
      track: { standing: 'clear', terminationWeek: null },
    };
  }

  // Buying records ownership only: the deposit is a `cash` effect and the
  // mortgage a `debt` effect, so each shows up on the balance sheet as itself.
  // Selling is priced by the market and clears the mortgage with the proceeds.
  let home = state.home;
  let saleProceedsCents = 0;
  for (const trade of outcome.homeTrades) {
    if (trade.action === 'buy') {
      home = { purchasePriceCents: trade.priceCents, purchasedWeek: week };
      continue;
    }
    if (home === null) continue;
    const valueCents = homeValueCents(home, world.market.homeValuePath, week);
    const mortgages = debts.filter(isMortgage);
    saleProceedsCents += homeSaleProceedsCents(
      valueCents,
      mortgages.reduce((sum, loan) => sum + loan.balanceCents, 0),
    );
    debts = debts.filter((debt) => !isMortgage(debt));
    home = null;
  }

  // Chains an event opened — GDD §5.4's follow-up. A chain already in flight is
  // left alone rather than restarted from the top.
  let chains = state.chains;
  for (const start of outcome.chainStarts) {
    if (chains.some((entry) => entry.chainId === start.chainId)) continue;
    const definition = chainById(world.chainDefs, start.chainId);
    if (definition === undefined) continue;
    const opened = startChain(definition, week, start.target);
    if (opened !== null) chains = withChain(chains, start.chainId, opened);
  }

  return {
    ...state,
    cashCents: state.cashCents + outcome.cashDeltaCents + saleProceedsCents,
    mood: clamp(state.mood + outcome.moodDelta, 0, 100),
    energy: clamp(state.energy + outcome.energyDelta, 0, 100),
    performance: clamp(state.performance + outcome.performanceDelta, 0, 100),
    holdings,
    flags,
    job,
    debts,
    home,
    chains,
    housingTier:
      outcome.housingTier === null
        ? state.housingTier
        : clamp(outcome.housingTier, 0, HOUSING_TIER_RENT_CENTS.length - 1),
    accruedUnpaidBillsCents: state.accruedUnpaidBillsCents + unabsorbedCents,
    recurringExpenses: mergeRecurring(state.recurringExpenses, outcome.expenses),
    deferredEffects: [...state.deferredEffects, ...outcome.deferred],
    credit: outcome.creditEvents.reduce<CreditState>(applyCreditEvent, state.credit),
  };
}

function isMortgage(debt: Debt): debt is AmortizingLoan {
  return debt.kind === 'amortizing' && (debt as AmortizingLoan).loanType === 'mortgage';
}

/**
 * Fold new recurring expenses into the existing list **by category**.
 *
 * Appending blindly let the list grow without bound: a rent-increase event that
 * fires every year across a 30-year run produced 28 separate permanent `rent`
 * lines totalling $11,000 a month. One category, one line.
 */
function mergeRecurring(
  existing: readonly RecurringExpense[],
  incoming: EffectOutcome['expenses'],
): readonly RecurringExpense[] {
  const recurring = incoming.filter((expense) => expense.recurring);
  if (recurring.length === 0) return existing;

  const byCategory = new Map(existing.map((expense) => [expense.category, expense.cents]));
  for (const expense of recurring) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.cents);
  }

  // Sorted by category so serialization is stable.
  return [...byCategory]
    .filter(([, cents]) => cents !== 0)
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function templateVarsFor(state: RunState, world: RunWorld, netWorth: number): Record<string, string> {
  return {
    age: String(state.startAge + yearIndex(state.weekIndex)),
    cash: String(state.cashCents),
    netWorth: String(netWorth),
    amount: String(Math.abs(state.cashCents)),
    jobTitle: state.job?.jobId ?? 'unemployed',
    pct: state.lastRaisePct.toFixed(1),
    yearsIn: String(yearIndex(state.weekIndex)),
    friendName: world.names.friendName,
    advisorName: world.names.advisorName,
    assetName: 'SafeCo Index',
    monthName: '',
  };
}

function settleYear(state: RunState, world: RunWorld, cpi: number, netWorth: number): RunState {
  const settlement = settleAnnualTax({ ...state.ytd, cpi });
  const cash = state.cashCents + settlement.settlementCents;

  // The annual raise (§6.2). Its inflation term reads the year just finished,
  // which is the year the player actually lived through.
  const finishedYear = Math.max(0, yearIndex(state.weekIndex) - 1);
  const inflation = world.market.inflation.annualRate[Math.min(finishedYear, state.runLengthYears - 1)];
  const age = state.startAge + yearIndex(state.weekIndex);
  const raise = state.job === null ? 0 : annualRaiseRate(inflation, state.performance, age);

  // What the employer match would have added at the full 4%, less what was
  // actually matched. Stated as arithmetic in the review, with no adjective.
  const fullMatch = Math.round(state.ytd.employmentGrossCents * EMPLOYER_MATCH_CAP_PCT);
  const matchForgoneCents = Math.max(0, fullMatch - state.employerMatchedThisYearCents);

  const snapshot: AnnualSnapshot = {
    year: yearIndex(state.weekIndex),
    age: age,
    cpi,
    assetsCents: netWorth + totalLiabilitiesCents(state.debts) + state.accruedUnpaidBillsCents,
    liabilitiesCents: totalLiabilitiesCents(state.debts) + state.accruedUnpaidBillsCents,
    netWorthCents: netWorth,
    incomeCents: state.ytd.employmentGrossCents + state.ytd.sideHustleGrossCents,
    taxPaidCents: settlement.totalOwedCents,
    interestPaidCents: state.interestPaidThisYearCents,
    retirementContributedCents: state.ytd.retirementContributionsCents,
    employerMatchedCents: state.employerMatchedThisYearCents,
    matchForgoneCents,
    cashCents: Math.max(0, cash),
    investedCents: 0,
  };

  return {
    ...state,
    cashCents: Math.max(0, cash),
    accruedUnpaidBillsCents: state.accruedUnpaidBillsCents + Math.max(0, -cash),
    ytd: emptyYearToDate(),
    credit: decayWeek(state.credit),
    job:
      state.job === null
        ? null
        : { ...state.job, weeklyGrossCents: applyRaiseCents(state.job.weeklyGrossCents, raise) },
    lastRaisePct: raise,
    annualSnapshots: [...state.annualSnapshots, snapshot],
    interestPaidThisYearCents: 0,
    employerMatchedThisYearCents: 0,
  };
}

/** GDD §2.1's halt conditions. */
export function evaluateInterrupts(state: RunState, previous: RunState): Interrupt[] {
  const interrupts: Interrupt[] = [];
  const week = state.weekIndex;

  if (state.energy < ENERGY_INTERRUPT_FLOOR && previous.energy >= ENERGY_INTERRUPT_FLOOR) {
    interrupts.push({ reason: 'energy-floor', weekIndex: week });
  }
  if (state.mood < MOOD_INTERRUPT_FLOOR && previous.mood >= MOOD_INTERRUPT_FLOOR) {
    interrupts.push({ reason: 'mood-floor', weekIndex: week });
  }

  const gross = annualGrossCents(state);
  if (gross > 0) {
    const dti = unsecuredDebtCents(state.debts) / gross;
    const wasDti = unsecuredDebtCents(previous.debts) / Math.max(1, annualGrossCents(previous));
    if (dti > DEBT_INTERRUPT_DTI && wasDti <= DEBT_INTERRUPT_DTI) {
      interrupts.push({ reason: 'debt-threshold', weekIndex: week });
    }
  }

  if (lifeStageFor(state.startAge + yearIndex(week)) !== lifeStageFor(state.startAge + yearIndex(previous.weekIndex))) {
    interrupts.push({ reason: 'life-stage', weekIndex: week });
  }

  return interrupts;
}
