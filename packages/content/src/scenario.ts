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
   * Which of GDD §3.7's starting positions to deal. Omitted means
   * `stable-ground` — the position every scripted run has always had, so the
   * no-argument call is byte-identical to what it produced before starts
   * existed.
   *
   * §3.7's Custom Start is not a seventh position: it is one of these six,
   * named by a player rather than dealt by the seed. What makes that run
   * non-comparable is that `startId` no longer equals `assignedStartId(seed)`,
   * which needs no field of its own.
   */
  readonly startId?: string;
  /**
   * Overrides the start's job. Explicit `null` begins the run out of work —
   * distinct from omitting it, which takes whatever the start deals.
   */
  readonly startingJobId?: string | null;
  readonly startingCashCents?: number;
}

/** Everything a run needs, with content wired in. */
export function scenarioConfig(options: ScenarioOptions): RunConfig {
  // An id the file does not define falls back to the baseline rather than
  // beginning a run with no position at all.
  const start = startById(options.startId ?? DEFAULT_START_ID) ?? startById(DEFAULT_START_ID)!;
  const position = resolveStart(start, options.seed);

  return {
    seed: options.seed,
    runLengthYears: options.runLengthYears ?? 30,
    startAge: options.startAge ?? 22,
    playerName: options.playerName ?? '',
    startId: options.startId ?? DEFAULT_START_ID,
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
