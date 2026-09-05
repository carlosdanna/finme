/**
 * Run initialization and the advance control.
 *
 * **Init draw order is contractual.** The pre-drawn streams (§2.2) are consumed
 * here, entirely, and never touched again: `startingDraw` for the run's names
 * and entry credit score, `market` inside `generateMarket`, `jobTimeline` for
 * the availability schedule, and `eventSlots` + `eventSelection` for the event
 * schedule. Adding a draw to any of them shifts every seed.
 */
import { drawEntryScore, emptyCreditState } from './credit.ts';
import { generateEventSchedule } from './events/index.ts';
import type { EventDef } from './events/index.ts';
import { type JobDef, generateJobTimeline } from './jobs.ts';
import { openLogbook } from './logbook/index.ts';
import type { RunNames, TemplatePools } from './logbook/index.ts';
import { generateMarket } from './market.ts';
import { stream } from './rng.ts';
import {
  type RunState,
  type RunStreams,
  type RunWorld,
  defaultStandingOrders,
  emptyHoldings,
  emptyYearToDate,
} from './state.ts';
import { totalWeeks } from './time.ts';
import { RULESET_VERSION } from './version.ts';
import { type Interrupt, type TickInput, type TickResult, tick } from './tick.ts';

export interface RunConfig {
  readonly seed: string;
  readonly runLengthYears: number;
  readonly startAge?: number;
  readonly jobs: readonly JobDef[];
  readonly eventDefs: readonly EventDef[];
  readonly templates: TemplatePools;
  /** Drawn from `startingDraw` by the caller, so content owns the name pools. */
  readonly drawNames: (rng: () => number) => RunNames;
  readonly startingCashCents?: number;
  readonly startingJobId?: string;
}

export interface Run {
  readonly world: RunWorld;
  readonly streams: RunStreams;
  readonly state: RunState;
}

/**
 * Build a run.
 *
 * `startingDraw` is consumed in this order: names, then entry credit score.
 * Everything else has its own stream.
 */
export function createRun(config: RunConfig): Run {
  const weeks = totalWeeks(config.runLengthYears);
  const startingDraw = stream(config.seed, 'startingDraw');

  const names = config.drawNames(startingDraw);
  const entryCreditScore = drawEntryScore(startingDraw);

  const world: RunWorld = {
    seed: config.seed,
    market: generateMarket(config.seed, config.runLengthYears),
    events: generateEventSchedule(
      stream(config.seed, 'eventSlots'),
      stream(config.seed, 'eventSelection'),
      weeks,
    ),
    jobTimeline: generateJobTimeline(stream(config.seed, 'jobTimeline'), config.jobs, weeks),
    names,
    entryCreditScore,
    jobs: config.jobs,
    eventDefs: config.eventDefs,
    templates: config.templates,
  };

  const streams: RunStreams = {
    eventOutcome: stream(config.seed, 'eventOutcome'),
    jobApplication: stream(config.seed, 'jobApplication'),
    flavor: stream(config.seed, 'flavor'),
  };

  const startingJob = config.jobs.find((job) => job.id === config.startingJobId);

  const state: RunState = {
    seed: config.seed,
    rulesetVersion: RULESET_VERSION,
    weekIndex: 0,
    startAge: config.startAge ?? 18,
    runLengthYears: config.runLengthYears,

    cashCents: config.startingCashCents ?? 100_000,
    savingsCents: 0,
    emergencyFundCents: 0,
    emergencyStreakWeeks: 0,

    holdings: emptyHoldings(),
    retirement: { balanceCents: 0, contributionPct: 0 },

    job:
      startingJob === undefined
        ? null
        : {
            jobId: startingJob.id,
            startedWeek: 0,
            weeklyGrossCents:
              startingJob.pay.kind === 'salaried'
                ? Math.round(startingJob.pay.annualSalaryCents / 52)
                : Math.round(startingJob.pay.rateCents * startingJob.pay.hoursPerWeek),
            workMode: startingJob.workMode,
            track: { standing: 'clear', terminationWeek: null },
          },
    // GDD §3.6: energy starts at 80, mood at 60.
    performance: 60,
    weeksUnemployed: 0,
    consecutiveOvertimeWeeks: 0,
    energy: 80,
    mood: 60,
    consecutiveLowMoodWeeks: 0,
    lastReachOutWeek: null,

    debts: [],
    accruedUnpaidBillsCents: 0,
    credit: emptyCreditState(),

    car: null,
    home: null,
    housingTier: 1,
    recurringExpenses: [],

    standingOrders: defaultStandingOrders(),
    eventHistory: {},
    deferredEffects: [],
    flags: [],

    ytd: emptyYearToDate(),
    lastRaisePct: 0,
    netWorthHistory: [],
    annualSnapshots: [],
    interestPaidThisYearCents: 0,
    employerMatchedThisYearCents: 0,

    dire: null,
    consecutiveMissedPaymentMonths: 0,
    decisionLog: [],

    logbook: openLogbook(streams.flavor),
    logbookEntries: [],
  };

  return { world, streams, state };
}

/** GDD §2.1's advance granularities. */
export type Granularity = 'week' | 'month' | 'season' | 'until-something-happens';

/**
 * [T] Stage-based default granularity: life gets less week-to-week precarious
 * as income stabilizes, and the pacing reflects that.
 */
export function defaultGranularity(yearsElapsed: number): Granularity {
  if (yearsElapsed < 3) return 'week';
  if (yearsElapsed < 15) return 'month';
  return 'season';
}

const GRANULARITY_WEEKS: Readonly<Record<Granularity, number>> = {
  week: 1,
  month: 4,
  season: 13,
  'until-something-happens': Number.POSITIVE_INFINITY,
};

export interface AdvanceResult {
  readonly run: Run;
  readonly interrupts: readonly Interrupt[];
  readonly weeksAdvanced: number;
}

/**
 * Advance time until an interrupt fires or the granularity budget runs out.
 *
 * The single most-pressed control in the game. It stops the moment anything
 * needs the player — an event, a bill that cannot be paid, a firing warning, a
 * floor crossed (GDD §2.1).
 */
export function advance(
  run: Run,
  granularity: Granularity = 'until-something-happens',
  inputFor: (state: RunState) => TickInput = () => ({}),
  maxWeeks = 5_200,
): AdvanceResult {
  const budget = Math.min(GRANULARITY_WEEKS[granularity], maxWeeks);
  let current = run;
  let weeksAdvanced = 0;

  for (let step = 0; step < budget; step++) {
    const result: TickResult = tick(current.world, current.streams, current.state, inputFor(current.state));
    if (result.interrupts.some((i) => i.reason === 'run-complete')) {
      return { run: current, interrupts: result.interrupts, weeksAdvanced };
    }

    current = { ...current, state: result.state };
    weeksAdvanced++;

    if (result.interrupts.length > 0) {
      return { run: current, interrupts: result.interrupts, weeksAdvanced };
    }
  }

  return { run: current, interrupts: [], weeksAdvanced };
}

/** Run `weeks` ticks regardless of interrupts. Used by the harness and fixtures. */
export function runWeeks(
  run: Run,
  weeks: number,
  inputFor: (state: RunState) => TickInput = () => ({}),
): Run {
  let current = run;
  for (let i = 0; i < weeks; i++) {
    const result = tick(current.world, current.streams, current.state, inputFor(current.state));
    current = { ...current, state: result.state };
  }
  return current;
}
