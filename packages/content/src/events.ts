/**
 * Event definitions — validated at load, never inlined in TypeScript.
 *
 * Beyond types, this file enforces the content lint from BUILD-PLAN prompt 12:
 * every choice carries a `logbookKey`, no choice silently does nothing, and no
 * id collides. **Event ids are stable forever** — a rename silently changes what
 * every existing seed produces.
 */
import {
  BASE_WEIGHT_COMMON,
  BASE_WEIGHT_UNCOMMON,
  EVENT_CATEGORIES,
  type EventDef,
  FORMULA_FUNCTIONS,
  evaluateFormula,
  placeholdersIn,
} from '@finme/engine';
import { z } from 'zod';
import data from '../events/mvp.json' with { type: 'json' };

/** Placeholders the run supplies rather than the event (TDD §12). */
export const RUN_SCOPED_VARS: readonly string[] = ['friendName', 'advisorName'];

/** A magnitude is a literal number or a formula string (TDD §9.3). */
const magnitudeSchema = z.union([z.number(), z.string().min(1)]);

/**
 * One `{{placeholder}}` value: what to compute, and how to render it. `number`
 * is bare, for prose that supplies its own unit — the bodies read "{{raisePct}}
 * percent", so a `<Pct>` would print the symbol twice.
 */
const displayVarSchema = z.object({
  as: z.enum(['money', 'number']),
  value: magnitudeSchema,
  /** Decimal places for `number`. Ignored for `money`. */
  precision: z.number().int().min(0).max(2).optional(),
});

/** A card field: one string, or a pool of variants. */
const cardTextSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const asPool = (value: string | readonly string[]): readonly string[] =>
  Array.isArray(value) ? value : [value as string];

/**
 * [T] Minimum card variants by rarity tier (`docs/EVENT-CATALOGUE.md` §3.3),
 * budgeted by how often the tier repeats. The Logbook has had a floor of 3 per
 * key since it shipped, for the same reason — see `MIN_VARIANTS_PER_KEY`.
 */
export const MIN_CARD_VARIANTS: Readonly<Record<'common' | 'uncommon' | 'rare', number>> = {
  common: 3,
  uncommon: 2,
  rare: 1,
};

const comparisonOpSchema = z.enum(['<', '<=', '>', '>=', '==', '!=']);

const gateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('age'), op: comparisonOpSchema, value: z.number() }),
  z.object({ type: z.literal('flag'), value: z.string().min(1) }),
  z.object({ type: z.literal('notFlag'), value: z.string().min(1) }),
  z.object({ type: z.literal('employed'), value: z.boolean().optional() }),
  z.object({ type: z.literal('ownsCar'), value: z.boolean().optional() }),
  z.object({ type: z.literal('ownsHome'), value: z.boolean().optional() }),
  z.object({ type: z.literal('hasDebtType'), value: z.string().min(1) }),
  z.object({ type: z.literal('holdsAsset'), value: z.string().min(1) }),
  z.object({ type: z.literal('lifeStage'), value: z.string().min(1) }),
  z.object({
    type: z.literal('stat'),
    stat: z.string().min(1),
    op: comparisonOpSchema,
    // A string names another stat to compare against.
    value: z.union([z.number(), z.string().min(1)]),
  }),
]);

const effectSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('cash'), cents: magnitudeSchema }),
  z.object({ k: z.literal('mood'), delta: magnitudeSchema }),
  z.object({ k: z.literal('energy'), delta: magnitudeSchema }),
  z.object({ k: z.literal('performance'), delta: magnitudeSchema }),
  z.object({
    k: z.literal('debt'),
    instrument: z.enum(['CREDIT_CARD', 'PERSONAL_LOAN', 'AUTO_LOAN', 'BNPL', 'PAYDAY']),
    principalCents: magnitudeSchema,
  }),
  z.object({ k: z.literal('asset'), assetId: z.string().min(1), sharesDelta: magnitudeSchema }),
  z.object({
    k: z.literal('expense'),
    category: z.string().min(1),
    cents: magnitudeSchema,
    recurring: z.boolean().optional(),
  }),
  z
    .object({ k: z.literal('flag'), add: z.string().min(1).optional(), remove: z.string().min(1).optional() })
    .refine((e) => e.add !== undefined || e.remove !== undefined, 'a flag effect must add or remove something'),
  z.object({ k: z.literal('jobOffer'), jobId: z.string().min(1) }),
  z.object({ k: z.literal('creditEvent'), kind: z.enum(['missed', 'onTime', 'collection', 'inquiry']) }),
]);

