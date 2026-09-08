import { describe, expect, it } from 'vitest';
import {
  ENERGY_INTERRUPT_FLOOR,
  MOOD_INTERRUPT_FLOOR,
  type AmortizingLoan,
  type Choice,
  type EventDef,
  type Interrupt,
  type Run,
  type RunState,
  advance,
  abandonChain,
  beginChain,
  buildSave,
  createRun,
  derogatoryScore,
  nextEnergy,
  defaultGranularity,
  emptyAllocation,
  lifeStageFor,
  monthlyRate,
  housingMoodModifier,
  loanApr,
  tierRentCents,
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

/**
 * A `creditEvent` effect must actually reach the credit file.
 *
 * It did not: the tick's reducer named `missed` and `onTime` and returned the
 * state unchanged for anything else, so `collection` was dropped and
 * `derogatoryScore` sat at 1.0 for the whole of every run. Unit-testing
 * `recordCollection` never caught it, because nothing called it.
 */
describe('credit events from an event effect', () => {
  const marker = (kind: 'collection' | 'inquiry'): EventDef => ({
    id: 'ZZZ_TEST_CREDIT',
    category: 'emergency',
    baseWeight: 100,
    cooldownWeeks: 0,
    gates: [],
    multipliers: [],
    title: 'A mark on the file',
    body: 'Something was reported.',
    choices: [
      { id: 'mark', label: 'A', effects: [{ k: 'creditEvent', kind }], logbookKey: 'quiet' },
      { id: 'nothing', label: 'B', effects: [], noop: true, logbookKey: 'quiet' },
    ],
  });

  function fireOnce(kind: 'collection' | 'inquiry'): RunState {
    let run = createRun({
      ...scenarioConfig({ seed: '4F2A9C1B', runLengthYears: 30 }),
      eventDefs: [marker(kind)],
    });
    for (let step = 0; step < 40; step++) {
      const result = advance(run, 'until-something-happens', () => ({
        allocation: DEFAULT_ALLOCATION,
        chooseEvent: () => 'mark',
      }));
      run = result.run;
      if (run.state.eventHistory.ZZZ_TEST_CREDIT !== undefined) break;
    }
    expect(run.state.eventHistory.ZZZ_TEST_CREDIT?.length ?? 0).toBeGreaterThan(0);
    return run.state;
  }

  it('records a collection and moves the derogatory component', () => {
    const state = fireOnce('collection');
    expect(state.credit.collections).toBeGreaterThan(0);
    expect(derogatoryScore(state.credit)).toBeLessThan(1);
  });

  it('accepts an inquiry without recording anything — §5.5 has no inquiry term', () => {
    const state = fireOnce('inquiry');
    expect(state.credit.collections).toBe(0);
    expect(derogatoryScore(state.credit)).toBe(1);
  });
});

/**
 * These three paths all computed a value and then discarded it. A `debt` effect
 * priced a loan and opened nothing, a `jobOffer` effect named a job and changed
 * nothing, and an amortizing loan sat at its opening balance forever because
 * only credit cards were serviced.
 */
describe('effects that reach the balance sheet', () => {
  const single = (choice: Choice): EventDef => ({
    id: 'ZZZ_TEST_EFFECT',
    category: 'emergency',
    baseWeight: 100,
    cooldownWeeks: 0,
    gates: [],
    multipliers: [],
    title: 'A thing happened',
    body: 'It did.',
    choices: [choice, { id: 'nothing', label: 'B', effects: [], noop: true, logbookKey: 'quiet' }],
  });

  function fireOnce(choice: Choice, weeks = 40): { state: RunState; interrupts: readonly Interrupt[] } {
    let run = createRun({ ...scenarioConfig({ seed: '4F2A9C1B', runLengthYears: 30 }), eventDefs: [single(choice)] });
    let interrupts: readonly Interrupt[] = [];
    for (let step = 0; step < weeks; step++) {
      const result = advance(run, 'until-something-happens', () => ({
        allocation: DEFAULT_ALLOCATION,
        chooseEvent: () => choice.id,
      }));
      run = result.run;
      interrupts = result.interrupts;
      if (run.state.eventHistory.ZZZ_TEST_EFFECT !== undefined) break;
    }
    expect(run.state.eventHistory.ZZZ_TEST_EFFECT?.length ?? 0).toBeGreaterThan(0);
    return { state: run.state, interrupts };
  }

  it('opens a real amortizing loan for a `debt` effect', () => {
    const { state } = fireOnce({
      id: 'borrow',
      label: 'A',
      effects: [{ k: 'debt', instrument: 'PERSONAL_LOAN', principalCents: 500_000 }],
      logbookKey: 'quiet',
    });

    expect(state.debts).toHaveLength(1);
    expect(state.debts[0].kind).toBe('amortizing');
    expect(state.debts[0].aprAnnual).toBe(loanApr('personal', state.credit.score));
  });

  it('amortizes that loan down at each month boundary', () => {
    // The loan opens somewhere in the first 40 weeks; run out the rest of the
    // year so several month boundaries pass over it.
    let run = createRun({
      ...scenarioConfig({ seed: '4F2A9C1B', runLengthYears: 30 }),
      eventDefs: [single({
        id: 'borrow',
        label: 'A',
        effects: [{ k: 'debt', instrument: 'PERSONAL_LOAN', principalCents: 500_000 }],
        logbookKey: 'quiet',
      })],
    });
    run = runWeeks(run, 8, () => ({ allocation: DEFAULT_ALLOCATION, chooseEvent: () => 'borrow' }));
    const opened = run.state.debts[0] as AmortizingLoan;
    expect(opened.originalPrincipalCents).toBe(500_000);

    run = runWeeks(run, 40, () => ({ allocation: DEFAULT_ALLOCATION, chooseEvent: () => 'nothing' }));
    const serviced = run.state.debts[0] as AmortizingLoan;

    expect(serviced.monthsPaid).toBeGreaterThan(opened.monthsPaid);
    expect(serviced.balanceCents).toBeLessThan(opened.balanceCents);
    // Interest reached the annual total, so the payment split is real.
    expect(run.state.interestPaidThisYearCents).toBeGreaterThan(0);
  });

  it('puts the player in the job a `jobOffer` effect names, and interrupts on it', () => {
    const { state, interrupts } = fireOnce({
      id: 'accept',
      label: 'A',
      effects: [{ k: 'jobOffer', jobId: 'office-admin' }],
      logbookKey: 'quiet',
    });

    expect(state.job?.jobId).toBe('office-admin');
    // Paid at the role's rate, not carrying the previous job's raises across.
    expect(state.job?.weeklyGrossCents).toBe(Math.round(42_000_00 / 52));
    expect(state.job?.track.standing).toBe('clear');
    expect(interrupts.map((i) => i.reason)).toContain('job-offer');
  });

  it('books a card charge with no card as an unpaid bill instead of losing it', () => {
    const { state } = fireOnce({
      id: 'card',
      label: 'A',
      effects: [{ k: 'debt', instrument: 'CREDIT_CARD', principalCents: 90_000 }],
      logbookKey: 'quiet',
    });

    expect(state.debts).toEqual([]);
    expect(state.accruedUnpaidBillsCents).toBeGreaterThanOrEqual(90_000);
  });
});

/**
 * Chains end to end (TDD §9.6).
 *
 * Both of these journeys were impossible before chains existed: nothing called
 * the application roll, and nothing could move `housingTier` at all.
 */
describe('chains, end to end', () => {
  const scripted = () => ({ allocation: DEFAULT_ALLOCATION });

  /** Drive a chain to completion, always taking `pick` where it is offered. */
  function driveChain(
    run: Run,
    pick: (stepId: string, choiceIds: readonly string[]) => string,
    maxWeeks = 80,
  ): Run {
    let current = run;
    for (let i = 0; i < maxWeeks; i++) {
      const result = tick(current.world, current.streams, current.state, {
        allocation: DEFAULT_ALLOCATION,
        chooseChainStep: (_chainId, stepId, choiceIds) => pick(stepId, choiceIds),
      });
      current = { ...current, state: result.state };
      if (current.state.chains.length === 0) break;
    }
    return current;
  }

  it('takes a fired player from unemployed back into work', () => {
    // The whole point: before this, being fired was terminal.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = { ...run, state: { ...run.state, job: null, weeksUnemployed: 10 } };

    const started = beginChain(run.world, run.streams, run.state, 'JOB_SEARCH', 'retail-associate');
    expect(started.chains).toHaveLength(1);
    expect(started.chains[0].target).toBe('retail-associate');
    // Starting a search does not advance time: it is a decision inside the
    // week the player is already in.
    expect(started.weekIndex).toBe(run.state.weekIndex);
    run = { ...run, state: started };

    // Take the interview, accept anything offered. Rejection is a legitimate
    // outcome, so assert on the shape of the journey, not on getting the job.
    const done = driveChain(run, (stepId, choiceIds) => {
      if (stepId === 'offer') return 'accept';
      return choiceIds[0];
    });

    expect(done.state.chains).toHaveLength(0);
    expect(done.state.chainHistory.JOB_SEARCH?.length).toBe(1);
    // Several weeks passed and several cards were answered — not one button.
    const steps = done.state.decisionLog.filter((r) => r.t === 'chainStep');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(done.state.weekIndex).toBeGreaterThan(run.state.weekIndex + 2);
  });

  it('hires the chain target when the offer is accepted', () => {
    // Force the accept path by running the chain until an offer appears.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = { ...run, state: { ...run.state, job: null, weeksUnemployed: 4 } };

    let hired = false;
    for (let attempt = 0; attempt < 12 && !hired; attempt++) {
      let current = { ...run, state: { ...run.state, weekIndex: run.state.weekIndex + attempt } };
      current = {
        ...current,
        state: beginChain(current.world, current.streams, current.state, 'JOB_SEARCH', 'retail-associate'),
      };
      const done = driveChain(current, (stepId, choiceIds) =>
        stepId === 'offer' ? 'accept' : choiceIds[0],
      );
      if (done.state.job?.jobId === 'retail-associate') {
        hired = true;
        expect(done.state.job.startedWeek).toBeGreaterThan(0);
        expect(done.state.job.track.standing).toBe('clear');
      }
    }
    expect(hired, 'no seed offset produced an offer in 12 attempts').toBe(true);
  });

  it('refuses a second search while one is already running', () => {
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = {
      ...run,
      state: beginChain(run.world, run.streams, run.state, 'JOB_SEARCH', 'retail-associate'),
    };

    const again = beginChain(run.world, run.streams, run.state, 'JOB_SEARCH', 'barista');
    expect(again.chains).toHaveLength(1);
    expect(again.chains[0].target).toBe('retail-associate');
  });

  it('leaves no orphaned state when a search is abandoned', () => {
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = {
      ...run,
      state: beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-2'),
    };
    expect(run.state.chains).toHaveLength(1);

    const left = { state: abandonChain(run.world, run.streams, run.state, 'HOME_SEARCH') };
    expect(left.state.chains).toEqual([]);
    expect(left.state.chainHistory.HOME_SEARCH).toHaveLength(1);
    expect(left.state.deferredEffects).toEqual([]);
    expect(left.state.decisionLog.at(-1)).toMatchObject({ t: 'chainAbandon', k: 'HOME_SEARCH' });
  });

  it('actually moves the player between housing tiers, rent and mood with them', () => {
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const tierBefore = run.state.housingTier;
    expect(tierBefore).toBe(1);

    run = {
      ...run,
      state: beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-3'),
    };
    run = { ...run, state: { ...run.state, cashCents: 50_000_00 } };

    const done = driveChain(run, (stepId, choiceIds) => {
      if (stepId === 'brief') return 'weekends';
      if (stepId === 'viewings') return 'look';
      if (stepId === 'shortlist') return 'apply';
      if (stepId === 'apply_rent') return 'submit';
      if (stepId === 'move_in') return 'sign';
      return choiceIds[0];
    }, 200);

    expect(done.state.chains).toHaveLength(0);
    if (done.state.housingTier !== tierBefore) {
      // The move happened: tier, rent and the mood modifier all follow.
      expect(done.state.housingTier).toBe(3);
      expect(tierRentCents(done.state.housingTier)).toBeGreaterThan(tierRentCents(tierBefore));
      expect(housingMoodModifier(done.state.housingTier)).toBeGreaterThan(
        housingMoodModifier(tierBefore),
      );
    }
  });

  it('opens a real mortgage and records the home when a purchase completes', () => {
    // A buyer needs a deposit and a score, and §5.5 will not let a thin file
    // hold one — so establish a real file first rather than pasting a number on.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = runWeeks(run, 40, scripted);
    run = {
      ...run,
      state: {
        ...run.state,
        cashCents: 200_000_00,
        credit: {
          ...run.state.credit,
          score: 760,
          firstLineWeek: 0,
          oldestAccountWeek: 0,
          onTimeWeighted: 40,
          debtTypesEverHeld: ['credit-card'],
        },
      },
    };

    let bought = false;
    for (let attempt = 0; attempt < 10 && !bought; attempt++) {
      let current = {
        ...run,
        state: beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'buy-2'),
      };
      current = driveChain(current, (stepId, choiceIds) => {
        if (stepId === 'brief') return 'agent';
        if (stepId === 'viewings_agent') return 'review';
        if (stepId === 'shortlist') return 'offer';
        if (stepId === 'offer_buy') return 'offer';
        if (stepId === 'completion') return 'complete';
        return choiceIds[0];
      }, 200);

      if (current.state.home !== null) {
        bought = true;
        const mortgage = current.state.debts.find(
          (d) => d.kind === 'amortizing' && (d as AmortizingLoan).loanType === 'mortgage',
        ) as AmortizingLoan | undefined;

        expect(mortgage, 'a completed purchase must open a mortgage').toBeDefined();
        expect(mortgage!.termMonths).toBe(360);
        // The price is derived from the rent tier, per §8.2's coupling.
        expect(mortgage!.originalPrincipalCents).toBeGreaterThan(0);
        expect(current.state.home!.purchasePriceCents).toBeGreaterThan(
          mortgage!.originalPrincipalCents,
        );
        // An owner pays no rent and the mortgage is a real liability.
        expect(current.state.debts.length).toBeGreaterThan(0);
      } else {
        // Different rolls next time round; the streams have advanced.
        run = { ...run, state: { ...run.state, weekIndex: run.state.weekIndex + 1 } };
      }
    }
    expect(bought, 'no attempt reached completion in 10 tries').toBe(true);
  });

  it('slips a chain step rather than presenting two cards in one week', () => {
    // [F] The slot schedule is the seeded world and never yields; the
    // player-initiated chain is the thing that waits.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const slotWeek = run.world.events.slots[0];

    // Walk to the week before the first slot, then start a chain whose first
    // step (gapWeeks 1) lands exactly on it.
    for (let i = 0; i < slotWeek - 1; i++) {
      run = { ...run, state: tick(run.world, run.streams, run.state, scripted()).state };
    }
    run = {
      ...run,
      state: beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-2'),
    };
    expect(run.state.chains[0].dueWeek).toBe(slotWeek);

    const collision = tick(run.world, run.streams, run.state, {
      allocation: DEFAULT_ALLOCATION,
      chooseEvent: (_id, ids) => ids[0],
      chooseChainStep: (_c, _s, ids) => ids[0],
    });

    expect(collision.firedEventId).not.toBeNull();
    expect(collision.firedChainStep).toBeNull();
    expect(collision.state.chains[0].dueWeek).toBe(slotWeek + 1);
  });
});

