/**
 * `{{placeholder}}` values for an event card.
 *
 * **No simulation logic.** Every number comes from the engine's own evaluator,
 * context and `roll`; this file decides how a number *reads*, not what it is.
 */
import {
  type EventDef,
  type RunState,
  type RunWorld,
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
  const context = pendingEventContext(state, world, roll);
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
