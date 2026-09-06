/**
 * `{{placeholder}}` values for an event card.
 *
 * **No simulation logic.** Every number comes from the engine's own formula
 * evaluator, against the engine's own context and the event's own `roll`. This
 * file decides how a number *reads*, not what it is — which is the only reason
 * it may live in the UI package at all.
 *
 * The card and the effects therefore quote the same formula string evaluated
 * the same way. Writing the number twice is how a card ends up promising a
 * price the choice does not charge.
 */
import {
  type EventDef,
  type RunState,
  type RunWorld,
  formulaContextFrom,
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
  const context = formulaContextFrom(state, world, roll);
  const out: Record<string, string> = {};

  for (const [key, spec] of Object.entries(event.displayVars ?? {})) {
    const value = resolveMagnitude(spec.value, context);
    out[key] =
      spec.as === 'money'
        ? formatCents(Math.round(value))
        : value.toFixed(spec.precision ?? 0);
  }

  return out;
}
