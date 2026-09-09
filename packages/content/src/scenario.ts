/**
 * The scripted default run used by golden fixtures and the balance harness.
 *
 * Content owns this because it wires the engine to the JSON: the engine declares
 * no dependencies and cannot import events, jobs or templates itself.
 */
import {
  type Allocation,
  type Run,
  type RunConfig,
  buildStartingDebts,
  createRun,
  emptyAllocation,
} from '@finme/engine';
import { CHAINS } from './chains.ts';
import { EVENTS } from './events.ts';
import { JOBS } from './jobs.ts';
import { LOGBOOK_TEMPLATES, drawRunNames } from './logbook.ts';
import { DEFAULT_START_ID, resolveStart, startById } from './starts.ts';

/** Full-time work, two points of rest, one of free social. A steady week. */
export const DEFAULT_ALLOCATION: Allocation = {
  ...emptyAllocation(),
  work: 'full-time',
  rest: 3,
  freeSocial: 2,
};

export interface ScenarioOptions {
  readonly seed: string;
  readonly runLengthYears?: number;
  readonly startAge?: number;
  /** Cosmetic only, and defaulted to empty so the scripted runs stay nameless. */
  readonly playerName?: string;
  /**
   * Omitted means `stable-ground`, so the no-argument call is byte-identical to
   * what it produced before starts existed.
   *
   * §3.7's Custom Start is one of these six named by a player rather than dealt.
   * That run is non-comparable precisely because `startId` no longer equals
   * `assignedStartId(seed)` — no field of its own is needed.
   */
  readonly startId?: string;
  /** Explicit `null` begins the run out of work; omitting it takes the start's. */
  readonly startingJobId?: string | null;
  readonly startingCashCents?: number;
}

/** Everything a run needs, with content wired in. */
export function scenarioConfig(options: ScenarioOptions): RunConfig {
  // `startId` records the start the run actually got, not the id asked for: an
  // unknown id would leave the state naming a position that does not exist, and
  // `App` reads that as a hand-set start.
  const start = startById(options.startId ?? DEFAULT_START_ID) ?? startById(DEFAULT_START_ID)!;
  const position = resolveStart(start, options.seed);

  return {
    seed: options.seed,
    runLengthYears: options.runLengthYears ?? 30,
    startAge: options.startAge ?? 22,
    playerName: options.playerName ?? '',
    startId: start.id,
    jobs: JOBS,
    eventDefs: EVENTS,
    chainDefs: CHAINS,
    templates: LOGBOOK_TEMPLATES,
    drawNames: drawRunNames,
    startingCashCents: options.startingCashCents ?? position.startingCashCents,
    startingJobId:
      (options.startingJobId === undefined ? position.startingJobId : options.startingJobId) ??
      undefined,
    educationYears: position.educationYears,
    committedTimePoints: position.committedTimePoints,
    startingDebts: buildStartingDebts(position.debts),
  };
}

export function createScenarioRun(options: ScenarioOptions): Run {
  return createRun(scenarioConfig(options));
}
