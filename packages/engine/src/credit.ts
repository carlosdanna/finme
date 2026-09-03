/**
 * Credit score — TDD §5.5.
 *
 * A lagging indicator, not a live readout: the score is recomputed monthly and
 * crawls toward its target at no more than ±20 points a month. That is both
 * realistic and better for pacing.
 *
 * **The score gates loan APRs (§5.2), housing tiers 2 and 3, insurance premiums
 * and mortgage eligibility. It must NEVER gate a job** (GDD §3.5). Nothing in
 * this file should ever be imported by jobs.ts.
 */
import { clamp } from './math.ts';
import type { DebtKind } from './debt/types.ts';
import { type Rng, uniform } from './rng.ts';

/** [T] No score exists until 26 weeks after the first reported line opens. */
export const THIN_FILE_WEEKS = 26;

/** [T] Entry score when the file establishes. */
export const ENTRY_SCORE_MIN = 620;
export const ENTRY_SCORE_MAX = 660;

/** The 300-850 range the composite maps onto. */
export const SCORE_FLOOR = 300;
export const SCORE_SPAN = 550;

/** [T] The score moves toward its target by at most this much per month. */
export const MAX_MONTHLY_MOVE = 20;

/** [T] Payment weights decay 0.5% a week, so old sins fade — half-life ~138 weeks. */
export const PAYMENT_DECAY_PER_WEEK = 0.995;

/** [T] A miss counts 2.5x an on-time payment. */
export const MISSED_PAYMENT_WEIGHT = 2.5;

/** [T] Utilization at or below 10% scores perfectly; 90% scores zero. */
export const UTILIZATION_SWEET_SPOT = 0.1;
export const UTILIZATION_SPAN = 0.8;

/** [T] Ten years of history maxes the age component. */
export const AGE_SCORE_MAX_WEEKS = 520;

/** [T] Three distinct debt types maxes the mix component. */
export const MIX_SCORE_MAX_TYPES = 3;

/** [T] Derogatory marks. */
export const COLLECTION_PENALTY = 0.25;
export const BANKRUPTCY_PENALTY = 0.6;

/** [T] The five components and their weights. They sum to 1. */
export const COMPONENT_WEIGHTS = {
  paymentHistory: 0.35,
  utilization: 0.3,
  age: 0.15,
  mix: 0.1,
  derogatory: 0.1,
} as const;

export interface CreditState {
  /**
   * `null` until the file establishes. The UI shows "No credit history" — not a
   * number, not a zero.
   */
  readonly score: number | null;
  /** Week the first reported credit line opened. */
  readonly firstLineWeek: number | null;
  /** Week the oldest still-counted account opened. */
  readonly oldestAccountWeek: number | null;
  /** Decayed weight of on-time payments. */
  readonly onTimeWeighted: number;
  /** Decayed weight of missed payments. */
  readonly missedWeighted: number;
  readonly collections: number;
  readonly bankruptcies: number;
  /** Sorted, so serialization and iteration are stable. */
  readonly debtTypesEverHeld: readonly DebtKind[];
}

export interface CreditInputs {
  readonly revolvingBalanceCents: number;
  readonly totalRevolvingLimitCents: number;
  readonly weekIndex: number;
}

export function emptyCreditState(): CreditState {
  return {
    score: null,
    firstLineWeek: null,
    oldestAccountWeek: null,
    onTimeWeighted: 0,
    missedWeighted: 0,
    collections: 0,
    bankruptcies: 0,
    debtTypesEverHeld: [],
  };
}

/**
 * The entry score, drawn once at run init from `startingDraw` and held until the
 * file establishes — see docs/DECISIONS.md. The caller supplies the stream.
 */
export function drawEntryScore(rng: Rng): number {
  return Math.round(uniform(rng, ENTRY_SCORE_MIN, ENTRY_SCORE_MAX));
}

/** Whether 26 weeks have passed since the first reported line opened. */
export function hasFile(state: CreditState, weekIndex: number): boolean {
  if (state.firstLineWeek === null) return false;
  return weekIndex - state.firstLineWeek >= THIN_FILE_WEEKS;
}

/** Record a newly opened credit line. */
export function openCreditLine(
  state: CreditState,
  kind: DebtKind,
  weekIndex: number,
): CreditState {
  const debtTypesEverHeld = state.debtTypesEverHeld.includes(kind)
    ? state.debtTypesEverHeld
    : [...state.debtTypesEverHeld, kind].sort();

  return {
    ...state,
    firstLineWeek: state.firstLineWeek ?? weekIndex,
    oldestAccountWeek: state.oldestAccountWeek ?? weekIndex,
    debtTypesEverHeld,
  };
}

