/**
 * Gate and multiplier evaluation — TDD §9.2.
 *
 * `EventState` is the read-only slice of game state a gate may see. It is
 * deliberately narrow: an event can ask what is true, never change it.
 */
import type { EventDef, Gate, Multiplier } from './schema.ts';

export interface EventState {
  readonly weekIndex: number;
  readonly age: number;
  readonly employed: boolean;
  readonly ownsCar: boolean;
  readonly ownsHome: boolean;
  readonly lifeStage: string;
  /** Flags currently set. */
  readonly flags: ReadonlySet<string>;
  /** Debt instruments the player currently holds. */
  readonly debtTypes: ReadonlySet<string>;
  /** Assets with a non-zero holding. */
  readonly heldAssets: ReadonlySet<string>;
  /**
   * Numeric stats a `stat` gate may read — `cashCents`, `mood`,
   * `emergencyFundMonths`, `carAgeYears`, and so on.
   */
  readonly stats: Readonly<Record<string, number>>;
}

function compare(left: number, op: string, right: number): boolean {
  switch (op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}

/**
 * Evaluate one gate.
 *
 * An unknown stat reads as *not passing* rather than throwing: a typo in content
 * should quietly stop an event firing, not crash a 30-year run mid-week. The
 * content lint is what catches the typo.
 */
export function passesGate(gate: Gate, state: EventState): boolean {
  switch (gate.type) {
    case 'age':
      return compare(state.age, gate.op, gate.value);
    case 'flag':
      return state.flags.has(gate.value);
    case 'notFlag':
      return !state.flags.has(gate.value);
    case 'employed':
      return state.employed === (gate.value ?? true);
    case 'ownsCar':
      return state.ownsCar === (gate.value ?? true);
    case 'ownsHome':
      return state.ownsHome === (gate.value ?? true);
    case 'hasDebtType':
      return state.debtTypes.has(gate.value);
    case 'holdsAsset':
      return state.heldAssets.has(gate.value);
    case 'lifeStage':
      return state.lifeStage === gate.value;
    case 'stat': {
      const actual = state.stats[gate.stat];
      if (actual === undefined) return false;
      return compare(actual, gate.op, gate.value);
    }
  }
}

/** ALL gates must pass. */
export function passesGates(gates: readonly Gate[], state: EventState): boolean {
  return gates.every((gate) => passesGate(gate, state));
}

/** The product of every multiplier whose gate passes. */
export function multiplierProduct(
  multipliers: readonly Multiplier[],
  state: EventState,
): number {
  let product = 1;
  for (const multiplier of multipliers) {
    if (passesGate(multiplier.when, state)) product *= multiplier.factor;
  }
  return product;
}

/** Whether an event's cooldown has elapsed since it last fired. */
export function cooldownExpired(
  event: EventDef,
  firedWeeks: readonly number[] | undefined,
  weekIndex: number,
): boolean {
  if (firedWeeks === undefined || firedWeeks.length === 0) return true;
  const last = firedWeeks[firedWeeks.length - 1];
  return weekIndex - last >= event.cooldownWeeks;
}

/** The weight an event carries at a slot, before normalization. */
export function eventWeight(event: EventDef, state: EventState): number {
  return event.baseWeight * multiplierProduct(event.multipliers, state);
}
