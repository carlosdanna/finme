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
import { carValueCents, homeCarryingCostWeeklyCents, homeValueCents } from './assets.ts';
import { type CreditState, decayWeek, recordMissedPayment, recordOnTimePayment, updateMonthly } from './credit.ts';
import { closeStatement, minimumPaymentCents } from './debt/creditCard.ts';
import { type Debt, totalLiabilitiesCents } from './debt/types.ts';
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
  /** Which choice to take if an event fires. Defaults to the first available. */
  readonly chooseEvent?: (eventId: string, choiceIds: readonly string[]) => string;
  /** Discretionary spending this week, for the mood term. */
  readonly discretionarySpendCents?: number;
}

export interface TickResult {
  readonly state: RunState;
  readonly interrupts: readonly Interrupt[];
  readonly firedEventId: string | null;
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

/** The formula context an event's magnitudes are evaluated against (§9.3). */
export function formulaContextFrom(state: RunState, world: RunWorld) {
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
    },
    price: (assetId: string) =>
      world.market.series[assetId as AssetId]?.priceCents[week] ?? Number.NaN,
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

    // 6b-c. Debt interest, minimums and BNPL installments.
    const serviced = serviceDebts(state, shortfall > 0);
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
      const pick = input.chooseEvent?.(selected.id, available.map((c) => c.id));
      const choice = available.find((c) => c.id === pick) ?? available[0];

      if (choice !== undefined) {
        state = {
          ...state,
          decisionLog: [
            ...state.decisionLog,
            { w: week, t: 'event', e: selected.id, c: choice.id },
          ],
        };
        const outcome = resolveChoice(choice, formulaContextFrom(state, world), week, streams.eventOutcome);
        state = applyOutcome(state, outcome, priceAt, week);
        state = { ...state, eventHistory: recordFiring(state.eventHistory, selected.id, week) };
        for (const key of outcome.logbookKeys) {
          pending.push({ trigger: { k: 'event', eventId: selected.id, choiceId: choice.id }, key });
        }
      }
      interrupts.push({ reason: 'event', weekIndex: week, detail: selected.id });
    }
  }

  // ---- 8. Resolve deferred effects due this week
  const due = state.deferredEffects.filter((deferred) => deferred.dueWeek === week);
  if (due.length > 0) {
    const eventState = eventStateFrom(state, world);
    for (const deferred of due) {
      if (deferred.condition !== undefined && !passesGate(deferred.condition, eventState)) continue;
      const outcome = applyEffects(deferred.effects, formulaContextFrom(state, world));
      state = applyOutcome(state, outcome, priceAt, week);
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

  state = {
    ...state,
    energy,
    mood,
    performance,
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

  return { state, interrupts, firedEventId };
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

function serviceDebts(
  state: RunState,
  broke: boolean,
): { debts: readonly Debt[]; paidCents: number; interestCents: number; missedAny: boolean } {
  let paidCents = 0;
  let interestCents = 0;
  let missedAny = false;
  const debts: Debt[] = [];

  // Iterate in the order the debts were opened — stable, and never sorted by
  // balance, which would make payment order depend on market movement.
  for (const debt of state.debts) {
    if (debt.kind !== 'credit-card') {
      debts.push(debt);
      continue;
    }
    const card = debt as Parameters<typeof closeStatement>[0];
    const due = broke ? 0 : minimumPaymentCents(card);
    if (due === 0 && card.balanceCents > 0) missedAny = true;
    const result = closeStatement(card, due);
    paidCents += result.paidCents;
    interestCents += result.interestChargedCents;
    debts.push(result.card);
  }

  return { debts, paidCents, interestCents, missedAny };
}

function applyOutcome(
  state: RunState,
  outcome: EffectOutcome,
  priceAt: (assetId: AssetId) => number,
  week: number,
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

  return {
    ...state,
    cashCents: state.cashCents + outcome.cashDeltaCents,
    mood: clamp(state.mood + outcome.moodDelta, 0, 100),
    energy: clamp(state.energy + outcome.energyDelta, 0, 100),
    performance: clamp(state.performance + outcome.performanceDelta, 0, 100),
    holdings,
    flags,
    recurringExpenses: mergeRecurring(state.recurringExpenses, outcome.expenses),
    deferredEffects: [...state.deferredEffects, ...outcome.deferred],
    credit: outcome.creditEvents.reduce<CreditState>(
      (credit, kind) => (kind === 'missed' ? recordMissedPayment(credit) : kind === 'onTime' ? recordOnTimePayment(credit) : credit),
      state.credit,
    ),
  };
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