export function recordOnTimePayment(state: CreditState, weight = 1): CreditState {
  return { ...state, onTimeWeighted: state.onTimeWeighted + weight };
}

export function recordMissedPayment(state: CreditState, weight = 1): CreditState {
  return { ...state, missedWeighted: state.missedWeighted + weight };
}

export function recordCollection(state: CreditState): CreditState {
  return { ...state, collections: state.collections + 1 };
}

export function recordBankruptcy(state: CreditState): CreditState {
  return { ...state, bankruptcies: state.bankruptcies + 1 };
}

/** One week of decay on both payment counters. Old sins fade; so does old credit. */
export function decayWeek(state: CreditState): CreditState {
  return {
    ...state,
    onTimeWeighted: state.onTimeWeighted * PAYMENT_DECAY_PER_WEEK,
    missedWeighted: state.missedWeighted * PAYMENT_DECAY_PER_WEEK,
  };
}

// --- The five components ----------------------------------------------------

/**
 * `onTime / (onTime + 2.5 · missed)`.
 *
 * With no history at all this is 1: nothing has been missed. The file cannot
 * establish before 26 weeks anyway, so this only matters for the first month.
 */
export function paymentHistoryScore(state: CreditState): number {
  const denominator = state.onTimeWeighted + MISSED_PAYMENT_WEIGHT * state.missedWeighted;
  if (denominator === 0) return 1;
  return state.onTimeWeighted / denominator;
}

/** Perfect at or below 10% utilization, falling linearly to zero at 90%. */
export function utilizationScore(utilization: number): number {
  if (utilization <= UTILIZATION_SWEET_SPOT) return 1;
  return clamp(1 - (utilization - UTILIZATION_SWEET_SPOT) / UTILIZATION_SPAN, 0, 1);
}

/** Revolving balance over revolving limit. No limit means nothing drawn. */
export function utilization(inputs: CreditInputs): number {
  if (inputs.totalRevolvingLimitCents <= 0) return 0;
  return inputs.revolvingBalanceCents / inputs.totalRevolvingLimitCents;
}

/** Ten years of history to max out. */
export function ageScore(state: CreditState, weekIndex: number): number {
  if (state.oldestAccountWeek === null) return 0;
  return clamp((weekIndex - state.oldestAccountWeek) / AGE_SCORE_MAX_WEEKS, 0, 1);
}

/** Three distinct debt types to max out. */
export function mixScore(state: CreditState): number {
  return clamp(state.debtTypesEverHeld.length / MIX_SCORE_MAX_TYPES, 0, 1);
}

export function derogatoryScore(state: CreditState): number {
  return clamp(
    1 - COLLECTION_PENALTY * state.collections - BANKRUPTCY_PENALTY * state.bankruptcies,
    0,
    1,
  );
}

/** The weighted composite, in 0..1. */
export function compositeScore(state: CreditState, inputs: CreditInputs): number {
  return clamp(
    COMPONENT_WEIGHTS.paymentHistory * paymentHistoryScore(state) +
      COMPONENT_WEIGHTS.utilization * utilizationScore(utilization(inputs)) +
      COMPONENT_WEIGHTS.age * ageScore(state, inputs.weekIndex) +
      COMPONENT_WEIGHTS.mix * mixScore(state) +
      COMPONENT_WEIGHTS.derogatory * derogatoryScore(state),
    0,
    1,
  );
}

/** Where the score is heading: `300 + 550 · composite`. */
export function targetScore(state: CreditState, inputs: CreditInputs): number {
  return Math.round(SCORE_FLOOR + SCORE_SPAN * compositeScore(state, inputs));
}

/**
 * Recompute at a month boundary.
 *
 * Before the file establishes the score stays `null`. On the month it
 * establishes it starts at `entryScore`. After that it moves toward the target
 * by at most ±20 points.
 */
export function updateMonthly(
  state: CreditState,
  inputs: CreditInputs,
  entryScore: number,
): CreditState {
  if (!hasFile(state, inputs.weekIndex)) return { ...state, score: null };
  if (state.score === null) return { ...state, score: Math.round(entryScore) };

  const target = targetScore(state, inputs);
  const move = clamp(target - state.score, -MAX_MONTHLY_MOVE, MAX_MONTHLY_MOVE);
  return { ...state, score: state.score + Math.round(move) };
}
