/**
 * Energy, mood, and job performance — TDD §7.
 *
 * The arithmetic here is the opportunity-cost engine of the game. Full-time work
 * (−40) against baseline recovery (+2) needs roughly 2.2 rest points a week just
 * to break even, and work already consumes 5 of the 10 points. That leaves about
 * 3 points for study, social and side hustle. **That tightness is the design —
 * verify it in balance testing, do not adjust it casually.**
 *
 * §7.4's anti-spiral guarantees are marked [F] and are safety properties, not
 * tuning. The property test that asserts them must never be skipped.
 */
import { clamp } from './math.ts';

/** [F] Ten time points a week. A caregiver start permanently commits 2 of them. */
export const TIME_POINTS_PER_WEEK = 10;

export type WorkMode = 'none' | 'part-time' | 'full-time';

/** [F] Work is a fixed block, not a per-point activity. */
export const WORK_TIME_POINTS: Readonly<Record<WorkMode, number>> = {
  none: 0,
  'part-time': 3,
  'full-time': 5,
};

export interface Allocation {
  readonly work: WorkMode;
  readonly overtime: number;
  readonly rest: number;
  readonly paidSocial: number;
  readonly freeSocial: number;
  readonly study: number;
  readonly sideHustle: number;
}

export function emptyAllocation(): Allocation {
  return {
    work: 'none',
    overtime: 0,
    rest: 0,
    paidSocial: 0,
    freeSocial: 0,
    study: 0,
    sideHustle: 0,
  };
}

/** Time points an allocation consumes. */
export function allocationPoints(allocation: Allocation): number {
  return (
    WORK_TIME_POINTS[allocation.work] +
    allocation.overtime +
    allocation.rest +
    allocation.paidSocial +
    allocation.freeSocial +
    allocation.study +
    allocation.sideHustle
  );
}

/** Points a player may spend this week, after any permanent commitment. */
export function availableTimePoints(committedPoints = 0): number {
  return TIME_POINTS_PER_WEEK - committedPoints;
}

export function isValidAllocation(allocation: Allocation, committedPoints = 0): boolean {
  const counts = [
    allocation.overtime,
    allocation.rest,
    allocation.paidSocial,
    allocation.freeSocial,
    allocation.study,
    allocation.sideHustle,
  ];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) return false;
  // Overtime is only available on top of work.
  if (allocation.overtime > 0 && allocation.work === 'none') return false;
  return allocationPoints(allocation) <= availableTimePoints(committedPoints);
}

// --- Energy (§7.2) ----------------------------------------------------------

/** [T] Passive recovery, before anything the player chooses. */
export const ENERGY_BASELINE_RECOVERY = 2;
export const ENERGY_PER_REST = 18;
export const ENERGY_FULL_TIME = -40;
export const ENERGY_PART_TIME = -24;
export const ENERGY_PER_OVERTIME = -12;
export const ENERGY_PER_STUDY = -8;
export const ENERGY_PER_SIDE_HUSTLE = -14;
export const ENERGY_PER_PAID_SOCIAL = -4;
export const ENERGY_PER_FREE_SOCIAL = -2;

/** [T] Mood pushes energy either way at the extremes. */
export const MOOD_ENERGY_COUPLING = 4;
export const MOOD_COUPLING_HIGH = 70;
export const MOOD_COUPLING_LOW = 30;

export function moodEnergyCoupling(mood: number): number {
  if (mood > MOOD_COUPLING_HIGH) return MOOD_ENERGY_COUPLING;
  if (mood < MOOD_COUPLING_LOW) return -MOOD_ENERGY_COUPLING;
  return 0;
}

const workEnergy = (work: WorkMode): number =>
  work === 'full-time' ? ENERGY_FULL_TIME : work === 'part-time' ? ENERGY_PART_TIME : 0;

/**
 * Energy for the coming week. Reads `mood` at the *same* tick as `energy`, so
 * the two updates never depend on each other's ordering.
 */
export function nextEnergy(energy: number, mood: number, allocation: Allocation): number {
  return clamp(
    energy +
      ENERGY_BASELINE_RECOVERY +
      ENERGY_PER_REST * allocation.rest +
      workEnergy(allocation.work) +
      ENERGY_PER_OVERTIME * allocation.overtime +
      ENERGY_PER_STUDY * allocation.study +
      ENERGY_PER_SIDE_HUSTLE * allocation.sideHustle +
      ENERGY_PER_PAID_SOCIAL * allocation.paidSocial +
      ENERGY_PER_FREE_SOCIAL * allocation.freeSocial +
      moodEnergyCoupling(mood),
    0,
    100,
  );
}

