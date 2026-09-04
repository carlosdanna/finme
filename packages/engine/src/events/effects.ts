/**
 * Effect application — TDD §9.3.
 *
 * Effects resolve to a *diff*, not a mutation. The tick pipeline applies the
 * diff, which keeps this file pure, keeps it testable without a whole game
 * state, and keeps event resolution replayable.
 */
import type { Rng } from '../rng.ts';
import { type FormulaContext, resolveCents, resolveMagnitude } from './formula.ts';
import type { Choice, DebtInstrument, DeferredEffect, Effect, OutcomeRoll } from './schema.ts';

export interface EffectOutcome {
  readonly cashDeltaCents: number;
  readonly moodDelta: number;
  readonly energyDelta: number;
  readonly performanceDelta: number;
  readonly debtsOpened: readonly { readonly instrument: DebtInstrument; readonly principalCents: number }[];
  readonly assetTrades: readonly { readonly assetId: string; readonly sharesDelta: number }[];
  readonly expenses: readonly {
    readonly category: string;
    readonly cents: number;
    readonly recurring: boolean;
  }[];
  readonly flagsAdded: readonly string[];
  readonly flagsRemoved: readonly string[];
  readonly jobOffers: readonly string[];
  readonly creditEvents: readonly ('missed' | 'onTime' | 'collection' | 'inquiry')[];
  /** Logbook keys this resolution produced, in order. */
  readonly logbookKeys: readonly string[];
  /** Effects scheduled for a later week. */
  readonly deferred: readonly ScheduledEffect[];
}

export interface ScheduledEffect {
  readonly dueWeek: number;
  readonly condition: DeferredEffect['condition'];
  readonly effects: readonly Effect[];
  readonly logbookKey?: string;
}

export function emptyOutcome(): EffectOutcome {
  return {
    cashDeltaCents: 0,
    moodDelta: 0,
    energyDelta: 0,
    performanceDelta: 0,
    debtsOpened: [],
    assetTrades: [],
    expenses: [],
    flagsAdded: [],
    flagsRemoved: [],
    jobOffers: [],
    creditEvents: [],
    logbookKeys: [],
    deferred: [],
  };
}

/** Fold a list of effects into a diff. */
export function applyEffects(
  effects: readonly Effect[],
  context: FormulaContext,
  base: EffectOutcome = emptyOutcome(),
): EffectOutcome {
  let out = base;

  for (const effect of effects) {
    switch (effect.k) {
      case 'cash':
        out = { ...out, cashDeltaCents: out.cashDeltaCents + resolveCents(effect.cents, context) };
        break;
      case 'mood':
        out = { ...out, moodDelta: out.moodDelta + resolveMagnitude(effect.delta, context) };
        break;
      case 'energy':
        out = { ...out, energyDelta: out.energyDelta + resolveMagnitude(effect.delta, context) };
        break;
      case 'performance':
        out = {
          ...out,
          performanceDelta: out.performanceDelta + resolveMagnitude(effect.delta, context),
        };
        break;
      case 'debt':
        out = {
          ...out,
          debtsOpened: [
            ...out.debtsOpened,
            { instrument: effect.instrument, principalCents: resolveCents(effect.principalCents, context) },
          ],
        };
        break;
      case 'asset':
        out = {
          ...out,
          assetTrades: [
            ...out.assetTrades,
            { assetId: effect.assetId, sharesDelta: resolveMagnitude(effect.sharesDelta, context) },
          ],
        };
        break;
      case 'expense':
        out = {
          ...out,
          expenses: [
            ...out.expenses,
            {
              category: effect.category,
              cents: resolveCents(effect.cents, context),
              recurring: effect.recurring ?? false,
            },
          ],
        };
        break;
      case 'flag':
        out = {
          ...out,
          flagsAdded: effect.add === undefined ? out.flagsAdded : [...out.flagsAdded, effect.add],
          flagsRemoved:
            effect.remove === undefined ? out.flagsRemoved : [...out.flagsRemoved, effect.remove],
        };
        break;
      case 'jobOffer':
        out = { ...out, jobOffers: [...out.jobOffers, effect.jobId] };
        break;
      case 'creditEvent':
        out = { ...out, creditEvents: [...out.creditEvents, effect.kind] };
        break;
    }
  }

  return out;
}

/**
 * Pick a branch from an outcome roll. One draw, from the `eventOutcome` stream.
 *
 * Branches are walked in declared order, so re-ordering them in content changes
 * what a given draw selects — treat branch order as part of the event's identity.
 */
export function rollOutcome(roll: OutcomeRoll, rng: Rng): OutcomeRoll['branches'][number] {
  const total = roll.branches.reduce((sum, branch) => sum + branch.p, 0);
  let x = rng() * total;
  for (const branch of roll.branches) {
    x -= branch.p;
    if (x <= 0) return branch;
  }
  return roll.branches[roll.branches.length - 1];
}

/**
 * Resolve a whole choice: its effects, an outcome roll if it has one, and any
 * deferred effects scheduled forward from `weekIndex`.
 *
 * The rng is consumed **only** when the choice declares an `outcomeRoll`, so a
 * choice without one costs no draws and cannot shift the stream.
 */
export function resolveChoice(
  choice: Choice,
  context: FormulaContext,
  weekIndex: number,
  rng: Rng,
): EffectOutcome {
  let out = applyEffects(choice.effects, context);
  out = { ...out, logbookKeys: [...out.logbookKeys, choice.logbookKey] };

  if (choice.outcomeRoll !== undefined) {
    const branch = rollOutcome(choice.outcomeRoll, rng);
    out = applyEffects(branch.effects, context, out);
    out = { ...out, logbookKeys: [...out.logbookKeys, branch.logbookKey] };
  }

  if (choice.deferred !== undefined) {
    out = {
      ...out,
      deferred: [
        ...out.deferred,
        ...choice.deferred.map((deferred) => ({
          dueWeek: weekIndex + deferred.afterWeeks,
          condition: deferred.condition,
          effects: deferred.effects,
          logbookKey: deferred.logbookKey,
        })),
      ],
    };
  }

  return out;
}

/** Interpolate `{{var}}` placeholders in an event body. */
export function interpolate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}
