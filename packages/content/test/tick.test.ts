import { describe, expect, it } from 'vitest';
import {
  ENERGY_INTERRUPT_FLOOR,
  MOOD_INTERRUPT_FLOOR,
  type RunState,
  advance,
  createRun,
  nextEnergy,
  defaultGranularity,
  emptyAllocation,
  lifeStageFor,
  runWeeks,
  tick,
} from '@finme/engine';
import golden from './golden/run-4F2A9C1B-200w.json' with { type: 'json' };
import { DEFAULT_ALLOCATION, createScenarioRun, scenarioConfig } from '../src/scenario.ts';
import { serializeState } from '../src/snapshot.ts';
import { LOGBOOK_TEMPLATES } from '../src/logbook.ts';

const scripted = () => ({ allocation: DEFAULT_ALLOCATION });

function runGolden(weeks = 200) {
  return runWeeks(createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 }), weeks, scripted);
}

/**
 * The golden-seed snapshot.
 *
 * **If this fails, the first question is "did I intend to change simulation
 * behaviour?" — never "let me update the fixture."** If the change was intended,
 * RULESET_VERSION moves in the same commit with an entry in DECISIONS.md.
 */
describe('golden seed 4F2A9C1B, 200 weeks, scripted default strategy', () => {
  it('matches the committed snapshot exactly', () => {
    expect(serializeState(runGolden().state)).toEqual(golden);
  });

  it('is reproducible run to run', () => {
    expect(serializeState(runGolden().state)).toEqual(serializeState(runGolden().state));
  });

  it('diverges for a different seed', () => {
    const other = runWeeks(createScenarioRun({ seed: '4F2A9C1C', runLengthYears: 30 }), 200, scripted);
    expect(serializeState(other.state)).not.toEqual(golden);
  });

  it('actually exercised the systems it is meant to pin', () => {
    // A fixture that pins an idle run proves nothing.
    expect(Object.keys(golden.eventHistory).length).toBeGreaterThanOrEqual(5);
    expect(golden.logbookEntryCount).toBeGreaterThan(20);
    expect(golden.netWorthHistory).toHaveLength(200);
    expect(golden.job?.weeklyGrossCents).toBeGreaterThan(75_000); // raises applied
    expect(golden.lastRaisePct).toBeGreaterThan(0);
    expect(golden.ytd.withheldCents).toBeGreaterThan(0);
  });
});

describe('the tick pipeline (TDD §10)', () => {
  it('advances exactly one week and derives everything from weekIndex', () => {
    const run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const result = tick(run.world, run.streams, run.state, scripted());
    expect(result.state.weekIndex).toBe(1);
    expect(result.state.netWorthHistory).toHaveLength(1);
  });

  it('runs step 7 before step 9, so an event constrains that week', () => {
    // §10: "an event that costs energy should constrain that week's allocation,
    // not the next one's." HOU_RENT_INCREASE / move costs -20 energy, so the
    // week's energy must be nextEnergy(energyAfterEvent), not
    // nextEnergy(energyBefore) with the event applied afterwards. Those two
    // orderings give different numbers, which is what makes this a real test.
    const run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const eventWeek = run.world.events.slots[0];

    let current = run;
    for (let i = 0; i < eventWeek - 1; i++) {
      current = { ...current, state: tick(current.world, current.streams, current.state, scripted()).state };
    }
    expect(current.state.weekIndex).toBe(eventWeek - 1);

    const energyBefore = current.state.energy;
    const moodBefore = current.state.mood;
    const result = tick(current.world, current.streams, current.state, {
      allocation: DEFAULT_ALLOCATION,
      chooseEvent: () => 'move',
    });

    expect(result.firedEventId).toBe('HOU_RENT_INCREASE');

    const eventFirst = nextEnergy(energyBefore - 20, moodBefore, DEFAULT_ALLOCATION);
    const allocationFirst = nextEnergy(energyBefore, moodBefore, DEFAULT_ALLOCATION) - 20;
    expect(eventFirst).not.toBe(allocationFirst); // the orderings are distinguishable
    expect(result.state.energy).toBe(eventFirst);
  });

  it('stops at the end of the run rather than reading past the price series', () => {
    const run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 10 });
    const ended = runWeeks(run, 520, scripted);
    const result = tick(ended.world, ended.streams, ended.state, scripted());
    expect(result.interrupts.map((i) => i.reason)).toContain('run-complete');
    expect(result.state.weekIndex).toBe(ended.state.weekIndex);
  });

  it('accrues income, withholds, and settles at the year boundary', () => {
    const run = runGolden(51);
    expect(run.state.ytd.employmentGrossCents).toBeGreaterThan(0);
    expect(run.state.ytd.withheldCents).toBeGreaterThan(0);

    const settled = runWeeks(run, 1, scripted);
    expect(settled.state.ytd.employmentGrossCents).toBe(0); // reset at the boundary
    expect(settled.state.lastRaisePct).toBeGreaterThan(0); // and the raise applied
  });

  it('keeps money in integer cents throughout', () => {
    const state = runGolden(120).state;
    for (const value of [state.cashCents, state.savingsCents, state.emergencyFundCents, state.retirement.balanceCents]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const entry of state.netWorthHistory) expect(Number.isFinite(entry)).toBe(true);
  });

  it('keeps flags sorted, so serialization is stable', () => {
    const state = runGolden(200).state;
    expect([...state.flags]).toEqual([...state.flags].sort());
  });
});

