import { describe, expect, it } from 'vitest';
import {
  type Allocation,
  DEBT_STRESS_HIGH,
  ENERGY_BASELINE_RECOVERY,
  ENERGY_FULL_TIME,
  ENERGY_PER_REST,
  HOUSING_MOOD_MODIFIER,
  MOOD_DECAY,
  MOOD_DECAY_LOW,
  MOOD_DECAY_THRESHOLD,
  MOOD_PER_FREE_SOCIAL,
  type MoodContext,
  PERFORMANCE_FIRING_THRESHOLD,
  PERFORMANCE_WARNING_THRESHOLD,
  REACH_OUT_CONSECUTIVE_WEEKS,
  REACH_OUT_COOLDOWN_WEEKS,
  TIME_POINTS_PER_WEEK,
  WORK_TIME_POINTS,
  allocationPoints,
  availableTimePoints,
  clearTrack,
  debtStress,
  discretionarySatisfaction,
  emptyAllocation,
  evaluatePerformanceTrack,
  housingMoodModifier,
  isValidAllocation,
  moodDecay,
  moodEnergyCoupling,
  nextEnergy,
  nextMood,
  nextPerformance,
  shouldForceReachOut,
} from '../src/vitals.ts';
import { intIn, stream } from '../src/rng.ts';

const alloc = (partial: Partial<Allocation>): Allocation => ({ ...emptyAllocation(), ...partial });

const CALM: MoodContext = {
  discretionarySpendCents: 0,
  discretionaryBaselineCents: 20_000,
  housingTier: 1,
  unsecuredDebtCents: 0,
  annualGrossCents: 5_200_000,
};

describe('time allocation (TDD §7.1)', () => {
  it('gives 10 points a week, less any permanent commitment', () => {
    expect(TIME_POINTS_PER_WEEK).toBe(10);
    expect(availableTimePoints()).toBe(10);
    // A caregiver start permanently commits 2.
    expect(availableTimePoints(2)).toBe(8);
  });

  it('charges work as a fixed block', () => {
    expect(WORK_TIME_POINTS['full-time']).toBe(5);
    expect(WORK_TIME_POINTS['part-time']).toBe(3);
    expect(allocationPoints(alloc({ work: 'full-time', rest: 2, study: 1 }))).toBe(8);
  });

  it('rejects allocations that overspend the week', () => {
    expect(isValidAllocation(alloc({ work: 'full-time', rest: 5 }))).toBe(true);
    expect(isValidAllocation(alloc({ work: 'full-time', rest: 6 }))).toBe(false);
    expect(isValidAllocation(alloc({ work: 'full-time', rest: 4 }), 2)).toBe(false);
    expect(isValidAllocation(alloc({ rest: -1 }))).toBe(false);
    // Overtime needs a job to be overtime from.
    expect(isValidAllocation(alloc({ overtime: 2 }))).toBe(false);
    expect(isValidAllocation(alloc({ work: 'full-time', overtime: 2 }))).toBe(true);
  });
});

