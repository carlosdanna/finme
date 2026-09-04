/**
 * Logbook templates and run-scoped names — validated at load.
 *
 * Placeholder copy: three variants per key. Real writing is a separate
 * workstream (GDD §12 sizes it at ~280 entries). The schema enforces the floor
 * so a key can never ship with one variant and start repeating immediately.
 *
 * **Adding, removing or reordering variants must never change a simulation
 * value.** That is guaranteed by the `flavor` stream being the only source of
 * randomness the Logbook touches — asserted in the engine tests.
 */
import type { RunNames, TemplatePools } from '@finme/engine';
import { z } from 'zod';
import names from '../logbook/names.json' with { type: 'json' };
import templates from '../logbook/templates.json' with { type: 'json' };
import { referencedLogbookKeys } from './events.ts';

/** [T] Minimum variants per key. Below this the Logbook repeats immediately. */
export const MIN_VARIANTS_PER_KEY = 3;

const templateStringSchema = z
  .string()
  .min(1)
  .refine(
    (text) => !/\b(should|shouldn't|mistake|wisely|foolish|smart move|well done|good job|congratulations)\b/i.test(text),
    'the Logbook narrates; it never approves or advises (GDD §1)',
  );

export const templatesFileSchema = z
  .object({
    templates: z.record(z.string().min(1), z.array(templateStringSchema).min(MIN_VARIANTS_PER_KEY)),
  })
  .superRefine((file, ctx) => {
    for (const [key, pool] of Object.entries(file.templates)) {
      if (new Set(pool).size !== pool.length) {
        ctx.addIssue({ code: 'custom', message: `key '${key}' has duplicate variants` });
      }
    }
  });

export const namesFileSchema = z.object({
  friendNames: z.array(z.string().min(1)).min(4),
  advisorNames: z.array(z.string().min(1)).min(4),
});

export const LOGBOOK_TEMPLATES: TemplatePools = templatesFileSchema.parse(templates).templates;

const parsedNames = namesFileSchema.parse(names);
export const FRIEND_NAMES: readonly string[] = parsedNames.friendNames;
export const ADVISOR_NAMES: readonly string[] = parsedNames.advisorNames;

/**
 * Draw the run's stable names. Two draws, from `startingDraw` — the caller
 * supplies the stream, so this stays pure and the names are a property of the
 * seed rather than of when they were first needed.
 */
export function drawRunNames(rng: () => number): RunNames {
  return {
    friendName: FRIEND_NAMES[Math.floor(rng() * FRIEND_NAMES.length)],
    advisorName: ADVISOR_NAMES[Math.floor(rng() * ADVISOR_NAMES.length)],
  };
}

/** Logbook keys the event content references but which have no prose yet. */
export function missingTemplateKeys(): string[] {
  return referencedLogbookKeys().filter((key) => LOGBOOK_TEMPLATES[key] === undefined);
}