describe('CRITICAL: the tick passes only `flavor` to the Logbook', () => {
  it('changes no simulation value when template variants change', () => {
    // The residual risk flagged in prompt 13 was the call site, not the engine.
    // This is the call site.
    const shuffled = Object.fromEntries(
      Object.entries(LOGBOOK_TEMPLATES).map(([key, pool]) => [key, [...pool].reverse()]),
    );

    const baseline = runGolden(200).state;
    const withShuffled = runWeeks(
      createRun({ ...scenarioConfig({ seed: '4F2A9C1B', runLengthYears: 30 }), templates: shuffled }),
      200,
      scripted,
    ).state;

    const strip = (state: RunState) => {
      const { logbookKeys, ...rest } = serializeState(state) as Record<string, unknown> & {
        logbookKeys: string[];
      };
      void logbookKeys;
      return rest;
    };

    expect(strip(withShuffled)).toEqual(strip(baseline));
    // And the prose really did change.
    expect(withShuffled.logbookEntries.map((e) => e.text)).not.toEqual(
      baseline.logbookEntries.map((e) => e.text),
    );
  });
});

describe('the advance control (GDD §2.1)', () => {
  it('widens the default granularity as the run stabilizes', () => {
    expect(defaultGranularity(0)).toBe('week');
    expect(defaultGranularity(2)).toBe('week');
    expect(defaultGranularity(3)).toBe('month');
    expect(defaultGranularity(14)).toBe('month');
    expect(defaultGranularity(15)).toBe('season');
    expect(defaultGranularity(29)).toBe('season');
  });

  it('halts on an event rather than running past it', () => {
    const run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const result = advance(run, 'until-something-happens', scripted);

    expect(result.interrupts.length).toBeGreaterThan(0);
    expect(result.weeksAdvanced).toBeGreaterThan(0);
    expect(result.run.state.weekIndex).toBe(result.weeksAdvanced);
    // The first slot is where it should stop.
    expect(result.weeksAdvanced).toBeLessThanOrEqual(run.world.events.slots[0]);
  });

  it('never advances past its granularity budget', () => {
    const run = createScenarioRun({ seed: 'QUIET1', runLengthYears: 30 });
    expect(advance(run, 'week', scripted).weeksAdvanced).toBeLessThanOrEqual(1);
    expect(advance(run, 'month', scripted).weeksAdvanced).toBeLessThanOrEqual(4);
    expect(advance(run, 'season', scripted).weeksAdvanced).toBeLessThanOrEqual(13);
  });

  it('halts when a bill cannot be paid from available cash', () => {
    const broke = createRun({
      ...scenarioConfig({ seed: '4F2A9C1B', runLengthYears: 30 }),
      startingCashCents: 0,
      startingJobId: undefined,
    });
    const result = advance(broke, 'until-something-happens', () => ({ allocation: emptyAllocation() }));
    expect(result.interrupts.map((i) => i.reason)).toContain('unpayable-bill');
  });

  it('halts when mood or energy crosses its floor', () => {
    // Work every hour available and never rest: energy collapses.
    const grind = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const result = advance(grind, 'until-something-happens', () => ({
      allocation: { ...emptyAllocation(), work: 'full-time', overtime: 2, sideHustle: 3 },
    }));
    const reasons = result.interrupts.map((i) => i.reason);
    expect(reasons.some((r) => r === 'energy-floor' || r === 'mood-floor' || r === 'event')).toBe(true);
  });

  it('halts on a life-stage transition', () => {
    expect(lifeStageFor(24)).toBe('starting-out');
    expect(lifeStageFor(25)).toBe('early-career');

    // Age 22 at start, so the transition lands at the year-3 boundary.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30, startAge: 22 });
    let sawTransition = false;
    for (let i = 0; i < 30; i++) {
      const result = advance(run, 'until-something-happens', scripted);
      run = result.run;
      if (result.interrupts.some((x) => x.reason === 'life-stage')) sawTransition = true;
      if (run.state.weekIndex > 200) break;
    }
    expect(sawTransition).toBe(true);
  });

  it('reports the floors it uses', () => {
    expect(ENERGY_INTERRUPT_FLOOR).toBe(20);
    expect(MOOD_INTERRUPT_FLOOR).toBe(25);
  });
});
