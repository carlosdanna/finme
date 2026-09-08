/**
 * The chain state machine — TDD §9.6.
 *
 * Pure: every function returns new state. The tick applies the result, which
 * keeps this testable without a whole game state and keeps a chain replayable.
 */
import type { EventState } from '../events/gates.ts';
import { passesGates } from '../events/gates.ts';
import {
  type ActiveChain,
  CHAIN_END,
  CHAIN_MAX_STEPS,
  type ChainDef,
  type ChainHistory,
  chainById,
  stepById,
} from './schema.ts';

/** Why a chain cannot be started right now. */
export type ChainBlockedReason = 'unknown' | 'already-active' | 'gated' | 'cooling-down';

/**
 * Whether the player may start this chain this week.
 *
 * Returns the reason rather than a bare boolean: the Jobs and Housing panels
 * state *why* plainly ("You are already looking"), which is the same courtesy
 * the job board pays with its ineligibility reasons.
 */
export function startBlockedReason(
  chains: readonly ChainDef[],
  active: readonly ActiveChain[],
  history: ChainHistory,
  chainId: string,
  state: EventState,
): ChainBlockedReason | null {
  const chain = chainById(chains, chainId);
  if (chain === undefined) return 'unknown';
  if (active.some((entry) => entry.chainId === chainId)) return 'already-active';
  if (!passesGates(chain.startGates, state)) return 'gated';

  const ended = history[chainId];
  if (ended !== undefined && ended.length > 0) {
    const last = ended[ended.length - 1];
    if (state.weekIndex - last < chain.cooldownWeeks) return 'cooling-down';
  }
  return null;
}

/**
 * Open a chain at its first step.
 *
 * The first step lands `gapWeeks` from now rather than immediately — deciding
 * to look for something is not the same week as the first thing happening.
 */
export function startChain(
  chain: ChainDef,
  weekIndex: number,
  target: string | null,
): ActiveChain | null {
  const first = stepById(chain, chain.firstStepId);
  if (first === undefined) return null;

  return {
    chainId: chain.id,
    stepId: first.id,
    dueWeek: weekIndex + first.gapWeeks,
    startedWeek: weekIndex,
    stepsTaken: 0,
    target,
  };
}

/**
 * Move a chain on after a step resolved.
 *
 * `goto` is `CHAIN_END`, or a step id in the same chain. Anything unrecognized
 * ends the chain rather than stalling it: a content typo must not leave a
 * player in a search that can never produce another card. The load-time lint in
 * `@finme/content` is what stops a typo getting this far.
 *
 * Returns `null` when the chain is over — the caller records the ending week
 * against the cooldown.
 */
export function advanceChain(
  chain: ChainDef,
  active: ActiveChain,
  goto: string | null,
  weekIndex: number,
): ActiveChain | null {
  const stepsTaken = active.stepsTaken + 1;
  if (goto === null || goto === CHAIN_END) return null;
  if (stepsTaken >= CHAIN_MAX_STEPS) return null;

  const next = stepById(chain, goto);
  if (next === undefined) return null;

  return {
    ...active,
    stepId: next.id,
    dueWeek: weekIndex + next.gapWeeks,
    stepsTaken,
  };
}

/**
 * The chain whose step is due this week, or `null`.
 *
 * [F] Iterated in `chainId` order, not in the order the player happened to
 * start them: a draw is taken for whichever card is presented, so the choice of
 * card must not depend on an incidental ordering (TDD §2.2).
 */
export function dueChain(active: readonly ActiveChain[], weekIndex: number): ActiveChain | null {
  const due = active
    .filter((entry) => entry.dueWeek <= weekIndex)
    .sort((a, b) => a.chainId.localeCompare(b.chainId));
  return due[0] ?? null;
}

/** Push a chain's due week out by one, when a slot event has taken the week. */
export function slipChain(active: ActiveChain, weekIndex: number): ActiveChain {
  return { ...active, dueWeek: weekIndex + 1 };
}

/** Replace or remove one chain, keeping the list sorted by `chainId`. */
export function withChain(
  active: readonly ActiveChain[],
  chainId: string,
  next: ActiveChain | null,
): readonly ActiveChain[] {
  const rest = active.filter((entry) => entry.chainId !== chainId);
  const all = next === null ? rest : [...rest, next];
  return all.sort((a, b) => a.chainId.localeCompare(b.chainId));
}

/** Record that a chain ended, for the cooldown. */
export function recordChainEnd(
  history: ChainHistory,
  chainId: string,
  weekIndex: number,
): ChainHistory {
  return { ...history, [chainId]: [...(history[chainId] ?? []), weekIndex] };
}
