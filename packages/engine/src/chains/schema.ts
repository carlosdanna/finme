/**
 * Chains — multi-week, player-initiated processes. TDD §9.6.
 *
 * A chain is a state machine whose steps are ordinary `EventDef` cards. Looking
 * for a job or somewhere to live is not one button: it is a handful of
 * decisions spread over weeks, each costing mood, energy and money, with the
 * outcome rolled against state the player actually built.
 *
 * Everything about a step — gates, choices, `requires`, formula magnitudes,
 * `outcomeRoll`, `deferred`, `displayVars`, card variants, logbook keys —
 * reuses the event machinery unchanged. Only three things are new: a step is
 * *scheduled* rather than drawn from a slot, the machine *advances* by an
 * explicit `goto`, and the player *starts* it.
 *
 * **Chain and step ids are stable forever**, for the same reason event ids are.
 */
import type { Effect, EventDef, Gate } from '../events/schema.ts';
import type { InPlayStream } from '../rng.ts';

/** The literal a `chain` effect uses to finish the chain rather than advance it. */
export const CHAIN_END = 'end';

/**
 * [F] A hard ceiling on steps before the chain is forced to end.
 *
 * A search that loops forever is both a hang and bad pedagogy — the lesson is
 * that looking for somewhere to live is wearing, not that it is unending.
 */
export const CHAIN_MAX_STEPS = 12;

export interface ChainStepDef {
  /** Unique within the chain. Stable forever. */
  readonly id: string;
  /**
   * [T] Weeks from the previous step resolving to this one landing. This is
   * where the *time* in "takes time" lives, and it is the chain's main cost.
   */
  readonly gapWeeks: number;
  /** The card. A full `EventDef`, held to every rule an ordinary event is. */
  readonly card: EventDef;
}

export interface ChainDef {
  /** `JOB_SEARCH`, `HOME_SEARCH`. Stable forever. */
  readonly id: string;
  /**
   * Which in-play stream this chain's rolls draw from. Declared per chain
   * rather than per step so `resolveChoice` keeps taking a single `Rng` — a
   * per-step stream would make the draw count depend on the path taken.
   */
  readonly stream: Extract<InPlayStream, 'chain' | 'jobApplication'>;
  /** All must pass before the player may start it. */
  readonly startGates: readonly Gate[];
  /** Applied on starting, so beginning a search is itself a decision. */
  readonly startEffects: readonly Effect[];
  readonly firstStepId: string;
  readonly steps: readonly ChainStepDef[];
  /** [T] Weeks after it ends before the same chain may be started again. */
  readonly cooldownWeeks: number;
  /** What walking away part-way costs. */
  readonly abandonEffects: readonly Effect[];
  readonly logbookKeyStart: string;
  readonly logbookKeyAbandon: string;
}

/**
 * A chain the player is part-way through.
 *
 * Serializable, like the rest of `RunState`: no Sets, no Maps, no functions.
 * `dueWeek` is an absolute `weekIndex` and never a countdown — `weekIndex` is
 * the only representation of time (TDD §0).
 */
export interface ActiveChain {
  readonly chainId: string;
  readonly stepId: string;
  readonly dueWeek: number;
  readonly startedWeek: number;
  /** Counts against `CHAIN_MAX_STEPS`. */
  readonly stepsTaken: number;
  /**
   * What the search is *for* — a `jobId`, or `rent-2` / `buy`. Chosen when the
   * chain starts, so the step cards themselves stay static content.
   */
  readonly target: string | null;
}

/** Weeks at which each chain last ended, by chain id. For cooldowns. */
export type ChainHistory = Readonly<Record<string, readonly number[]>>;

export function chainById(chains: readonly ChainDef[], chainId: string): ChainDef | undefined {
  return chains.find((chain) => chain.id === chainId);
}

export function stepById(chain: ChainDef, stepId: string): ChainStepDef | undefined {
  return chain.steps.find((step) => step.id === stepId);
}
