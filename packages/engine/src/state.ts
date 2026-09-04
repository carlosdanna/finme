/**
 * Run state — TDD §4.1.
 *
 * `RunState` is the mutable part of a run and must stay serializable: no Sets,
 * no Maps, no functions. Flags are a **sorted array** rather than §4.1's `Set`
 * so that two states with the same flags serialize identically — see
 * docs/DECISIONS.md.
 *
 * `RunWorld` is everything drawn at init and never touched again. `RunStreams`
 * holds the three in-play generators.
 */
import type { Car, Home } from './assets.ts';
import type { CreditState } from './credit.ts';
import type { Debt } from './debt/types.ts';
import type { EventDef, EventHistory, EventSchedule, ScheduledEffect } from './events/index.ts';
import type { JobDef, JobOpening } from './jobs.ts';
import type { LogbookEntry, LogbookState, RunNames, TemplatePools } from './logbook/index.ts';
import { ASSET_IDS, type AssetId, type MarketHistory } from './market.ts';
import type { Rng } from './rng.ts';
import type { TaxLot } from './tax.ts';
import { type Allocation, type PerformanceTrack, type WorkMode, emptyAllocation } from './vitals.ts';

/** [T] Monthly rent by housing tier, in year-0 cents. Indexed by CPI at use. */
export const HOUSING_TIER_RENT_CENTS: readonly number[] = [65_000, 110_000, 160_000, 235_000];

/** [T] Everything that is not rent: food, utilities, phone, transport, insurance. */
export const BASE_MONTHLY_EXPENSES_CENTS = 95_000;

/** [T] The discretionary spend a mood of "not deprived" assumes, per month. */
export const DISCRETIONARY_BASELINE_CENTS = 40_000;

export interface JobState {
  readonly jobId: string;
  readonly startedWeek: number;
  /** Current pay, after every raise and hop. */
  readonly weeklyGrossCents: number;
  readonly workMode: WorkMode;
  readonly track: PerformanceTrack;
}

export type DebtPaymentPolicy = 'minimum' | 'statement' | { readonly fixedCents: number };

export interface StandingOrders {
  readonly emergencyFundWeeklyCents: number;
  readonly savingsWeeklyCents: number;
  readonly autoInvest: { readonly assetId: AssetId; readonly weeklyCents: number } | null;
  readonly debtPayment: DebtPaymentPolicy;
  readonly autoReinvestDividends: boolean;
  readonly defaultAllocation: Allocation;
}

export interface Holding {
  readonly shares: number;
  readonly lots: readonly TaxLot[];
}

export interface RecurringExpense {
  readonly category: string;
  readonly cents: number;
}

/** Accumulators reset at each year boundary, for the annual settlement. */
export interface YearToDate {
  readonly employmentGrossCents: number;
  readonly sideHustleGrossCents: number;
  readonly dividendsCents: number;
  readonly shortTermGainsCents: number;
  readonly longTermGainsCents: number;
  readonly retirementContributionsCents: number;
  readonly withheldCents: number;
}

export function emptyYearToDate(): YearToDate {
  return {
    employmentGrossCents: 0,
    sideHustleGrossCents: 0,
    dividendsCents: 0,
    shortTermGainsCents: 0,
    longTermGainsCents: 0,
    retirementContributionsCents: 0,
    withheldCents: 0,
  };
}

/**
 * A year's closing position, recorded at each year boundary.
 *
 * The annual review compares the player to their own past (GDD §4.2), so it
 * needs the whole series, not just today. Every figure is nominal; `cpi` is
 * carried alongside so the review can state real terms without re-deriving it.
 */
export interface AnnualSnapshot {
  readonly year: number;
  readonly age: number;
  readonly cpi: number;
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
  readonly netWorthCents: number;
  readonly incomeCents: number;
  readonly taxPaidCents: number;
  readonly interestPaidCents: number;
  readonly retirementContributedCents: number;
  readonly employerMatchedCents: number;
  /** What the match would have added had the player contributed the full 4%. */
  readonly matchForgoneCents: number;
  readonly cashCents: number;
  readonly investedCents: number;
}