// --- Mood (§7.3) ------------------------------------------------------------

export const MOOD_PER_PAID_SOCIAL = 12;
export const MOOD_PER_FREE_SOCIAL = 7;
export const MOOD_PER_REST = 2;
export const MOOD_FULL_TIME = -5;
/**
 * [T] §7.3's formula has no part-time term, though GDD §3.6's table gives −3.
 * Implemented as the TDD specifies — the TDD is the formula authority — with the
 * gap made a named constant so closing it is one line. See docs/DECISIONS.md.
 */
export const MOOD_PART_TIME = 0;
export const MOOD_PER_OVERTIME = -6;
export const MOOD_PER_STUDY = -2;
export const MOOD_PER_SIDE_HUSTLE = -4;

/** [T] Discretionary spending buys up to +8 mood, and no more. */
export const MOOD_DISCRETIONARY_MAX = 8;

/** [T] Housing tier 0..3. */
export const HOUSING_MOOD_MODIFIER: readonly number[] = [-4, 0, 3, 5];

/** [T] Unsecured debt against annual gross. */
export const DEBT_STRESS_HIGH_DTI = 1.0;
export const DEBT_STRESS_MID_DTI = 0.5;
export const DEBT_STRESS_HIGH = 6;
export const DEBT_STRESS_MID = 3;

/**
 * [F] Mood decay halves below 20, so the floor is approached asymptotically
 * rather than crossed. This is anti-spiral guarantee 2 of §7.4.
 */
export const MOOD_DECAY = 1;
export const MOOD_DECAY_LOW = 0.5;
export const MOOD_DECAY_THRESHOLD = 20;

export function discretionarySatisfaction(spendCents: number, baselineCents: number): number {
  if (baselineCents <= 0) return 0;
  return clamp((MOOD_DISCRETIONARY_MAX * spendCents) / baselineCents, 0, MOOD_DISCRETIONARY_MAX);
}

export function housingMoodModifier(tier: number): number {
  return HOUSING_MOOD_MODIFIER[clamp(Math.round(tier), 0, HOUSING_MOOD_MODIFIER.length - 1)];
}

export function debtStress(unsecuredDebtCents: number, annualGrossCents: number): number {
  if (annualGrossCents <= 0) return unsecuredDebtCents > 0 ? DEBT_STRESS_HIGH : 0;
  const dti = unsecuredDebtCents / annualGrossCents;
  if (dti > DEBT_STRESS_HIGH_DTI) return DEBT_STRESS_HIGH;
  if (dti > DEBT_STRESS_MID_DTI) return DEBT_STRESS_MID;
  return 0;
}

/** [F] Half decay below 20 — §7.4 guarantee 2. */
export function moodDecay(mood: number): number {
  return mood > MOOD_DECAY_THRESHOLD ? MOOD_DECAY : MOOD_DECAY_LOW;
}

export interface MoodContext {
  readonly discretionarySpendCents: number;
  readonly discretionaryBaselineCents: number;
  readonly housingTier: number;
  readonly unsecuredDebtCents: number;
  readonly annualGrossCents: number;
}

export function nextMood(mood: number, allocation: Allocation, context: MoodContext): number {
  const work =
    allocation.work === 'full-time'
      ? MOOD_FULL_TIME
      : allocation.work === 'part-time'
        ? MOOD_PART_TIME
        : 0;

  return clamp(
    mood +
      MOOD_PER_PAID_SOCIAL * allocation.paidSocial +
      MOOD_PER_FREE_SOCIAL * allocation.freeSocial +
      MOOD_PER_REST * allocation.rest +
      work +
      MOOD_PER_OVERTIME * allocation.overtime +
      MOOD_PER_STUDY * allocation.study +
      MOOD_PER_SIDE_HUSTLE * allocation.sideHustle +
      discretionarySatisfaction(context.discretionarySpendCents, context.discretionaryBaselineCents) +
      housingMoodModifier(context.housingTier) -
      debtStress(context.unsecuredDebtCents, context.annualGrossCents) -
      moodDecay(mood),
    0,
    100,
  );
}

