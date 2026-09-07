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
import type { CreditEventKind } from '../credit.ts';
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
  | {
      readonly type: 'stat';
      readonly stat: string;
      readonly op: ComparisonOp;
      /**
       * A number, or the name of another stat to compare against — §9.4's
       * CAR_RAISE_BELOW_INFLATION compares `lastRaisePct` to
       * `inflationThisYear`, which is how "below inflation" stays true at any
       * inflation level.
       */
      readonly value: number | string;
    }
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
  | { readonly k: 'creditEvent'; readonly kind: CreditEventKind };

export interface DeferredEffect {
  readonly afterWeeks: number;
  /** Checked when the deferred effect comes due, not when it was scheduled. */
  readonly condition?: Gate;
  readonly effects: readonly Effect[];
  readonly logbookKey?: string;
}

/** The literal that means "whatever probability the other branches leave". */
export const REST_BRANCH = 'rest';

export interface OutcomeBranch {
  /**
   * Probability of this branch: a number, a formula (`"0.25 + 0.3*performanceNorm"`),
   * or `"rest"` for the remainder. Branches are walked in declared order.
   */
  readonly p: Magnitude | typeof REST_BRANCH;
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
  /**
   * Marks a choice that deliberately does nothing mechanically — §9.4's "Say
   * thank you" is the canonical case. The content lint rejects an empty choice
   * without this, so an author who simply forgot the effects is caught.
   */
  readonly noop?: boolean;
  readonly deferred?: readonly DeferredEffect[];
  readonly outcomeRoll?: OutcomeRoll;
  readonly logbookKey: string;
}

/**
 * A `{{placeholder}}` value for an event card. Evaluated against the same
 * context and `roll` as the effects, so the card cannot quote a price the
 * choice will not charge.
 */
export interface DisplayVar {
  readonly as: 'money' | 'number';
  readonly value: Magnitude;
  /** Decimal places for `number`. Ignored for `money`. */
  readonly precision?: number;
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
  /** One title, or one per card variant. Supports {{var}} interpolation. */
  readonly title: string | readonly string[];
  /**
   * One body, or one per card variant. A common event fires six or seven times
   * in a run, so repeatable events carry several — budgeted by rarity tier in
   * `docs/EVENT-CATALOGUE.md` §3.3 and enforced at load.
   */
  readonly body: string | readonly string[];
  /** Values for the placeholders in `title` and `body`. */
  readonly displayVars?: Readonly<Record<string, DisplayVar>>;
  readonly choices: readonly Choice[];
}

/** Weeks at which each event has fired, by event id. */
export type EventHistory = Readonly<Record<string, readonly number[]>>;

/**
 * The card to show for one firing of an event.
 *
 * Deliberately not an RNG draw: a pure function of the event and its week needs
 * no stream and cannot shift one. Adding a variant changes which card a seed
 * shows — prose only, never a number, the same licence the Logbook has (§2.2).
 * The index picks a matching title/body pair, so a variant is a whole card.
 */
export function cardVariant(event: EventDef, weekIndex: number): { title: string; body: string } {
  const titles = Array.isArray(event.title) ? event.title : [event.title as string];
  const bodies = Array.isArray(event.body) ? event.body : [event.body as string];
  const index = weekIndex % Math.max(titles.length, bodies.length);

  return {
    title: titles[index % titles.length],
    body: bodies[index % bodies.length],
  };
}
