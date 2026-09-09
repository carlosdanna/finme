import { describe, expect, it } from 'vitest';
import {
  type AmortizingLoan,
  type CreditCard,
  STUDY_WEEKS_PER_YEAR,
  TIME_POINTS_PER_WEEK,
  allocationPoints,
  createRun,
  emptyAllocation,
  isEligible,
  runWeeks,
} from '@finme/engine';
import { JOBS, jobById } from '../src/jobs.ts';
import { STARTS, assignedStartId, startById, startsFileSchema } from '../src/starts.ts';
import {
  DEFAULT_ALLOCATION,
  createScenarioRun,
  scenarioConfig,
} from '../src/scenario.ts';
import { serializeState } from '../src/snapshot.ts';

const SEED = '4F2A9C1B';

/**
 * What `drawEntryScore` returns for `SEED` on the second draw of
 * `startingDraw`. A literal on purpose: it is the only assertion in the repo
 * that would notice a draw being inserted into that stream.
 *
 * It is a real draw and not the floor leaking through — other seeds give 640,
 * 650, 621. That it happens to equal `ENTRY_SCORE_MIN` is a coincidence, and
 * one worth knowing: an inserted draw has roughly a 1-in-80 chance of landing
 * back on this number, so this test is a strong signal and not a proof.
 */
const ENTRY_SCORE_FOR_SEED = 620;

