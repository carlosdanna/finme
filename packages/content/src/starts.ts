/**
 * Starting positions — GDD §3.7's table, validated at load, never inlined in
 * TypeScript.
 *
 * The schema mirrors `StartDef` in @finme/engine, and the `satisfies` at the
 * bottom is what keeps the two from drifting — the same arrangement `jobs.ts`
 * has.
 *
 * **The assignment is a hash, not a draw.** `assignedStartId` runs `fnv1a` over
 * the seed and consumes nothing, so no stream gains, loses or reorders a draw
 * and no existing seed moves. Reroll still changes the start, because Reroll
 * changes the seed.
 */
import { type StartDef, assignedStart, resolveStart } from '@finme/engine';
import { z } from 'zod';
import data from '../starts.json' with { type: 'json' };
import { jobById } from './jobs.ts';

/**
 * The baseline row of §3.7's table, and the position every scripted run has
 * always had. `scenarioConfig` with no `startId` must remain byte-identical to
 * it — the golden fixture and the C-suite both call that path.
 */
export const DEFAULT_START_ID = 'stable-ground';

const centsSchema = z.number().int().nonnegative();

export const startingDebtSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('credit-card'),
    balanceCents: centsSchema,
    creditLimitCents: centsSchema.positive(),
  }),
  z.object({
    kind: z.literal('loan'),
    loanType: z.enum(['personal', 'auto', 'student', 'mortgage']),
    principalCents: centsSchema.positive(),
    termMonths: z.number().int().positive().max(480).optional(),
  }),
]);

/** The position itself, without the name on it. A variant overrides any subset. */
const positionShape = {
  startingCashCents: centsSchema,
  startingJobId: z.string().min(1).nullable(),
  educationYears: z.number().int().nonnegative().max(12),
  committedTimePoints: z.number().int().nonnegative().max(9),
  debts: z.array(startingDebtSchema),
};

export const startSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'start ids are stable forever: lowercase, digits and dashes only'),
  label: z.string().min(1),
  blurb: z.string().min(1),
  ...positionShape,
  variants: z.array(z.object(positionShape).partial()).min(1).optional(),
});

export const startsFileSchema = z
  .object({ starts: z.array(startSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const start of file.starts) {
      if (seen.has(start.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate start id '${start.id}' — ids are stable forever and must never be reused`,
        });
      }
      seen.add(start.id);

      // A start that names a job nothing defines would begin a run unemployed
      // and say nothing about it.
      const jobIds = [
        start.startingJobId,
        ...(start.variants ?? []).map((variant) => variant.startingJobId ?? null),
      ];
      for (const jobId of jobIds) {
        if (jobId !== null && jobId !== undefined && jobById(jobId) === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `start '${start.id}' names job '${jobId}', which is not in jobs.json`,
          });
        }
      }
    }

    // The scripted run, the golden fixture and the whole balance harness are
    // this one start. It is the no-argument default and must stay reachable.
    if (!file.starts.some((start) => start.id === DEFAULT_START_ID)) {
      ctx.addIssue({
        code: 'custom',
        message: `starts.json must define '${DEFAULT_START_ID}' — it is the scripted default (GDD §3.7)`,
      });
    }
  });

export type StartsFile = z.infer<typeof startsFileSchema>;

/** Parsed and validated at module load, so a content bug is never a runtime crash. */
export const STARTS: readonly StartDef[] = startsFileSchema.parse(data)
  .starts satisfies readonly StartDef[];

export function startById(id: string): StartDef | undefined {
  return STARTS.find((start) => start.id === id);
}

/**
 * The start a seed is dealt.
 *
 * Pure in the seed and free of every stream, which is the whole point: §3.7
 * assigns rather than offers, and the tempting implementation — a draw from
 * `startingDraw` — is the one thing that cannot be done, because that stream is
 * consumed in a contractual order and an inserted draw would shift the entry
 * credit score of every existing seed.
 */
export function assignedStartId(seed: string): string {
  return assignedStart(STARTS, seed).id;
}

export { resolveStart };