const deferredSchema = z.object({
  afterWeeks: z.number().int().positive(),
  condition: gateSchema.optional(),
  effects: z.array(effectSchema).min(1),
  logbookKey: z.string().min(1).optional(),
});

const outcomeRollSchema = z.object({
  stream: z.literal('eventOutcome'),
  branches: z
    .array(
      z.object({
        p: z.union([z.number(), z.string().min(1)]),
        effects: z.array(effectSchema),
        logbookKey: z.string().min(1),
      }),
    )
    .min(2),
});

const choiceSchema = z
  .object({
    id: z.string().min(1).regex(/^[a-z0-9_]+$/, 'choice ids are lowercase, digits and underscores'),
    label: z.string().min(1),
    requires: z.array(gateSchema).optional(),
    effects: z.array(effectSchema),
    noop: z.boolean().optional(),
    deferred: z.array(deferredSchema).optional(),
    outcomeRoll: outcomeRollSchema.optional(),
    logbookKey: z.string().min(1),
  })
  .superRefine((choice, ctx) => {
    // A choice must do something, or say plainly that it does not. This is the
    // lint that catches an author who simply forgot the effects.
    const doesSomething =
      choice.effects.length > 0 ||
      choice.outcomeRoll !== undefined ||
      (choice.deferred?.length ?? 0) > 0;
    if (!doesSomething && choice.noop !== true) {
      ctx.addIssue({
        code: 'custom',
        message: `choice '${choice.id}' has no effects — add them, or mark it "noop": true if it deliberately does nothing`,
      });
    }
  });

export const eventSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[A-Z]{3}_[A-Z0-9_]+$/, 'event ids are PREFIX_UPPER_SNAKE and are stable forever'),
    category: z.enum(EVENT_CATEGORIES),
    baseWeight: z.number().positive(),
    oncePerRun: z.boolean().optional(),
    cooldownWeeks: z.number().int().nonnegative(),
    gates: z.array(gateSchema),
    multipliers: z.array(z.object({ when: gateSchema, factor: z.number().positive() })),
    title: cardTextSchema,
    body: cardTextSchema,
    /**
     * Values for the `{{placeholders}}` in `title` and `body`. Magnitudes in
     * the same language as an effect's, against the same context and `roll`.
     */
    displayVars: z.record(z.string().min(1), displayVarSchema).optional(),
    choices: z.array(choiceSchema).min(2),
  })
  .superRefine((event, ctx) => {
    const choiceIds = new Set<string>();
    for (const choice of event.choices) {
      if (choiceIds.has(choice.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate choice id '${choice.id}' in ${event.id}` });
      }
      choiceIds.add(choice.id);
    }

    // `interpolate` passes an unknown key through as literal text, so without
    // this a typo ships as `{{repairCost}}` on the card.
    const declared = new Set([...Object.keys(event.displayVars ?? {}), ...RUN_SCOPED_VARS]);
    const titles = asPool(event.title);
    const bodies = asPool(event.body);

    for (const [field, pool] of [['title', titles], ['body', bodies]] as const) {
      for (const text of pool) {
        for (const key of placeholdersIn(text)) {
          if (!declared.has(key)) {
            ctx.addIssue({
              code: 'custom',
              message: `${event.id}: ${field} references {{${key}}}, which nothing provides — add it to displayVars`,
            });
          }
        }
      }
    }

    const allText = [...titles, ...bodies];
    for (const key of Object.keys(event.displayVars ?? {})) {
      if (!allText.some((text) => placeholdersIn(text).includes(key))) {
        ctx.addIssue({
          code: 'custom',
          message: `${event.id}: displayVars.${key} is never referenced by title or body`,
        });
      }
    }

    // A variant is a whole card, so the pools must line up.
    if (titles.length > 1 && bodies.length > 1 && titles.length !== bodies.length) {
      ctx.addIssue({
        code: 'custom',
        message: `${event.id}: ${titles.length} titles against ${bodies.length} bodies — a variant is a title and a body together`,
      });
    }

    const tier =
      event.baseWeight >= BASE_WEIGHT_COMMON
        ? 'common'
        : event.baseWeight >= BASE_WEIGHT_UNCOMMON
          ? 'uncommon'
          : 'rare';
    const variants = Math.max(titles.length, bodies.length);
    if (variants < MIN_CARD_VARIANTS[tier]) {
      ctx.addIssue({
        code: 'custom',
        message: `${event.id} is ${tier} and fires often enough to need ${MIN_CARD_VARIANTS[tier]} card variants — it has ${variants}`,
      });
    }
  });

export const eventsFileSchema = z
  .object({ events: z.array(eventSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const event of file.events) {
      if (seen.has(event.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate event id '${event.id}' — ids are stable forever and must never be reused`,
        });
      }
      seen.add(event.id);
    }
  });