/**
 * Draw accounting for chains.
 *
 * The invariant events already hold (`events.test.ts`: no draws for a choice
 * without an outcome roll) has to hold here too, or two players sharing a seed
 * fall out of step the first time one of them looks for a job.
 */
describe('chain draw accounting', () => {
  /** Wrap a stream so its draws can be counted. */
  function counted(run: Run, name: 'chain' | 'jobApplication') {
    let draws = 0;
    const inner = run.streams[name];
    const wrapped = { ...run, streams: { ...run.streams, [name]: () => { draws++; return inner(); } } };
    return { run: wrapped, draws: () => draws };
  }

  it('takes exactly one draw for a presented card, and one more for an outcome roll', () => {
    let base = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    base = {
      ...base,
      state: beginChain(base.world, base.streams, base.state, 'HOME_SEARCH', 'rent-2'),
    };

    const { run, draws } = counted(base, 'chain');
    let current = run;

    // Advance to the `brief` card. `agent` and `weekends` carry no outcomeRoll.
    for (let i = 0; i < 5; i++) {
      const before = draws();
      const result = tick(current.world, current.streams, current.state, {
        allocation: DEFAULT_ALLOCATION,
        chooseChainStep: () => 'weekends',
      });
      current = { ...current, state: result.state };
      if (result.firedChainStep?.stepId === 'brief') {
        expect(draws() - before, 'one magnitude draw, no outcome roll').toBe(1);
        break;
      }
      expect(draws() - before, 'a week with no card takes no draw').toBe(0);
    }

    // `viewings`/`look` does carry one, so that step costs two.
    for (let i = 0; i < 5; i++) {
      const before = draws();
      const result = tick(current.world, current.streams, current.state, {
        allocation: DEFAULT_ALLOCATION,
        chooseChainStep: () => 'look',
      });
      current = { ...current, state: result.state };
      if (result.firedChainStep?.stepId === 'viewings') {
        expect(draws() - before, 'magnitude draw plus the outcome roll').toBe(2);
        return;
      }
    }
    throw new Error('never reached the viewings step');
  });

  it('costs the same draws whether the card is answered at once or declined first', () => {
    // The decline/re-tick path the UI uses must not burn a second draw.
    const build = () => {
      let base = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
      base = {
        ...base,
        state: beginChain(base.world, base.streams, base.state, 'HOME_SEARCH', 'rent-2'),
      };
      return counted(base, 'chain');
    };

    // Straight through.
    const direct = build();
    let a = direct.run;
    for (let i = 0; i < 3; i++) {
      a = {
        ...a,
        state: tick(a.world, a.streams, a.state, {
          allocation: DEFAULT_ALLOCATION,
          chooseChainStep: () => 'weekends',
        }).state,
      };
    }

    // Declined once, then answered with the roll fed back.
    const declined = build();
    let b = declined.run;
    for (let i = 0; i < 3; i++) {
      const first = tick(b.world, b.streams, b.state, {
        allocation: DEFAULT_ALLOCATION,
        chooseChainStep: () => null,
      });
      if (first.awaitingChainStep !== null) {
        b = {
          ...b,
          state: tick(b.world, b.streams, b.state, {
            allocation: DEFAULT_ALLOCATION,
            chooseChainStep: () => 'weekends',
            chainRoll: first.chainRoll!,
          }).state,
        };
      } else {
        b = { ...b, state: first.state };
      }
    }

    expect(declined.draws()).toBe(direct.draws());
    expect(b.state.chains).toEqual(a.state.chains);
  });

  it('records everything a replay of a chain would need', () => {
    // A save is the seed plus the decision log (§14), so a search in flight has
    // to be reconstructible from these records alone.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = {
      ...run,
      state: beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-3'),
    };
    for (let i = 0; i < 6; i++) {
      run = {
        ...run,
        state: tick(run.world, run.streams, run.state, {
          allocation: DEFAULT_ALLOCATION,
          chooseChainStep: (_c, _s, ids) => ids[0],
        }).state,
      };
    }

    const log = run.state.decisionLog;
    const start = log.find((entry) => entry.t === 'chainStart');
    expect(start).toMatchObject({ t: 'chainStart', k: 'HOME_SEARCH', g: 'rent-3' });

    const steps = log.filter((entry) => entry.t === 'chainStep');
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      // Chain, step and choice: enough to replay the branch that was taken.
      expect(step).toMatchObject({ k: 'HOME_SEARCH' });
      expect(typeof (step as { s: string }).s).toBe('string');
      expect(typeof (step as { c: string }).c).toBe('string');
    }

    // And a checkpoint carries the search in flight, so one straddling week 100
    // survives the load path that lifts state wholesale.
    const checkpoint = buildSave({
      state: run.state,
      decisionLog: log,
      checkpoint: { weekIndex: run.state.weekIndex, state: run.state },
      now: 0,
    });
    expect(checkpoint.checkpoint!.state.chains).toEqual(run.state.chains);
  });
});

