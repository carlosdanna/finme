/**
 * `{{placeholder}}` values for an event card.
 *
 * **No simulation logic.** Every number comes from the engine's own evaluator,
 * context and `roll`; this file decides how a number *reads*, not what it is.
 */
import {
  type ActiveChain,
  type EventDef,
  type FormulaContext,
  type RunState,
  type RunWorld,
  pendingChainContext,
  pendingEventContext,
  resolveMagnitude,
} from '@finme/engine';
import { formatCents } from '@/lib/format';

/** The names the run supplies rather than the event (TDD §12). */
export interface RunScopedVars {
  readonly friendName: string;
  readonly advisorName: string;
}

export function eventDisplayVars(
  event: EventDef,
  state: RunState,
  world: RunWorld,
  roll: number,
): Record<string, string> {
  // `state` is the week before the event's own; the engine owns that offset.
  return renderVars(event, pendingEventContext(state, world, roll));
}

/**
 * The same, for a chain step card. A chain card's formulas may also name the
 * search's own numbers — the rent it is chasing, the deposit it would need —
 * so it evaluates against the chain context rather than the event one.
 */
export function chainDisplayVars(
  card: EventDef,
  state: RunState,
  world: RunWorld,
  chain: ActiveChain,
  roll: number,
): Record<string, string> {
  return renderVars(card, pendingChainContext(state, world, chain, roll));
}

function renderVars(card: EventDef, context: FormulaContext): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, spec] of Object.entries(card.displayVars ?? {})) {
    const value = resolveMagnitude(spec.value, context);
    out[key] =
      spec.as === 'money' ? formatCents(Math.round(value)) : value.toFixed(spec.precision ?? 0);
  }

  return out;
}
