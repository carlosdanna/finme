/** Event system — TDD §9.1-9.3. */
export {
  EVENT_CATEGORIES,
  BASE_WEIGHT_COMMON,
  BASE_WEIGHT_UNCOMMON,
  BASE_WEIGHT_RARE,
  REST_BRANCH,
  cardVariant,
} from './schema.ts';
export type {
  EventDef,
  DisplayVar,
  EventCategory,
  EventHistory,
  Gate,
  ComparisonOp,
  Multiplier,
  Choice,
  Effect,
  DeferredEffect,
  OutcomeRoll,
  OutcomeBranch,
} from './schema.ts';

export {
  passesGate,
  passesGates,
  multiplierProduct,
  cooldownExpired,
  eventWeight,
} from './gates.ts';
export type { EventState } from './gates.ts';

export {
  SLOT_LAMBDA,
  SLOT_GAP_MIN,
  SLOT_GAP_MAX,
  generateEventSchedule,
  eligibleEvents,
  selectEvent,
  recordFiring,
  slotIndexAt,
} from './selection.ts';
export type { EventSchedule } from './selection.ts';

export {
  FORMULA_FUNCTIONS,
  FormulaError,
  evaluateFormula,
  resolveMagnitude,
  resolveCents,
} from './formula.ts';
export type { FormulaContext, Magnitude, FormulaFunction } from './formula.ts';

export {
  emptyOutcome,
  applyEffects,
  rollOutcome,
  branchProbabilities,
  resolveChoice,
  interpolate,
  placeholdersIn,
} from './effects.ts';
export type { EffectOutcome, ScheduledEffect } from './effects.ts';
