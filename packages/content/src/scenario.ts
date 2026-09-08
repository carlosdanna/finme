/**
 * The scripted default run used by golden fixtures and the balance harness.
 *
 * Content owns this because it wires the engine to the JSON: the engine declares
 * no dependencies and cannot import events, jobs or templates itself.
 */
import { type Allocation, type Run, type RunConfig, createRun, emptyAllocation } from '@finme/engine';
import { CHAINS } from './chains.ts';
import { EVENTS } from './events.ts';
import { JOBS } from './jobs.ts';
import { LOGBOOK_TEMPLATES, drawRunNames } from './logbook.ts';

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
  readonly startingJobId?: string;
  readonly startingCashCents?: number;
}

/** Everything a run needs, with content wired in. */
export function scenarioConfig(options: ScenarioOptions): RunConfig {
  return {
    seed: options.seed,
    runLengthYears: options.runLengthYears ?? 30,
    startAge: options.startAge ?? 22,
    playerName: options.playerName ?? '',
    jobs: JOBS,
    eventDefs: EVENTS,
    chainDefs: CHAINS,
    templates: LOGBOOK_TEMPLATES,
    drawNames: drawRunNames,
    startingCashCents: options.startingCashCents ?? 200_000,
    startingJobId: options.startingJobId ?? 'warehouse-picker',
  };
}

export function createScenarioRun(options: ScenarioOptions): Run {
  return createRun(scenarioConfig(options));
}