describe('starts.json', () => {
  it('defines GDD §3.7\'s six rows, in the table\'s order', () => {
    expect(STARTS.map((start) => start.id)).toEqual([
      'stable-ground',
      'head-start',
      'behind-the-line',
      'student-path',
      'caregiver',
      'life-draw',
    ]);
  });

  it('rejects a duplicate id, because ids are stable forever', () => {
    const duplicated = { starts: [...STARTS, STARTS[0]] };
    expect(startsFileSchema.safeParse(duplicated).success).toBe(false);
  });

  it('rejects a start that names a job jobs.json does not define', () => {
    const broken = { starts: [{ ...STARTS[0], startingJobId: 'astronaut' }] };
    expect(startsFileSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a file with no stable-ground, which is the scripted default', () => {
    const without = { starts: STARTS.filter((start) => start.id !== 'stable-ground') };
    expect(startsFileSchema.safeParse(without).success).toBe(false);
  });

  it('never commits the whole week', () => {
    for (const start of STARTS) {
      const committed = [
        start.committedTimePoints,
        ...(start.variants ?? []).map((v) => v.committedTimePoints ?? start.committedTimePoints),
      ];
      for (const points of committed) expect(points).toBeLessThan(TIME_POINTS_PER_WEEK);
    }
  });

  it('deals only jobs the run can actually hold on day one', () => {
    // A start grants its job rather than applying for it, so nothing checks the
    // requirements. A start that granted a job the player could never have
    // reached would be handing out an unreachable salary.
    const applicant = { educationYears: 0, experienceYears: 0, hasVehicle: false };
    for (const start of STARTS) {
      const jobIds = [
        start.startingJobId,
        ...(start.variants ?? []).map((v) => (v.startingJobId === undefined ? null : v.startingJobId)),
      ];
      for (const jobId of jobIds) {
        if (jobId === null) continue;
        const job = jobById(jobId)!;
        const granted = { ...applicant, educationYears: start.educationYears };
        expect(isEligible(job, granted), `${start.id} → ${jobId}`).toBe(true);
      }
    }
  });
});

/**
 * §3.7 is explicit that the player is assigned a start, and the tempting
 * implementation — a draw from `startingDraw` — is the one thing that cannot be
 * done: that stream is consumed in a contractual order, so an inserted draw
 * would shift the entry credit score of every existing seed.
 */
describe('the assignment is a hash, not a draw', () => {
  it('is a pure function of the seed', () => {
    expect(assignedStartId(SEED)).toBe(assignedStartId(SEED));
  });

  it('changes when Reroll changes the seed', () => {
    const dealt = new Set(
      ['4F2A9C1B', '4F2A9C1C', 'QUIET1', 'ZZZZ0001', '00000000', 'ABCDEFGH', '12345678'].map(
        assignedStartId,
      ),
    );
    expect(dealt.size).toBeGreaterThan(1);
  });

  it('deals every start to some seed', () => {
    const dealt = new Set<string>();
    // Enough seeds that a start reachable at all is reached; the assertion is
    // about coverage, not about the distribution being uniform.
    for (let i = 0; i < 500; i++) dealt.add(assignedStartId(`SEED${i}`));
    expect([...dealt].sort()).toEqual(STARTS.map((s) => s.id).slice().sort());
  });

  it('deals these exact seeds these exact starts', () => {
    // `starts.length` is load-bearing the way an event id is: the assignment is
    // `fnv1a(...) % starts.length`, so **adding a seventh start silently
    // re-deals every existing seed** — and every save whose `startId` no longer
    // matches its seed would start showing the custom-start notice. The set-based
    // assertions above would all survive that. This is the one that would not.
    //
    // If this fails and the change was intended, it is a ruleset change: bump
    // `RULESET_VERSION` and record it in docs/DECISIONS.md.
    expect({
      PIN11: assignedStartId('PIN11'),
      PIN3: assignedStartId('PIN3'),
      PIN4: assignedStartId('PIN4'),
      PIN5: assignedStartId('PIN5'),
      PIN0: assignedStartId('PIN0'),
      PIN1: assignedStartId('PIN1'),
    }).toEqual({
      PIN11: 'stable-ground',
      PIN3: 'head-start',
      PIN4: 'behind-the-line',
      PIN5: 'student-path',
      PIN0: 'caregiver',
      PIN1: 'life-draw',
    });
  });

  it('deals life-draw these exact positions', () => {
    // The same hazard one level down: `resolveStart` is `% positions.length`,
    // so a sixth variant re-deals every life-draw seed. Nothing else pins this.
    const dealt = (seed: string) => {
      const state = createScenarioRun({ seed, runLengthYears: 30, startId: 'life-draw' }).state;
      return {
        cashCents: state.cashCents,
        jobId: state.job?.jobId ?? null,
        debts: state.debts.length,
        educationYears: state.educationYears,
        committedTimePoints: state.committedTimePoints,
      };
    };
    expect(dealt('PIN9')).toEqual({
      cashCents: 80_000,
      jobId: 'line-cook',
      debts: 0,
      educationYears: 0,
      committedTimePoints: 0,
    });
    expect(dealt('PIN1')).toEqual({
      cashCents: 450_000,
      jobId: 'retail-associate',
      debts: 0,
      educationYears: 1,
      committedTimePoints: 0,
    });
    expect(dealt('PIN12')).toEqual({
      cashCents: 25_000,
      jobId: 'warehouse-picker',
      debts: 0,
      educationYears: 0,
      committedTimePoints: 2,
    });
  });

  it('leaves the entry credit score exactly where it was', () => {
    // `startingDraw` is consumed as names-then-score, and until now nothing
    // could see a shift in it: the scripted run never opens a credit line, so
    // the score stays null, and the names reach only Logbook prose, which
    // `serializeState` excludes on purpose. A start that opens a line at week 0
    // is the first thing that makes the draw order observable — so it is pinned
    // here. If this number moves, a draw was inserted before `drawEntryScore`.
    const run = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: 'behind-the-line' });
    expect(run.world.entryCreditScore).toBe(ENTRY_SCORE_FOR_SEED);

    // And it is genuinely reachable, rather than pinned somewhere inert.
    const later = runWeeks(run, 30, () => ({ allocation: DEFAULT_ALLOCATION }));
    expect(later.state.credit.score).not.toBeNull();
  });

  it('moves no stream, whichever start it deals', () => {
    // The proof that RULESET_VERSION holds: every pre-drawn stream lands
    // identically no matter which position the run begins in.
    const base = createScenarioRun({ seed: SEED, runLengthYears: 30 });
    for (const start of STARTS) {
      const other = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: start.id });
      expect(other.world.entryCreditScore, start.id).toBe(base.world.entryCreditScore);
      expect(other.world.names, start.id).toEqual(base.world.names);
      expect(other.world.events, start.id).toEqual(base.world.events);
      expect(other.world.jobTimeline, start.id).toEqual(base.world.jobTimeline);
      expect(other.world.market, start.id).toEqual(base.world.market);
    }
  });
});

