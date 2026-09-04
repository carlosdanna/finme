/**
 * Event definitions — TDD §9.3.
 *
 * These are the types content must satisfy. The Zod schema that validates the
 * JSON lives in `@finme/content`, which depends on this package — the engine
 * declares no dependencies, so validation cannot live here.
 *
 * **Event ids are stable forever.** Never rename one and never reuse one: a
 * rename silently changes what every existing seed produces.
 */
import type { Magnitude } from './formula.ts';

/** GDD §5.2. */
export const EVENT_CATEGORIES = [
  'windfall',
  'emergency',
  'market',
  'career',
  'social',
  'scam',
  'housing',
  'health',
  'family',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** [T] Rarity tiers, from §9.3. */
export const BASE_WEIGHT_COMMON = 100;
export const BASE_WEIGHT_UNCOMMON = 45;
export const BASE_WEIGHT_RARE = 12;

export type ComparisonOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

/**
 * A condition. Every gate on an event must pass; a multiplier's gate decides
 * whether its factor applies.
 */
export type Gate =
  | { readonly type: 'age'; readonly op: ComparisonOp; readonly value: number }
  | { readonly type: 'flag'; readonly value: string }
  | { readonly type: 'notFlag'; readonly value: string }
  | { readonly type: 'employed'; readonly value?: boolean }
  | { readonly type: 'ownsCar'; readonly value?: boolean }
  | { readonly type: 'ownsHome'; readonly value?: boolean }
  | { readonly type: 'hasDebtType'; readonly value: string }
  | { readonly type: 'holdsAsset'; readonly value: string }
  | { readonly type: 'stat'; readonly stat: string; readonly op: ComparisonOp; readonly value: number }
  | { readonly type: 'lifeStage'; readonly value: string };

export interface Multiplier {
  readonly when: Gate;
  /** Multiplicative against baseWeight. 1.0 is no effect. */
  readonly factor: number;
}

export type DebtInstrument = 'CREDIT_CARD' | 'PERSONAL_LOAN' | 'AUTO_LOAN' | 'BNPL' | 'PAYDAY';

export type Effect =
  | { readonly k: 'cash'; readonly cents: Magnitude }
  | { readonly k: 'mood'; readonly delta: Magnitude }
  | { readonly k: 'energy'; readonly delta: Magnitude }
  | { readonly k: 'performance'; readonly delta: Magnitude }
  | { readonly k: 'debt'; readonly instrument: DebtInstrument; readonly principalCents: Magnitude }
  | { readonly k: 'asset'; readonly assetId: string; readonly sharesDelta: Magnitude }
  | {
      readonly k: 'expense';
      readonly category: string;
      readonly cents: Magnitude;
      readonly recurring?: boolean;
    }
  | { readonly k: 'flag'; readonly add?: string; readonly remove?: string }
  | { readonly k: 'jobOffer'; readonly jobId: string }
  | {
      readonly k: 'creditEvent';
      readonly kind: 'missed' | 'onTime' | 'collection' | 'inquiry';
    };

export interface DeferredEffect {
  readonly afterWeeks: number;
  /** Checked when the deferred effect comes due, not when it was scheduled. */
  readonly condition?: Gate;
  readonly effects: readonly Effect[];
  readonly logbookKey?: string;
}

export interface OutcomeBranch {
  /** Probability of this branch. Branches are drawn in order and sum to 1. */
  readonly p: number;
  readonly effects: readonly Effect[];
  readonly logbookKey: string;
}

export interface OutcomeRoll {
  readonly stream: 'eventOutcome';
  readonly branches: readonly OutcomeBranch[];
}

export interface Choice {
  readonly id: string;
  /** Never signals which choice is correct — in wording, order or styling. */
  readonly label: string;
  readonly requires?: readonly Gate[];
  readonly effects: readonly Effect[];
  readonly deferred?: readonly DeferredEffect[];
  readonly outcomeRoll?: OutcomeRoll;
  readonly logbookKey: string;
}

export interface EventDef {
  readonly id: string;
  readonly category: EventCategory;
  readonly baseWeight: number;
  readonly oncePerRun?: boolean;
  readonly cooldownWeeks: number;
  /** ALL must pass for the event to be eligible. */
  readonly gates: readonly Gate[];
  /** Product of the factors whose gate passes. */
  readonly multipliers: readonly Multiplier[];
  readonly title: string;
  /** Supports {{var}} interpolation. */
  readonly body: string;
  readonly choices: readonly Choice[];
}

/** Weeks at which each event has fired, by event id. */
export type EventHistory = Readonly<Record<string, readonly number[]>>;