// --- Job performance (§7.5) -------------------------------------------------

export const PERFORMANCE_RECOVERY = 1.5;
export const PERFORMANCE_RECOVERY_ENERGY = 60;
export const PERFORMANCE_EXHAUSTION_PENALTY = -4;
export const PERFORMANCE_EXHAUSTION_ENERGY = 25;
export const PERFORMANCE_OVERTIME_PENALTY = -3;
export const PERFORMANCE_OVERTIME_WEEKS = 6;

/** [T] Written warning below 40; fired below 20; the warning clears above 55. */
export const PERFORMANCE_WARNING_THRESHOLD = 40;
export const PERFORMANCE_FIRING_THRESHOLD = 20;
export const PERFORMANCE_WARNING_CLEAR_THRESHOLD = 55;

/** [T] Firing comes with two weeks' notice, not on the spot. */
export const FIRING_NOTICE_WEEKS = 2;

export interface PerformanceContext {
  /** Energy *after* this week's allocation — see docs/DECISIONS.md. */
  readonly energy: number;
  readonly workedThisWeek: boolean;
  readonly consecutiveOvertimeWeeks: number;
  readonly eventModifiers?: number;
}

export function nextPerformance(performance: number, context: PerformanceContext): number {
  const rested = context.energy >= PERFORMANCE_RECOVERY_ENERGY ? PERFORMANCE_RECOVERY : 0;
  const exhausted =
    context.energy < PERFORMANCE_EXHAUSTION_ENERGY && context.workedThisWeek
      ? PERFORMANCE_EXHAUSTION_PENALTY
      : 0;
  const overworked =
    context.consecutiveOvertimeWeeks > PERFORMANCE_OVERTIME_WEEKS ? PERFORMANCE_OVERTIME_PENALTY : 0;

  return clamp(
    performance + rested + exhausted + overworked + (context.eventModifiers ?? 0),
    0,
    100,
  );
}

export type EmploymentStanding = 'clear' | 'written-warning' | 'terminating';

export interface PerformanceTrack {
  readonly standing: EmploymentStanding;
  /** Week the termination takes effect, once notice has been given. */
  readonly terminationWeek: number | null;
}

export function clearTrack(): PerformanceTrack {
  return { standing: 'clear', terminationWeek: null };
}

/**
 * The warning and firing track (§7.5).
 *
 * Termination needs sustained low performance: once notice is given it stands,
 * but a single bad week only ever produces a warning, and recovering above 55
 * clears it.
 */
export function evaluatePerformanceTrack(
  track: PerformanceTrack,
  performance: number,
  weekIndex: number,
): PerformanceTrack {
  // Notice already served — the clock runs out regardless.
  if (track.standing === 'terminating') return track;

  if (performance < PERFORMANCE_FIRING_THRESHOLD) {
    return { standing: 'terminating', terminationWeek: weekIndex + FIRING_NOTICE_WEEKS };
  }
  if (performance < PERFORMANCE_WARNING_THRESHOLD) {
    return { standing: 'written-warning', terminationWeek: null };
  }
  if (track.standing === 'written-warning' && performance > PERFORMANCE_WARNING_CLEAR_THRESHOLD) {
    return clearTrack();
  }
  return track;
}

// --- Anti-spiral (§7.4) -----------------------------------------------------

/** [F] Sustained low mood that force-schedules SOC_REACH_OUT. */
export const REACH_OUT_MOOD_THRESHOLD = 25;
export const REACH_OUT_CONSECUTIVE_WEEKS = 4;
export const REACH_OUT_COOLDOWN_WEEKS = 26;
export const REACH_OUT_MOOD_GRANT = 25;

/**
 * [F] Anti-spiral guarantee 3 of §7.4.
 *
 * The one place an event is not seed-placed. It bypasses the normal slot
 * schedule deliberately: a player in a spiral must be reachable regardless of
 * what the `eventSlots` stream drew.
 */
export function shouldForceReachOut(
  consecutiveLowMoodWeeks: number,
  weeksSinceLastReachOut: number | null,
): boolean {
  if (consecutiveLowMoodWeeks < REACH_OUT_CONSECUTIVE_WEEKS) return false;
  return weeksSinceLastReachOut === null || weeksSinceLastReachOut >= REACH_OUT_COOLDOWN_WEEKS;
}