describe('the scripted default is untouched', () => {
  it('deep-equals the no-argument config', () => {
    expect(scenarioConfig({ seed: SEED, startId: 'stable-ground' })).toEqual(
      scenarioConfig({ seed: SEED }),
    );
  });

  it('is the position every scripted run has always had', () => {
    const config = scenarioConfig({ seed: SEED });
    expect(config.startId).toBe('stable-ground');
    expect(config.startingCashCents).toBe(200_000);
    expect(config.startingJobId).toBe('warehouse-picker');
    expect(config.startingDebts).toEqual([]);
    expect(config.educationYears).toBe(0);
    expect(config.committedTimePoints).toBe(0);
  });
});

describe('all six starts build a run', () => {
  for (const start of STARTS) {
    it(`${start.id} opens a playable week 0`, () => {
      const run = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: start.id });
      expect(run.state.startId).toBe(start.id);
      expect(run.state.cashCents).toBeGreaterThanOrEqual(0);
      // A start that hands over a balance also hands over a credit file: a debt
      // no bureau has heard of would be a hole in §5.5.
      if (run.state.debts.length > 0) {
        expect(run.state.credit.firstLineWeek).toBe(0);
        expect(run.state.credit.debtTypesEverHeld.length).toBeGreaterThan(0);
      } else {
        expect(run.state.credit.firstLineWeek).toBeNull();
      }
      // And it survives a stretch of weeks rather than only initializing.
      const later = runWeeks(run, 60, () => ({ allocation: DEFAULT_ALLOCATION }));
      expect(later.state.weekIndex).toBe(60);
      expect(Number.isFinite(later.state.cashCents)).toBe(true);
      expect(serializeState(later.state).startId).toBe(start.id);
    });
  }
});

describe('the positions the table describes', () => {
  const position = (id: string) =>
    createScenarioRun({ seed: SEED, runLengthYears: 30, startId: id }).state;

  it('head-start unlocks exactly one skilled job, and it is the education-gated one', () => {
    const state = position('head-start');
    const applicant = { educationYears: state.educationYears, experienceYears: 0, hasVehicle: false };
    const unlocked = JOBS.filter(
      (job) => job.tier !== 'entry' && isEligible(job, applicant),
    ).map((job) => job.id);
    expect(unlocked).toEqual(['dental-hygienist']);
  });

  it('behind-the-line begins with a carried card balance, not a card in grace', () => {
    const card = position('behind-the-line').debts[0] as CreditCard;
    expect(card.kind).toBe('credit-card');
    expect(card.balanceCents).toBe(140_000);
    // Carried means the first statement charges interest. A card opened in
    // grace would make the start free for a month.
    expect(card.inGracePeriod).toBe(false);
    expect(card.statementBalanceCents).toBe(140_000);
  });

  it('student-path begins with a student loan on §5.2\'s rate and term', () => {
    const loan = position('student-path').debts[0] as AmortizingLoan;
    expect(loan.kind).toBe('amortizing');
    expect(loan.loanType).toBe('student');
    expect(loan.aprAnnual).toBeCloseTo(0.045, 10);
    expect(loan.termMonths).toBe(120);
    expect(loan.monthlyPaymentCents).toBeGreaterThan(0);
  });

  it('caregiver commits two points of every week, in the harness as well as the UI', () => {
    const run = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: 'caregiver' });
    expect(run.state.committedTimePoints).toBe(2);

    // The scripted allocation spends all ten. A caregiver week has eight, and
    // `tick` is what enforces that — nothing about this run touches the screen.
    expect(allocationPoints(DEFAULT_ALLOCATION)).toBe(TIME_POINTS_PER_WEEK);
    const committed = runWeeks(run, 8, () => ({ allocation: DEFAULT_ALLOCATION }));
    const free = runWeeks(
      createScenarioRun({ seed: SEED, runLengthYears: 30 }),
      8,
      () => ({ allocation: DEFAULT_ALLOCATION }),
    );
    expect(committed.state.mood).not.toBe(free.state.mood);
  });

  it('life-draw is the only start whose position depends on the seed', () => {
    for (const start of STARTS) {
      const dealt = new Set(
        ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'J9', 'K0', 'M1', 'N2'].map((seed) =>
          JSON.stringify(
            (({ cashCents, job, debts, educationYears, committedTimePoints }) => ({
              cashCents,
              jobId: job?.jobId ?? null,
              debts: debts.length,
              educationYears,
              committedTimePoints,
            }))(createScenarioRun({ seed, runLengthYears: 30, startId: start.id }).state),
          ),
        ),
      );
      if (start.id === 'life-draw') expect(dealt.size).toBeGreaterThan(1);
      else expect(dealt.size, start.id).toBe(1);
    }
  });
});