describe('energy (TDD §7.2)', () => {
  it('keeps the opportunity-cost engine tight', () => {
    // Full-time work against baseline recovery needs ~2.2 rest points a week
    // just to break even. This tightness IS the design.
    const breakEvenRest = (-ENERGY_FULL_TIME - ENERGY_BASELINE_RECOVERY) / ENERGY_PER_REST;
    expect(breakEvenRest).toBeCloseTo(2.11, 2);

    // Work takes 5 of 10 points; ~2 more go to rest; 3 are left for everything.
    expect(nextEnergy(50, 50, alloc({ work: 'full-time', rest: 2 }))).toBe(48);
    expect(nextEnergy(50, 50, alloc({ work: 'full-time', rest: 3 }))).toBe(66);
  });

  it('applies every activity cost from the table', () => {
    expect(nextEnergy(50, 50, emptyAllocation())).toBe(52); // baseline only
    expect(nextEnergy(50, 50, alloc({ rest: 1 }))).toBe(70);
    expect(nextEnergy(50, 50, alloc({ work: 'part-time' }))).toBe(28);
    expect(nextEnergy(50, 50, alloc({ work: 'full-time', overtime: 2 }))).toBe(0);
    expect(nextEnergy(50, 50, alloc({ study: 1 }))).toBe(44);
    expect(nextEnergy(50, 50, alloc({ sideHustle: 1 }))).toBe(38);
    expect(nextEnergy(50, 50, alloc({ paidSocial: 1 }))).toBe(48);
    expect(nextEnergy(50, 50, alloc({ freeSocial: 1 }))).toBe(50);
  });

  it('couples to mood at the extremes only', () => {
    expect(moodEnergyCoupling(71)).toBe(4);
    expect(moodEnergyCoupling(70)).toBe(0);
    expect(moodEnergyCoupling(30)).toBe(0);
    expect(moodEnergyCoupling(29)).toBe(-4);
    expect(nextEnergy(50, 80, emptyAllocation())).toBe(56);
    expect(nextEnergy(50, 20, emptyAllocation())).toBe(48);
  });

  it('clamps to 0..100', () => {
    expect(nextEnergy(5, 50, alloc({ work: 'full-time' }))).toBe(0);
    expect(nextEnergy(95, 50, alloc({ rest: 5 }))).toBe(100);
  });
});

describe('mood (TDD §7.3)', () => {
  it('applies every activity effect from the table', () => {
    const base = nextMood(50, emptyAllocation(), CALM);
    expect(base).toBe(49); // decay only
    expect(nextMood(50, alloc({ paidSocial: 1 }), CALM)).toBe(61);
    expect(nextMood(50, alloc({ freeSocial: 1 }), CALM)).toBe(56);
    expect(nextMood(50, alloc({ rest: 1 }), CALM)).toBe(51);
    expect(nextMood(50, alloc({ work: 'full-time' }), CALM)).toBe(44);
    expect(nextMood(50, alloc({ work: 'full-time', overtime: 1 }), CALM)).toBe(38);
    expect(nextMood(50, alloc({ study: 1 }), CALM)).toBe(47);
    expect(nextMood(50, alloc({ sideHustle: 1 }), CALM)).toBe(45);
  });

  it('caps what discretionary spending can buy', () => {
    expect(discretionarySatisfaction(0, 20_000)).toBe(0);
    expect(discretionarySatisfaction(10_000, 20_000)).toBe(4);
    expect(discretionarySatisfaction(20_000, 20_000)).toBe(8);
    // Spending three times the baseline buys nothing more than spending it once.
    expect(discretionarySatisfaction(60_000, 20_000)).toBe(8);
    expect(discretionarySatisfaction(10_000, 0)).toBe(0);
  });

  it('modifies mood by housing tier', () => {
    expect([...HOUSING_MOOD_MODIFIER]).toEqual([-4, 0, 3, 5]);
    expect(housingMoodModifier(0)).toBe(-4);
    expect(housingMoodModifier(3)).toBe(5);
    expect(housingMoodModifier(99)).toBe(5); // clamped
  });

  it('charges debt stress in two bands', () => {
    const gross = 5_000_000;
    expect(debtStress(0, gross)).toBe(0);
    expect(debtStress(2_500_000, gross)).toBe(0); // dti exactly 0.5
    expect(debtStress(2_600_000, gross)).toBe(3);
    expect(debtStress(5_000_000, gross)).toBe(0 + 3); // dti exactly 1.0
    expect(debtStress(5_100_000, gross)).toBe(DEBT_STRESS_HIGH);
    // No income and unsecured debt is the worst case, not a divide by zero.
    expect(debtStress(100_000, 0)).toBe(DEBT_STRESS_HIGH);
    expect(debtStress(0, 0)).toBe(0);
  });

  it('clamps to 0..100', () => {
    expect(nextMood(2, alloc({ work: 'full-time', overtime: 2 }), CALM)).toBe(0);
    expect(nextMood(98, alloc({ paidSocial: 4 }), CALM)).toBe(100);
  });
});