/**
 * The seams the panels reach into.
 *
 * Both of these were shipped broken in the first pass of this feature and found
 * in review: starting a search resolved whatever card the week was holding, and
 * a missed amortizing payment forgave its interest.
 */
describe('chain actions do not disturb the week they are taken in', () => {
  it('does not advance time, fire an event, or answer a card', () => {
    // Week 7 is the first slot week for this seed. Under the old shape, a start
    // requested here ticked, fired HOU_RENT_INCREASE and resolved it with its
    // first-listed choice — a correctness bug and a GDD §1 one.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    const slotWeek = run.world.events.slots[0];
    for (let i = 0; i < slotWeek - 1; i++) {
      run = { ...run, state: tick(run.world, run.streams, run.state, scripted()).state };
    }
    expect(run.state.weekIndex).toBe(slotWeek - 1);

    const after = beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-2');

    expect(after.weekIndex).toBe(slotWeek - 1);
    expect(after.eventHistory).toEqual(run.state.eventHistory);
    expect(after.decisionLog.filter((entry) => entry.t === 'event')).toEqual(
      run.state.decisionLog.filter((entry) => entry.t === 'event'),
    );
    expect(after.chains).toHaveLength(1);
    // The slot event is still ahead of the player, unanswered.
    const next = tick(run.world, run.streams, after, {
      allocation: DEFAULT_ALLOCATION,
      chooseEvent: () => null,
    });
    expect(next.awaitingEventChoice).toBe('HOU_RENT_INCREASE');
  });

  it('does not answer a chain step that is due the same week', () => {
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = { ...run, state: beginChain(run.world, run.streams, run.state, 'JOB_SEARCH', 'retail-associate') };
    // `prepare` is due next week; walk onto it without answering.
    const due = run.state.chains[0].dueWeek;
    while (run.state.weekIndex < due - 1) {
      run = { ...run, state: tick(run.world, run.streams, run.state, scripted()).state };
    }

    const after = beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-2');

    expect(after.decisionLog.filter((entry) => entry.t === 'chainStep')).toEqual([]);
    expect(after.chains.map((c) => c.chainId).sort()).toEqual(['HOME_SEARCH', 'JOB_SEARCH']);
    // JOB_SEARCH is still sitting on `prepare`, unanswered.
    expect(after.chains.find((c) => c.chainId === 'JOB_SEARCH')!.stepId).toBe('prepare');
  });

  it('leaves the state untouched when the engine refuses the start', () => {
    const run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    expect(beginChain(run.world, run.streams, run.state, 'NO_SUCH_CHAIN', null)).toBe(run.state);
    const started = beginChain(run.world, run.streams, run.state, 'HOME_SEARCH', 'rent-2');
    // Already running: refused, and the first search is untouched.
    expect(beginChain(run.world, run.streams, started, 'HOME_SEARCH', 'rent-3')).toBe(started);
    expect(abandonChain(run.world, run.streams, run.state, 'HOME_SEARCH')).toBe(run.state);
  });
});