export type EventsFile = z.infer<typeof eventsFileSchema>;

/** Parsed and validated at module load, so a content bug is never a runtime crash. */
export const EVENTS: readonly EventDef[] = eventsFileSchema.parse(data).events satisfies readonly EventDef[];

export function eventById(id: string): EventDef | undefined {
  return EVENTS.find((event) => event.id === id);
}

/** Every logbook key the event content references, sorted and deduplicated. */
export function referencedLogbookKeys(events: readonly EventDef[] = EVENTS): string[] {
  const keys = new Set<string>();
  for (const event of events) {
    for (const choice of event.choices) {
      keys.add(choice.logbookKey);
      for (const branch of choice.outcomeRoll?.branches ?? []) keys.add(branch.logbookKey);
      for (const deferred of choice.deferred ?? []) {
        if (deferred.logbookKey !== undefined) keys.add(deferred.logbookKey);
      }
    }
  }
  return [...keys].sort();
}

/** Every formula string in the content, with where it came from. */
export function collectFormulas(
  events: readonly EventDef[] = EVENTS,
): { readonly eventId: string; readonly source: string }[] {
  const found: { eventId: string; source: string }[] = [];
  const push = (eventId: string, value: unknown): void => {
    if (typeof value === 'string') found.push({ eventId, source: value });
  };

  for (const event of events) {
    for (const choice of event.choices) {
      const effectGroups = [
        choice.effects,
        ...(choice.outcomeRoll?.branches ?? []).map((b) => b.effects),
        ...(choice.deferred ?? []).map((d) => d.effects),
      ];
      for (const effects of effectGroups) {
        for (const effect of effects) {
          if ('cents' in effect) push(event.id, effect.cents);
          if ('delta' in effect) push(event.id, effect.delta);
          if ('principalCents' in effect) push(event.id, effect.principalCents);
          if ('sharesDelta' in effect) push(event.id, effect.sharesDelta);
        }
      }
      for (const branch of choice.outcomeRoll?.branches ?? []) {
        if (typeof branch.p === 'string' && branch.p !== 'rest') push(event.id, branch.p);
      }
    }

    // Card values are formulas too; omitting them let a typo'd variable pass
    // every check and then throw out of the tick.
    for (const spec of Object.values(event.displayVars ?? {})) {
      push(event.id, spec.value);
    }
  }
  return found;
}

/** Names the formula evaluator will accept as a function call. */
export const ALLOWED_FORMULA_FUNCTIONS: readonly string[] = FORMULA_FUNCTIONS;

/** Re-exported so the lint test can parse content formulas against real vars. */
export { evaluateFormula };