describe('the anti-spiral guarantees (TDD §7.4) — safety properties, never skip', () => {
  it('guarantee 1: free social always out-paces any decay', () => {
    // +7 mood for 1 point and zero cash. Three points is +21/week, which
    // exceeds the worst combined drag the model can produce.
    const worstDrag = MOOD_DECAY + Math.abs(HOUSING_MOOD_MODIFIER[0]) + DEBT_STRESS_HIGH;
    expect(MOOD_PER_FREE_SOCIAL * 3).toBeGreaterThan(worstDrag);
    expect(MOOD_PER_FREE_SOCIAL * 3).toBe(21);
    expect(worstDrag).toBe(11);
  });

  it('guarantee 2: decay halves below 20, so the floor is approached not crossed', () => {
    // Assert the literal rates, not the constants — comparing the function to
    // the constant it returns would pass however the constant were changed.
    expect(moodDecay(MOOD_DECAY_THRESHOLD + 1)).toBe(1);
    expect(moodDecay(MOOD_DECAY_THRESHOLD)).toBe(0.5);
    expect(moodDecay(0)).toBe(0.5);
    expect(MOOD_DECAY_LOW * 2).toBe(MOOD_DECAY);

    // Behaviourally: with nothing else acting on mood, the last 10 points take
    // twice as long to lose as the 10 above the threshold.
    const neutral: MoodContext = { ...CALM, housingTier: 1 };
    const weeksToFall = (from: number, to: number) => {
      let mood = from;
      let weeks = 0;
      while (mood > to && weeks < 500) {
        mood = nextMood(mood, emptyAllocation(), neutral);
        weeks++;
      }
      return weeks;
    };
    expect(weeksToFall(30, 20)).toBe(10); // full decay above the threshold
    expect(weeksToFall(20, 10)).toBe(20); // halved below it

    // And with the worst housing and debt it still lands on the floor rather
    // than going through it.
    const grim: MoodContext = { ...CALM, housingTier: 0, unsecuredDebtCents: 9_000_000 };
    let mood = 30;
    for (let week = 0; week < 200; week++) mood = nextMood(mood, emptyAllocation(), grim);
    expect(mood).toBe(0);
  });

  it('guarantee 3: force-schedules reach-out on sustained low mood', () => {
    expect(shouldForceReachOut(REACH_OUT_CONSECUTIVE_WEEKS, null)).toBe(true);
    expect(shouldForceReachOut(REACH_OUT_CONSECUTIVE_WEEKS - 1, null)).toBe(false);
    // Not again inside the cooldown.
    expect(shouldForceReachOut(10, REACH_OUT_COOLDOWN_WEEKS - 1)).toBe(false);
    expect(shouldForceReachOut(10, REACH_OUT_COOLDOWN_WEEKS)).toBe(true);
  });

  /**
   * The §7.4 invariant, as a property test over 500 random reachable states.
   *
   * **This test must never be marked skip.** If it fails, the game has a state a
   * player cannot climb out of, and no amount of framing fixes that.
   */
  it('recovers any low state above 50 mood and energy within 8 weeks', () => {
    const rng = stream('4F2A9C1B', 'startingDraw');
    const failures: string[] = [];

    for (let trial = 0; trial < 500; trial++) {
      // A reachable spiral: low mood, low energy, worst housing and debt in
      // range, no cash for discretionary spending, possibly a caregiver
      // commitment eating 2 of the 10 points.
      const startEnergy = intIn(rng, 0, 29);
      const startMood = intIn(rng, 0, 29);
      const committed = intIn(rng, 0, 1) * 2;
      const context: MoodContext = {
        discretionarySpendCents: 0,
        discretionaryBaselineCents: intIn(rng, 10_000, 50_000),
        housingTier: intIn(rng, 0, 3),
        unsecuredDebtCents: intIn(rng, 0, 12_000_000),
        annualGrossCents: intIn(rng, 0, 1) === 0 ? 0 : intIn(rng, 1_000_000, 8_000_000),
      };

      let energy = startEnergy;
      let mood = startMood;
      let recoveredBy: number | null = null;

      for (let week = 1; week <= 8; week++) {
        // Rest and free social only: no work, no money, nothing that costs.
        const points = availableTimePoints(committed);
        const rest = Math.min(points, Math.max(0, Math.ceil((60 - energy) / ENERGY_PER_REST)));
        const allocation = alloc({ rest, freeSocial: points - rest });

        const nextE = nextEnergy(energy, mood, allocation);
        mood = nextMood(mood, allocation, context);
        energy = nextE;

        if (energy > 50 && mood > 50) {
          recoveredBy = week;
          break;
        }
      }

      if (recoveredBy === null) {
        failures.push(
          `energy ${startEnergy} mood ${startMood} committed ${committed} ` +
            `housing ${context.housingTier} debt ${context.unsecuredDebtCents} ` +
            `gross ${context.annualGrossCents} -> ended energy ${energy.toFixed(1)} mood ${mood.toFixed(1)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('job performance (TDD §7.5)', () => {
  const ctx = (partial: Partial<Parameters<typeof nextPerformance>[1]>) => ({
    energy: 70,
    workedThisWeek: true,
    consecutiveOvertimeWeeks: 0,
    ...partial,
  });

  it('recovers slowly when rested and falls fast when exhausted', () => {
    expect(nextPerformance(50, ctx({ energy: 60 }))).toBe(51.5);
    expect(nextPerformance(50, ctx({ energy: 59 }))).toBe(50);
    expect(nextPerformance(50, ctx({ energy: 24 }))).toBe(46);
    // Exhaustion only counts if the player actually worked.
    expect(nextPerformance(50, ctx({ energy: 24, workedThisWeek: false }))).toBe(50);
  });

  it('penalizes sustained overtime past six weeks', () => {
    expect(nextPerformance(50, ctx({ energy: 30, consecutiveOvertimeWeeks: 6 }))).toBe(50);
    expect(nextPerformance(50, ctx({ energy: 30, consecutiveOvertimeWeeks: 7 }))).toBe(47);
  });

  it('clamps to 0..100', () => {
    expect(nextPerformance(99.5, ctx({}))).toBe(100);
    expect(nextPerformance(2, ctx({ energy: 10, consecutiveOvertimeWeeks: 8 }))).toBe(0);
  });

  it('warns before firing, and never fires on a single bad week', () => {
    let track = clearTrack();
    let performance = 100;

    // Worst sustainable conditions: exhausted and over-worked every week.
    const bad = ctx({ energy: 10, consecutiveOvertimeWeeks: 8 });
    let firstWarningWeek: number | null = null;
    let firingWeek: number | null = null;

    for (let week = 1; week <= 40; week++) {
      performance = nextPerformance(performance, bad);
      track = evaluatePerformanceTrack(track, performance, week);
      if (firstWarningWeek === null && track.standing === 'written-warning') firstWarningWeek = week;
      if (firingWeek === null && track.standing === 'terminating') firingWeek = week;
    }

    // Performance falls at most 7 points a week, so 100 -> 40 takes 9 weeks and
    // 100 -> 20 takes 12. Firing is structurally impossible to reach quickly.
    expect(firstWarningWeek).toBe(9);
    expect(firingWeek).toBe(12);
    expect(track.terminationWeek).toBe(12 + 2); // two weeks' notice
  });

  it('clears a warning on recovery above 55, but not below', () => {
    let track = evaluatePerformanceTrack(clearTrack(), 35, 10);
    expect(track.standing).toBe('written-warning');

    track = evaluatePerformanceTrack(track, 55, 11);
    expect(track.standing).toBe('written-warning'); // 55 is not above 55

    track = evaluatePerformanceTrack(track, 56, 12);
    expect(track.standing).toBe('clear');
    expect(track.terminationWeek).toBeNull();
  });

  it('does not un-fire once notice is served', () => {
    const fired = evaluatePerformanceTrack(clearTrack(), 10, 20);
    expect(fired.standing).toBe('terminating');
    expect(evaluatePerformanceTrack(fired, 100, 21)).toEqual(fired);
  });

  it('sets the warning threshold below the clearing threshold', () => {
    // Otherwise a warning would clear itself the moment it was issued.
    expect(PERFORMANCE_WARNING_THRESHOLD).toBeLessThan(55);
    expect(PERFORMANCE_FIRING_THRESHOLD).toBeLessThan(PERFORMANCE_WARNING_THRESHOLD);
  });
});