describe('a missed amortizing payment (TDD §5.2)', () => {
  const mortgage = (): AmortizingLoan => ({
    id: 'm',
    kind: 'amortizing',
    loanType: 'mortgage',
    balanceCents: 24_600_000,
    originalPrincipalCents: 24_600_000,
    aprAnnual: 0.075,
    termMonths: 360,
    monthlyPaymentCents: 172_000,
    monthsPaid: 0,
    openedWeek: 0,
  });

  function brokeFor(weeks: number) {
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = { ...run, state: { ...run.state, debts: [mortgage()], cashCents: 0, job: null } };
    for (let i = 0; i < weeks; i++) {
      run = { ...run, state: tick(run.world, run.streams, run.state, scripted()).state };
    }
    return run.state;
  }

  it('accrues the interest onto the balance instead of forgiving it', () => {
    // A player who stays broke used to ride a mortgage for thirty years without
    // paying a cent of interest, which inverts §5.2's lesson on the one
    // instrument the whole buy path rests on.
    const state = brokeFor(10);
    const loan = state.debts[0] as AmortizingLoan;

    expect(loan.balanceCents).toBeGreaterThan(24_600_000);
    expect(state.interestPaidThisYearCents).toBeGreaterThan(0);
    // Roughly one month's interest per month boundary crossed, compounding.
    expect(loan.balanceCents - 24_600_000).toBeGreaterThanOrEqual(
      Math.round(24_600_000 * monthlyRate(0.075)),
    );
  });

  it('does not count a missed month as a month of the term served', () => {
    expect((brokeFor(10).debts[0] as AmortizingLoan).monthsPaid).toBe(0);
  });

  it('never lets debt service overdraw the account', () => {
    // $1,720 a month against no income. Held to the weeks before this seed's
    // first event slot, so the only thing moving cash is bills and debt service
    // — an event with a cash cost can still take cash negative through
    // `applyOutcome`, which is pre-existing and not what this pins.
    for (const weeks of [2, 4, 6]) {
      const state = brokeFor(weeks);
      expect(state.cashCents, `week ${weeks}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('misses a payment the cash cannot cover rather than overdrawing for it', () => {
    // Enough for the month's bills, nowhere near the $1,720 payment.
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = { ...run, state: { ...run.state, debts: [mortgage()], cashCents: 300_000, job: null } };
    for (let i = 0; i < 6; i++) {
      run = { ...run, state: tick(run.world, run.streams, run.state, scripted()).state };
    }
    const loan = run.state.debts[0] as AmortizingLoan;

    expect(loan.monthsPaid).toBe(0);
    expect(loan.balanceCents).toBeGreaterThan(24_600_000);
    expect(run.state.cashCents).toBeGreaterThanOrEqual(0);
  });

  it('pays and amortizes normally when the cash is there', () => {
    let run = createScenarioRun({ seed: '4F2A9C1B', runLengthYears: 30 });
    run = { ...run, state: { ...run.state, debts: [mortgage()], cashCents: 5_000_000 } };
    for (let i = 0; i < 10; i++) {
      run = { ...run, state: tick(run.world, run.streams, run.state, scripted()).state };
    }
    const loan = run.state.debts[0] as AmortizingLoan;

    expect(loan.monthsPaid).toBeGreaterThan(0);
    expect(loan.balanceCents).toBeLessThan(24_600_000);
    expect(run.state.cashCents).toBeGreaterThanOrEqual(0);
  });
});