export interface RunState {
  readonly seed: string;
  readonly rulesetVersion: string;
  readonly weekIndex: number;
  readonly startAge: number;
  readonly runLengthYears: number;

  readonly cashCents: number;
  readonly savingsCents: number;
  readonly emergencyFundCents: number;
  readonly emergencyStreakWeeks: number;

  readonly holdings: Readonly<Record<AssetId, Holding>>;
  readonly retirement: { readonly balanceCents: number; readonly contributionPct: number };

  readonly job: JobState | null;
  readonly performance: number;
  readonly weeksUnemployed: number;
  readonly consecutiveOvertimeWeeks: number;

  readonly energy: number;
  readonly mood: number;
  readonly consecutiveLowMoodWeeks: number;
  readonly lastReachOutWeek: number | null;

  readonly debts: readonly Debt[];
  readonly accruedUnpaidBillsCents: number;
  readonly credit: CreditState;

  readonly car: Car | null;
  readonly home: Home | null;
  readonly housingTier: number;
  readonly recurringExpenses: readonly RecurringExpense[];

  readonly standingOrders: StandingOrders;
  readonly eventHistory: EventHistory;
  readonly deferredEffects: readonly ScheduledEffect[];
  /** Sorted, so serialization is stable. */
  readonly flags: readonly string[];

  readonly ytd: YearToDate;
  readonly lastRaisePct: number;
  readonly netWorthHistory: readonly number[];
  readonly annualSnapshots: readonly AnnualSnapshot[];
  /** Interest paid across the current year, for the review's debt trajectory. */
  readonly interestPaidThisYearCents: number;
  readonly employerMatchedThisYearCents: number;

  readonly logbook: LogbookState;
  readonly logbookEntries: readonly LogbookEntry[];
}

/** Everything drawn at init and never touched again. */
export interface RunWorld {
  readonly seed: string;
  readonly market: MarketHistory;
  readonly events: EventSchedule;
  readonly jobTimeline: readonly JobOpening[];
  readonly names: RunNames;
  readonly entryCreditScore: number;
  readonly jobs: readonly JobDef[];
  readonly eventDefs: readonly EventDef[];
  readonly templates: TemplatePools;
}

/** The three in-play streams. Never serialized; re-derived on replay (§14). */
export interface RunStreams {
  readonly eventOutcome: Rng;
  readonly jobApplication: Rng;
  /**
   * [F] The Logbook's only source of randomness. Passing anything else here
   * would break the §2.2 guarantee that flavor never influences simulation.
   */
  readonly flavor: Rng;
}

export function emptyHoldings(): Record<AssetId, Holding> {
  const holdings = {} as Record<AssetId, Holding>;
  for (const id of ASSET_IDS) holdings[id] = { shares: 0, lots: [] };
  return holdings;
}

export function defaultStandingOrders(): StandingOrders {
  return {
    emergencyFundWeeklyCents: 0,
    savingsWeeklyCents: 0,
    autoInvest: null,
    debtPayment: 'minimum',
    // [F] Off by default, and the game never prompts (GDD §3.10 / TDD §6.4).
    autoReinvestDividends: false,
    defaultAllocation: emptyAllocation(),
  };
}

export function hasFlag(state: RunState, flag: string): boolean {
  return state.flags.includes(flag);
}

/** Add a flag, keeping the array sorted and unique. */
export function addFlag(flags: readonly string[], flag: string): readonly string[] {
  return flags.includes(flag) ? flags : [...flags, flag].sort();
}

export function removeFlag(flags: readonly string[], flag: string): readonly string[] {
  return flags.filter((existing) => existing !== flag);
}

/** Monthly rent for a housing tier, before CPI indexing. */
export function tierRentCents(tier: number): number {
  const index = Math.min(Math.max(Math.round(tier), 0), HOUSING_TIER_RENT_CENTS.length - 1);
  return HOUSING_TIER_RENT_CENTS[index];
}
