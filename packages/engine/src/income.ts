/**
 * Income — TDD §6.1, §6.2, §6.4.
 *
 * All currency is integer cents. Rates are annual and converted at point of use.
 */
import { clamp } from './math.ts';
import { type Rng, uniform } from './rng.ts';
import { WEEKS_PER_YEAR } from './time.ts';

/** [T] Hours past this in a week are overtime. */
export const OVERTIME_THRESHOLD_HOURS = 40;

/** [F] Overtime hours pay time-and-a-half. */
export const OVERTIME_MULTIPLIER = 1.5;

/**
 * [T] The quiet villain of the whole game: the default raise tracks only 80% of
 * inflation. A player who never negotiates, never job-hops and never builds
 * skills loses real income slowly across three decades.
 *
 * This single coefficient does more teaching than any event in the catalogue.
 * It should be visible in the annual review's real-vs-nominal income line and
 * nowhere else — the game never explains it.
 */
export const RAISE_INFLATION_FACTOR = 0.8;

/** [T] Performance moves the raise by ±2% across the 0-100 performance range. */
export const RAISE_PERFORMANCE_SPAN = 0.02;
export const PERFORMANCE_MIDPOINT = 50;

/** [T] Age-banded career growth, on top of inflation and performance. */
export const CAREER_CURVE: readonly { readonly underAge: number; readonly rate: number }[] = [
  { underAge: 30, rate: 0.012 },
  { underAge: 45, rate: 0.008 },
  { underAge: 55, rate: 0.002 },
  { underAge: Infinity, rate: 0.0 },
];

/**
 * [T] A one-time step for accepting a competitor's offer. This is why job-hopping
 * dominates loyalty — discoverable through play, never stated.
 */
export const JOB_HOP_RAISE_MIN = 0.08;
export const JOB_HOP_RAISE_MAX = 0.18;

/** [F] The default retirement contribution, and the game never prompts. */
export const DEFAULT_CONTRIBUTION_PCT = 0.0;

/** [T] Employer matches 100% of the first 4% of gross. */
export const EMPLOYER_MATCH_CAP_PCT = 0.04;

/** Early withdrawal costs 10% on top of ordinary income tax on the full amount. */
export const EARLY_WITHDRAWAL_PENALTY_RATE = 0.1;
export const EARLY_WITHDRAWAL_AGE = 59;

/**
 * Weekly gross for hourly work.
 *
 * `overtimeHours` is the portion of `hoursWorked` paid at time-and-a-half, not
 * hours on top of it — so 45 hours with 5 of overtime pays 45 + 0.5*5 = 47.5
 * hours' worth. That is the "blended" multiplier of TDD §6.1 written out.
 */
export function weeklyGrossHourlyCents(
  hourlyRateCents: number,
  hoursWorked: number,
  overtimeHours = 0,
): number {
  const paidHours = hoursWorked + (OVERTIME_MULTIPLIER - 1) * clamp(overtimeHours, 0, hoursWorked);
  return Math.round(hourlyRateCents * paidHours);
}

/** The overtime portion of a week's hours. */
export function overtimeHoursFor(hoursWorked: number): number {
  return Math.max(0, hoursWorked - OVERTIME_THRESHOLD_HOURS);
}

/**
 * Weekly gross for salaried work.
 *
 * `annualSalary / 52` regardless of month length — a 5-week month simply pays
 * five of these against the same fixed rent (TDD §1.2).
 */
export function weeklyGrossSalariedCents(annualSalaryCents: number): number {
  return Math.round(annualSalaryCents / WEEKS_PER_YEAR);
}

/** The career-curve component of a raise, by age. */
export function careerCurveRate(age: number): number {
  for (const band of CAREER_CURVE) {
    if (age < band.underAge) return band.rate;
  }
  return 0;
}

/** The performance component of a raise: −2% at 0, 0% at 50, +2% at 100. */
export function performanceBonusRate(performance: number): number {
  return ((performance - PERFORMANCE_MIDPOINT) / PERFORMANCE_MIDPOINT) * RAISE_PERFORMANCE_SPAN;
}

/**
 * The annual raise, applied at a year boundary (TDD §6.2).
 *
 * Never negative — a bad year holds pay flat rather than cutting it, which is
 * what makes the inflation lag erode real income quietly instead of visibly.
 */
export function annualRaiseRate(inflationRate: number, performance: number, age: number): number {
  const raise =
    inflationRate * RAISE_INFLATION_FACTOR + performanceBonusRate(performance) + careerCurveRate(age);
  return Math.max(0, raise);
}

/** Apply a raise to a salary, in integer cents. */
export function applyRaiseCents(currentCents: number, raiseRate: number): number {
  return Math.round(currentCents * (1 + raiseRate));
}

/**
 * The one-time step from accepting a competitor's offer. One draw.
 *
 * The caller supplies the stream — jobs.ts owns which one, so this stays a pure
 * function of the rng it is handed.
 */
export function jobHopRaiseRate(rng: Rng): number {
  return uniform(rng, JOB_HOP_RAISE_MIN, JOB_HOP_RAISE_MAX);
}

export interface RetirementContribution {
  /** Comes out of gross and reduces taxable income. */
  readonly employeeCents: number;
  /** Free money. Does not reduce taxable income because it was never the player's. */
  readonly employerCents: number;
  readonly totalCents: number;
}

/**
 * Retirement contribution and employer match for one week (TDD §6.4).
 *
 * The default contribution is 0% and nothing in the UI highlights the slider.
 * Discovering that in the epilogue is the lesson (GDD §3.10).
 */
export function retirementContributionCents(
  weeklyGrossCents: number,
  contributionPct: number,
): RetirementContribution {
  const employeeCents = Math.round(weeklyGrossCents * clamp(contributionPct, 0, 1));
  const employerCents = Math.min(
    employeeCents,
    Math.round(weeklyGrossCents * EMPLOYER_MATCH_CAP_PCT),
  );
  return { employeeCents, employerCents, totalCents: employeeCents + employerCents };
}

/** The 10% penalty on a withdrawal before 59. Ordinary income tax applies on top. */
export function earlyWithdrawalPenaltyCents(amountCents: number, age: number): number {
  if (age >= EARLY_WITHDRAWAL_AGE) return 0;
  return Math.round(amountCents * EARLY_WITHDRAWAL_PENALTY_RATE);
}