describe('study buys education (docs/DECISIONS.md)', () => {
  const studying = { ...emptyAllocation(), work: 'none' as const, study: 2, rest: 8 };

  it('turns study points into whole years at the declared rate', () => {
    const run = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: 'student-path' });
    const weeks = STUDY_WEEKS_PER_YEAR / studying.study;
    const after = runWeeks(run, weeks, () => ({ allocation: studying }));
    expect(after.state.studyWeeks).toBe(STUDY_WEEKS_PER_YEAR);
    expect(after.state.educationYears).toBe(1);
  });

  it('never takes back education a start granted', () => {
    const run = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: 'head-start' });
    const after = runWeeks(run, 40, () => ({ allocation: DEFAULT_ALLOCATION }));
    expect(after.state.studyWeeks).toBe(0);
    expect(after.state.educationYears).toBe(2);
  });

  it('reaches a professional job it was locked out of, given enough of it', () => {
    const run = createScenarioRun({ seed: SEED, runLengthYears: 30, startId: 'student-path' });
    const developer = jobById('software-developer')!;
    expect(
      isEligible(developer, { educationYears: 0, experienceYears: 4, hasVehicle: true }),
    ).toBe(false);

    const after = runWeeks(run, (STUDY_WEEKS_PER_YEAR / studying.study) * 4, () => ({
      allocation: studying,
    }));
    expect(after.state.educationYears).toBe(4);
    expect(
      isEligible(developer, {
        educationYears: after.state.educationYears,
        experienceYears: 4,
        hasVehicle: true,
      }),
    ).toBe(true);
  });
});

describe('a start set by hand', () => {
  it('is recorded on the state as the start it names', () => {
    const run = createRun(scenarioConfig({ seed: SEED, startId: 'caregiver' }));
    expect(run.state.startId).toBe('caregiver');
  });

  it('is distinguishable from a dealt one without a field of its own', () => {
    // How §3.7's "flagged as non-comparable" is surfaced: a chosen start is
    // exactly one the seed would not have dealt.
    const dealt = assignedStartId(SEED);
    const chosen = STARTS.find((start) => start.id !== dealt)!.id;
    expect(createScenarioRun({ seed: SEED, startId: dealt }).state.startId).toBe(dealt);
    expect(createScenarioRun({ seed: SEED, startId: chosen }).state.startId).not.toBe(dealt);
  });

  it('falls back to the baseline rather than opening a run with no position', () => {
    const config = scenarioConfig({ seed: SEED, startId: 'not-a-start' });
    expect(config.startingCashCents).toBe(startById('stable-ground')!.startingCashCents);
    // And records the start it actually got. A state naming a position that
    // does not exist would read as a hand-set start to `App`, which shows the
    // non-comparable notice — a typo must not produce that.
    expect(config.startId).toBe('stable-ground');
    expect(STARTS.some((start) => start.id === config.startId)).toBe(true);
  });
});
