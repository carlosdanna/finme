/**
 * Slot scheduling and event selection — TDD §9.1, §9.2.
 *
 * This is the mechanism that reconciles state-weighted events with seed
 * reproducibility (GDD §13): **the ticket is fixed by the seed; what the ticket
 * maps to depends on state.** Two players sharing a seed hit events in the same
 * weeks, but not necessarily the same events.
 */
import { clamp } from '../math.ts';
import type { Rng } from '../rng.ts';
import { type EventState, cooldownExpired, eventWeight, passesGates } from './gates.ts';
import type { EventDef, EventHistory } from './schema.ts';

/** [T] Inter-arrival rate for event slots. Mean gap ≈ 4.5 weeks. */
export const SLOT_LAMBDA = 0.22;
/** [T] Hard bounds on the gap, so events never bunch up or vanish for a year. */
export const SLOT_GAP_MIN = 3;
export const SLOT_GAP_MAX = 10;

export interface EventSchedule {
  /** Weeks at which an event may fire, ascending. */
  readonly slots: readonly number[];
  /** One uniform per slot, pre-drawn. `slotTickets[i]` belongs to `slots[i]`. */
  readonly slotTickets: readonly number[];
}

/**
 * Pre-draw the whole schedule at init: slot weeks from `eventSlots`, then one
 * ticket per slot from `eventSelection`.
 *
 * [F] Both streams are fully consumed here and never touched again. That is what
 * makes the *when* of every event a property of the seed alone.
 */
export function generateEventSchedule(
  slotsRng: Rng,
  selectionRng: Rng,
  totalWeeks: number,
): EventSchedule {
  const slots: number[] = [];
  let week = 0;

  while (week < totalWeeks) {
    const u = Math.max(slotsRng(), Number.MIN_VALUE);
    const gap = clamp(SLOT_GAP_MIN + Math.floor(-Math.log(u) / SLOT_LAMBDA), SLOT_GAP_MIN, SLOT_GAP_MAX);
    week += gap;
    if (week < totalWeeks) slots.push(week);
  }

  const slotTickets = slots.map(() => selectionRng());
  return { slots, slotTickets };
}

/**
 * The eligible pool at a slot, in the stable order selection depends on.
 *
 * [F] The sort is load-bearing. Without a stable ordering the same ticket maps
 * to different events across engine versions, and every shared seed silently
 * breaks. Never replace this with iteration over an object or a Map.
 */
export function eligibleEvents(
  events: readonly EventDef[],
  state: EventState,
  history: EventHistory,
): EventDef[] {
  return events
    .filter((event) => passesGates(event.gates, state))
    .filter((event) => cooldownExpired(event, history[event.id], state.weekIndex))
    .filter((event) => !(event.oncePerRun === true && (history[event.id]?.length ?? 0) > 0))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Pick the event for a slot, or `null` if nothing is eligible.
 *
 * A slot with an empty pool **passes silently**. It is not an error, and it is
 * not backfilled with something inappropriate — a quiet week is a legitimate
 * outcome, and forcing an event would break the age-appropriateness that gating
 * exists to provide.
 */
export function selectEvent(
  events: readonly EventDef[],
  state: EventState,
  history: EventHistory,
  ticket: number,
): EventDef | null {
  const eligible = eligibleEvents(events, state, history);
  if (eligible.length === 0) return null;

  const weights = eligible.map((event) => eventWeight(event, state));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return null;

  let x = ticket * total;
  for (let i = 0; i < eligible.length; i++) {
    x -= weights[i];
    if (x <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}

/** Record that an event fired, for cooldown and once-per-run bookkeeping. */
export function recordFiring(
  history: EventHistory,
  eventId: string,
  weekIndex: number,
): EventHistory {
  return { ...history, [eventId]: [...(history[eventId] ?? []), weekIndex] };
}

/** Slot index for a week, or -1 if that week holds no slot. */
export function slotIndexAt(schedule: EventSchedule, weekIndex: number): number {
  return schedule.slots.indexOf(weekIndex);
}
