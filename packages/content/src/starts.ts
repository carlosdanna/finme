/**
 * Starting positions — GDD §3.7's table, validated at load.
 *
 * The schema mirrors `StartDef` in @finme/engine; the `satisfies` at the bottom
 * is what keeps the two from drifting, as in `jobs.ts`.
 */
import { type StartDef, assignedStart, resolveStart } from '@finme/engine';
import { z } from 'zod';
import data from '../starts.json' with { type: 'json' };
import { jobById } from './jobs.ts';

/**
 * The baseline row, and the position every scripted run has always had.
 * `scenarioConfig` with no `startId` must stay byte-identical to it — the
 * golden fixture and the C-suite both call that path.
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

/** A variant overrides any subset of these. */
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

/** The start a seed is dealt — a hash, never a draw. See `starts.ts` in the engine. */
export function assignedStartId(seed: string): string {
  return assignedStart(STARTS, seed).id;
}

export { resolveStart };
